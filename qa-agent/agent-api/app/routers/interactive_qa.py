"""Interactive QA Buddy API endpoints."""

import uuid
import json
import logging
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, HTTPException, Body
from pydantic import BaseModel, Field

from app.models.run_context import RunContext, AuthConfig, Question, AnswerRequest
from app.models.run_state import RunState
from app.services.run_store import RunStore
from app.services.browser_manager import get_browser_manager
from app.services.session_checker import get_session_checker
from app.services.login_detector import get_login_detector
from app.services.login_executor import get_login_executor
from app.services.post_login_validator import get_post_login_validator
from app.services.context_detector import get_context_detector
from app.services.discovery_runner import get_discovery_runner
from app.services.discovery_summarizer import get_discovery_summarizer
from app.services.test_plan_builder import get_test_plan_builder
from app.services.test_executor import get_test_executor
from app.services.report_generator import get_report_generator

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/runs", tags=["Interactive QA"])

# Global run store instance
_run_store = RunStore()


# =============================================================================
# Request/Response Models
# =============================================================================

class StartRunRequest(BaseModel):
    """Request to start a new interactive QA run."""
    
    base_url: str = Field(..., description="Base application URL", examples=["https://app.example.com"])
    env: Optional[str] = Field("staging", description="Environment name", examples=["staging", "dev", "prod"])
    headless: Optional[bool] = Field(True, description="Run browser in headless mode")
    auth: Optional[AuthConfig] = Field(None, description="Authentication configuration")
    
    class Config:
        json_schema_extra = {
            "example": {
                "base_url": "https://app.example.com",
                "env": "staging",
                "headless": True,
                "auth": {
                    "type": "keycloak",
                    "username": "user@example.com"
                }
            }
        }


class StartRunResponse(BaseModel):
    """Response from starting a run."""
    
    run_id: str = Field(..., description="Unique run identifier")
    state: str = Field(..., description="Current run state")
    question: Optional[Question] = Field(None, description="Question if waiting for input")
    
    class Config:
        json_schema_extra = {
            "example": {
                "run_id": "abc123def456",
                "state": "WAIT_LOGIN_INPUT",
                "question": {
                    "id": "login_creds",
                    "type": "text",
                    "text": "Please provide login credentials (username,password or JSON)"
                }
            }
        }


class RunStatusResponse(BaseModel):
    """Response for run status query."""
    
    run_id: str = Field(..., description="Unique run identifier")
    state: str = Field(..., description="Current run state")
    question: Optional[Question] = Field(None, description="Question if waiting for input")
    progress: Optional[int] = Field(None, description="Progress percentage (0-100)")
    last_step: Optional[str] = Field(None, description="Last completed step name")
    current_url: Optional[str] = Field(None, description="Current page URL")
    
    class Config:
        json_schema_extra = {
            "example": {
                "run_id": "abc123def456",
                "state": "WAIT_LOGIN_INPUT",
                "question": {
                    "id": "login_creds",
                    "type": "text",
                    "text": "Please provide login credentials"
                },
                "progress": 15,
                "last_step": "OPEN_URL",
                "current_url": "https://app.example.com/login"
            }
        }


class AnswerResponse(BaseModel):
    """Response from answering a question."""
    
    run_id: str = Field(..., description="Run identifier")
    state: str = Field(..., description="Updated run state")
    question: Optional[Question] = Field(None, description="Next question if waiting for input")
    message: Optional[str] = Field(None, description="Status message")
    
    class Config:
        json_schema_extra = {
            "example": {
                "run_id": "abc123def456",
                "state": "LOGIN_ATTEMPT",
                "question": None,
                "message": "Credentials accepted, attempting login..."
            }
        }


# =============================================================================
# Endpoints
# =============================================================================

@router.post("/start", response_model=StartRunResponse, summary="Start a new interactive QA run")
async def start_run(request: StartRunRequest = Body(...)) -> StartRunResponse:
    """
    Start a new interactive QA Buddy run.
    
    Creates a new run context, opens the base URL, and performs SESSION_CHECK.
    The run will progress through states and may pause to ask questions.
    
    **Note**: Discovery and tests are not executed yet - only session checking.
    """
    run_id = str(uuid.uuid4())[:12]
    
    try:
        # Create run context
        context = _run_store.create_run(
            run_id=run_id,
            base_url=request.base_url,
            env=request.env or "staging",
            headless=request.headless if request.headless is not None else True,
            auth=request.auth
        )
        
        # Transition to OPEN_URL (opens URL in check_session)
        context = _run_store.transition_state(run_id, RunState.OPEN_URL)
        
        # Transition to SESSION_CHECK
        context = _run_store.transition_state(run_id, RunState.SESSION_CHECK)
        
        # Perform SESSION_CHECK
        browser_manager = get_browser_manager()
        session_checker = get_session_checker()
        
        # Get or create browser page
        page = await browser_manager.get_page(run_id)
        
        # Perform session check (this opens the URL and checks session state)
        check_result = await session_checker.check_session(
            page=page,
            base_url=request.base_url,
            run_id=run_id,
            artifacts_path=context.artifacts_path
        )
        
        # Update context with current URL
        current_url = page.url
        context = _run_store.update_run(run_id, current_url=current_url)
        
        # Transition to next state based on check result
        next_state = check_result["next_state"]
        context = _run_store.transition_state(run_id, next_state)
        
        # If transitioning to LOGIN_DETECT, perform login detection
        if next_state == RunState.LOGIN_DETECT:
            login_detector = get_login_detector()
            keycloak_detected = check_result["status"] == "keycloak"
            detect_result = await login_detector.detect_login(
                run_id=run_id,
                context=context,
                keycloak_detected=keycloak_detected
            )
            
            # Update auth if needed
            if detect_result["auth_updated"]:
                context = _run_store.update_run(run_id, auth=context.auth)
            
            # Transition to next state from login detection
            next_state = detect_result["next_state"]
            context = _run_store.transition_state(run_id, next_state)
            
            # Update question if credentials needed
            if detect_result["question"]:
                context = _run_store.update_run(run_id, question=detect_result["question"])
            
            # Get updated context after login detection
            context = _run_store.get_run(run_id)
            next_state = detect_result["next_state"]
            
            # If transitioning to LOGIN_ATTEMPT, execute login
            if next_state == RunState.LOGIN_ATTEMPT:
                if not context.auth or not context.auth.username or not context.auth.password:
                    # Should not happen, but safety check
                    logger.error(f"[{run_id}] LOGIN_ATTEMPT without credentials")
                    question = Question(
                        id="login_creds",
                        type="text",
                        text="Credentials missing. Please provide login credentials."
                    )
                    context = _run_store.transition_state(run_id, RunState.WAIT_LOGIN_INPUT)
                    context = _run_store.update_run(run_id, question=question)
                else:
                    # Execute login attempt
                    login_executor = get_login_executor()
                    login_result = await login_executor.attempt_login(
                        page=page,
                        run_id=run_id,
                        base_url=request.base_url,
                        username=context.auth.username,
                        password=context.auth.password,
                        artifacts_path=context.artifacts_path
                    )
                    
                    # Update current URL
                    current_url = page.url
                    context = _run_store.update_run(run_id, current_url=current_url)
                    
                    # Transition to next state
                    next_state = login_result["next_state"]
                    context = _run_store.transition_state(run_id, next_state)
                    
                    # Update question if needed
                    if login_result["question"]:
                        context = _run_store.update_run(run_id, question=login_result["question"])
                    
                    # If transitioning to POST_LOGIN_VALIDATE, perform validation
                    if login_result["next_state"] == RunState.POST_LOGIN_VALIDATE:
                        post_login_validator = get_post_login_validator()
                        validation_result = await post_login_validator.validate_session(
                            page=page,
                            run_id=run_id,
                            base_url=request.base_url,
                            artifacts_path=context.artifacts_path
                        )
                        
                        # Update current URL
                        context = _run_store.update_run(run_id, current_url=validation_result["current_url"])
                        
                        # Transition to next state
                        next_state = validation_result["next_state"]
                        context = _run_store.transition_state(run_id, next_state)
                        
                        # Update question if bounced
                        if validation_result["question"]:
                            context = _run_store.update_run(run_id, question=validation_result["question"])
                        else:
                            # If transitioning to CONTEXT_DETECT, perform context detection
                            if validation_result["next_state"] == RunState.CONTEXT_DETECT:
                                context_detector = get_context_detector()
                                detect_result = await context_detector.detect_context(
                                    page=page,
                                    run_id=run_id,
                                    artifacts_path=context.artifacts_path
                                )
                                
                                # Update selected context if single option
                                if detect_result.get("selected_context"):
                                    context = _run_store.update_run(run_id, selected_context=detect_result["selected_context"])
                                
                                # Transition to next state
                                next_state = detect_result["next_state"]
                                context = _run_store.transition_state(run_id, next_state)
                                
                                # Update question if multiple options
                                if detect_result["question"]:
                                    context = _run_store.update_run(run_id, question=detect_result["question"])
                                else:
                                    # If transitioning to DISCOVERY_RUN, execute discovery
                                    if detect_result["next_state"] == RunState.DISCOVERY_RUN:
                                        discovery_runner = get_discovery_runner()
                                        discovery_result = await discovery_runner.run_discovery(
                                            page=page,
                                            run_id=run_id,
                                            base_url=request.base_url,
                                            artifacts_path=context.artifacts_path
                                        )
                                        
                                        # Store discovery summary in context
                                        context = _run_store.update_run(
                                            run_id,
                                            discovery_summary=discovery_result.get("summary", {})
                                        )
                                        
                                        # Transition to DISCOVERY_SUMMARY
                                        context = _run_store.transition_state(run_id, RunState.DISCOVERY_SUMMARY)
                                        
                                        # Generate discovery summary and transition to WAIT_TEST_INTENT
                                        discovery_summarizer = get_discovery_summarizer()
                                        summary_result = await discovery_summarizer.generate_summary(
                                            page=page,
                                            run_id=run_id,
                                            artifacts_path=context.artifacts_path
                                        )
                                        
                                        # Store detailed summary in context
                                        context = _run_store.update_run(
                                            run_id,
                                            discovery_summary=summary_result["summary"]
                                        )
                                        
                                        # Transition to WAIT_TEST_INTENT
                                        context = _run_store.transition_state(run_id, summary_result["next_state"])
                                        
                                        # Update question
                                        if summary_result["question"]:
                                            context = _run_store.update_run(run_id, question=summary_result["question"])
            else:
                # Update question if ambiguous (from SESSION_CHECK)
                if check_result["question"]:
                    context = _run_store.update_run(run_id, question=check_result["question"])
        
        # Get updated context
        context = _run_store.get_run(run_id)
        
        return StartRunResponse(
            run_id=context.run_id,
            state=context.state.value,
            question=context.question
        )
    
    except Exception as e:
        logger.error(f"Failed to start run: {e}", exc_info=True)
        # Cleanup browser context on error
        try:
            browser_manager = get_browser_manager()
            await browser_manager.close_context(run_id)
        except:
            pass
        raise HTTPException(status_code=500, detail=f"Failed to start run: {str(e)}")


@router.get("/{run_id}/report", summary="Get HTML report for a run")
async def get_report(run_id: str):
    """
    Get HTML report for a run.
    
    Returns the generated HTML report if available.
    """
    context = _run_store.get_run(run_id)
    if not context:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")
    
    report_path = Path(context.artifacts_path) / "report.html"
    
    if not report_path.exists():
        # Try to generate report
        report_generator = get_report_generator()
        try:
            result = report_generator.generate_html_report(
                run_id=run_id,
                artifacts_path=context.artifacts_path
            )
            report_path = Path(result["html_path"])
        except Exception as e:
            raise HTTPException(
                status_code=404,
                detail=f"Report not found and generation failed: {str(e)[:200]}"
            )
    
    # Read and return HTML
    with open(report_path, "r", encoding="utf-8") as f:
        html_content = f.read()
    
    from fastapi.responses import HTMLResponse
    return HTMLResponse(content=html_content)


@router.get("/{run_id}/status", response_model=RunStatusResponse, summary="Get run status")
async def get_run_status(run_id: str) -> RunStatusResponse:
    """
    Get the current status of a run.
    
    Returns the current state, any pending question, progress, and other metadata.
    """
    context = _run_store.get_run(run_id)
    if not context:
        raise HTTPException(status_code=404, detail=f"Run not found: {run_id}")
    
    # Calculate progress based on state
    progress = _calculate_progress(context.state)
    
    # Get last step from timestamps (most recent state before current)
    last_step = None
    if len(context.timestamps) > 1:
        # Get second-to-last state
        states = list(context.timestamps.keys())
        if len(states) >= 2:
            last_step = states[-2]
    
    return RunStatusResponse(
        run_id=context.run_id,
        state=context.state.value,
        question=context.question,
        progress=progress,
        last_step=last_step,
        current_url=context.current_url
    )


@router.post("/{run_id}/answer", response_model=AnswerResponse, summary="Answer a question")
async def answer_question(
    run_id: str,
    request: AnswerRequest = Body(...)
) -> AnswerResponse:
    """
    Answer a question for an interactive run.
    
    Handles different question types:
    - **text**: Accepts text input (e.g., credentials)
    - **select_one**: Accepts option ID selection
    - **confirm**: Accepts yes/no answer
    
    **Note**: State transitions and UI interactions are not implemented yet.
    This endpoint only updates the run context.
    """
    context = _run_store.get_run(run_id)
    if not context:
        raise HTTPException(status_code=404, detail=f"Run not found: {run_id}")
    
    # Handle free_text commands (special case)
    if request.question_id == "free_text":
        # Store free_text command
        if not context.free_text_commands:
            context.free_text_commands = []
        context.free_text_commands.append(request.answer)
        context = _run_store.update_run(run_id, free_text_commands=context.free_text_commands)
        
        logger.info(f"[{run_id}] Free text command received: {request.answer[:100]}")
        
        # Log the command (for now, just acknowledge)
        # In future, this can be used to influence TEST_PLAN_BUILD
        message = f"Command received: {request.answer[:100]}"
        
        # Return current status
        context = _run_store.get_run(run_id)
        return AnswerResponse(
            run_id=context.run_id,
            state=context.state.value,
            question=context.question,
            message=message,
            current_url=context.current_url
        )
    
    # Validate question_id matches current question
    if context.question and context.question.id != request.question_id:
        raise HTTPException(
            status_code=400,
            detail=f"Question ID mismatch. Expected: {context.question.id}, got: {request.question_id}"
        )
    
    # Handle answer based on current state
    message = None
    new_state = context.state
    next_question = None
    
    try:
        if context.state == RunState.WAIT_LOGIN_INPUT:
            # Parse credentials
            if context.question and context.question.type == "text":
                # Try to parse answer as JSON or comma-separated
                import json
                try:
                    creds = json.loads(request.answer)
                    username = creds.get("username", "")
                    password = creds.get("password", "")
                except:
                    # Try comma-separated format
                    parts = request.answer.split(",", 1)
                    username = parts[0].strip() if len(parts) > 0 else ""
                    password = parts[1].strip() if len(parts) > 1 else ""
                
                # Update auth config
                if context.auth:
                    context.auth.username = username
                    context.auth.password = password
                else:
                    context.auth = AuthConfig(
                        type="keycloak",
                        username=username,
                        password=password
                    )
                
                context = _run_store.update_run(run_id, auth=context.auth)
                new_state = RunState.LOGIN_ATTEMPT
                context = _run_store.transition_state(run_id, new_state)
                
                # Execute login attempt
                browser_manager = get_browser_manager()
                login_executor = get_login_executor()
                
                try:
                    page = await browser_manager.get_page(run_id)
                    login_result = await login_executor.attempt_login(
                        page=page,
                        run_id=run_id,
                        base_url=context.base_url,
                        username=context.auth.username,
                        password=context.auth.password,
                        artifacts_path=context.artifacts_path
                    )
                    
                    # Update current URL
                    current_url = page.url
                    context = _run_store.update_run(run_id, current_url=current_url)
                    
                    # Transition to next state
                    new_state = login_result["next_state"]
                    context = _run_store.transition_state(run_id, new_state)
                    
                    # Update question if needed
                    if login_result["question"]:
                        context = _run_store.update_run(run_id, question=login_result["question"])
                        message = login_result.get("error_message") or "Login attempt completed"
                    else:
                        # Login successful - perform post-login validation
                        if login_result["next_state"] == RunState.POST_LOGIN_VALIDATE:
                            post_login_validator = get_post_login_validator()
                            validation_result = await post_login_validator.validate_session(
                                page=page,
                                run_id=run_id,
                                base_url=context.base_url,
                                artifacts_path=context.artifacts_path
                            )
                            
                            # Update current URL
                            context = _run_store.update_run(run_id, current_url=validation_result["current_url"])
                            
                            # Transition to next state
                            new_state = validation_result["next_state"]
                            context = _run_store.transition_state(run_id, new_state)
                            
                            # Update question if bounced
                            if validation_result["question"]:
                                context = _run_store.update_run(run_id, question=validation_result["question"])
                                message = "Session not established - bounced back to Keycloak"
                            else:
                                # Session validated - perform context detection
                                if validation_result["next_state"] == RunState.CONTEXT_DETECT:
                                    context_detector = get_context_detector()
                                    detect_result = await context_detector.detect_context(
                                        page=page,
                                        run_id=run_id,
                                        artifacts_path=context.artifacts_path
                                    )
                                    
                                    # Update selected context if single option
                                    if detect_result.get("selected_context"):
                                        context = _run_store.update_run(run_id, selected_context=detect_result["selected_context"])
                                    
                                    # Transition to next state
                                    new_state = detect_result["next_state"]
                                    context = _run_store.transition_state(run_id, new_state)
                                    
                                    # Update question if multiple options
                                    if detect_result["question"]:
                                        context = _run_store.update_run(run_id, question=detect_result["question"])
                                        message = "Multiple contexts detected - please select one"
                                    else:
                                        # Context selected - proceed to discovery
                                        if detect_result["next_state"] == RunState.DISCOVERY_RUN:
                                            discovery_runner = get_discovery_runner()
                                            discovery_result = await discovery_runner.run_discovery(
                                                page=page,
                                                run_id=run_id,
                                                base_url=context.base_url,
                                                artifacts_path=context.artifacts_path
                                            )
                                            
                                            # Store discovery summary in context
                                            context = _run_store.update_run(
                                                run_id,
                                                discovery_summary=discovery_result.get("summary", {})
                                            )
                                            
                                            # Transition to DISCOVERY_SUMMARY
                                            context = _run_store.transition_state(run_id, RunState.DISCOVERY_SUMMARY)
                                            
                                            # Generate discovery summary and transition to WAIT_TEST_INTENT
                                            discovery_summarizer = get_discovery_summarizer()
                                            summary_result = await discovery_summarizer.generate_summary(
                                                page=page,
                                                run_id=run_id,
                                                artifacts_path=context.artifacts_path
                                            )
                                            
                                            # Store detailed summary in context
                                            context = _run_store.update_run(
                                                run_id,
                                                discovery_summary=summary_result["summary"]
                                            )
                                            
                                            # Transition to WAIT_TEST_INTENT
                                            context = _run_store.transition_state(run_id, summary_result["next_state"])
                                            
                                            # Update question
                                            if summary_result["question"]:
                                                context = _run_store.update_run(run_id, question=summary_result["question"])
                                            
                                            message = f"Discovery completed: {summary_result['summary']['pages_count']} pages, {summary_result['summary']['forms_count']} forms found"
                                        else:
                                            message = f"Login successful and context detected: {detect_result.get('selected_context', 'default')}"
                                else:
                                    message = "Login successful and session validated"
                        else:
                            message = "Login successful"
                except Exception as e:
                    logger.error(f"[{run_id}] Login execution failed: {e}", exc_info=True)
                    # Fallback to asking for credentials again
                    question = Question(
                        id="login_creds",
                        type="text",
                        text=f"Login execution failed: {str(e)[:200]}. Please try again."
                    )
                    new_state = RunState.WAIT_LOGIN_INPUT
                    context = _run_store.transition_state(run_id, new_state)
                    context = _run_store.update_run(run_id, question=question)
                    message = "Login execution failed"
        
        elif context.state == RunState.WAIT_CONTEXT_INPUT:
            # Store selected context
            context = _run_store.update_run(run_id, selected_context=request.answer)
            new_state = RunState.DISCOVERY_RUN
            context = _run_store.transition_state(run_id, new_state)
            
            # Execute discovery
            browser_manager = get_browser_manager()
            discovery_runner = get_discovery_runner()
            
            try:
                page = await browser_manager.get_page(run_id)
                discovery_result = await discovery_runner.run_discovery(
                    page=page,
                    run_id=run_id,
                    base_url=context.base_url,
                    artifacts_path=context.artifacts_path
                )
                
                # Store discovery summary in context
                context = _run_store.update_run(
                    run_id,
                    discovery_summary=discovery_result.get("summary", {})
                )
                
                # Transition to DISCOVERY_SUMMARY
                context = _run_store.transition_state(run_id, RunState.DISCOVERY_SUMMARY)
                
                # Generate discovery summary and transition to WAIT_TEST_INTENT
                discovery_summarizer = get_discovery_summarizer()
                summary_result = await discovery_summarizer.generate_summary(
                    page=page,
                    run_id=run_id,
                    artifacts_path=context.artifacts_path
                )
                
                # Store detailed summary in context
                context = _run_store.update_run(
                    run_id,
                    discovery_summary=summary_result["summary"]
                )
                
                # Transition to WAIT_TEST_INTENT
                context = _run_store.transition_state(run_id, summary_result["next_state"])
                
                # Update question
                if summary_result["question"]:
                    context = _run_store.update_run(run_id, question=summary_result["question"])
                
                message = f"Context selected: {request.answer}. Discovery completed: {summary_result['summary']['pages_count']} pages, {summary_result['summary']['forms_count']} forms found"
            except Exception as e:
                logger.error(f"[{run_id}] Discovery execution failed: {e}", exc_info=True)
                message = f"Context selected: {request.answer}. Discovery failed: {str(e)[:200]}"
        
        elif context.state == RunState.WAIT_LOGIN_CONFIRM:
            # Handle yes/no answer
            answer_lower = request.answer.lower().strip()
            if answer_lower in ["yes", "y", "true", "1"]:
                # User says they are logged in - proceed to context detection
                new_state = RunState.CONTEXT_DETECT
                context = _run_store.transition_state(run_id, new_state)
                
                # Perform context detection
                browser_manager = get_browser_manager()
                context_detector = get_context_detector()
                
                try:
                    page = await browser_manager.get_page(run_id)
                    detect_result = await context_detector.detect_context(
                        page=page,
                        run_id=run_id,
                        artifacts_path=context.artifacts_path
                    )
                    
                    # Update selected context if single option
                    if detect_result.get("selected_context"):
                        context = _run_store.update_run(run_id, selected_context=detect_result["selected_context"])
                    
                    # Transition to next state
                    new_state = detect_result["next_state"]
                    context = _run_store.transition_state(run_id, new_state)
                    
                    # Update question if multiple options
                    if detect_result["question"]:
                        context = _run_store.update_run(run_id, question=detect_result["question"])
                        message = "Multiple contexts detected - please select one"
                    else:
                        # Context selected - proceed to discovery
                        if detect_result["next_state"] == RunState.DISCOVERY_RUN:
                            discovery_runner = get_discovery_runner()
                            discovery_result = await discovery_runner.run_discovery(
                                page=page,
                                run_id=run_id,
                                base_url=context.base_url,
                                artifacts_path=context.artifacts_path
                            )
                            
                            # Store discovery summary in context
                            context = _run_store.update_run(
                                run_id,
                                discovery_summary=discovery_result.get("summary", {})
                            )
                            
                            # Transition to DISCOVERY_SUMMARY
                            context = _run_store.transition_state(run_id, RunState.DISCOVERY_SUMMARY)
                            
                            # Generate discovery summary and transition to WAIT_TEST_INTENT
                            discovery_summarizer = get_discovery_summarizer()
                            summary_result = await discovery_summarizer.generate_summary(
                                page=page,
                                run_id=run_id,
                                artifacts_path=context.artifacts_path
                            )
                            
                            # Store detailed summary in context
                            context = _run_store.update_run(
                                run_id,
                                discovery_summary=summary_result["summary"]
                            )
                            
                            # Transition to WAIT_TEST_INTENT
                            context = _run_store.transition_state(run_id, summary_result["next_state"])
                            
                            # Update question
                            if summary_result["question"]:
                                context = _run_store.update_run(run_id, question=summary_result["question"])
                            
                            message = f"Discovery completed: {summary_result['summary']['pages_count']} pages, {summary_result['summary']['forms_count']} forms found"
                        else:
                            message = f"Proceeding with existing session. Context: {detect_result.get('selected_context', 'default')}"
                except Exception as e:
                    logger.error(f"[{run_id}] Context detection failed: {e}", exc_info=True)
                    # Default to proceeding without context
                    new_state = RunState.DISCOVERY_RUN
                    context = _run_store.transition_state(run_id, new_state)
                    message = "Proceeding with existing session (context detection failed)"
        
        elif context.state == RunState.WAIT_TEST_INTENT:
            # User selected test intent - build test plan
            test_intent = request.answer.lower().strip()
            
            if test_intent not in ["smoke", "crud_sanity", "module_based", "exploratory_15m"]:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid test intent: {test_intent}. Expected: smoke, crud_sanity, module_based, or exploratory_15m"
                )
            
            # Transition to TEST_PLAN_BUILD
            new_state = RunState.TEST_PLAN_BUILD
            context = _run_store.transition_state(run_id, new_state)
            
            # Build test plan
            browser_manager = get_browser_manager()
            test_plan_builder = get_test_plan_builder()
            
            try:
                page = await browser_manager.get_page(run_id)
                plan_result = await test_plan_builder.build_test_plan(
                    page=page,
                    run_id=run_id,
                    artifacts_path=context.artifacts_path,
                    test_intent=test_intent
                )
                
                # If module_based and multiple modules, ask for module selection
                if plan_result.get("question"):
                    context = _run_store.update_run(run_id, question=plan_result["question"])
                    # Store modules for later use
                    context = _run_store.update_run(run_id, selected_context=test_intent)  # Store intent temporarily
                    message = f"Test intent selected: {test_intent}. Please select a module."
                else:
                    # Test plan built - store it and transition to TEST_EXECUTE
                    context = _run_store.update_run(
                        run_id,
                        test_plan=plan_result["test_plan"]
                    )
                    
                    # Transition to TEST_EXECUTE
                    new_state = plan_result["next_state"]
                    context = _run_store.transition_state(run_id, new_state)
                    
                    # Execute tests
                    test_executor = get_test_executor()
                    execution_result = await test_executor.execute_tests(
                        page=page,
                        run_id=run_id,
                        artifacts_path=context.artifacts_path,
                        test_plan=plan_result["test_plan"]
                    )
                    
                    # If unsafe deletes detected, pause and ask
                    if execution_result.get("question"):
                        context = _run_store.update_run(run_id, question=execution_result["question"])
                        message = f"Test plan built: {plan_result['test_plan']['total_tests']} tests. Unsafe deletes detected - confirmation required."
                    else:
                        # Transition to next state
                        next_state = execution_result["next_state"]
                        context = _run_store.transition_state(run_id, next_state)
                        message = f"Test execution completed: {execution_result['report']['passed']} passed, {execution_result['report']['failed']} failed"
            except Exception as e:
                logger.error(f"[{run_id}] Test plan build failed: {e}", exc_info=True)
                message = f"Test plan build failed: {str(e)[:200]}"
        
        elif context.state == RunState.WAIT_TEST_INTENT_MODULE:
            # User selected module for module_based testing
            selected_module = request.answer
            
            # Build test plan for selected module
            browser_manager = get_browser_manager()
            test_plan_builder = get_test_plan_builder()
            
            try:
                page = await browser_manager.get_page(run_id)
                
                # Load discovery data
                discovery_dir = Path(context.artifacts_path)
                discovery_file = discovery_dir / "discovery.json"
                with open(discovery_file) as f:
                    discovery_data = json.load(f)
                base_url = discovery_data.get("base_url", context.base_url)
                
                # Generate tests for this specific module
                module_tests = test_plan_builder._generate_module_tests(discovery_data, base_url, selected_module)
                
                # Build test plan
                test_plan = {
                    "run_id": run_id,
                    "test_intent": "module_based",
                    "module": selected_module,
                    "generated_at": test_plan_builder._get_timestamp(),
                    "total_tests": len(module_tests),
                    "tests": module_tests
                }
                
                # Save test plan to JSON file
                plan_file = discovery_dir / "test_plan.json"
                with open(plan_file, "w") as f:
                    json.dump(test_plan, f, indent=2, default=str)
                
                # Store test plan in context
                context = _run_store.update_run(
                    run_id,
                    test_plan=test_plan
                )
                
                # Transition to TEST_EXECUTE
                new_state = RunState.TEST_EXECUTE
                context = _run_store.transition_state(run_id, new_state)
                
                # Execute tests
                test_executor = get_test_executor()
                execution_result = await test_executor.execute_tests(
                    page=page,
                    run_id=run_id,
                    artifacts_path=context.artifacts_path,
                    test_plan=test_plan
                )
                
                # If unsafe deletes detected, pause and ask
                if execution_result.get("question"):
                    context = _run_store.update_run(run_id, question=execution_result["question"])
                    message = f"Test plan built for module '{selected_module}': {len(module_tests)} tests. Unsafe deletes detected - confirmation required."
                else:
                    # Transition to next state
                    next_state = execution_result["next_state"]
                    context = _run_store.transition_state(run_id, next_state)
                    message = f"Test execution completed: {execution_result['report']['passed']} passed, {execution_result['report']['failed']} failed"
            except Exception as e:
                logger.error(f"[{run_id}] Module test plan build failed: {e}", exc_info=True)
                message = f"Module test plan build failed: {str(e)[:200]}"
        
        elif context.state == RunState.WAIT_LOGIN_CONFIRM:
            # Handle yes/no answer
            answer_lower = request.answer.lower().strip()
            if answer_lower in ["yes", "y", "true", "1"]:
                # User says they need to login - perform LOGIN_DETECT
                new_state = RunState.LOGIN_DETECT
                context = _run_store.transition_state(run_id, new_state)
                
                # Perform login detection
                login_detector = get_login_detector()
                detect_result = await login_detector.detect_login(
                    run_id=run_id,
                    context=context,
                    keycloak_detected=True  # Assume Keycloak if user says they need login
                )
                
                # Update auth if needed
                if detect_result["auth_updated"]:
                    context = _run_store.update_run(run_id, auth=context.auth)
                
                # Transition to next state from login detection
                new_state = detect_result["next_state"]
                context = _run_store.transition_state(run_id, new_state)
                
                # Update question if credentials needed
                if detect_result["question"]:
                    context = _run_store.update_run(run_id, question=detect_result["question"])
                    message = "Please provide login credentials"
                else:
                    message = "Credentials available, ready for login attempt"
            else:
                raise HTTPException(status_code=400, detail="Invalid answer. Expected: yes/no")
        
        elif context.state == RunState.TEST_EXECUTE:
            # Handle confirmation for unsafe deletes
            answer_lower = request.answer.lower().strip()
            
            if answer_lower in ["yes", "y", "true", "1"]:
                # User confirmed - execute tests with unsafe deletes
                browser_manager = get_browser_manager()
                test_executor = get_test_executor()
                
                try:
                    page = await browser_manager.get_page(run_id)
                    test_plan = context.test_plan
                    
                    if not test_plan:
                        raise ValueError("Test plan not found")
                    
                    execution_result = await test_executor.execute_tests(
                        page=page,
                        run_id=run_id,
                        artifacts_path=context.artifacts_path,
                        test_plan=test_plan
                    )
                    
                    # Transition to next state
                    next_state = execution_result["next_state"]
                    context = _run_store.transition_state(run_id, next_state)
                    message = f"Test execution completed: {execution_result['report']['passed']} passed, {execution_result['report']['failed']} failed"
                except Exception as e:
                    logger.error(f"[{run_id}] Test execution failed: {e}", exc_info=True)
                    message = f"Test execution failed: {str(e)[:200]}"
            else:
                # User declined - skip unsafe deletes and proceed
                message = "Skipping unsafe DELETE operations. Proceeding with safe tests only."
        
        elif context.state == RunState.REPORT_GENERATE:
            # Generate HTML report
            report_generator = get_report_generator()
            
            try:
                result = report_generator.generate_html_report(
                    run_id=run_id,
                    artifacts_path=context.artifacts_path
                )
                
                # Transition to DONE
                if not result.get("skipped"):
                    context = _run_store.transition_state(run_id, RunState.DONE)
                    message = f"HTML report generated: {result['html_path']}"
                else:
                    context = _run_store.transition_state(run_id, RunState.DONE)
                    message = "HTML report already exists, skipping generation"
            except Exception as e:
                logger.error(f"[{run_id}] Report generation failed: {e}", exc_info=True)
                message = f"Report generation failed: {str(e)[:200]}"
        
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Run is not in a state that accepts answers. Current state: {context.state.value}"
            )
        
        # Get updated context
        context = _run_store.get_run(run_id)
        
        return AnswerResponse(
            run_id=context.run_id,
            state=context.state.value,
            question=context.question,
            message=message
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to process answer for run {run_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to process answer: {str(e)}")


# =============================================================================
# Helper Functions
# =============================================================================

def _calculate_progress(state: RunState) -> int:
    """Calculate progress percentage based on state."""
    state_order = [
        RunState.START,
        RunState.OPEN_URL,
        RunState.SESSION_CHECK,
        RunState.LOGIN_DETECT,
        RunState.WAIT_LOGIN_INPUT,
        RunState.WAIT_LOGIN_CONFIRM,
        RunState.LOGIN_ATTEMPT,
        RunState.POST_LOGIN_VALIDATE,
        RunState.CONTEXT_DETECT,
        RunState.WAIT_CONTEXT_INPUT,
        RunState.DISCOVERY_RUN,
        RunState.DISCOVERY_SUMMARY,
        RunState.WAIT_TEST_INTENT,
        RunState.TEST_PLAN_BUILD,
        RunState.TEST_EXECUTE,
        RunState.REPORT_GENERATE,
        RunState.DONE
    ]
    
    try:
        index = state_order.index(state)
        progress = int((index / (len(state_order) - 1)) * 100)
        return min(100, max(0, progress))
    except ValueError:
        # State not in order (e.g., FAILED)
        return 0 if state == RunState.FAILED else 100

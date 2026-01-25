"""Run context models for Interactive QA Buddy."""

from typing import Optional, Dict, Any, List
from datetime import datetime
from pydantic import BaseModel, Field

from app.models.run_state import RunState


class AuthConfig(BaseModel):
    """Authentication configuration."""
    
    type: str = Field(..., description="Auth type (e.g., 'keycloak')")
    username: Optional[str] = Field(None, description="Username for login")
    password: Optional[str] = Field(None, description="Password for login")
    
    class Config:
        json_schema_extra = {
            "example": {
                "type": "keycloak",
                "username": "user@example.com",
                "password": "password123"
            }
        }


class QuestionOption(BaseModel):
    """Option for select_one question type."""
    
    id: str = Field(..., description="Option identifier")
    label: str = Field(..., description="Display label for the option")
    
    class Config:
        json_schema_extra = {
            "example": {
                "id": "tenant_a",
                "label": "Tenant A"
            }
        }


class Question(BaseModel):
    """Question schema for interactive prompts."""
    
    id: str = Field(..., description="Question identifier")
    type: str = Field(..., description="Question type: 'select_one', 'confirm', or 'text'")
    text: str = Field(..., description="Question text/prompt")
    options: Optional[List[QuestionOption]] = Field(None, description="Options for select_one type")
    screenshot_path: Optional[str] = Field(None, description="Path to screenshot if available")
    
    class Config:
        json_schema_extra = {
            "examples": [
                {
                    "id": "login_creds",
                    "type": "text",
                    "text": "Please provide login credentials (username,password or JSON)",
                    "screenshot_path": "screenshots/login_page.png"
                },
                {
                    "id": "context_select",
                    "type": "select_one",
                    "text": "Select a context/tenant to proceed",
                    "options": [
                        {"id": "tenant_a", "label": "Tenant A"},
                        {"id": "tenant_b", "label": "Tenant B"}
                    ],
                    "screenshot_path": "screenshots/context_selection.png"
                },
                {
                    "id": "login_confirm",
                    "type": "confirm",
                    "text": "Are you already logged in?",
                    "screenshot_path": "screenshots/current_page.png"
                }
            ]
        }


class RunContext(BaseModel):
    """Run context storing state and metadata."""
    
    run_id: str = Field(..., description="Unique run identifier")
    base_url: str = Field(..., description="Base application URL")
    env: str = Field(default="staging", description="Environment name")
    headless: bool = Field(default=True, description="Run browser in headless mode")
    auth: Optional[AuthConfig] = Field(None, description="Authentication configuration")
    current_url: Optional[str] = Field(None, description="Current page URL")
    state: RunState = Field(default=RunState.START, description="Current run state")
    question: Optional[Question] = Field(None, description="Current question if waiting for input")
    selected_context: Optional[str] = Field(None, description="Selected context/tenant")
    discovery_summary: Optional[Dict[str, Any]] = Field(None, description="Discovery results summary")
    test_plan: Optional[Dict[str, Any]] = Field(None, description="Generated test plan")
    discovery_debug: bool = Field(default=False, description="Enable discovery debug trace + screenshots")
    uploaded_images: Optional[list] = Field(None, description="Pre-uploaded image analysis results")
    uploaded_documents: Optional[list] = Field(None, description="Pre-uploaded document analysis results")
    test_phase: str = Field(default="phase1_get_operations", description="Test phase: phase1_get_operations or phase2_full_testing")

    # Discovery configuration overrides (optional)
    max_pages: Optional[int] = Field(None, description="Maximum pages to discover (default: 2000)")
    max_forms_per_page: Optional[int] = Field(None, description="Maximum forms to process per page (default: 50)")
    max_table_rows_to_click: Optional[int] = Field(None, description="Maximum table rows to click (default: 50)")
    max_discovery_time_minutes: Optional[int] = Field(None, description="Maximum discovery time in minutes (default: 60)")

    timestamps: Dict[str, str] = Field(default_factory=dict, description="State transition timestamps")
    artifacts_path: str = Field(..., description="Path to artifacts directory")
    free_text_commands: List[str] = Field(default_factory=list, description="Free-text commands from user")
    
    class Config:
        json_schema_extra = {
            "example": {
                "run_id": "abc123def456",
                "base_url": "https://app.example.com",
                "env": "staging",
                "headless": True,
                "auth": {
                    "type": "keycloak",
                    "username": "user@example.com"
                },
                "current_url": "https://app.example.com/login",
                "state": "WAIT_LOGIN_INPUT",
                "question": {
                    "id": "login_creds",
                    "type": "text",
                    "text": "Please provide login credentials"
                },
                "artifacts_path": "artifacts/abc123def456"
            }
        }


class AnswerRequest(BaseModel):
    """Request model for answering a question."""
    
    question_id: str = Field(..., description="ID of the question being answered")
    answer: str = Field(..., description="Answer value (text, option ID, or yes/no)")
    selector: Optional[str] = Field(None, description="CSS selector for UI interaction (WAIT_CONTEXT_INPUT)")
    option_text: Optional[str] = Field(None, description="Visible text for option selection")
    
    class Config:
        json_schema_extra = {
            "examples": [
                {
                    "question_id": "login_creds",
                    "answer": "user@example.com,password123"
                },
                {
                    "question_id": "context_select",
                    "answer": "tenant_a",
                    "selector": "select[name='tenant']",
                    "option_text": "Tenant A"
                },
                {
                    "question_id": "login_confirm",
                    "answer": "yes"
                }
            ]
        }

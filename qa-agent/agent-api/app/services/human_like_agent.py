"""
Goal-driven browser steps using the current page snapshot + LLM (human-like loop).

Not full computer-use vision: the model sees a text list of visible controls (URL, title,
buttons/links, inputs). Executes one bounded action per step: click, fill, Enter, wait, done.
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Dict, List, Optional, Tuple

from app.services.ai.provider_factory import get_llm_provider

logger = logging.getLogger(__name__)

# Words stripped from free-text goals when matching navigation (rules-based path)
_GOAL_STOP_WORDS = frozenset(
    {
        "test",
        "fully",
        "thoroughly",
        "complete",
        "check",
        "verify",
        "validate",
        "the",
        "a",
        "an",
        "to",
        "and",
        "or",
        "go",
        "open",
        "please",
        "run",
        "execute",
        "navigate",
        "goto",
        "into",
        "on",
        "in",
        "for",
        "all",
        "every",
        "thing",
        "things",
        "poora test karo",
        "poora test karna",
    }
)

_CLICK_SKIP_SUBSTRINGS = (
    "delete",
    "remove",
    "logout",
    "log out",
    "sign out",
    "cancel",
    "close",
)

# Hard ceiling for human-like loop (matches AIConfig.human_like_max_steps le=)
_HUMAN_LIKE_CAP = 2000


def resolve_max_steps(explicit: Optional[int]) -> int:
    """Per-run cap for human-like loop: explicit from AI config, else env, else 25."""
    if explicit is not None:
        return max(1, min(_HUMAN_LIKE_CAP, explicit))
    raw = os.getenv("HUMAN_LIKE_AGENT_MAX_STEPS", "25")
    try:
        return max(1, min(_HUMAN_LIKE_CAP, int(raw.strip())))
    except ValueError:
        return 25
SYSTEM_PROMPT = """You are a careful browser automation assistant.
You only choose the next single action to move toward the user's goal.
You must pick targets that appear in the provided page snapshot (use exact or substring text from "text" fields).
Respond with ONLY a JSON object, no markdown, no prose.
Schema:
{"action":"click"|"fill"|"press_enter"|"wait"|"done","target_substring":"","value":"","reason":""}
- action "click": click a button or link whose visible text contains target_substring.
- action "fill": type value into an input; target_substring should match placeholder, label text, or name from snapshot.
- action "press_enter": press Enter (e.g. after search).
- action "wait": wait ~1s for SPA (target_substring may be empty).
- action "done": goal achieved or impossible safely.
Keep target_substring short (key words from the UI list).
"""


async def _snapshot_page(page) -> Dict[str, Any]:
    """Compact list of visible interactive elements (text-only 'seeing')."""
    try:
        data = await page.evaluate(
            """() => {
              const out = { url: location.href, title: document.title, items: [] };
              const seen = new Set();
              function add(item) {
                const key = JSON.stringify(item);
                if (seen.has(key) || out.items.length >= 60) return;
                seen.add(key);
                out.items.push(item);
              }
              document.querySelectorAll(
                'button, a[href], [role="button"], input[type="submit"], input[type="button"]'
              ).forEach((el) => {
                const t = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim();
                if (t && t.length < 200) add({ kind: 'click', text: t.slice(0, 120) });
              });
              document.querySelectorAll(
                'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select'
              ).forEach((el) => {
                const ph = (el.placeholder || '').trim();
                const nm = (el.name || el.id || '').trim();
                const al = (el.getAttribute('aria-label') || '').trim();
                const lab = document.querySelector(`label[for="${el.id}"]`);
                const lt = lab ? (lab.innerText || '').trim().slice(0, 80) : '';
                if (ph || nm || al || lt) {
                  add({ kind: 'input', placeholder: ph, name: nm, aria: al, label: lt });
                }
              });
              return out;
            }"""
        )
        return data if isinstance(data, dict) else {"url": "", "title": "", "items": []}
    except Exception as e:
        logger.warning(f"Page snapshot failed: {e}")
        return {"url": "", "title": "", "items": [], "error": str(e)[:120]}


def _ai_config_to_dict(ai_config: Any) -> Optional[Dict[str, Any]]:
    if ai_config is None:
        return None
    if hasattr(ai_config, "model_dump"):
        return ai_config.model_dump()
    if isinstance(ai_config, dict):
        return ai_config
    return None


async def run_goal_loop(
    page,
    goal: str,
    run_id: str,
    ai_config: Any,
    *,
    max_steps: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Observe page → ask LLM for one action → execute → repeat until done or max_steps.

    Returns dict with keys: ok, steps (list of {action, result}), summary, error (optional).
    """
    cfg = _ai_config_to_dict(ai_config)
    if not cfg or not cfg.get("enabled", True):
        return {
            "ok": False,
            "steps": [],
            "summary": "Enable AI in run settings (Ollama or OpenAI) for human-like agent mode.",
            "error": "ai_disabled",
        }

    provider = get_llm_provider(cfg)
    if provider is None:
        return {
            "ok": False,
            "steps": [],
            "summary": "Set AI provider to ollama or openai (not 'none') for agent mode.",
            "error": "no_provider",
        }

    effective_max = max_steps
    if effective_max is None:
        effective_max = cfg.get("human_like_max_steps")
    cap = resolve_max_steps(effective_max)

    steps_out: List[Dict[str, Any]] = []
    last_error = ""

    for step_i in range(cap):
        snap = await _snapshot_page(page)
        snap_txt = json.dumps(snap, indent=0)[:12000]
        user_prompt = f"""User goal: {goal}

Current page snapshot:
{snap_txt}
"""
        if last_error:
            user_prompt += f"\nPrevious step failed: {last_error}\nChoose a different action.\n"

        user_prompt += "\nOutput one JSON object only for the next action."

        try:
            raw = await provider.generate_text(
                prompt=user_prompt,
                system_prompt=SYSTEM_PROMPT,
                temperature=0.15,
                max_tokens=min(cfg.get("max_tokens", 2000), 800),
            )
        except Exception as e:
            logger.error(f"[{run_id}] LLM call failed: {e}", exc_info=True)
            return {
                "ok": False,
                "steps": steps_out,
                "summary": f"LLM error: {str(e)[:200]}",
                "error": "llm_error",
            }

        action = _parse_action_json(raw)
        if not action:
            last_error = "Could not parse model output as JSON"
            steps_out.append({"step": step_i + 1, "raw": raw[:300], "result": last_error})
            continue

        logger.info(f"[{run_id}] human_like step {step_i + 1}: {action}")
        result_msg = await _execute_one_action(page, action)
        steps_out.append({"step": step_i + 1, "action": action, "result": result_msg})

        if action.get("action", "").lower() == "done" or result_msg == "done":
            return {
                "ok": True,
                "steps": steps_out,
                "summary": f"Completed in {len(steps_out)} step(s). Last: {result_msg}",
            }

        if result_msg.startswith("error:"):
            last_error = result_msg
        else:
            last_error = ""

    return {
        "ok": False,
        "steps": steps_out,
        "summary": (
            f"Goal not completed after {cap} steps (limit). "
            f"Set AI human_like_max_steps, or env HUMAN_LIKE_AGENT_MAX_STEPS, or use a smaller goal. "
            f"Last URL: {page.url}"
        ),
        "error": "max_steps",
    }


def _parse_action_json(raw: str) -> Optional[Dict[str, Any]]:
    if not raw:
        return None
    text = raw.strip()
    if "```" in text:
        parts = re.split(r"```(?:json)?", text, maxsplit=1)
        if len(parts) >= 2:
            text = parts[1].split("```")[0].strip()
    try:
        obj = json.loads(text)
        if isinstance(obj, dict) and "action" in obj:
            return obj
    except json.JSONDecodeError:
        pass
    m = re.search(r"\{[^{}]*\"action\"[^{}]*\}", raw, re.DOTALL)
    if m:
        try:
            obj = json.loads(m.group(0))
            if isinstance(obj, dict):
                return obj
        except json.JSONDecodeError:
            pass
    return None


async def _execute_one_action(page, action: Dict[str, Any]) -> str:
    a = (action.get("action") or "").lower().strip()
    ts = (action.get("target_substring") or "").strip()
    val = action.get("value")
    if isinstance(val, str):
        pass
    elif val is not None:
        val = str(val)
    else:
        val = ""

    if a == "done":
        return "done"

    if a == "wait":
        await page.wait_for_timeout(1300)
        return "waited"

    if a == "press_enter":
        await page.keyboard.press("Enter")
        return "pressed Enter"

    if a == "fill":
        if not ts and not val:
            return "error: fill needs target_substring or value"
        # Try placeholder
        if ts:
            try:
                loc = page.get_by_placeholder(ts, exact=False)
                if await loc.count() > 0:
                    await loc.first.click(timeout=3000)
                    await loc.first.fill(val, timeout=8000)
                    return f"filled field (placeholder ~ {ts[:40]})"
            except Exception as e:
                logger.debug(f"fill placeholder: {e}")
            try:
                loc = page.get_by_label(ts, exact=False)
                if await loc.count() > 0:
                    await loc.first.fill(val, timeout=8000)
                    return f"filled field (label ~ {ts[:40]})"
            except Exception as e:
                logger.debug(f"fill label: {e}")
            try:
                rgx = re.compile(re.escape(ts[:80]), re.IGNORECASE)
                role_box = page.get_by_role("textbox", name=rgx)
                if await role_box.count() > 0:
                    await role_box.first.click(timeout=3000)
                    await role_box.first.fill(val, timeout=8000)
                    return f"filled field (role=textbox name ~ {ts[:40]})"
            except Exception as e:
                logger.debug(f"fill role textbox: {e}")
        try:
            box = page.locator("input:visible, textarea:visible").first
            await box.fill(val, timeout=8000)
            return "filled first visible input"
        except Exception as e:
            return f"error: fill failed: {str(e)[:160]}"

    if a == "click":
        if not ts:
            return "error: click needs target_substring"
        try:
            await page.get_by_text(ts, exact=False).first.click(timeout=9000)
            return f"clicked text matching '{ts[:50]}'"
        except Exception as e:
            return f"error: click failed: {str(e)[:160]}"

    return f"error: unknown action '{a}'"


def parse_agent_instruction(instruction: str) -> Optional[Dict[str, str]]:
    """
    Parse operator instructions:
    - agent: <goal>  → always use LLM human-like loop (requires AI + provider).
    - human: / goal: → rules-first; LLM only when AI mode is 'ai', or as fallback when 'hybrid'.
    Also accepts ``human <goal>`` (space, no colon).
    """
    s = instruction.strip()
    m = re.match(r"^(?i)(agent|human|goal)\s*:\s*(.+)$", s)
    if m:
        return {"kind": m.group(1).lower(), "goal": m.group(2).strip()}
    m = re.match(r"^(?i)(agent|human)\s+(.+)$", s)
    if m:
        return {"kind": m.group(1).lower(), "goal": m.group(2).strip()}
    return None


def parse_agent_goal(instruction: str) -> Optional[str]:
    """Backward compat: goal text only."""
    p = parse_agent_instruction(instruction)
    return p["goal"] if p else None


# Sentinel goal: user asked for full-app resource coverage (handled as guidance, not a single click path)
QA_BUDDY_FULL_COVERAGE_GOAL = "__QA_BUDDY_FULL_COVERAGE__"


def infer_plain_language_goal(instruction: str) -> Optional[Dict[str, str]]:
    """
    Treat natural language as a ``human:`` goal when the user does not add a prefix.

    Examples that match:
    - "complete the create file system wizard with name \\"qa-test-fs-01\\" and submit"
    - "open storage and create a new bucket"
    - "complete UI testing for all resources"
    """
    s = instruction.strip()
    if len(s) < 10:
        return None
    lower = s.lower()

    # Broad "test everything" intent → discovery + test run is the source of truth
    if any(
        phrase in lower
        for phrase in (
            "all resources",
            "every resource",
            "all resource",
            "complete ui testing",
            "full ui test",
            "test everything",
            "entire ui",
            "full coverage",
            "whole ui",
            "every page",
            "all pages",
            "all modules",
            "saare resource",
            "sab resources",
            "poora ui",
            "khud sure",
            "sure yourself",
            "be sure",
            "self verify",
        )
    ):
        return {"kind": "human", "goal": QA_BUDDY_FULL_COVERAGE_GOAL}

    # Single-task / wizard style (imperative)
    task_markers = (
        "complete ",
        "finish ",
        "fill ",
        "submit",
        "wizard",
        "create ",
        "add ",
        "new ",
        "open ",
        "navigate ",
        "go to ",
        "goto ",
        "test the ",
        "verify ",
        "enter ",
        "run through",
        "walk through",
        "save ",
        "update ",
        "edit ",
        "delete ",
        "remove ",
    )
    if any(m in lower for m in task_markers):
        return {"kind": "human", "goal": s}

    # Quoted value + form-ish words → likely a wizard instruction
    if ("name" in lower or "wizard" in lower or "form" in lower) and (
        '"' in s or "'" in s
    ):
        return {"kind": "human", "goal": s}

    return None


def _seed_strings_from_goal(goal: str) -> List[str]:
    """Pull quoted literals and `name ...` fragments for SmartFormFiller seed_data."""
    if not goal or goal == QA_BUDDY_FULL_COVERAGE_GOAL:
        return []
    out: List[str] = []
    out.extend(re.findall(r'"([^"]{1,200})"', goal))
    out.extend(re.findall(r"'([^']{1,200})'", goal))
    m = re.search(
        r"(?i)\bname\s+(?:is\s+)?[:=]?\s*([A-Za-z0-9][A-Za-z0-9._\-]{1,120})",
        goal,
    )
    if m:
        out.append(m.group(1).strip())
    # de-dupe preserving order
    seen = set()
    uniq: List[str] = []
    for x in out:
        x = x.strip()
        if x and x.lower() not in seen:
            seen.add(x.lower())
            uniq.append(x)
    return uniq


def _goal_tokens(goal: str) -> List[str]:
    words = re.findall(r"[a-z0-9]+", goal.lower())
    return [w for w in words if w not in _GOAL_STOP_WORDS and len(w) > 1]


async def _rules_collect_click_candidates(page) -> List[Dict[str, Any]]:
    try:
        return await page.evaluate(
            """() => {
              const out = [];
              const sel = 'a[href], button, [role="button"], [role="menuitem"], [role="tab"]';
              document.querySelectorAll(sel).forEach((el) => {
                if (!el.offsetParent) return;
                const t = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim();
                if (!t || t.length > 120) return;
                const tl = t.toLowerCase();
                out.push({ text: t, lower: tl });
              });
              return out;
            }"""
        )
    except Exception as e:
        logger.debug(f"rules collect candidates failed: {e}")
        return []


def _score_nav_text(lower_text: str, tokens: List[str]) -> int:
    if not tokens:
        return 0
    score = 0
    for tok in tokens:
        if tok in lower_text:
            score += 3
        elif any(tok in w or w in tok for w in lower_text.split() if len(w) > 2):
            score += 1
    return score


async def run_rules_based_goal(page, goal: str, run_id: str) -> Dict[str, Any]:
    """
    Deterministic navigation + SmartFormFiller for goals like "test file storage fully".
    Does not call an LLM.
    """
    from app.services.smart_form_filler import SmartFormFiller

    gstrip = goal.strip()
    if gstrip == QA_BUDDY_FULL_COVERAGE_GOAL:
        return {
            "ok": True,
            "steps": [],
            "summary": (
                "Full UI coverage for all resources is built into the main run: "
                "(1) Start run → discovery walks navigation and pages. "
                "(2) Test cases are auto-generated per area (list, search, filter, forms, actions). "
                "(3) Open Test Cases → Run to execute. "
                "Turn on create/update/delete under Operations if you want write tests. "
                "— Hindi: Sab resources ke liye Start Run → discovery, phir Test Cases run karo; "
                "yahi systematic 'poora UI sure' karna hai."
            ),
        }

    seed_for_fill = _seed_strings_from_goal(goal)
    seed_kw = seed_for_fill if seed_for_fill else None

    tokens = _goal_tokens(goal)
    steps_out: List[Dict[str, Any]] = []
    filler = SmartFormFiller()
    modal_miss = 0

    async def visible_modal_scope() -> Optional[str]:
        for sel in ("[role='dialog']", "[role='alertdialog']", ".modal:visible"):
            try:
                loc = page.locator(sel).first
                if await loc.count() > 0 and await loc.is_visible():
                    return sel
            except Exception:
                continue
        return None

    for step_i in range(18):
        scope = await visible_modal_scope()
        if scope:
            res = await filler.fill_form(
                page,
                run_id,
                form_selector=scope,
                context_hint=goal,
                seed_data=seed_kw,
            )
            steps_out.append(
                {"step": step_i + 1, "action": "smart_fill", "scope": scope, "result": res}
            )
            if res.get("filled_count", 0) > 0:
                modal_miss = 0
                submitted = await filler.find_and_click_submit(page, scope)
                steps_out.append(
                    {
                        "step": step_i + 1,
                        "action": "submit",
                        "result": "clicked" if submitted else "no_submit_button",
                    }
                )
                await page.wait_for_timeout(1200)
                errs = await filler.check_for_validation_errors(page)
                if not errs:
                    return {
                        "ok": True,
                        "steps": steps_out,
                        "summary": f"Rules path: filled form in {scope} and submitted ({res.get('filled_count')} fields).",
                    }
                if step_i > 8:
                    return {
                        "ok": False,
                        "steps": steps_out,
                        "summary": f"Rules path: validation still failing: {errs[:2]}",
                    }
            else:
                modal_miss += 1
                if modal_miss >= 4:
                    return {
                        "ok": False,
                        "steps": steps_out,
                        "summary": "Rules path: dialog visible but no fillable fields were detected.",
                        "error": "rules_modal_no_fields",
                    }
            continue

        created = await filler.find_and_click_create_button(page)
        if created:
            steps_out.append(
                {"step": step_i + 1, "action": "click_create", "result": created}
            )
            await page.wait_for_timeout(1000)
            continue

        candidates = await _rules_collect_click_candidates(page)
        best: Optional[Tuple[int, str]] = None
        for c in candidates:
            text = c.get("text") or ""
            low = c.get("lower") or text.lower()
            if any(bad in low for bad in _CLICK_SKIP_SUBSTRINGS):
                continue
            sc = _score_nav_text(low, tokens)
            if sc <= 0:
                continue
            if best is None or sc > best[0]:
                best = (sc, text)

        if best:
            _, label = best
            try:
                await page.get_by_text(label, exact=True).first.click(timeout=6000)
            except Exception:
                await page.get_by_text(label, exact=False).first.click(timeout=6000)
            steps_out.append({"step": step_i + 1, "action": "click_nav", "target": label})
            await page.wait_for_timeout(1200)
            try:
                await page.wait_for_load_state("networkidle", timeout=8000)
            except Exception:
                pass
            continue

        if not tokens:
            break
        low_url = page.url.lower()
        if any(t in low_url for t in tokens):
            res = await filler.fill_form(
                page,
                run_id,
                form_selector=None,
                context_hint=goal,
                seed_data=seed_kw,
            )
            steps_out.append({"step": step_i + 1, "action": "smart_fill_page", "result": res})
            if res.get("filled_count", 0) > 0:
                await filler.find_and_click_submit(page, None)
                return {
                    "ok": True,
                    "steps": steps_out,
                    "summary": "Rules path: filled fields on current page matching goal URL.",
                }
        break

    return {
        "ok": False,
        "steps": steps_out,
        "summary": (
            "Rules-based goal runner could not complete the goal "
            f"(tokens={tokens!r}). Try AI mode 'hybrid' or 'ai', or prefix with agent: for LLM-only."
        ),
        "error": "rules_incomplete",
    }


def should_use_llm_for_goal(
    kind: str,
    ai_config: Any,
) -> str:
    """
    Returns 'force_llm' | 'llm_only' | 'rules_then_maybe_llm' | 'rules_only'.
    """
    enabled = bool(ai_config and getattr(ai_config, "enabled", False))
    provider = getattr(ai_config, "provider", "none") if ai_config else "none"
    ai_on = enabled and provider and str(provider).lower() != "none"
    mode = getattr(ai_config, "mode", "normal") if ai_config else "normal"

    if kind == "agent":
        # Always invoke LLM path so disabled/misconfigured AI returns a clear error to the user.
        return "force_llm"

    if kind in ("human", "goal"):
        if mode == "ai" and ai_on:
            return "llm_only"
        if mode == "hybrid" and ai_on:
            return "rules_then_maybe_llm"
        return "rules_only"

    return "rules_only"

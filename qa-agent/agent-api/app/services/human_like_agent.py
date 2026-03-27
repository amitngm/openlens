"""
Goal-driven browser steps using the current page snapshot + LLM (human-like loop).

Not full computer-use vision: the model sees a text list of visible controls (URL, title,
buttons/links, inputs). Executes one bounded action per step: click, fill, Enter, wait, done.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, List, Optional

from app.services.ai.provider_factory import get_llm_provider

logger = logging.getLogger(__name__)

MAX_STEPS = 10
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
    max_steps: int = MAX_STEPS,
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

    steps_out: List[Dict[str, Any]] = []
    last_error = ""

    for step_i in range(max_steps):
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
        "ok": True,
        "steps": steps_out,
        "summary": f"Stopped after {max_steps} steps (cap). Last URL: {page.url}",
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


def parse_agent_goal(instruction: str) -> Optional[str]:
    """
    Extract goal from: 'agent: ...', 'human: ...', 'goal: ...' (case-insensitive).
    """
    s = instruction.strip()
    m = re.match(r"^(?i)(agent|human|goal)\s*:\s*(.+)$", s)
    if m:
        return m.group(2).strip()
    m = re.match(r"^(?i)(agent|human)\s+(.+)$", s)
    if m:
        return m.group(2).strip()
    return None

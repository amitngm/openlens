"""
Smart Form Filler - Intelligently fills any web form by detecting field types,
labels, and placeholders to generate contextually appropriate test data.

Works for any application type (SaaS, e-commerce, CMS, admin panels, etc.)
without pre-configuration.
"""

import asyncio
import logging
import re
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


class SmartFormFiller:
    """
    Intelligently fills any web form by detecting field types, labels, and
    placeholders to generate contextually appropriate test data.

    Design principles:
    - Detect semantic intent from field name + label + placeholder + aria-label
    - Generate realistic test data that passes common validations
    - Handle all standard HTML input types plus custom comboboxes/pickers
    - Prefer seed data (real scraped values) for search fields
    - Never fill disabled/readonly/hidden fields
    - Log every action for traceability
    """

    # ── Semantic intent patterns (checked in order, most-specific first) ─────
    INTENT_PATTERNS: List[Tuple[str, str]] = [
        ("confirm_password", r"(confirm|repeat|retype)[\-_\s]*(password|passwd|pass)"),
        ("password",         r"\b(password|passwd|pass|secret|credential)\b"),
        ("email",            r"\b(e[\-_]?mail|mail)\b"),
        ("phone",            r"\b(phone|mobile|cell|tel(?:ephone)?)\b"),
        ("first_name",       r"(first[\-_\s]?name|firstname|fname|given[\-_\s]?name)"),
        ("last_name",        r"(last[\-_\s]?name|lastname|surname|lname|family[\-_\s]?name)"),
        ("full_name",        r"(full[\-_\s]?name|display[\-_\s]?name|displayname)"),
        ("username",         r"\b(username|user[\-_]?name|login|handle|account[\-_]?name)\b"),
        ("dob",              r"(date[\-_\s]?of[\-_\s]?birth|birth[\-_\s]?date|birthday|dob)\b"),
        ("start_date",       r"(start[\-_\s]?date|begin[\-_\s]?date|from[\-_\s]?date)"),
        ("end_date",         r"(end[\-_\s]?date|expire[sd]?|expiry|expiration|until|to[\-_\s]?date)"),
        ("date",             r"\bdate\b"),
        ("address",          r"\b(address|street|addr)\b"),
        ("city",             r"\b(city|town)\b"),
        ("state",            r"\b(state|province|region)\b"),
        ("zip",              r"\b(zip|postal|postcode)\b"),
        ("country",          r"\b(country|nation)\b"),
        ("company",          r"\b(company|organization|organisation|org|firm|business|employer)\b"),
        ("job_title",        r"\b(job[\-_\s]?title|position|designation)\b"),
        ("title",            r"\btitle\b"),
        ("department",       r"\b(department|dept|division|team)\b"),
        ("description",      r"\b(description|desc|details|notes?|comments?|remarks|summary|about)\b"),
        ("subject",          r"\b(subject|topic|heading|headline)\b"),
        ("message",          r"\b(message|body|content)\b"),
        ("quantity",         r"\b(quantity|qty|count|amount|number|num)\b"),
        ("price",            r"\b(price|cost|rate|fee|charge)\b"),
        ("url",              r"\b(url|link|website|site|domain|endpoint|callback|redirect|homepage)\b"),
        ("search",           r"\b(search|query|find|filter|keyword|lookup)\b"),
        ("tag",              r"\b(tags?|labels?|keywords?)\b"),
        ("namespace",        r"\b(namespace|ns|prefix)\b"),
        ("cluster",          r"\b(cluster|node|server|host(?:name)?)\b"),
        ("vpc",              r"\b(vpc|virtual\s*private\s*cloud)\b"),
        ("subnet",           r"\b(subnet)\b"),
        ("cidr",             r"\b(cidr|cidr\s*block|network\s*range|ip\s*range)\b"),
        ("availability_zone", r"\b(az|availability[\-_\s]?zone)\b"),
        ("region",           r"\b(region)\b"),
        ("name",             r"\bname\b"),          # generic "name" — keep last
        ("id_field",         r"\b(id|identifier|key|code|ref(?:erence)?)\b"),
    ]

    # ── Static test-data pool ─────────────────────────────────────────────────
    _POOL: Dict[str, List[str]] = {
        "email":            ["qa.buddy@example.com", "test.user@example.org"],
        "phone":            ["+1-555-123-4567", "+44-20-1234-5678"],
        "first_name":       ["John", "Jane"],
        "last_name":        ["Smith", "Doe"],
        "full_name":        ["John Smith", "Jane Doe"],
        "username":         ["testuser_qa", "autobuddy01"],
        "password":         ["Test@1234!", "Secure#Pass9"],
        "confirm_password": ["Test@1234!", "Secure#Pass9"],
        "address":          ["123 Test Street", "456 QA Avenue"],
        "city":             ["Test City", "QA Town"],
        "state":            ["CA", "TX"],
        "zip":              ["12345", "90210"],
        "country":          ["US", "United States"],
        "company":          ["Test Corp", "QA Automations Inc"],
        "job_title":        ["QA Engineer", "Test Automation Lead"],
        "title":            ["QA Engineer", "Test Manager"],
        "department":       ["Engineering", "QA & Automation"],
        "description":      ["Automated test description generated by QA Buddy."],
        "subject":          ["QA Buddy Test Subject"],
        "message":          ["This message was generated by QA Buddy automation."],
        "quantity":         ["1", "5"],
        "price":            ["10.00", "99.99"],
        "url":              ["https://test.example.com"],
        "search":           ["test", "example"],
        "tag":              ["qa", "automation"],
        "namespace":        ["default", "test"],
        "cluster":          ["test-cluster", "qa-cluster"],
        "vpc":              ["qa-buddy-vpc-01", "test-vpc-qa"],
        "subnet":           ["subnet-qa-buddy-01", "subnet-test-01"],
        "cidr":             ["10.0.0.0/16", "172.16.0.0/24"],
        "availability_zone": ["us-east-1a", "eu-west-1a"],
        "region":           ["us-east-1", "eu-west-1"],
        "name":             ["TestResource-01", "QABuddy-Item"],
        "id_field":         ["test-001", "qa-001"],
        "generic":          ["TestValue001", "QABuddy-001"],
    }

    def __init__(self) -> None:
        self._run_data: Dict[str, Dict[str, str]] = {}

    # ── Public API ─────────────────────────────────────────────────────────────

    async def fill_form(
        self,
        page,
        run_id: str,
        form_selector: Optional[str] = None,
        context_hint: str = "",
        seed_data: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Fill a form (or page-level scope) with intelligent test data.

        Args:
            page: Playwright Page object
            run_id: Run identifier for logging/state
            form_selector: CSS selector for the form scope (None = auto-detect)
            context_hint: Human hint about form purpose, e.g. "create namespace"
            seed_data: User-provided real values to prefer for search fields

        Returns:
            {"filled_count": int, "fields": {field_key: value}, "status": str}
        """
        try:
            scope = await self._resolve_scope(page, form_selector)
            fields = await self._discover_fields(scope or page)

            logger.info(f"[{run_id}] SmartFormFiller: {len(fields)} fillable fields in scope")

            filled: Dict[str, str] = {}
            for field in fields:
                try:
                    value = await self._fill_one(page, field, run_id, seed_data)
                    if value is not None:
                        key = (
                            field.get("name")
                            or field.get("label")
                            or field.get("placeholder")
                            or f"field_{field['index']}"
                        )
                        filled[key] = value
                        logger.debug(f"[{run_id}]   ✔ '{key}' = '{value if field['type'] != 'password' else '***'}'")
                except Exception as exc:
                    logger.debug(f"[{run_id}]   ✗ skip field {field.get('name')}: {exc}")

            self._run_data[run_id] = filled
            logger.info(f"[{run_id}] SmartFormFiller: filled {len(filled)} / {len(fields)} fields")
            return {
                "filled_count": len(filled),
                "fields": filled,
                "status": "success" if filled else "no_fields",
            }

        except Exception as exc:
            logger.error(f"[{run_id}] SmartFormFiller.fill_form failed: {exc}", exc_info=True)
            return {"filled_count": 0, "fields": {}, "status": "error", "error": str(exc)}

    async def find_and_click_create_button(self, page) -> Optional[str]:
        """
        Look for a 'Create / Add / New' button on the page and click it.
        Returns the button text if found, else None.
        """
        selectors = [
            "button:has-text('Create')", "button:has-text('Add')",
            "button:has-text('New')", "button:has-text('+ Add')",
            "button:has-text('Add New')", "button:has-text('Create New')",
            "[role='button']:has-text('Create')", "[role='button']:has-text('Add')",
            "a:has-text('Create')", "a:has-text('Add New')",
            # icon-only buttons with aria labels
            "button[aria-label*='Create' i]", "button[aria-label*='Add' i]",
            "button[aria-label*='New' i]",
        ]
        for sel in selectors:
            try:
                btn = page.locator(sel).first
                if await btn.count() > 0 and await btn.is_visible():
                    text = (await btn.inner_text()).strip() or sel
                    await btn.click()
                    await asyncio.sleep(0.8)
                    return text
            except Exception:
                continue
        return None

    async def find_and_click_submit(
        self, page, form_selector: Optional[str] = None
    ) -> bool:
        """Click the first visible submit/save button inside the form (or page)."""
        submit_selectors = [
            "button[type='submit']",
            "input[type='submit']",
            "button:has-text('Save')",
            "button:has-text('Create')",
            "button:has-text('Submit')",
            "button:has-text('Add')",
            "button:has-text('OK')",
            "button:has-text('Confirm')",
            "button:has-text('Apply')",
            "button:has-text('Done')",
            "button:has-text('Next')",
            "[role='button']:has-text('Save')",
            "[role='button']:has-text('Create')",
            "[role='button']:has-text('Submit')",
        ]
        scope_loc = page.locator(form_selector) if form_selector else page
        for sel in submit_selectors:
            try:
                btn = scope_loc.locator(sel).first
                if await btn.count() > 0 and await btn.is_visible():
                    await btn.click()
                    return True
            except Exception:
                continue
        return False

    async def check_for_validation_errors(self, page) -> List[str]:
        """Detect visible validation error messages after form submission."""
        error_selectors = [
            ".error", ".error-message", "[class*='error']",
            ".invalid-feedback", ".field-error",
            "[role='alert']", ".alert-danger", ".alert-error",
            "[aria-invalid='true']", ".form-error",
            ".notification-error", ".toast-error",
            "p:has-text('required')", "span:has-text('invalid')",
            # MUI / Radix / common design systems
            ".MuiAlert-root", ".MuiFormHelperText-root", ".Mui-error",
            "[data-testid*='error']", "[data-test*='error']",
            "[role='status']",
            ".snackbar-error", ".SnackbarContent-root",
        ]
        errors: List[str] = []
        for sel in error_selectors:
            try:
                elems = page.locator(sel)
                cnt = await elems.count()
                for i in range(min(cnt, 5)):
                    try:
                        txt = (await elems.nth(i).inner_text()).strip()
                        if txt and txt not in errors and len(txt) > 2:
                            errors.append(txt[:200])
                    except Exception:
                        pass
            except Exception:
                continue
        return errors

    async def check_for_success(self, page) -> bool:
        """Check if a form was submitted successfully (redirect or success toast)."""
        success_selectors = [
            ".success", ".alert-success", ".toast-success",
            "[class*='success']", ".notification-success",
            "p:has-text('created')", "p:has-text('saved')",
            "p:has-text('success')", "span:has-text('successfully')",
        ]
        for sel in success_selectors:
            try:
                elem = page.locator(sel).first
                if await elem.count() > 0 and await elem.is_visible():
                    return True
            except Exception:
                continue
        return False

    def get_last_filled(self, run_id: str) -> Dict[str, str]:
        """Retrieve the last set of values filled for a run."""
        return self._run_data.get(run_id, {})

    # ── Internal: scope resolution ─────────────────────────────────────────────

    async def _resolve_scope(self, page, selector: Optional[str]):
        """Return the element matching selector, or auto-detect the primary form area."""
        if selector:
            loc = page.locator(selector)
            if await loc.count() > 0:
                return loc.first

        # Prefer a visible modal / drawer (highest priority for Create forms)
        for modal_sel in [
            "[role='dialog']:visible",
            "[aria-modal='true']:visible",
            ".modal:visible",
            ".modal-content:visible",
            ".drawer:visible",
            ".drawer-content:visible",
            ".panel:visible",
            ".sheet:visible",
        ]:
            try:
                m = page.locator(modal_sel).first
                if await m.count() > 0 and await m.is_visible():
                    return m
            except Exception:
                pass

        # Fallback: first <form>
        forms = page.locator("form")
        if await forms.count() > 0:
            return forms.first

        return None  # fall back to full page

    # ── Internal: field discovery ──────────────────────────────────────────────

    async def _discover_fields(self, scope) -> List[Dict[str, Any]]:
        """Enumerate all interactive fillable elements within scope."""
        fields: List[Dict[str, Any]] = []
        idx = 0

        # ── Standard text-like inputs ─────────────────────────────────────────
        inp_loc = scope.locator(
            "input:not([type='hidden']):not([type='submit']):not([type='button'])"
            ":not([type='reset']):not([type='image']):not([type='checkbox'])"
            ":not([type='radio']):not([disabled]):not([readonly])"
        )
        cnt = await inp_loc.count()
        for i in range(cnt):
            try:
                el = inp_loc.nth(i)
                if not await el.is_visible():
                    continue
                fields.append({
                    "element":     el,
                    "tag":         "input",
                    "type":        (await el.get_attribute("type") or "text").lower(),
                    "name":        await el.get_attribute("name") or "",
                    "placeholder": await el.get_attribute("placeholder") or "",
                    "aria_label":  await el.get_attribute("aria-label") or "",
                    "label":       await self._label_for(el, scope),
                    "required":    await el.get_attribute("required") is not None,
                    "index":       idx,
                })
                idx += 1
            except Exception:
                continue

        # ── Checkboxes ────────────────────────────────────────────────────────
        cb_loc = scope.locator("input[type='checkbox']:not([disabled])")
        cnt = await cb_loc.count()
        for i in range(min(cnt, 5)):  # cap at 5 checkboxes
            try:
                el = cb_loc.nth(i)
                if not await el.is_visible():
                    continue
                fields.append({
                    "element": el, "tag": "input", "type": "checkbox",
                    "name":        await el.get_attribute("name") or "",
                    "placeholder": "", "aria_label": "",
                    "label":       await self._label_for(el, scope),
                    "required":    False, "index": idx,
                })
                idx += 1
            except Exception:
                continue

        # ── Radio buttons (first of each group) ──────────────────────────────
        seen_groups: set = set()
        radio_loc = scope.locator("input[type='radio']:not([disabled])")
        cnt = await radio_loc.count()
        for i in range(cnt):
            try:
                el = radio_loc.nth(i)
                grp = await el.get_attribute("name") or f"r{i}"
                if grp in seen_groups:
                    continue
                seen_groups.add(grp)
                if not await el.is_visible():
                    continue
                fields.append({
                    "element": el, "tag": "input", "type": "radio",
                    "name": grp, "placeholder": "", "aria_label": "",
                    "label": await self._label_for(el, scope),
                    "required": False, "index": idx,
                })
                idx += 1
            except Exception:
                continue

        # ── Textarea ──────────────────────────────────────────────────────────
        ta_loc = scope.locator("textarea:not([disabled]):not([readonly])")
        cnt = await ta_loc.count()
        for i in range(cnt):
            try:
                el = ta_loc.nth(i)
                if not await el.is_visible():
                    continue
                fields.append({
                    "element":     el,
                    "tag":         "textarea",
                    "type":        "textarea",
                    "name":        await el.get_attribute("name") or "",
                    "placeholder": await el.get_attribute("placeholder") or "",
                    "aria_label":  await el.get_attribute("aria-label") or "",
                    "label":       await self._label_for(el, scope),
                    "required":    await el.get_attribute("required") is not None,
                    "index":       idx,
                })
                idx += 1
            except Exception:
                continue

        # ── Native <select> ───────────────────────────────────────────────────
        sel_loc = scope.locator("select:not([disabled])")
        cnt = await sel_loc.count()
        for i in range(cnt):
            try:
                el = sel_loc.nth(i)
                if not await el.is_visible():
                    continue
                options = await self._get_select_options(el)
                fields.append({
                    "element":     el,
                    "tag":         "select",
                    "type":        "select",
                    "name":        await el.get_attribute("name") or "",
                    "placeholder": "",
                    "aria_label":  "",
                    "label":       await self._label_for(el, scope),
                    "options":     options,
                    "required":    await el.get_attribute("required") is not None,
                    "index":       idx,
                })
                idx += 1
            except Exception:
                continue

        return fields

    # ── Internal: label resolution ────────────────────────────────────────────

    async def _label_for(self, element, scope) -> str:
        """Best-effort: return the human-visible label text for a form field."""
        # 1. aria-labelledby
        try:
            lby = await element.get_attribute("aria-labelledby")
            if lby:
                for part in lby.split():
                    try:
                        txt = await scope.locator(f"#{part}").first.inner_text()
                        if txt and txt.strip():
                            return txt.strip()
                    except Exception:
                        pass
        except Exception:
            pass

        # 2. <label for="id">
        try:
            fid = await element.get_attribute("id")
            if fid:
                lbl = scope.locator(f"label[for='{fid}']").first
                if await lbl.count() > 0:
                    return (await lbl.inner_text()).strip()
        except Exception:
            pass

        # 3. parent <label>
        try:
            parent_tag = await element.evaluate(
                "el => el.parentElement?.tagName?.toLowerCase() || ''"
            )
            if parent_tag == "label":
                txt = await element.evaluate(
                    "el => el.parentElement.innerText || ''"
                )
                return txt.strip()
        except Exception:
            pass

        # 4. aria-label attribute
        try:
            al = await element.get_attribute("aria-label")
            if al:
                return al.strip()
        except Exception:
            pass

        # 5. Nearest preceding sibling / ancestor label text (heuristic)
        try:
            txt = await element.evaluate("""el => {
                let sib = el.previousElementSibling;
                while (sib) {
                    if (sib.tagName === 'LABEL' || sib.classList.contains('label') ||
                        sib.classList.contains('form-label')) {
                        return sib.innerText.trim();
                    }
                    sib = sib.previousElementSibling;
                }
                // walk up and check parent's first text child
                let p = el.parentElement;
                if (p) {
                    let lbl = p.querySelector('label, .label, .form-label');
                    if (lbl) return lbl.innerText.trim();
                }
                return '';
            }""")
            if txt:
                return txt.strip()
        except Exception:
            pass

        return ""

    async def _get_select_options(self, select_element) -> List[Dict[str, str]]:
        opts: List[Dict[str, str]] = []
        opt_loc = select_element.locator("option")
        cnt = await opt_loc.count()
        _skip = {"", "0", "-1", "null", "undefined", "none",
                 "select", "choose", "pick", "-- select --", "--",
                 "please select", "select...", "choose...", "any",
                 "select an option", "select option"}
        for i in range(cnt):
            try:
                el = opt_loc.nth(i)
                val = (await el.get_attribute("value") or "").strip()
                txt = (await el.inner_text()).strip()
                if val.lower() not in _skip:
                    opts.append({"value": val, "text": txt})
            except Exception:
                continue
        return opts

    # ── Internal: field filling ────────────────────────────────────────────────

    async def _fill_one(
        self,
        page,
        field: Dict[str, Any],
        run_id: str,
        seed_data: Optional[List[str]],
    ) -> Optional[str]:
        el = field["element"]
        ftype = field["type"]

        if ftype == "checkbox":
            await el.check()
            return "checked"

        if ftype == "radio":
            await el.check()
            return "selected"

        if ftype == "select":
            return await self._fill_select(el, field)

        # Detect semantic intent
        intent = self._detect_intent(field)

        # Date fields
        if ftype == "date":
            val = self._gen_date(intent)
            try:
                await el.fill(val)
                return val
            except Exception:
                try:
                    await el.type(val)
                    return val
                except Exception:
                    return None

        # All text-like fields (text, email, tel, number, url, search, textarea, password)
        val = self._gen_value(intent, ftype, seed_data)
        if val:
            try:
                await el.fill(val)
                return "***" if ftype == "password" else val
            except Exception:
                try:
                    await el.clear()
                    await el.type(val)
                    return "***" if ftype == "password" else val
                except Exception:
                    return None

        return None

    async def _fill_select(self, element, field: Dict) -> Optional[str]:
        options = field.get("options", [])
        if not options:
            options = await self._get_select_options(element)
        if not options:
            return None
        # Prefer first real option from the DOM (skip placeholders / empty values)
        placeholder_re = re.compile(
            r"^(select|choose|pick|please|--|\.\.\.|any|none)\b", re.I
        )
        target = None
        for opt in options:
            val = (opt.get("value") or "").strip()
            txt = (opt.get("text") or "").strip()
            if not val and not txt:
                continue
            if not val or val.lower() in {"", "-1", "0", "null", "undefined"}:
                continue
            if txt and placeholder_re.search(txt.strip()):
                continue
            target = opt
            break
        if target is None:
            target = options[1] if len(options) > 1 else options[0]
        try:
            await element.select_option(value=target["value"])
            return target.get("text") or target["value"]
        except Exception:
            try:
                await element.select_option(label=target["text"])
                return target["text"]
            except Exception:
                try:
                    await element.select_option(index=min(1, len(options) - 1))
                    return options[min(1, len(options) - 1)].get("text", "")
                except Exception:
                    return None

    # ── Internal: intent detection ────────────────────────────────────────────

    def _detect_intent(self, field: Dict) -> str:
        """Derive semantic intent from all human-readable attributes of the field."""
        combined = " ".join([
            field.get("name", ""),
            field.get("label", ""),
            field.get("placeholder", ""),
            field.get("aria_label", ""),
        ]).lower().strip()

        for intent, pattern in self.INTENT_PATTERNS:
            if re.search(pattern, combined, re.IGNORECASE):
                return intent

        # Fall back to HTML type
        type_map = {
            "email":    "email",
            "tel":      "phone",
            "url":      "url",
            "number":   "quantity",
            "date":     "date",
            "textarea": "description",
            "password": "password",
        }
        return type_map.get(field.get("type", "text"), "generic")

    # ── Internal: data generation ─────────────────────────────────────────────

    def _gen_value(
        self,
        intent: str,
        ftype: str,
        seed_data: Optional[List[str]],
    ) -> Optional[str]:
        # Password always use hardcoded safe value
        if ftype == "password" or intent in ("password", "confirm_password"):
            return self._POOL.get(intent, ["Test@1234!"])[0]

        # Search fields: prefer real seed data
        if intent == "search" and seed_data:
            return seed_data[0]

        # Explicit names from user prompts (e.g. wizard: name "qa-test-fs-01")
        if seed_data and intent in (
            "name",
            "full_name",
            "title",
            "namespace",
            "cluster",
            "id_field",
            "username",
            "subject",
        ):
            candidates = [s.strip() for s in seed_data if s and str(s).strip()]
            if candidates:
                return max(candidates, key=len)

        # HTML-type overrides
        if ftype == "email":
            return self._POOL["email"][0]
        if ftype == "url":
            return self._POOL["url"][0]
        if ftype == "number":
            return "1"

        # Lookup pool
        pool = self._POOL.get(intent)
        if pool:
            return pool[0]

        # CIDR / network strings must look valid
        if intent == "cidr":
            return self._POOL["cidr"][0]

        # Long text for textarea / description intents
        if ftype == "textarea" or intent == "description":
            return (
                "Automated test content generated by QA Buddy for verification. "
                "This entry was created during automated testing."
            )

        return "TestValue001"

    def _gen_date(self, intent: str) -> str:
        today = datetime.now()
        if intent == "dob":
            return today.replace(year=today.year - 28).strftime("%Y-%m-%d")
        if intent == "start_date":
            return today.strftime("%Y-%m-%d")
        if intent == "end_date":
            return (today + timedelta(days=30)).strftime("%Y-%m-%d")
        return (today + timedelta(days=1)).strftime("%Y-%m-%d")


# ── Singleton ─────────────────────────────────────────────────────────────────
_smart_form_filler: Optional[SmartFormFiller] = None


def get_smart_form_filler() -> SmartFormFiller:
    global _smart_form_filler
    if _smart_form_filler is None:
        _smart_form_filler = SmartFormFiller()
    return _smart_form_filler

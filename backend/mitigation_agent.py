import html as html_lib
import json
import logging
import re
import threading
import types

import google.generativeai as genai
import requests

from config import UserConfig
from prompt_privacy import (
    deep_pseudonymize,
    deep_scrub_text,
    restore_aliases,
    sanitize_issue_for_prompt,
    scrub_emails,
)

# The google-generativeai SDK keeps API-key state process-global
# (genai.configure); serialize init + calls to avoid cross-profile key races.
_GENAI_LOCK = threading.Lock()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Matches Jira issue keys like MOS-21, PFIN-123
JIRA_KEY_RE = re.compile(r"\b([A-Z][A-Z0-9_]+-\d+)\b")


class OpenRouterModel:
    """Minimal OpenAI-style wrapper around OpenRouter's chat completions endpoint."""

    API_URL = "https://openrouter.ai/api/v1/chat/completions"

    def __init__(self, api_key, model):
        self.model = model
        self.headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://sprint-risk-radar.vercel.app",
            "X-Title": "Sprint Risk Radar",
        }

    def generate_content(self, prompt):
        payload = {
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.3,
            "max_tokens": 2000,
        }
        response = requests.post(self.API_URL, json=payload, headers=self.headers, timeout=45)
        response.raise_for_status()
        data = response.json()
        content = ((data.get("choices") or [{}])[0].get("message") or {}).get("content", "")
        return types.SimpleNamespace(text=content)


class MitigationAgent:
    """Per-profile LLM agent. Uses exactly one provider (gemini | openrouter)."""

    PROVIDERS = ("gemini", "openrouter")

    def __init__(self, config: UserConfig):
        self.config = config
        self.provider = (config.llm_provider or "gemini").lower()
        self.model = None
        self._provider_name = self.provider

        if self.provider not in self.PROVIDERS:
            self.provider = "gemini"

        api_key = config.llm_api_key
        model = config.llm_model

        try:
            if self.provider == "gemini":
                if not api_key:
                    raise RuntimeError("Gemini API key is empty")
                # genai.configure mutates process-global SDK state; serialize it
                # so concurrent profiles cannot race each other's API key in.
                with _GENAI_LOCK:
                    genai.configure(api_key=api_key)
                    self.model = genai.GenerativeModel(model or "gemini-flash-latest")
            elif self.provider == "openrouter":
                if not api_key:
                    raise RuntimeError("OpenRouter API key is empty")
                self.model = OpenRouterModel(api_key, model or "openai/gpt-4o-mini")
            logger.info(f"🤖 LLM ready: {self.provider} | {model or 'default'}")
        except Exception as e:
            logger.error(f"LLM provider '{self.provider}' failed to initialize: {e}. Using rule-based fallback.")
            self.model = None
            self._provider_name = "rule-based"

    def _generate_with_model(self, prompt):
        if not self.model:
            raise RuntimeError("No LLM provider configured")
        if self.provider == "openrouter":
            # Stateless per-instance HTTP client; no shared state to guard.
            return self.model.generate_content(prompt)
        # genai.configure mutates process-global SDK state, so Gemini calls
        # must be serialized across concurrent profiles/threads. Bound the
        # wait so requests degrade to rule-based fallback instead of
        # queueing past Vercel's 60s function deadline.
        if not _GENAI_LOCK.acquire(timeout=15):
            raise RuntimeError("LLM busy — another analysis is in flight")
        try:
            return self.model.generate_content(prompt, request_options={"timeout": 45})
        finally:
            _GENAI_LOCK.release()

    # ---------------- privacy: prompt sanitization ---------------- #
    # See prompt_privacy.py — assignees become per-call pseudonyms before
    # payloads leave for the provider; emails are scrubbed from free text.

    def generate_sprint_mitigation_plan(self, sprints):
        mitigations = []
        for sprint in sprints:
            mitigations.append(self._generate_sprint_mitigation(sprint))
        return mitigations

    def _generate_sprint_mitigation(self, sprint):
        sprint_key = sprint.get("sprint_key")
        project_key = sprint.get("project_key", "N/A")
        risks = sprint.get("risks", [])
        issues = sprint.get("issues", [])
        prompt, prompt_mapping = self._build_sprint_prompt(sprint)

        try:
            response = self._generate_with_model(prompt)
            # The LLM only ever sees pseudonyms; map them back to real names
            # before display/extraction. raw_response keeps the alias-only text.
            mitigation_text = restore_aliases(response.text, prompt_mapping)

            mitigation = {
                "sprint_key": sprint_key,
                "project_key": project_key,
                "risk_count": len(risks),
                "risk_types": sorted(set(r.get("type") for r in risks)),
                "risk_score": max([r.get("risk_score", 0) for r in risks], default=0),
                "burndown_gap_percent": max(
                    [r.get("burndown_gap_percent", 0) for r in risks if r.get("type") == "BURNDOWN_BEHIND"],
                    default=None,
                ),
                "confidence": self._extract_confidence(mitigation_text) or max([r.get("confidence", 0) for r in risks], default=0),
                "ai_mitigation_suggestion": mitigation_text,
                "prompt": prompt,
                "raw_response": response.text,
                "ai_used": True,
                "llm": self.get_model_info(),
                "action_items": self._extract_action_items(mitigation_text),
                "owner": self._extract_owner(mitigation_text),
                "timeline": self._extract_timeline(mitigation_text),
                "success_criteria": self._extract_bullets(self._extract_section(mitigation_text, "SUCCESS CRITERIA:")),
                "details": [{
                    "key": issue.get("key"),
                    "summary": issue.get("summary"),
                    "status": issue.get("status"),
                    "story_points": issue.get("story_points", 0),
                    "assignee": issue.get("assignee", "Unassigned"),
                    "due_date": issue.get("due_date"),
                    "risk_type": self._risk_type_for_issue(risks, issue.get("key")),
                } for issue in issues],
            }

            return mitigation

        except Exception as e:
            logger.error(f"Error generating sprint mitigation for {sprint_key}: {e}")
            return {
                "sprint_key": sprint_key,
                "project_key": project_key,
                "risk_count": len(risks),
                "risk_types": sorted(set(r.get("type") for r in risks)),
                "risk_score": max([r.get("risk_score", 0) for r in risks], default=0),
                "confidence": max([r.get("confidence", 0) for r in risks], default=0),
                "ai_mitigation_suggestion": self._sprint_fallback_suggestion(risks),
                "prompt": prompt,
                "raw_response": "",
                "ai_used": False,
                "llm": self.get_model_info(),
                "action_items": [],
                "owner": "Scrum Master (escalate if needed)",
                "timeline": "ASAP (within 24 hours)",
                "success_criteria": [],
                "details": [{
                    "key": issue.get("key"),
                    "summary": issue.get("summary"),
                    "status": issue.get("status"),
                    "story_points": issue.get("story_points", 0),
                    "assignee": issue.get("assignee", "Unassigned"),
                    "due_date": issue.get("due_date"),
                    "risk_type": self._risk_type_for_issue(risks, issue.get("key")),
                } for issue in issues],
                "error": str(e),
            }

    def _sprint_fallback_suggestion(self, risks):
        if not risks:
            return "Sprint is on track. No mitigation needed at this time."
        parts = []
        for r in risks[:5]:
            parts.append(f"{r.get('type')}: {r.get('recommendation', '')}")
        return " | ".join(parts)

    def _risk_type_for_issue(self, risks, issue_key):
        return next(
            (r.get("type") for r in risks if r.get("issue_key") == issue_key),
            "N/A",
        )

    def _build_sprint_prompt(self, sprint):
        sprint_key = sprint.get("sprint_key")
        project_key = sprint.get("project_key", "N/A")
        risks = sprint.get("risks", [])
        issues = sprint.get("issues", [])

        sprint_issues = [{
            "key": i.get("key"),
            "summary": i.get("summary"),
            "status": i.get("status"),
            "story_points": i.get("story_points", 0),
            "assignee": i.get("assignee", "Unassigned"),
            "due_date": i.get("due_date"),
            "description": (i.get("description") or "")[:500],
            "acceptance_criteria": (i.get("acceptance_criteria") or "")[:500],
        } for i in issues]
        prompt_mapping = {}
        sprint_issues = [sanitize_issue_for_prompt(i, prompt_mapping) for i in sprint_issues]
        # Risks carry assignee keys AND free-text recommendations that can embed
        # real names ("Check with John..."). Pseudonymize keys first (fills the
        # shared map), then scrub every string value.
        risks_for_prompt = deep_scrub_text(deep_pseudonymize(risks, prompt_mapping), prompt_mapping)

        prompt = f"""
You are an expert Scrum Master/Project Manager. Analyze this sprint and its risks, then provide actionable mitigation strategies at the sprint level.

Sprint: {sprint_key}
Project: {project_key}
Number of Risks: {len(risks)}

Risks:
{json.dumps(risks_for_prompt, indent=2, default=str)}

Sprint Tickets:
{json.dumps(sprint_issues, indent=2, default=str)}

Each ticket includes a "due_date" (YYYY-MM-DD, null if unset). Treat a ticket whose due_date is today or past and not Done as DUE_DATE_PASSED, and prioritize mitigation of those tickets.

Provide mitigation suggestions using EXACTLY these section headers, one per line, in this order:

ACTION ITEMS:
- <specific, actionable step 1>
- <specific, actionable step 2>
- <specific, actionable step 3>

OWNER:
- <Role or Person>: <what they are responsible for>

TIMELINE:
- <when>: <what happens by then>

CONFIDENCE:
<70-100>%

SUCCESS CRITERIA:
- <how to measure success 1>
- <how to measure success 2>

Rules:
- Use the exact section headers shown above (ALL CAPS, ending with a colon). Do not number them, do not add sub-headings, do not use "###", "####", or "**" formatting.
- Each bullet line must start with "- ".
- Keep the plan concise and practical for a team standup.
- Every section must be present, even if brief.
"""
        return prompt, prompt_mapping

    def _extract_section(self, text, header):
        lines = text.split("\n")
        section_lines = []
        in_section = False
        for line in lines:
            stripped = line.strip()
            if in_section:
                if stripped and stripped.isupper() and stripped.endswith(":"):
                    break
                if stripped and not stripped.startswith("-") and not stripped.startswith("*") and not stripped.startswith("•"):
                    if any(h in stripped.upper() for h in ["ACTION ITEMS", "OWNER:", "TIMELINE:", "CONFIDENCE:", "SUCCESS CRITERIA"]):
                        break
                if stripped:
                    section_lines.append(stripped)
            elif stripped.upper().startswith(header):
                in_section = True
        return section_lines

    def _extract_bullets(self, section_lines):
        items = []
        for line in section_lines:
            for prefix in ["- ", "* ", "• "]:
                if line.startswith(prefix):
                    line = line[len(prefix):].strip()
                    break
            if line:
                items.append(line)
        return items

    def _extract_action_items(self, text):
        return self._extract_bullets(self._extract_section(text, "ACTION ITEMS:"))[:5]

    def _extract_owner(self, text):
        owners = self._extract_bullets(self._extract_section(text, "OWNER:"))
        return "; ".join(owners) if owners else "Scrum Master (escalate if needed)"

    def _extract_timeline(self, text):
        items = self._extract_bullets(self._extract_section(text, "TIMELINE:"))
        return "; ".join(items) if items else "ASAP (within 24 hours)"

    def _extract_confidence(self, text):
        section = self._extract_section(text, "CONFIDENCE:")
        for line in section:
            nums = [int(s) for s in line.split() if s.isdigit()]
            if nums:
                return max(nums)
        return None

    def generate_followup_message(self, blocker):
        prompt = self._build_followup_prompt(blocker)
        real_assignee = (blocker.get("assignee") or "").strip()
        alias = "dev-01" if real_assignee else None

        try:
            response = self._generate_with_model(prompt)
            text = response.text.strip()
            if alias:
                # Restore the real name locally; the pseudonym never ships.
                text = re.sub(rf"\b{re.escape(alias)}\b", real_assignee, text)
            message = self._linkify_issue_keys(text)
            return {
                "message": message,
                "generated_by": "ai",
                "raw": text,
            }
        except Exception as e:
            logger.error(f"Error generating follow-up message: {e}")
            return {
                "message": self._linkify_issue_keys(self._rule_based_followup_message(blocker)),
                "generated_by": "rule-based",
                "error": str(e),
            }

    def _linkify_issue_keys(self, text):
        escaped = html_lib.escape(text or "")

        def replace(match):
            key = match.group(0)
            url = f"{self.config.jira_cloud_url.rstrip('/')}/browse/{key}"
            return f'<a href="{url}" target="_blank" rel="noopener noreferrer">{key}</a>'

        return JIRA_KEY_RE.sub(replace, escaped)

    def _build_followup_prompt(self, blocker):
        issue_key = blocker.get("issue_key")
        summary = scrub_emails(blocker.get("summary")) or "this ticket"
        real_assignee = (blocker.get("assignee") or "").strip()
        # Pseudonymize the person's name; the caller restores it in the
        # generated text so it never leaves this server.
        assignee = "dev-01" if real_assignee else "the assignee"
        risk_type = blocker.get("type", "RISK")
        hours = blocker.get("hours_since_update")
        status = blocker.get("status")
        sprint_key = blocker.get("sprint_key", "the current sprint")

        context_lines = [
            f"- Ticket: {issue_key}",
            f"- Summary: {summary}",
            f"- Assignee: {assignee}",
            f"- Risk type: {risk_type}",
            f"- Sprint: {sprint_key}",
        ]
        if hours is not None:
            context_lines.append(f"- Hours since last update: {hours}")
        if status:
            context_lines.append(f"- Current status: {status}")

        return f"""
You are an experienced Scrum Master writing a polite, professional follow-up message about a blocked ticket.

TICKET CONTEXT:
{chr(10).join(context_lines)}

Write a short, friendly follow-up message (2-4 sentences) to {assignee} asking for an update on {issue_key}.
- Be concise and actionable, suitable for Slack/Teams or email.
- Reference the specific blocker/risk ({risk_type}).
- If the ticket has been idle for many hours, gently flag that it needs attention.
- End with a clear request (e.g. share an update, unblock, or pair).
- IMPORTANT: Use PLAIN TEXT ONLY. Do NOT use any markdown, asterisks, bold, italics, or emoji formatting.
- Refer to the ticket using its key (e.g. {issue_key}) without any special characters around it.
- Do not mention that this was AI-generated. Return only the message text.
"""

    def _rule_based_followup_message(self, blocker):
        issue_key = blocker.get("issue_key") or "this ticket"
        summary = blocker.get("summary")
        assignee = blocker.get("assignee") or "team"
        risk_type = blocker.get("type", "risk")
        hours = blocker.get("hours_since_update")

        msg = f"Hi {assignee}, quick check-in on {issue_key}"
        if summary:
            msg += f" ({summary})"
        msg += "."
        if hours is not None:
            msg += f" It has been {hours} hours without an update."
        msg += f" Could you share the current status and any blockers ({risk_type})? Thanks!"
        return msg

    def get_model_info(self):
        if self.provider == "openrouter":
            return {"provider": "openrouter", "model": self.config.llm_model or "openai/gpt-4o-mini", "base_url": "https://openrouter.ai"}
        return {"provider": "gemini", "model": self.config.llm_model or "gemini-flash-latest", "base_url": None}

    def analyze_next_sprint_risks(self, project_key, sprint, issues, rule_based_risks=None):
        rule_based_risks = rule_based_risks or []
        prompt, prompt_mapping = self._build_next_sprint_risk_prompt(project_key, sprint, issues)

        try:
            response = self._generate_with_model(prompt)
            text = restore_aliases(response.text.strip(), prompt_mapping)
            raw_risks = self._extract_risk_list(text)

            info = self.get_model_info()
            if raw_risks:
                logger.info(f"🤖 AI identified {len(raw_risks)} early risks for {project_key} next sprint "
                            f"[{info['provider']} | {info['model']}]")
                return raw_risks, True, prompt, text
            logger.warning(f"⚠️ AI returned empty risk list for {project_key}. Using rule-based fallback. "
                           f"[{info['provider']} | {info['model']}]")
            return rule_based_risks, False, prompt, text
        except Exception as e:
            info = self.get_model_info()
            logger.error(f"❌ AI next-sprint risk analysis failed for {project_key} "
                         f"[{info['provider']} | {info['model']}]: {e}")
            return rule_based_risks, False, prompt, ""

    def _build_next_sprint_risk_prompt(self, project_key, sprint, issues):
        sprint_key = sprint.get("name") or sprint.get("id")
        start_date = sprint.get("startDate")
        end_date = sprint.get("endDate")

        issue_list = [{
            "key": i.get("key"),
            "summary": i.get("summary"),
            "status": i.get("status"),
            "story_points": i.get("story_points", 0),
            "assignee": i.get("assignee", "Unassigned"),
            "issue_type": i.get("issue_type"),
            "priority": i.get("priority"),
            "description": (i.get("description") or "")[:500],
            "acceptance_criteria": (i.get("acceptance_criteria") or "")[:500],
            "due_date": i.get("due_date"),
        } for i in issues]
        prompt_mapping = {}
        issue_list = [sanitize_issue_for_prompt(i, prompt_mapping) for i in issue_list]
        issue_list = [deep_scrub_text(i, prompt_mapping) for i in issue_list]

        prompt = f"""
You are an expert Scrum Master performing pre-planning risk analysis on an UPCOMING sprint.

Sprint: {sprint_key}
Project: {project_key}
Planned Dates: {start_date} → {end_date}
Number of Work Items: {len(issues)}

Planned Work Items:
{json.dumps(issue_list, indent=2, default=str)}

Analyze the upcoming sprint for early risks BEFORE planning begins. Consider:
- Unassigned work items (capacity / ownership gaps)
- Missing story points (sizing / velocity concerns)
- Undefined scope (missing or thin acceptance_criteria; no description)
- Acceptance criteria too thin for the estimated size (e.g. 8+ SP with a single short scenario)
- External dependencies or "blocked by" mentions
- Assignee overload (one person carrying too many items)
- Priority conflicts or high-priority items with large estimates
- Too much work vs. team capacity (velocity)
- Due-date checkpoint: only flag DUE_DATE_PASSED when a work item HAS a due_date that is on or before the sprint start date, or already in the past. A null/missing due_date is NOT a risk — but note missing due dates as a planning checkpoint (confirm due dates during planning) rather than a scored risk

Each work item includes "description", "acceptance_criteria", and "due_date" (YYYY-MM-DD, null if unset) fields.
Judge scope completeness from "acceptance_criteria", not just the description text.
Treat due_date as a pre-planning checkpoint: flag items with an EXPLICIT past/at-start due_date as "DUE_DATE_PASSED". Never emit DUE_DATE_PASSED for items with a null due_date.

Return your findings as a valid JSON array. Each element MUST be an object with exactly these keys:
  "type"         - short ALL-CAPS identifier (e.g. "UNASSIGNED", "UNESTIMATED", "OVERLOADED", "EXTERNAL_DEPENDENCY", "SCOPE_RISK", "DUE_DATE_PASSED")
  "issue_keys"   - list of affected ticket keys (strings); use [] if sprint-wide
  "count"        - number of affected tickets
  "risk_score"   - integer 0-100
  "confidence"   - integer 0-100
  "severity"     - "CRITICAL", "HIGH", "MEDIUM", or "LOW"
  "recommendation" - one concise actionable sentence to de-risk before planning

Rules:
- Return ONLY the JSON array. No markdown fences, no code block markers, no extra text.
- If no meaningful risks exist, return an empty array: []
- Maximum 6 risks, ranked by risk_score descending.
"""
        return prompt, prompt_mapping

    def _extract_risk_list(self, text):
        text = text.strip()
        fence_match = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
        if fence_match:
            text = fence_match.group(1).strip()
        try:
            return json.loads(text)
        except Exception:
            start = text.find("[")
            end = text.rfind("]")
            if start != -1 and end != -1 and end > start:
                try:
                    return json.loads(text[start:end + 1])
                except Exception:
                    return []
            return []

    def generate_stakeholder_report(self, risks, mitigations, sprint_data=None):
        report_mapping = {}
        prompt = f"""
You are creating a Sprint Status Report for Product Owners and Executives.

Total Risks Identified: {len(risks)}
Critical Severity Risks: {len([r for r in risks if r.get('severity') == 'CRITICAL'])}
High Severity Risks: {len([r for r in risks if r.get('severity') == 'HIGH'])}
Medium Severity Risks: {len([r for r in risks if r.get('severity') == 'MEDIUM'])}

Risks Summary:
{json.dumps(deep_pseudonymize(risks[:5], report_mapping), indent=2, default=str)}

Mitigations Proposed:
{json.dumps(deep_pseudonymize(mitigations[:5], report_mapping), indent=2, default=str)}

Generate a 3-paragraph executive summary:
1. Current Sprint Status (one sentence)
2. Key Risks & Impact (2-3 risks)
3. Mitigation Plan & Next Steps

Make it suitable for a 5-minute stakeholder update. Be direct and actionable.
"""

        try:
            response = self._generate_with_model(prompt)
            return restore_aliases(response.text, report_mapping)
        except Exception as e:
            logger.error(f"Error generating stakeholder report: {e}")
            return f"Unable to generate report. {len(risks)} risks detected, manual review required."
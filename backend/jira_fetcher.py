import logging
import html as html_lib
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

import requests

from config import UserConfig, settings
from risk_components import is_qa_status

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_ANCHOR_RE = re.compile(r'<a\s+href="([^"]*)"[^>]*>([\s\S]*?)</a>', re.IGNORECASE)
_TAG_RE = re.compile(r'<[^>]*>')


class JiraFetcher:
    def __init__(self, config: UserConfig):
        self.config = config
        self.base_url = config.jira_cloud_url.rstrip("/")
        self.auth = (config.jira_email, config.jira_api_token)
        self.headers = {"Accept": "application/json"}
        self.blocked_by_field = settings.jira_field_mapping.get("blocked_by_field")
        self._story_points_field: str | None = None
        self._story_points_resolved = False

    # ------------------------------------------------------------------ #
    # Connectivity / diagnostics (used by the Settings "Test Connection")
    # ------------------------------------------------------------------ #
    def test_connection(self) -> dict:
        results: dict = {"auth": {"ok": False}}

        try:
            r = requests.get(
                f"{self.base_url}/rest/api/3/myself",
                auth=self.auth, headers=self.headers, timeout=30,
            )
            if r.status_code == 200:
                me = r.json()
                results["auth"] = {
                    "ok": True,
                    "display_name": me.get("displayName"),
                    "email": me.get("emailAddress"),
                }
            else:
                results["auth"] = {"ok": False, "error": f"HTTP {r.status_code} {r.text[:200]}"}
        except Exception as e:
            results["auth"] = {"ok": False, "error": str(e)}

        try:
            results["story_points_field"] = self.detect_story_points_field()
        except Exception as e:
            results["story_points_field"] = {"ok": False, "error": str(e)}

        results["projects"] = {}
        for project_key in self.config.project_list:
            results["projects"][project_key] = self._project_diag(project_key)

        return results

    def _project_diag(self, project_key) -> dict:
        try:
            r = requests.get(
                f"{self.base_url}/rest/agile/1.0/board",
                auth=self.auth, headers=self.headers,
                params={"projectKeyOrId": project_key}, timeout=30,
            )
            r.raise_for_status()
            boards = r.json().get("values", [])
            if not boards:
                return {"ok": False, "error": "no board found"}
            board_id = boards[0]["id"]
            board_name = boards[0].get("name")
            sr = requests.get(
                f"{self.base_url}/rest/agile/1.0/board/{board_id}/sprint",
                auth=self.auth, headers=self.headers, timeout=30,
            )
            sr.raise_for_status()
            sprints = sr.json().get("values", [])
            active = next((s.get("name") for s in sprints if s.get("state") == "active"), None)
            return {
                "ok": True,
                "board": board_name,
                "active_sprint": active,
                "sprint_count": len(sprints),
            }
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def detect_story_points_field(self) -> dict | None:
        """Find the custom field named 'Story Points' on this Jira instance."""
        r = requests.get(
            f"{self.base_url}/rest/api/3/field",
            auth=self.auth, headers=self.headers, timeout=30,
        )
        r.raise_for_status()
        for field in r.json():
            if (field.get("name") or "").strip().lower() == "story points":
                return {"ok": True, "id": field.get("id")}
        return {"ok": False, "error": "no field named 'Story Points' found"}

    def resolve_story_points_field(self) -> str | None:
        if self.config.story_points_field:
            return self.config.story_points_field
        if not self._story_points_resolved:
            try:
                detected = self.detect_story_points_field()
                self._story_points_field = detected.get("id") if detected and detected.get("ok") else None
            except Exception:
                self._story_points_field = None
            self._story_points_resolved = True
        return self._story_points_field

    # ------------------------------------------------------------------ #
    # Sprint / issue fetching
    # ------------------------------------------------------------------ #
    def _get_sprint_by_state(self, project_key, state):
        try:
            boards = requests.get(
                f"{self.base_url}/rest/agile/1.0/board",
                auth=self.auth, headers=self.headers,
                params={"projectKeyOrId": project_key}, timeout=60,
            ).json().get("values", [])

            if not boards:
                logger.warning(f"No boards found for {project_key}")
                return None

            board_id = boards[0]["id"]
            sprints = requests.get(
                f"{self.base_url}/rest/agile/1.0/board/{board_id}/sprint",
                auth=self.auth, headers=self.headers, timeout=60,
            ).json().get("values", [])
            return next((s for s in sprints if s.get("state") == state), None)
        except Exception as e:
            logger.error(f"Error fetching {state} sprint for {project_key}: {e}")
            return None

    def get_sprint_issues(self, sprint_id):
        jql = f"sprint = {sprint_id} AND type in (Story, Task, Bug)"
        try:
            response = requests.get(
                f"{self.base_url}/rest/api/3/search/jql",
                auth=self.auth, headers=self.headers,
                params={"jql": jql, "maxResults": 100, "expand": "changelog", "fields": "*all"},
                timeout=60,
            )
            response.raise_for_status()
            return response.json().get("issues", [])
        except Exception as e:
            logger.error(f"Error fetching sprint issues: {e}")
            return []

    def _adf_inline_nodes(self, line: str) -> list:
        """Convert one line of (possibly anchor-containing) text into ADF inline nodes.

        <a href="URL">LABEL</a> becomes a text node with a link mark; everything
        else stays plain text. HTML entities are unescaped.
        """
        content = []
        pos = 0
        for m in _ANCHOR_RE.finditer(line):
            if m.start() > pos:
                content.append({"type": "text", "text": html_lib.unescape(line[pos:m.start()])})
            label = _TAG_RE.sub("", m.group(2))
            content.append({
                "type": "text",
                "text": html_lib.unescape(label),
                "marks": [{"type": "link", "attrs": {"href": m.group(1)}}],
            })
            pos = m.end()
        if pos < len(line):
            content.append({"type": "text", "text": html_lib.unescape(line[pos:])})
        return content

    def add_comment(self, issue_key, body):
        """Post a comment on an issue. <a href="..."> anchors in body become real links. Returns (ok, error_or_comment_id)."""
        paragraphs = []
        for para in (body or "").split("\n\n"):
            lines = [ln for ln in para.split("\n")]
            if not lines:
                continue
            content = []
            for i, line in enumerate(lines):
                if i:
                    content.append({"type": "hardBreak"})
                content.extend(self._adf_inline_nodes(line))
            paragraphs.append({"type": "paragraph", "content": content})

        payload = {
            "body": {
                "type": "doc",
                "version": 1,
                "content": paragraphs or [{"type": "paragraph", "content": []}],
            }
        }
        try:
            response = requests.post(
                f"{self.base_url}/rest/api/3/issue/{issue_key}/comment",
                auth=self.auth, headers={**self.headers, "Content-Type": "application/json"},
                json=payload, timeout=30,
            )
            response.raise_for_status()
            return True, response.json().get("id")
        except requests.HTTPError as e:
            detail = e.response.text[:300] if e.response is not None else str(e)
            logger.error(f"Error posting comment to {issue_key}: {detail}")
            return False, detail
        except Exception as e:
            logger.error(f"Error posting comment to {issue_key}: {e}")
            return False, str(e)

    # ------------------------------------------------------------------ #
    # Aggregates
    # ------------------------------------------------------------------ #
    def _sprint_bundle(self, project_key, state):
        sprint = self._get_sprint_by_state(project_key, state)
        if not sprint:
            return None
        raw_issues = self.get_sprint_issues(sprint["id"])
        return {
            "sprint": sprint,
            "issues": [self.parse_issue_data(i) for i in raw_issues],
        }

    def get_all_sprints_data(self):
        all_data = {}
        for project_key in self.config.project_list:
            bundle = self._sprint_bundle(project_key, "active")
            if bundle:
                all_data[project_key] = bundle
        return all_data

    def get_next_sprints_data(self):
        all_data = {}
        for project_key in self.config.project_list:
            bundle = self._sprint_bundle(project_key, "future")
            if bundle:
                all_data[project_key] = bundle
        return all_data

    def get_velocity_data(self, max_sprints=5):
        velocity = {}
        for project_key in self.config.project_list:
            sprints = self._get_recent_closed_sprints(project_key, max_sprints)
            if not sprints:
                continue
            data = []
            for sprint in sprints:
                raw_issues = self.get_sprint_issues(sprint["id"])
                issues = [self.parse_issue_data(i) for i in raw_issues]
                completed_sp = sum(
                    i.get("story_points", 0) for i in issues if i.get("status") == "Done"
                )
                total_sp = sum(i.get("story_points", 0) for i in issues)
                data.append({
                    "sprint_key": sprint.get("name"),
                    "start_date": sprint.get("startDate"),
                    "end_date": sprint.get("endDate"),
                    "duration_days": self._sprint_duration_days(sprint),
                    "completed_sp": completed_sp,
                    "total_sp": total_sp,
                    "completed_percent": int((completed_sp / total_sp * 100) if total_sp > 0 else 0),
                    "qa_cleared_count": sum(1 for i in issues if self._passed_through_qa(i)),
                })
            velocity[project_key] = data
        return velocity

    def _get_recent_closed_sprints(self, project_key, max_sprints=5):
        try:
            boards = requests.get(
                f"{self.base_url}/rest/agile/1.0/board",
                auth=self.auth, headers=self.headers,
                params={"projectKeyOrId": project_key}, timeout=60,
            ).json().get("values", [])
            if not boards:
                return []
            board_id = boards[0]["id"]
            sprints = requests.get(
                f"{self.base_url}/rest/agile/1.0/board/{board_id}/sprint",
                auth=self.auth, headers=self.headers,
                params={"state": "closed", "maxResults": max_sprints}, timeout=60,
            ).json().get("values", [])
            return sorted(
                (s for s in sprints if s.get("state") == "closed"),
                key=lambda s: s.get("endDate") or "",
            )
        except Exception as e:
            logger.error(f"Error fetching closed sprints for {project_key}: {e}")
            return []

    @staticmethod
    def _sprint_duration_days(sprint):
        try:
            start = datetime.fromisoformat(sprint["startDate"].replace("Z", "+00:00")).replace(tzinfo=None)
            end = datetime.fromisoformat(sprint["endDate"].replace("Z", "+00:00")).replace(tzinfo=None)
            return max((end - start).days, 1)
        except Exception:
            return 14

    def _passed_through_qa(self, issue):
        changelog = issue.get("changelog") or []
        for history in changelog:
            for item in (history.get("items") or []):
                if item.get("field") == "status" and is_qa_status(item.get("toString")):
                    return True
        return is_qa_status(issue.get("status"))

    # ------------------------------------------------------------------ #
    # Issue parsing
    # ------------------------------------------------------------------ #
    def _extract_description(self, description):
        if isinstance(description, str):
            return description
        if isinstance(description, list):
            return "\n".join(self._extract_description(item) for item in description)
        if isinstance(description, dict):
            node_type = description.get("type")
            if node_type == "text":
                return description.get("text", "")
            parts = []
            for item in description.get("content", []) or []:
                text = self._extract_description(item)
                if text:
                    parts.append(text)
            if node_type in ("tableCell", "tableHeader", "listItem"):
                return " ".join(p for p in parts if p.strip())
            return "\n".join(parts)
        return ""

    def _extract_acceptance_criteria(self, description):
        if not description:
            return ""
        match = re.search(r"(?ims)^\s*acceptance\s+criteria\s*:?\s*\n(.*)", description)
        if not match:
            return ""
        ac = match.group(1).strip()
        ac = re.split(r"(?im)^\s*[a-z][a-z ]*:\s*$", ac)[0].strip()
        return ac

    def parse_issue_data(self, issue):
        fields = issue.get("fields", {}) or {}
        resolved = self.resolve_story_points_field()
        story_point_fields = [
            resolved,
            settings.jira_field_mapping.get("story_points"),
            "customfield_10102",
            "customfield_10016",
            "customfield_10004",
        ]
        story_points = 0
        for field in story_point_fields:
            if not field:
                continue
            value = fields.get(field)
            if value not in (None, "", 0):
                story_points = value
                break

        description = self._extract_description(fields.get("description", ""))

        return {
            "key": issue["key"],
            "summary": fields.get("summary"),
            "status": (fields.get("status") or {}).get("name"),
            "assignee": (fields.get("assignee") or {}).get("displayName", "Unassigned"),
            "story_points": story_points,
            "priority": (fields.get("priority") or {}).get("name"),
            "issue_type": (fields.get("issuetype") or {}).get("name"),
            "created": fields.get("created"),
            "updated": fields.get("updated"),
            "description": description,
            "acceptance_criteria": self._extract_acceptance_criteria(description),
            "due_date": fields.get("duedate"),
            "labels": fields.get("labels", []),
            "blocked_by": fields.get(self.blocked_by_field),
            "changelog": issue.get("changelog", {}).get("histories", []),
        }


def fetch_all(fetcher: JiraFetcher) -> dict:
    """Fetch sprint, next-sprint and velocity data for a profile, in parallel."""
    sprint_data, next_sprint_data, velocity_data = {}, {}, {}

    with ThreadPoolExecutor(max_workers=3) as pool:
        f_sprint = pool.submit(fetcher.get_all_sprints_data)
        f_next = pool.submit(fetcher.get_next_sprints_data)
        f_vel = pool.submit(fetcher.get_velocity_data)

        try:
            sprint_data = f_sprint.result()
        except Exception as e:
            logger.error(f"Sprint fetch failed: {e}")
        try:
            next_sprint_data = f_next.result()
        except Exception as e:
            logger.error(f"Next-sprint fetch failed: {e}")
        try:
            velocity_data = f_vel.result()
        except Exception as e:
            logger.error(f"Velocity fetch failed: {e}")

    return {
        "sprint_data": sprint_data,
        "next_sprint_data": next_sprint_data,
        "velocity_data": velocity_data,
    }
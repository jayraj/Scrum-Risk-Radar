"""v2 risk engine implementing the Sprint Risk Scoring Rubric v2.

All triggers remain the same as v1; only scoring changed. Each risk emits a
capped `risk_score` (for UI/severity) and an uncapped `raw_score` (for
sprint-to-sprint and ticket-to-ticket ranking/triage).
"""
import logging
from datetime import date, datetime

from config import settings
from risk_components import (
    STALE_HOURS,
    assignee_factor,
    avg_sprint_sp,
    bucket_severity,
    cap_score,
    days_remaining,
    hours_since,
    is_blocking_map,
    is_qa_status,
    now_utc,
    pct_sprint_elapsed,
    size_weight,
    time_pressure_multiplier,
    to_utc,
    trend_factor,
    workflow_stage_weight,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

EXTERNAL_KEYWORDS = ["vendor", "third-party", "third party", "procurement", "external", "credentials"]
INTERNAL_KEYWORDS = ["another team", "other team", "internal", "platform team", "another squad", "squad"]
TRIGGER_KEYWORDS = ["blocked by", "depends on", "waiting for", "external", "vendor", "third-party"]

DEPENDENCY_BASE = {
    "external": settings.dependency_external_base,
    "internal": settings.dependency_internal_base,
    "default": settings.dependency_default_base,
}


class RiskEngine:

    # ------------------------------------------------------------------ #
    # Orchestrator
    # ------------------------------------------------------------------ #
    def calculate_all_risks(self, sprint_data, velocity_data=None, burndown_history=None, scope_meta=None):
        risks = []
        burndown_history = burndown_history or {}
        scope_meta = scope_meta or {}
        baselines = scope_meta.get("baselines") or {}
        scope_history = scope_meta.get("history") or {}

        for project_key, data in sprint_data.items():
            sprint = data["sprint"]
            issues = data["issues"]

            context = {
                "avg_sp": avg_sprint_sp(issues),
                "blocking_map": is_blocking_map(issues),
                "qa_throughput": self._qa_throughput(velocity_data, project_key),
                "burndown_history": burndown_history.get(sprint.get("name")) if sprint else None,
                "scope_baseline": baselines.get(sprint.get("name")) if sprint else None,
                "scope_history": scope_history.get(sprint.get("name")) if sprint else None,
            }

            risks.extend(self.detect_story_progress_risks(issues, context))
            risks.extend(self.detect_burndown_risks(sprint, issues, context))
            risks.extend(self.detect_qa_bottleneck(sprint, issues, context))
            risks.extend(self.detect_external_dependencies(issues, context))
            risks.extend(self.detect_due_date_risks(sprint, issues, context))
            risks.extend(self.detect_bug_risks(sprint, issues, context))
            risks.extend(self.detect_scope_creep(sprint, issues, context))

        return sorted(risks, key=lambda x: x["raw_score"], reverse=True)

    @staticmethod
    def _qa_throughput(velocity_data, project_key):
        from risk_components import qa_throughput_per_day
        return qa_throughput_per_day(velocity_data, project_key)

    # ------------------------------------------------------------------ #
    # 1. STORY_NOT_PROGRESSING (ticket-level)
    # ------------------------------------------------------------------ #
    def detect_story_progress_risks(self, issues, context=None):
        risks = []
        context = context or {}
        avg_sp = context.get("avg_sp", 0.0)

        for issue in issues:
            key = issue.get("key")
            status = issue.get("status")
            if not key or status == "Done":
                continue
            h = hours_since(issue.get("updated"))
            if h is None or h <= STALE_HOURS:
                continue

            raw, score, detail = self._stalled_ticket_score(issue, issues, avg_sp)
            risks.append({
                "type": "STORY_NOT_PROGRESSING",
                "issue_key": key,
                "summary": issue.get("summary"),
                "assignee": issue.get("assignee"),
                "status": status,
                "hours_since_update": round(h, 1),
                "risk_score": score,
                "raw_score": round(raw, 1),
                "confidence": 85,
                "severity": bucket_severity(score),
                "recommendation": (
                    f"Story '{key}' has no updates in {int(h)}h. "
                    f"Check with {issue.get('assignee')} for blockers."
                ),
                **detail,
            })

        return risks

    def _stalled_ticket_score(self, issue, issues, avg_sp):
        """Per-ticket stalled formula (used by STORY_NOT_PROGRESSING)."""
        h = hours_since(issue.get("updated")) or STALE_HOURS + 1
        base = min(settings.stalled_base_cap, h / 2.0)
        stage = workflow_stage_weight(issue.get("status"))
        af = assignee_factor(issues, issue.get("assignee"))
        sw = size_weight(issue.get("story_points") or 0, avg_sp)
        raw = base * stage * af * sw
        return raw, cap_score(raw), {
            "stage_weight": stage,
            "assignee_factor": af,
            "size_weight": round(sw, 3),
        }

    # ------------------------------------------------------------------ #
    # 2. BURNDOWN_BEHIND (sprint-level)
    # ------------------------------------------------------------------ #
    def get_burndown_gap(self, sprint, issues):
        """Return computed burndown metrics for a sprint (None if not judgeable).

        Used by main.py to persist per-check-in gap history for the trend factor.
        """
        return self._compute_burndown(sprint, issues)

    def _compute_burndown(self, sprint, issues):
        if not sprint:
            return None

        start_date = self._parse_dt(sprint.get("startDate"))
        end_date = self._parse_dt(sprint.get("endDate"))
        now = datetime.utcnow()
        if not start_date or not end_date:
            return None

        sprint_duration = (end_date - start_date).days
        days_elapsed = (now - start_date).days
        days_left = (end_date - now).days

        if days_elapsed <= 0 or sprint_duration <= 0:
            return None

        # Grace period: don't judge burndown until the sprint has progressed
        if days_elapsed / sprint_duration < settings.burndown_grace_period_fraction:
            return None

        total_sp = sum(issue.get("story_points", 0) for issue in issues)
        completed_sp = sum(
            issue.get("story_points", 0) * settings.status_completion_weights.get(issue.get("status"), 0)
            for issue in issues
        )
        done_sp = sum(
            issue.get("story_points", 0)
            for issue in issues
            if issue.get("status") == "Done"
        )

        expected_completion_rate = min(1.0, days_elapsed / sprint_duration)
        actual_completion_rate = completed_sp / total_sp if total_sp > 0 else 0
        burndown_gap = (expected_completion_rate - actual_completion_rate) * 100

        return {
            "sprint_duration": sprint_duration,
            "days_elapsed": days_elapsed,
            "days_remaining": days_left,
            "total_sp": total_sp,
            "completed_sp": round(done_sp, 1),
            "weighted_completed_sp": round(completed_sp, 1),
            "remaining_sp": total_sp - completed_sp,
            "expected_completion_rate": round(expected_completion_rate, 4),
            "actual_completion_rate": round(actual_completion_rate, 4),
            "burndown_gap_percent": round(burndown_gap, 1),
        }

    def detect_burndown_risks(self, sprint, issues, context=None):
        risks = []
        context = context or {}
        data = self._compute_burndown(sprint, issues)
        if not data:
            return risks

        burndown_gap = data["burndown_gap_percent"]
        if burndown_gap <= settings.burndown_behind_threshold:
            return risks

        # v2: trend + time pressure composition
        base_severity = min(settings.burndown_gap_cap, burndown_gap)
        tf = trend_factor(context.get("burndown_history") or [])
        tp = time_pressure_multiplier(sprint)
        raw = base_severity * tf * tp
        score = cap_score(raw)

        risks.append({
            "type": "BURNDOWN_BEHIND",
            "sprint_key": sprint.get("name"),
            "issue_keys": [i.get("key") for i in issues if i.get("status") != "Done"],
            "total_sp": data["total_sp"],
            "completed_sp": data["completed_sp"],
            "weighted_completed_sp": data["weighted_completed_sp"],
            "remaining_sp": data["remaining_sp"],
            "days_remaining": data["days_remaining"],
            "burndown_gap_percent": burndown_gap,
            "risk_score": score,
            "raw_score": round(raw, 1),
            "confidence": 90,
            "severity": bucket_severity(score),
            "recommendation": (
                f"Burndown {burndown_gap:.1f}% behind. Need to complete "
                f"{data['remaining_sp']:.0f} SP in {data['days_remaining']} days."
            ),
        })

        return risks

    # ------------------------------------------------------------------ #
    # 3. QA_BOTTLENECK (sprint-level, capacity vs time)
    # ------------------------------------------------------------------ #
    def detect_qa_bottleneck(self, sprint, issues, context=None):
        risks = []
        context = context or {}

        qa_stories = [issue for issue in issues if is_qa_status(issue.get("status"))]

        if len(qa_stories) < settings.qa_bottleneck_threshold:
            return risks

        stuck_stories = []
        for issue in qa_stories:
            h = hours_since(issue.get("updated"))
            if h is not None and h > 24:
                stuck_stories.append({
                    "key": issue["key"],
                    "summary": issue.get("summary"),
                    "hours_in_qa": round(h, 1),
                })

        # Capacity-vs-time model
        throughput = context.get("qa_throughput", settings.qa_throughput_default) or settings.qa_throughput_default
        qa_queue_count = len(qa_stories)
        backlog_clear_days = qa_queue_count / throughput if throughput > 0 else qa_queue_count
        days_left = days_remaining(sprint)
        base = min(settings.qa_backlog_cap, (backlog_clear_days / days_left) * 100)
        tp = time_pressure_multiplier(sprint)
        raw = base * tp
        score = cap_score(raw)

        risks.append({
            "type": "QA_BOTTLENECK",
            "sprint_key": sprint.get("name") if sprint else None,
            "issue_keys": [s.get("key") for s in qa_stories],
            "qa_stories_count": qa_queue_count,
            "qa_throughput_per_day": round(throughput, 2),
            "backlog_clear_days": round(backlog_clear_days, 2),
            "days_remaining": days_left,
            "stuck_stories": stuck_stories,
            "risk_score": score,
            "raw_score": round(raw, 1),
            "confidence": 80,
            "severity": bucket_severity(score),
            "recommendation": (
                f"{qa_queue_count} stories in QA Review. Consider adding QA "
                f"resource or running parallel testing."
            ),
        })

        return risks

    # ------------------------------------------------------------------ #
    # 4. EXTERNAL_DEPENDENCY (ticket-level)
    # ------------------------------------------------------------------ #
    def detect_external_dependencies(self, issues, context=None):
        risks = []
        context = context or {}
        avg_sp = context.get("avg_sp", 0.0)
        blocking_map = context.get("blocking_map", {})

        for issue in issues:
            description = (issue.get("description") or "").lower()
            if not any(k in description for k in TRIGGER_KEYWORDS):
                continue
            if issue.get("status") == "Done":
                continue

            if any(k in description for k in EXTERNAL_KEYWORDS):
                dep_base = DEPENDENCY_BASE["external"]
            elif any(k in description for k in INTERNAL_KEYWORDS):
                dep_base = DEPENDENCY_BASE["internal"]
            else:
                dep_base = DEPENDENCY_BASE["default"]

            fan_out = settings.fan_out_factor if issue.get("key") in blocking_map else 1.0
            sw = size_weight(issue.get("story_points") or 0, avg_sp)
            raw = dep_base * fan_out * sw
            score = cap_score(raw)

            risks.append({
                "type": "EXTERNAL_DEPENDENCY",
                "issue_key": issue["key"],
                "summary": issue.get("summary"),
                "dependency_detail": issue.get("blocked_by", "External dependency mentioned in description"),
                "dependency_base": dep_base,
                "fan_out": fan_out,
                "risk_score": score,
                "raw_score": round(raw, 1),
                "confidence": 75,
                "severity": bucket_severity(score),
                "recommendation": (
                    f"Story '{issue['key']}' has external dependency. "
                    f"Verify status and escalate if blocked."
                ),
            })

        return risks

    # ------------------------------------------------------------------ #
    # 5. DUE_DATE_PASSED (sprint-level, per-ticket max aggregate)
    # ------------------------------------------------------------------ #
    def detect_due_date_risks(self, sprint, issues, context=None):
        risks = []
        context = context or {}
        avg_sp = context.get("avg_sp", 0.0)
        blocking_map = context.get("blocking_map", {})
        today = date.today()
        overdue = []

        for issue in issues:
            due_date = issue.get("due_date")
            if not due_date or issue.get("status") == "Done":
                continue
            try:
                due = date.fromisoformat(str(due_date).split("T")[0])
            except ValueError:
                continue
            if due >= today:
                continue

            days_overdue = (today - due).days
            base = min(settings.due_date_base_cap, days_overdue * settings.due_date_base_per_day)
            stage = workflow_stage_weight(issue.get("status"))
            sw = size_weight(issue.get("story_points") or 0, avg_sp)
            blocking = settings.blocking_factor if issue.get("key") in blocking_map else 1.0
            raw = base * stage * sw * blocking

            overdue.append({
                "key": issue["key"],
                "summary": issue.get("summary"),
                "due_date": due_date,
                "assignee": issue.get("assignee"),
                "days_overdue": days_overdue,
                "stage_weight": stage,
                "size_weight": round(sw, 3),
                "is_blocking": issue.get("key") in blocking_map,
                "raw_score": round(raw, 1),
                "risk_score": cap_score(raw),
            })

        if not overdue:
            return risks

        raw = max(o["raw_score"] for o in overdue)
        score = cap_score(raw)

        risks.append({
            "type": "DUE_DATE_PASSED",
            "sprint_key": sprint.get("name") if sprint else None,
            "issue_keys": [o["key"] for o in overdue],
            "overdue_issues": overdue,
            "count": len(overdue),
            "risk_score": score,
            "raw_score": round(raw, 1),
            "confidence": 85,
            "severity": bucket_severity(score),
            "recommendation": (
                f"{len(overdue)} ticket(s) are past their due date. "
                f"Escalate immediately and reassign to unblock delivery."
            ),
        })

        return risks

    # ------------------------------------------------------------------ #
    # 6. BUG_RAISED (ticket-level, in-sprint defect)
    # ------------------------------------------------------------------ #
    def detect_bug_risks(self, sprint, issues, context=None):
        """Flag bugs raised during the current sprint (in-sprint defects).

        Sprint membership is guaranteed by the fetch JQL; the created-date
        comparison is the ISD discriminator (defect injected by this sprint,
        not backlog debt pulled in).

        Scoring follows the defect quality-risk band model: each bug's tier
        (P1-P4, derived from its Jira priority) maps to a score band, and the
        position within the band ramps with age across the sprint duration.
        Fixed P1s stay visible at a lower band; fixed P2+ drop out. A P1
        labeled as a production escape scores the maximum.
        """
        risks = []
        sprint_start = to_utc(sprint.get("startDate")) if sprint else None
        sprint_end = to_utc(sprint.get("endDate")) if sprint else None
        now = now_utc()
        sprint_days = None
        if sprint_start and sprint_end and sprint_end > sprint_start:
            sprint_days = max(1.0, (sprint_end - sprint_start).total_seconds() / 86400)

        for issue in issues:
            itype = (issue.get("issue_type") or "").strip().lower()
            if itype != "bug":
                continue
            status = issue.get("status")
            created = to_utc(issue.get("created"))
            if not created or not sprint_start or created < sprint_start:
                continue

            priority = issue.get("priority") or ""
            tier = settings.bug_priority_tiers.get(priority, settings.bug_default_tier)

            labels = [str(lb).strip().lower() for lb in (issue.get("labels") or [])]
            escaped = tier == "P1" and any(
                lb in settings.bug_prod_escape_labels for lb in labels
            )

            done = status == "Done"
            if done and tier != "P1":
                continue  # fixed lower-tier defects are normal quality variation
            if done and sprint_end and now > sprint_end:
                continue  # sprint ended and defect contained - no active risk

            days_old = max(0.0, (now - created).total_seconds() / 86400)
            if escaped:
                band_name = "P1_escaped"
                raw = float(settings.bug_p1_escaped_score)
            else:
                if tier == "P1":
                    band_name = "P1_fixed" if done else "P1_open"
                else:
                    band_name = tier
                low, high = settings.bug_tier_bands[band_name]
                frac = min(1.0, days_old / sprint_days) if sprint_days else 0.0
                raw = low + (high - low) * frac
            score = cap_score(int(round(raw)))

            if escaped:
                recommendation = (
                    f"P1 defect '{issue.get('key')}' escaped to production. "
                    f"Investigate the escape immediately, add a regression test "
                    f"and review release/QA gates."
                )
            elif tier == "P1" and done:
                recommendation = (
                    f"P1 defect '{issue.get('key')}' was raised this sprint and "
                    f"fixed ({int(days_old)}d old). Contained before sprint end - "
                    f"verify the fix and watch for regressions."
                )
            elif tier == "P1":
                recommendation = (
                    f"P1 defect '{issue.get('key')}' raised this sprint is still "
                    f"open ({int(days_old)}d). Very high Definition-of-Done risk - "
                    f"prioritize the fix above new scope."
                )
            else:
                recommendation = (
                    f"{tier} defect '{issue.get('key')}' raised during the sprint "
                    f"({priority or 'unprioritized'}, {int(days_old)}d old). "
                    f"Triage and fix forward to protect the sprint goal."
                )

            risks.append({
                "type": "BUG_RAISED",
                "sprint_key": sprint.get("name") if sprint else None,
                "issue_key": issue.get("key"),
                "issue_keys": [issue.get("key")],
                "summary": issue.get("summary"),
                "assignee": issue.get("assignee"),
                "status": status,
                "priority": priority,
                "tier": tier,
                "band": band_name,
                "days_since_created": round(days_old, 1),
                "risk_score": score,
                "raw_score": round(raw, 1),
                "confidence": 80,
                "severity": bucket_severity(score),
                "recommendation": recommendation,
            })

        return risks

    # ------------------------------------------------------------------ #
    # 7. SCOPE_CREEP (sprint-level, vs first-active-sync baseline)
    # ------------------------------------------------------------------ #
    def detect_scope_creep(self, sprint, issues, context=None):
        """Flag scope added or re-estimated upward after sprint start.

        The baseline (total SP + per-issue SP map) is captured automatically
        on the first sync while the sprint is active — that is treated as the
        planning commitment. Growth beyond settings.scope_creep_min_growth_pct,
        any issue added post-baseline, or any estimate hike triggers the risk.
        Requires at least two scope history points so single-sync noise and
        future sprints (no baseline) are skipped.
        """
        risks = []
        context = context or {}
        name = sprint.get("name") if sprint else None
        if not name:
            return risks

        baseline = context.get("scope_baseline")
        history = context.get("scope_history") or []
        if not baseline or len(history) < 2:
            return risks

        current_sp = sum(issue.get("story_points", 0) or 0 for issue in issues)
        baseline_sp = float(baseline.get("total_sp") or 0)
        baseline_issues = baseline.get("issues") or {}

        current_by_key = {
            issue.get("key"): (issue.get("story_points", 0) or 0)
            for issue in issues
            if issue.get("key")
        }
        added = [
            {"key": key, "summary": issue.get("summary"), "sp": current_by_key[key]}
            for issue in issues
            if issue.get("key") and issue["key"] not in baseline_issues
        ]
        hiked = [
            {"key": key, "from": base_sp, "to": current_by_key[key]}
            for key, base_sp in baseline_issues.items()
            if key in current_by_key and current_by_key[key] > (base_sp or 0)
        ]

        growth = ((current_sp - baseline_sp) / baseline_sp * 100) if baseline_sp > 0 else 0.0
        min_growth = settings.scope_creep_min_growth_pct
        if growth < min_growth and not added and not hiked:
            return risks

        # Pure additions/hikes with sub-threshold net growth still count as
        # at least a threshold-level signal.
        base = max(growth, min_growth) if (added or hiked) else growth
        tp = time_pressure_multiplier(sprint)
        raw = min(settings.scope_creep_cap, base) * tp
        score = cap_score(raw)

        parts = [f"Sprint scope grew {growth:.0f}% since planning ({baseline_sp:.0f} → {current_sp} SP)."]
        if added:
            keys = ", ".join(a["key"] for a in added[:3])
            more = "" if len(added) <= 3 else f" (+{len(added) - 3} more)"
            parts.append(f"{len(added)} issue(s) added after start ({keys}{more}).")
        if hiked:
            hikes_txt = ", ".join(f"{h['key']} {h['from']}→{h['to']}" for h in hiked[:3])
            more = "" if len(hiked) <= 3 else f" (+{len(hiked) - 3} more)"
            parts.append(f"Estimates raised: {hikes_txt}{more}.")
        parts.append(
            "Renegotiate scope with stakeholders or add capacity — do not "
            "silently absorb the extra work."
        )

        risks.append({
            "type": "SCOPE_CREEP",
            "sprint_key": name,
            "issue_keys": [a["key"] for a in added] + [h["key"] for h in hiked],
            "baseline_sp": baseline_sp,
            "current_sp": current_sp,
            "growth_percent": round(growth, 1),
            "added_issues": added,
            "story_point_hikes": hiked,
            "late_baseline": bool(baseline.get("late_capture")),
            "risk_score": score,
            "raw_score": round(raw, 1),
            "confidence": 60 if baseline.get("late_capture") else 75,
            "severity": bucket_severity(score),
            "recommendation": " ".join(parts),
        })

        return risks

    # ------------------------------------------------------------------ #
    # Next-sprint (pre-planning) — v1 formulas, out of v2 rubric scope
    # ------------------------------------------------------------------ #
    def calculate_next_sprint_risks(self, issues):
        risks = []

        unassigned = [i for i in issues if not i.get("assignee") or i.get("assignee") == "Unassigned"]
        if unassigned:
            risks.append({
                "type": "UNASSIGNED",
                "issue_keys": [i["key"] for i in unassigned],
                "count": len(unassigned),
                "risk_score": min(100, 40 + len(unassigned) * 10),
                "confidence": 85,
                "severity": "HIGH" if len(unassigned) >= 3 else "MEDIUM",
                "recommendation": (
                    f"{len(unassigned)} issue(s) have no assignee. Assign owners before planning to avoid capacity gaps."
                ),
            })

        unestimated = [i for i in issues if not i.get("story_points") or i.get("story_points") == 0]
        if unestimated:
            risks.append({
                "type": "UNESTIMATED",
                "issue_keys": [i["key"] for i in unestimated],
                "count": len(unestimated),
                "risk_score": min(100, 35 + len(unestimated) * 8),
                "confidence": 80,
                "severity": "MEDIUM",
                "recommendation": (
                    f"{len(unestimated)} issue(s) lack story points. Estimate during planning to size the sprint accurately."
                ),
            })

        no_desc = [i for i in issues if not (i.get("description") or "").strip()]
        thin_ac = [
            i for i in issues
            if (i.get("description") or "").strip() and len((i.get("acceptance_criteria") or "").strip()) < 30
        ]
        undefined = no_desc + thin_ac
        if undefined:
            risks.append({
                "type": "UNDEFINED_SCOPE",
                "issue_keys": [i["key"] for i in undefined],
                "count": len(undefined),
                "risk_score": min(100, 30 + len(undefined) * 8),
                "confidence": 75,
                "severity": "MEDIUM",
                "recommendation": (
                    f"{len(undefined)} issue(s) lack defined acceptance criteria. "
                    "Clarify acceptance criteria before planning."
                ),
            })

        oversized = [i for i in issues if (i.get("story_points") or 0) >= 8]
        if oversized:
            risks.append({
                "type": "SIZING_RISK",
                "issue_keys": [i["key"] for i in oversized],
                "count": len(oversized),
                "risk_score": min(100, 50 + len(oversized) * 15),
                "confidence": 70,
                "severity": "MEDIUM",
                "recommendation": (
                    f"{len(oversized)} issue(s) are large (>=8 SP). Break them down before committing to the sprint."
                ),
            })

        dep_risks = self.detect_external_dependencies(issues)
        risks.extend(dep_risks)

        due_risks = self.detect_due_date_risks(None, issues)
        risks.extend(due_risks)

        return sorted(risks, key=lambda x: x.get("risk_score", 0), reverse=True)

    # ------------------------------------------------------------------ #
    # Aggregation helpers
    # ------------------------------------------------------------------ #
    def aggregate_risk_score(self, risks):
        scores = sorted([r.get("risk_score", 0) for r in risks], reverse=True)
        if not scores:
            return 0
        score = scores[0]
        for s in scores[1:]:
            score += s * 0.2
        return min(100, int(round(score)))

    def generate_risk_summary(self, risks):
        high_risks = [r for r in risks if r["severity"] in ("CRITICAL", "HIGH")]
        medium_risks = [r for r in risks if r["severity"] == "MEDIUM"]

        return {
            "total_risks": len(risks),
            "high_severity": len(high_risks),
            "medium_severity": len(medium_risks),
            "overall_sprint_health": max(0, 100 - (len(high_risks) * 20 + len(medium_risks) * 10)),
        }

    @staticmethod
    def _parse_dt(value):
        if not value:
            return None
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
        except Exception:
            return None
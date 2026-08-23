"""Validate the v2 rubric scoring against the rubric's worked examples.

Usage:  python validate_rubric.py
Each example is reconstructed as synthetic sprint/ticket data and the produced
scores are asserted with a small tolerance (scores are rounded ints).
"""
import os
from datetime import datetime, timedelta

from config import settings as _settings
from risk_components import (
    STALE_HOURS,
    avg_sprint_sp,
    is_blocking_map,
    time_pressure_multiplier,
)
from risk_engine import RiskEngine

eng = RiskEngine()


def settings_scope_cap():
    return _settings.scope_creep_cap


def _iso(days_from_now):
    return (datetime.utcnow() + timedelta(days=days_from_now)).isoformat() + "Z"


def _sprint(days_elapsed, duration, name="Sprint X"):
    """Sprint starting `days_elapsed` days ago, ending `duration - days_elapsed` from now."""
    return {
        "name": name,
        "startDate": _iso(-days_elapsed),
        "endDate": _iso(duration - days_elapsed),
    }


def _issue(key, status, sp, updated_hours_ago, assignee="Alice", due=None, blocked_by=None,
           priority=None, issue_type=None, created_days_ago=None, labels=None):
    issue = {
        "key": key,
        "summary": f"{key} summary",
        "status": status,
        "story_points": sp,
        "assignee": assignee,
        "updated": _iso(-updated_hours_ago / 24),
        "description": "",
    }
    if due:
        issue["due_date"] = due
    if blocked_by:
        issue["blocked_by"] = blocked_by
    if priority:
        issue["priority"] = priority
    if issue_type:
        issue["issue_type"] = issue_type
    if created_days_ago is not None:
        issue["created"] = _iso(-created_days_ago)
    if labels:
        issue["labels"] = labels
    return issue


def check(name, actual, expected, tol=2):
    ok = abs(actual - expected) <= tol
    mark = "PASS" if ok else "FAIL"
    print(f"  [{mark}] {name}: expected {expected}, got {actual}")
    return ok


def _first(risks, label):
    if not risks:
        raise AssertionError(f"{label}: engine returned no risks (expected at least one)")
    return risks[0]


def run():
    results = []

    # ------------------------------------------------------------------ #
    # BURNDOWN_BEHIND
    # ------------------------------------------------------------------ #
    print("\nBURNDOWN_BEHIND")
    # Example A: gap=100 (capped 60), day 4/4 (mult 1.7), flat trend (1.3) -> 60*1.3*1.7 = 132 -> 100 CRITICAL
    sprint_a = _sprint(days_elapsed=4, duration=4, name="PFIN Sprint 4")
    issues_a = [_issue("P-1", "To Do", 8, 10), _issue("P-2", "To Do", 8, 10)]
    history_a = [5, 100]  # widening -> flat
    risks_a = eng.detect_burndown_risks(sprint_a, issues_a, {"burndown_history": history_a})
    r = _first(risks_a, "BURNDOWN_BEHIND A")
    assert r["type"] == "BURNDOWN_BEHIND", r
    results.append(check(f"A: {sprint_a['name']} (gap 100, day4/4, flat)", r["risk_score"], 100))
    results.append(check("A severity", 1 if r["severity"] == "CRITICAL" else 0, 1, tol=0))

    # Example B: same issue set, day 1/4 (mult 0.6) -> strictly lower urgency
    sprint_b = _sprint(days_elapsed=1, duration=4, name="PFIN Sprint 4")
    risks_b = eng.detect_burndown_risks(sprint_b, issues_a, {"burndown_history": history_a})
    results.append(check("B: time_pressure(0.25) == 0.6", time_pressure_multiplier(sprint_b), 0.6, tol=0.01))
    results.append(check("B: day1/4 score < day4/4 score (time pressure works)",
                         1 if _first(risks_b, "BURNDOWN_BEHIND B")["risk_score"] < risks_a[0]["risk_score"] else 0, 1, tol=0))

    # ------------------------------------------------------------------ #
    # DUE_DATE_PASSED
    # ------------------------------------------------------------------ #
    print("\nDUE_DATE_PASSED")
    # Example: PFIN-10 1 day overdue, Code Review (1.1), 5 SP (size 1.0), blocks 1 (1.3)
    # base=min(70,15)=15 -> 15*1.1*1.0*1.3 = 21.45 -> 21 LOW-MEDIUM
    sprint_d = _sprint(1, 5)
    issues_d = [
        _issue("PFIN-10", "Code Review", 5, 6, due=(datetime.utcnow() - timedelta(days=1)).date().isoformat()),
        _issue("PFIN-11", "To Do", 5, 6, blocked_by="PFIN-10"),
    ]
    ctx_d = {"avg_sp": avg_sprint_sp(issues_d), "blocking_map": is_blocking_map(issues_d)}
    risks_d = eng.detect_due_date_risks(sprint_d, issues_d, ctx_d)
    r = _first(risks_d, "DUE_DATE_PASSED example")
    results.append(check("Example: 1 day overdue, CR, 5SP, blocks 1", r["risk_score"], 21))

    # Counter-example: 4 days overdue, QA (1.3), blocks 2 (1.3)
    # base=min(70,60)=60 -> 60*1.3*1.0*1.3 = 101.4 -> 100 HIGH
    issues_d2 = [
        _issue("PFIN-10", "In QA Review", 5, 6, due=(datetime.utcnow() - timedelta(days=4)).date().isoformat()),
        _issue("PFIN-11", "To Do", 5, 6, blocked_by="PFIN-10"),
        _issue("PFIN-12", "To Do", 5, 6, blocked_by="PFIN-10"),
    ]
    ctx_d2 = {"avg_sp": avg_sprint_sp(issues_d2), "blocking_map": is_blocking_map(issues_d2)}
    risks_d2 = eng.detect_due_date_risks(sprint_d, issues_d2, ctx_d2)
    r = _first(risks_d2, "DUE_DATE_PASSED counter")
    results.append(check("Counter: 4 days overdue, QA, blocks 2", r["risk_score"], 100))

    # ------------------------------------------------------------------ #
    # BUG_RAISED (in-sprint defect)
    # ------------------------------------------------------------------ #
    print("\nBUG_RAISED")
    # Band model: tier derived from priority; score interpolates within the
    # tier band by age across the sprint length. sprint_b is 10 days long.
    sprint_b = _sprint(days_elapsed=4, duration=10)
    # P2 (High), 4/10 days old -> 30 + (50-30)*0.4 = 38 MEDIUM
    issues_b = [
        _issue("PFIN-50", "In QA Review", 2, 2, priority="High", issue_type="Bug",
               created_days_ago=4),
        _issue("PFIN-49", "In Progress", 3, 2, issue_type="Story", created_days_ago=5),
    ]
    risks_b = eng.detect_bug_risks(sprint_b, issues_b)
    r = _first(risks_b, "BUG_RAISED")
    results.append(check("P2 mid-age in band", r["risk_score"], 38))
    results.append(check("P2 severity MEDIUM", 1 if r["severity"] == "MEDIUM" else 0, 1, tol=0))

    # Counter: P4 (Low), fresh today -> band low 10 LOW
    issues_b2 = [
        _issue("PFIN-51", "To Do", 1, 1, priority="Low", issue_type="Bug",
               created_days_ago=0),
    ]
    risks_b2 = eng.detect_bug_risks(sprint_b, issues_b2)
    r = risks_b2[0]
    results.append(check("P4 fresh at band low", r["risk_score"], 10))

    # Filter: bug created BEFORE sprint start is not an in-sprint defect
    issues_b3 = [
        _issue("PFIN-52", "To Do", 2, 2, priority="High", issue_type="Bug",
               created_days_ago=6),
    ]
    risks_b3 = eng.detect_bug_risks(_sprint(days_elapsed=4, duration=10), issues_b3)
    results.append(check("Filter: pre-sprint bug not flagged", 0 if not risks_b3 else 1, 0))

    # P1 open (Highest, To Do, fresh) -> P1_open band low 80 CRITICAL
    issues_b4 = [
        _issue("PFIN-53", "To Do", 1, 1, priority="Highest", issue_type="Bug",
               created_days_ago=0),
    ]
    risks_b4 = eng.detect_bug_risks(sprint_b, issues_b4)
    r = risks_b4[0]
    results.append(check("P1 open at band low", r["risk_score"], 80))
    results.append(check("P1 open severity CRITICAL", 1 if r["severity"] == "CRITICAL" else 0, 1, tol=0))

    # P1 fixed before sprint end (Done) -> P1_fixed: 60 + (70-60)*0.4 = 64 HIGH
    issues_b5 = [
        _issue("PFIN-54", "Done", 2, 2, priority="Highest", issue_type="Bug",
               created_days_ago=4),
    ]
    risks_b5 = eng.detect_bug_risks(sprint_b, issues_b5)
    r = risks_b5[0]
    results.append(check("P1 fixed in band", r["risk_score"], 64))
    results.append(check("P1 fixed severity HIGH", 1 if r["severity"] == "HIGH" else 0, 1, tol=0))

    # Fixed lower-tier defects are normal quality variation -> skipped
    issues_b6 = [
        _issue("PFIN-55", "Done", 1, 1, priority="High", issue_type="Bug",
               created_days_ago=2),
    ]
    risks_b6 = eng.detect_bug_risks(sprint_b, issues_b6)
    results.append(check("Fixed P2 skipped", 0 if not risks_b6 else 1, 0))

    # Prod-escaped P1 (label) -> 100 CRITICAL regardless of status/age
    issues_b7 = [
        _issue("PFIN-56", "To Do", 1, 1, priority="Highest", issue_type="Bug",
               created_days_ago=1, labels=["production"]),
    ]
    risks_b7 = eng.detect_bug_risks(sprint_b, issues_b7)
    r = risks_b7[0]
    results.append(check("Prod-escaped P1 max score", r["risk_score"], 100))
    results.append(check("Prod-escaped severity CRITICAL", 1 if r["severity"] == "CRITICAL" else 0, 1, tol=0))

    # Unknown/missing priority defaults to P3
    issues_b8 = [
        _issue("PFIN-57", "To Do", 1, 1, issue_type="Bug", created_days_ago=0),
    ]
    risks_b8 = eng.detect_bug_risks(sprint_b, issues_b8)
    r = risks_b8[0]
    results.append(check("Unknown priority defaults to P3", 1 if r["tier"] == "P3" else 0, 1, tol=0))

    # ------------------------------------------------------------------ #
    # QA_BOTTLENECK
    # ------------------------------------------------------------------ #
    print("\nQA_BOTTLENECK")
    # Example: 2 in QA, throughput 1/day -> backlog 2; 3 days remain (day2/5, mult 0.8)
    # base=min(70, 200/3)=67 -> 67*0.8 = 53.6 -> 54 MEDIUM
    sprint_q = _sprint(days_elapsed=2, duration=5)
    issues_q = [
        _issue("Q-1", "In QA Review", 3, 30),
        _issue("Q-2", "In QA Review", 5, 30),
    ]
    ctx_q = {"qa_throughput": 1.0}
    risks_q = eng.detect_qa_bottleneck(sprint_q, issues_q, ctx_q)
    r = risks_q[0]
    results.append(check("Example: 2 QA, throughput 1/day, 3 days left", r["risk_score"], 54))
    results.append(check("Example severity MEDIUM", 1 if r["severity"] == "MEDIUM" else 0, 1, tol=0))

    # Counter: 2 QA, 1 day remains (mult 1.7) -> base=70 -> 119 -> 100 HIGH
    sprint_q2 = _sprint(days_elapsed=4, duration=5)
    risks_q2 = eng.detect_qa_bottleneck(sprint_q2, issues_q, ctx_q)
    r = risks_q2[0]
    results.append(check("Counter: 2 QA, 1 day left", r["risk_score"], 100))

    # Board-naming robustness: "QA Review" (without "In") matches too
    issues_q3 = [
        _issue("Q-1", "QA Review", 3, 30),
        _issue("Q-2", "QA Review", 5, 30),
    ]
    risks_q3 = eng.detect_qa_bottleneck(sprint_q, issues_q3, ctx_q)
    results.append(check("'QA Review' variant detected", 1 if risks_q3 else 0, 1, tol=0))
    if risks_q3:
        results.append(check("'QA Review' variant same score", risks_q3[0]["risk_score"], 54))

    # ------------------------------------------------------------------ #
    # EXTERNAL_DEPENDENCY
    # ------------------------------------------------------------------ #
    print("\nEXTERNAL_DEPENDENCY")
    # Example: external "waiting for vendor credentials", blocks 2 (1.3), 5 SP (size 1.0)
    # 75*1.3*1.0 = 97.5 -> 97/98 HIGH
    sprint_e = _sprint(1, 5)
    issues_e = [
        _issue("E-1", "In Progress", 5, 6, blocked_by="DEP-1"),
        _issue("E-2", "To Do", 5, 6, blocked_by="DEP-1"),
        _issue("DEP-1", "In Progress", 5, 6, blocked_by="DEP-1")
        | {"description": "Blocked: waiting for vendor credentials from external vendor"},
    ]
    ctx_e = {"avg_sp": avg_sprint_sp(issues_e), "blocking_map": is_blocking_map(issues_e)}
    risks_e = eng.detect_external_dependencies(issues_e, ctx_e)
    dep = [r for r in risks_e if r["issue_key"] == "DEP-1"]
    r = dep[0]
    results.append(check("Example: external vendor, blocks 2, 5SP", r["risk_score"], 97, tol=2))
    results.append(check("Example severity CRITICAL", 1 if r["severity"] == "CRITICAL" else 0, 1, tol=0))

    # Counter: internal "depends on Platform team's API", nothing blocked, 2 SP
    # 50*1.0*size(2SP, avg5) = 50*0.82 = 41 MEDIUM
    issues_e2 = [
        _issue("E-3", "To Do", 8, 6),
        _issue("DEP-2", "In Progress", 2, 6)
        | {"description": "Depends on the Platform team's API"},
    ]
    ctx_e2 = {"avg_sp": avg_sprint_sp(issues_e2), "blocking_map": is_blocking_map(issues_e2)}
    risks_e2 = eng.detect_external_dependencies(issues_e2, ctx_e2)
    r = [x for x in risks_e2 if x["issue_key"] == "DEP-2"][0]
    results.append(check("Counter: internal, no fan-out, 2SP", r["risk_score"], 41, tol=3))

    # ------------------------------------------------------------------ #
    # Privacy: LLM prompt sanitization (prompt_privacy)
    # ------------------------------------------------------------------ #
    from prompt_privacy import pseudonymize_assignee, scrub_emails

    mapping = {}
    assert pseudonymize_assignee("Sarah Chen", mapping) == "dev-01"
    assert pseudonymize_assignee("Ravi Patel", mapping) == "dev-02"
    results.append(check("Privacy: pseudonyms assigned in order, shared map", 1, 1, tol=0))
    results.append(check("Privacy: same person maps consistently",
                         1 if pseudonymize_assignee("Sarah Chen", mapping) == "dev-01" else 0, 1, tol=0))
    results.append(check("Privacy: Unassigned passes through",
                         1 if pseudonymize_assignee(None, mapping) == "Unassigned" else 0, 1, tol=0))

    scrubbed = scrub_emails("Contact bob@corp.com about MOS-12")
    results.append(check("Privacy: emails scrubbed from free text",
                         1 if "bob@corp.com" not in scrubbed and "[email]" in scrubbed else 0, 1, tol=0))
    src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "mitigation_agent.py")).read()
    wired = src.count("sanitize_issue_for_prompt(") >= 2  # sprint + next-sprint prompt builders
    restored = "re.sub" in src and "re.escape(alias)" in src
    deep = "deep_pseudonymize(risks[:5]" in src and "deep_pseudonymize(mitigations[:5]" in src
    results.append(check("Privacy: sanitization wired at all prompt sites + followup restore + report deep-scan",
                         1 if (wired and restored and deep) else 0, 1, tol=0))

    # ------------------------------------------------------------------ #
    # SCOPE_CREEP
    # ------------------------------------------------------------------ #
    print("\nSCOPE_CREEP")
    sprint = _sprint(2, 10)
    # Planning committed 3 SP; after start PFIN-1 was re-estimated to 5 SP.
    baseline = {
        "total_sp": 3,
        "issues": {"PFIN-1": 3},
        "captured_at": "2026-01-01T09:00:00",
        "late_capture": False,
    }
    context = {"scope_baseline": baseline, "scope_history": [3, 5]}
    creep = eng.detect_scope_creep(sprint, [_issue("PFIN-1", "In Progress", 5, 4)], context)
    if not creep:
        raise AssertionError("SCOPE_CREEP: estimate hike 3->5 did not trigger")
    c = creep[0]
    expected_raw = min(settings_scope_cap(), ((5 - 3) / 3) * 100) * time_pressure_multiplier(sprint)
    results.append(check("Scope: type + growth percent", 1 if c["type"] == "SCOPE_CREEP" and abs(c["growth_percent"] - 66.7) < 0.5 else 0, 1, tol=0))
    results.append(check("Scope: score = min(cap, growth%) x time pressure", c["risk_score"], int(round(expected_raw)), tol=2))
    results.append(check("Scope: full-confidence baseline", c["confidence"], 75, tol=0))

    late_ctx = {"scope_baseline": dict(baseline, late_capture=True), "scope_history": [3, 5]}
    late = eng.detect_scope_creep(sprint, [_issue("PFIN-1", "In Progress", 5, 4)], late_ctx)
    results.append(check("Scope: late-captured baseline lowers confidence",
                         late[0]["confidence"] if late else 0, 60, tol=0))

    quiet_ctx = {"scope_baseline": baseline, "scope_history": [3, 3]}
    quiet = eng.detect_scope_creep(sprint, [_issue("PFIN-1", "In Progress", 3, 4)], quiet_ctx)
    results.append(check("Scope: no growth/hikes/additions => silent", len(quiet), 0, tol=0))

    cold_ctx = {"scope_baseline": baseline}  # single sync so far
    cold = eng.detect_scope_creep(sprint, [_issue("PFIN-1", "In Progress", 9, 4)], cold_ctx)
    results.append(check("Scope: needs >=2 history points before judging", len(cold), 0, tol=0))

    src_main = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "main.py")).read()
    captures = "baselines[name] = {" in src_main and "late_capture" in src_main
    persists = '"scope_meta": scope_meta' in src_main.replace("'", '"') or 'scope_meta=scope_meta' in src_main
    results.append(check("Scope: auto-baseline on first active sync persisted via snapshot",
                         1 if (captures and persists) else 0, 1, tol=0))

    # ------------------------------------------------------------------ #
    print("\n" + "=" * 40)
    passed = sum(results)
    print(f"RESULT: {passed}/{len(results)} checks passed")
    return passed == len(results)


if __name__ == "__main__":
    import sys

    sys.exit(0 if run() else 1)
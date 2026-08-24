# Upcoming Sprint Improvement Plan

## Problem

On the dashboard, the **Upcoming Sprint** card (`FUTURE SPRINT(S)`) always shows
`✅ No issues`, and it does not display a per-severity risk count the way the
**Active Sprint** card does.

### Root cause

`SprintCard` renders the `✅ No issues` empty state whenever it receives **zero
blockers**. It counts risks from a `blockers` prop and renders `CRITICAL / HIGH /
MEDIUM / LOW` badges when risks are present.

- The **Active Sprint** card gets its blockers via `RiskRadar`:
  `blockers={snapshot.blockers.filter(b => b.sprint_key === risk.sprint_key)}`
  (`frontend/src/components/RiskRadar.tsx`).
- The **Upcoming Sprint** card is rendered by `NextSprintOverview` as
  `<SprintCard data={project} />` **without passing `blockers`**
  (`frontend/src/components/NextSprintOverview.tsx`). So `blockers` defaults to
  `[]` → `totalRisks === 0` → `No issues` **always** appears.

### Is the risk count available?

Not on the card today. The upcoming overview
(`next_sprint_overview.projects[]` → `NextSprintProject`) carries only an
aggregate `risk_score` — no per-severity risk list.

Upcoming-sprint risks exist in two forms:

1. **Rule-based**, computed at sync in `backend/snapshot.py`
   (`_build_next_sprint_overview`, `risk_engine.calculate_next_sprint_risks(issues)`).
   This already returns full `Blocker`-shaped objects **with `severity`**
   (e.g. `UNASSIGNED` → HIGH, `UNESTIMATED` → MEDIUM). Only the aggregated
   `risk_score` is currently persisted — the per-risk list is discarded.
2. **AI scan**, via `POST /api/next-sprint-risks`, computed on demand and **not
   persisted** to the snapshot.

So the data is available (rule-based at sync); it is simply never surfaced to the card.

## Proposed change

Make the upcoming card show severity badges + count exactly like the active
sprint card, sourced from the rule-based risks already computed at sync.

### Backend — `backend/snapshot.py`

In `_build_next_sprint_overview` (~line 191), add the already-computed
`rule_risks` to each project dict:

```python
overview["projects"].append({
    "project_key": project_key,
    "sprint_key": sprint.get("name"),
    "start_date": sprint.get("startDate"),
    "end_date": sprint.get("endDate"),
    "total_sp": total_sp,
    "issue_count": len(issues),
    "issue_types": issue_types,
    "risk_score": risk_score,
    "risks": rule_risks,   # <-- add this
})
```

### Frontend — `frontend/src/api/client.ts`

Add `risks` to `NextSprintProject` (~line 123):

```ts
export interface NextSprintProject {
  project_key: string
  sprint_key: string
  start_date?: string
  end_date?: string
  total_sp: number
  issue_count: number
  issue_types: Record<string, number>
  risk_score?: number
  risks?: Blocker[]   // <-- add this
}
```

### Frontend — `frontend/src/components/NextSprintOverview.tsx`

Pass the risks into `SprintCard` (~line 38):

```tsx
<SprintCard
  key={project.project_key}
  data={project}
  blockers={project.risks ?? []}
  eyebrow="UPCOMING SPRINT"
  detailsTo={`/future/${encodeURIComponent(project.project_key)}`}
/>
```

No change to `SprintCard` is required — it already counts by severity and renders
the badges, and `No issues` will then appear only when there are genuinely 0 risks.

## Verification

- Backend: `python3 validate_rubric.py` (must stay 52/52).
- Frontend: `cd frontend && npm run lint && npm run build`.
- Manual: dashboard upcoming card should show `CRITICAL/HIGH/MEDIUM/LOW` badges
  matching the computed risks; `No issues` only when `risks` is empty.

## Optional enhancement (decision needed)

If the card should reflect the **latest AI-scan** results (instead of, or merged
with, the rule-based risks), the `/api/next-sprint-risks` endpoint would need to
persist its results into the snapshot, and `NextSprintOverview` would read those.
This is a larger change. The rule-based parity above matches how the active sprint
behaves and is the recommended default.

### Open question

Do we want the card driven by the **rule-based risks computed at sync**
(recommended, consistent with the active sprint), or should it also reflect the
on-demand **AI scan** results?

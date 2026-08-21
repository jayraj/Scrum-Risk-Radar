# Sprint Risk Radar — Multi-Scrum-Master SaaS

React (TypeScript) frontend + FastAPI backend. Each scrum master configures their
own Jira Cloud workspace and LLM provider in a Settings screen; the backend stores
profiles encrypted in **Supabase** and serves the whole dashboard from a single
**cached snapshot** so it can run on **Vercel serverless** (free plan). Scoring
uses the **Sprint Risk Scoring Rubric v2** (`severity × time-pressure × blast-radius`).

## Architecture

```
sprint-risk-radar-v2/
├── sql/migration.sql         # profiles table + RLS (run in Supabase SQL editor)
├── backend/                  # Vercel project #1 (Root Directory: backend)
│   ├── vercel.json           # /api/* -> Python function
│   ├── .vercelignore         # keeps venv/data out of the lambda
│   ├── requirements.txt      # Python deps for the Vercel runtime
│   ├── api/index.py          # Vercel serverless shim -> main.app
│   ├── main.py               # FastAPI app (serverless, token-gated)
│   ├── config.py             # Settings (env) + UserConfig (per-profile)
│   ├── crypto.py             # AES-GCM (Fernet) at rest + SHA-256 token hash
│   ├── supabase_store.py     # PostgREST CRUD for `profiles` (service-role only)
│   ├── jira_fetcher.py       # Per-profile Jira fetch + story-points auto-detect + test_connection
│   ├── risk_components.py    # Shared v2 scoring (time pressure, stage, size, …)
│   ├── risk_engine.py        # v2 detectors + raw/capped scores + next-sprint
│   ├── mitigation_agent.py   # Per-profile LLM (Gemini | OpenRouter) + fallback
│   ├── snapshot.py           # Builds the single /api/snapshot payload
│   └── validate_rubric.py    # Rubric example assertions (15/15 passing)
└── frontend/                 # Vercel project #2 (Root Directory: frontend) — Vite React-TS app
    └── src/
        ├── api/config.ts     # localStorage profile slug+token store
        ├── api/client.ts     # Axios client (X-SRR auth headers) + typed endpoints
        ├── hooks/useSnapshot.ts
        ├── utils/format.ts   # Severity colors (70/35), risk labels, dates
        └── components/       # RiskRadar, NextSprintOverview, ExecutiveDashboard, SprintOverview, Settings, Header
```

## How multi-tenancy works

- **Profiles** = one row per scrum master in Supabase (`profiles` table):
  Jira URL/email/API token, project keys, LLM provider/model/key (encrypted at
  rest with AES-GCM via `cryptography`), optional story-points field override,
  cached `snapshot jsonb`, `burndown_history jsonb`, `fetched_at`.
- **No login (MVP)**. Each profile has a slug + access token. The token is
  generated in the browser, saved in `localStorage` (`srr2_profiles`), and the
  backend stores **only a SHA-256 hash** of it. Requests send
  `X-SRR-Profile` + `X-SRR-Token` headers.
- **Backend owns Supabase** via the service-role key; the frontend never talks to
  Supabase directly. RLS is enabled with **no anon policies**.
- **Serverless-friendly**: no scheduler. `/api/snapshot` returns the cached
  snapshot when it's under `SYNC_INTERVAL_MINUTES` (default 5 min) old, otherwise
  re-fetches Jira, recomputes risks, and persists a new snapshot. Burndown
  history lives in the profile row.

## Setup

### 1. Supabase

1. Create a Supabase project and run `sql/migration.sql` in the SQL editor.
2. Grab the project URL and the **service-role** key (Settings → API).

### 2. Environment variables

Copy `.env.example` and fill in (local: `backend/.env`; deployed: Vercel env vars):

```
ENCRYPTION_KEY=            # python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
CORS_ORIGINS=http://localhost:3001,http://127.0.0.1:3001,https://<frontend>.vercel.app
```

The `JIRA_*` / `GEMINI_*` / `OPENROUTER_*` vars are only **defaults** shown on the
Settings screen — each profile supplies its own via the UI.

### 3. Run locally

```bash
# Backend (port 5002)
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python validate_rubric.py     # 15/15 rubric checks
python main.py

# Frontend (port 3001) — point it at the local backend
cd frontend
cp .env.example .env.local    # VITE_API_BASE=http://127.0.0.1:5002
npm install
npm run dev
```

Open `http://localhost:3001`, go to **Settings**, create a profile (Jira Cloud URL,
email, API token, project keys, LLM provider/model/key). "Test Connection" validates
it without saving. The generated access token is stored in your browser only.

### 4. Deploy to Vercel (two separate projects)

The monorepo deploys as **two independent Vercel projects**, each with its own
Root Directory:

**Project 1 — Backend API**

1. Import the repo into Vercel; set **Root Directory** to `backend`.
2. Framework Preset: *Other*. Vercel auto-detects `backend/api/index.py` (Python
   runtime) and installs `backend/requirements.txt`. `backend/vercel.json` maps
   `/api/*` to the function; `.vercelignore` keeps `venv/` and `data/` out of the
   lambda.
3. Add env vars (project settings → Environment Variables): `ENCRYPTION_KEY`,
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `CORS_ORIGINS` including the
   frontend URL you will deploy next, e.g.
   `https://<frontend>.vercel.app` (plus localhost for dev).
4. Deploy → note the URL, e.g. `https://srr-backend.vercel.app`
   (health check: `curl https://srr-backend.vercel.app/api/health`).

**Project 2 — Frontend**

1. Import the same repo again; set **Root Directory** to `frontend`.
2. Framework Preset: *Vite* (build `npm run build`, output `dist` — auto).
3. Add one env var: `VITE_API_BASE=https://srr-backend.vercel.app` (the backend
   project URL from above). Without it, production builds would call `/api`
   same-origin and get 404s.
4. Deploy.

Then open Settings → create a profile → **Test Connection** → Save → Dashboard.

Note: Vercel Hobby functions have a per-request time limit (~10s default, up to 60s
as set in `backend/vercel.json`). The first snapshot fetch per profile can take a few
seconds; subsequent requests hit the cached snapshot. Because the apps are on
different origins in production, cross-origin calls rely on `CORS_ORIGINS` —
keep it in sync with both deployed URLs.

## Scoring rubric v2

`score = base_severity × time_pressure_multiplier × blast_radius_weight`, capped at
100 for the UI (`risk_score`); uncapped `raw_score` is kept for ranking.

| Time elapsed | Multiplier |
|--------------|-----------|
| 0–25%        | 0.6       |
| 25–50%       | 0.8       |
| 50–75%       | 1.1       |
| 75–90%       | 1.4       |
| 90–100%      | 1.7       |

Severity buckets: **LOW < 35 · MEDIUM 35–69 · HIGH ≥ 70** (frontend colors use the
same thresholds).

Workflow stage weights: To Do 0.6 · In Progress 0.9 · Code Review 1.1 · QA/In QA
Review 1.3 · Blocked 1.4. Size weight `0.7 + (sp / avg_sprint_sp) × 0.3` clamped
0.4–1.6.

Risk types (radar = sprint-level): BURNDOWN_BEHIND, QA_BOTTLENECK, DUE_DATE_PASSED.
Ticket-level (blockers panel): STORY_NOT_PROGRESSING, EXTERNAL_DEPENDENCY.

## API endpoints

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /api/health` | – | Liveness + storage status |
| `GET /api/config-defaults` | – | Provider options + default models |
| `POST /api/profiles` | – | Create profile (returns access token once) |
| `POST /api/profiles/verify` | – | Validate slug + token |
| `GET/PUT/DELETE /api/profiles/{slug}` | profile | Read (sanitized) / update / delete |
| `POST /api/test-config` | – | Validate a config without saving |
| `GET /api/snapshot` | profile | Single dashboard payload (cached) |
| `POST /api/sync-now` | profile | Force a fresh fetch + recompute |
| `POST /api/generate-mitigations` | profile | Sprint-level AI mitigation plan |
| `POST /api/next-sprint-risks` | profile | Pre-planning AI risk analysis |
| `POST /api/next-sprint-issues` | profile | Planned work items |
| `POST /api/generate-followup-message` | profile | Draft a follow-up to an assignee |
| `GET /api/stakeholder-report` | profile | Executive summary |

## v1 → v2 → SaaS changes

- Flask → FastAPI, Vue → React (TypeScript), router + type-safe API client.
- All risk scoring rebuilt on the v2 rubric (severity × time-pressure × blast-radius);
  severity buckets moved from 80/60 to 70/35.
- QA_BOTTLENECK emits `sprint_key` + `issue_keys` (was missing `sprint_key`).
- Timezone-safe Jira timestamp parsing (`to_utc` handles `+0545` offsets);
  `days_remaining` uses the rubric convention `duration − elapsed` (min 1).
- **Multi-tenant**: per-profile config stored in Supabase (encrypted API keys),
  token-based access, single `/api/snapshot` payload, serverless on Vercel.
- Story-points field auto-detected (optional per-profile override).
# System Guidelines

Rules and guidelines to follow when generating code for the Sprint Risk Radar v2 app.

# General guidelines

- Prefer responsive, well-structured layouts using flexbox and CSS grid over absolute positioning.
- Use plain, named CSS classes in `frontend/src/index.css` — do **not** use Tailwind utility classes, even though Tailwind is installed.
- Keep components in `frontend/src/components/` (one component per file) and helpers in `frontend/src/utils/format.ts`.
- Reuse existing UI components and CSS classes; don't duplicate styles or components.
- Inline SVG icons for buttons/icons (11px, `stroke="currentColor"`, `fill="none"`, `strokeWidth="2"`). Emojis are acceptable for UI labels/titles.
- After any change, run `npm run lint && npm run build` in `frontend/`; backend changes must pass `python3 validate_rubric.py` in `backend/`.
- Backend risk data flows through `backend/risk_engine.py`, `backend/snapshot.py`, and the frontend `Blocker` type in `frontend/src/api/client.ts`.

# Design system guidelines

## Colors

- **Severity (primary semantic color)** — always from the shared helpers in `frontend/src/utils/format.ts` (`getRiskColor`, `severityColor`, `ringRiskColor`, `severityClass`):
  - CRITICAL → `#dc2626` (red)
  - HIGH → `#ea8c00` (orange)
  - MEDIUM → `#f59e0b` (amber)
  - LOW → `#16a34a` (green)
- **Accent (primary action)** — cyan `#22d3ee`; ghost buttons use `rgba(34, 211, 238, …)` backgrounds/borders.
- **Indigo** `#667eea` — used for next-sprint cards (`risk-card indigo`).
- **Neutrals** — text `#1f2937`/`#374151`, secondary/muted `#6b7280`/`#9ca3af`, borders `#e5e7eb`, surfaces `#f8fafc`/`#f1f5f9`.
- Card border-left color is severity-driven (`.risk-card.critical/.high/.medium/.low`).
- The risk-score badge is always **white text on the severity background color** (never theme-colored text).

## Typography

- Base UI text: 12–14px.
- Table cells, keys, status, category, meta labels: 9–12px `'Courier New', monospace`.
- Labels/captions: uppercase with `letter-spacing: 0.05–0.1em`.
- Dates always formatted as "Jun 10" via `formatDate` in `frontend/src/utils/format.ts`.

## Layout & spacing

- `radar-grid` for card grids: `grid-template-columns: repeat(auto-fit, minmax(280px, 1fr))`.
- Cards: white `background`, `border-radius: 8px`, `padding: 16px`, `border-left: 4px solid` severity color, subtle `box-shadow`.
- Panel (`blockers-panel`): white, `border-radius: 8px`, `padding: 20px`.
- Section titles: `.component-title` (24px, 700); page headers row uses `.panel-heading` (flex, title left / action right).

## Components

### Button
The Button component is the primary interactive element. It provides visual feedback and clear affordances.

#### Usage
Buttons trigger actions (sync, scan, mitigate, draft, navigate). Labels are short, action-oriented, uppercase for primary actions.

#### Variants
- **Primary / Action** — `.ai-scan-btn`: cyan ghost (transparent bg, cyan border/text), `display: flex` with a small leading icon, 11px mono uppercase with `letter-spacing`. Used for primary CTAs (e.g., "RUN AI SCAN", "Mitigate with AI"). Disabled → `opacity: 0.5`.
- **Secondary / Card action** — `.details-btn`: muted outlined button used on cards ("Details →").
- **Tertiary / Utility** — `.draft-btn`, `.copy-btn`: subtle gray/small buttons for supporting actions.
- Never stack a full-width button inside the `.ai-scan-btn` ghost style — reserve ghost for emphasized actions.

### Risk card
Structure: `.risk-header` (risk-score badge + `.issue-key`), `.risk-body` (`.summary` with optional `.sprint-dates`, `.risk-type`, `.sprint-meta`, `.sprint-day`), `.risk-footer` (`.issue-types` chips + action button).

### Risk table (severity-filtered)
- Tabs: `.risk-tabs` → `.risk-tab` (mono uppercase, muted), `.risk-tab.active` (cyan text + cyan 2px bottom border).
- Table: `.risk-table` with `.risk-table-header` and rows `.risk-row` (CSS grid; 5-col default, `.risk-table.six-col` for 6).
- Each row: `.risk-row-main` (`.risk-dot` pulsing for CRITICAL/MEDIUM + `.risk-row-title` with `.blocker-key` + `.risk-row-summary`), then `.risk-row-cat`, `.risk-row-sev`, `.risk-row-detect`, `.risk-row-stories`, `.risk-row-status`.
- Status labels by severity: CRITICAL/HIGH → `ACTIVE` (severity color), MEDIUM → `MONITORING` (amber), LOW → `MITIGATED` (green).
- Expanding a row shows `.risk-row-expand` with the `⚡ AI MITIGATION STRATEGY` recommendation.

### Breadcrumb
`.breadcrumb` → `Link` / `.breadcrumb-link-btn` / `.breadcrumb-sep` ( `/` ) / `.breadcrumb-current`. In-page detail views keep the breadcrumb inside the current page (back button, not route navigation).

### Other
- Badges: `.risk-type-badge.critical/.high/.medium/.low`.
- Chips: `.risk-chip` (mitigation), `.type-chip` (card issue types).
- Empty states: `.empty-cell` (✅ no blockers) and `.risk-table-empty`.
- Home tabs: `.home-tab-bar` / `.home-tab` / `.home-tab.active`.

## Rules to follow

- Always use the shared color/format helpers — never hardcode severity colors.
- One ticket = one row in risk tables; flatten `issue_keys` into per-ticket rows.
- Use `formatRiskType` for category labels and extend its map when adding new risk types.
- Keep "RUN AI SCAN"-style primary actions inline with their section title (`.panel-heading`).
- Risk-score badges and status text must remain readable against their colored background.

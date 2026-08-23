# AgileComrade — Responsive Layout Design Prompt

## Objective

Transform the current AgileComrade web app from a single full-width purple top
bar into a **responsive dashboard layout**: a dark **left hamburger sidebar** for
navigation plus a slim dark **utility strip** on top. Light content area.

## Current State (before)

- `App.tsx` renders `<Header>` (purple top bar with logo, nav links, profile
  selector, last-sync text, Sync Now button) above `<main className="app-main">`
  with routes, and a footer below.
- `Header.tsx` contains: radar logo + "SPRINT RISK RADAR" title, nav links
  (Dashboard `/`, Executive `/executive`, Sprint Projects `/sprints`,
  Settings `/settings`), a profile `<select>`, `Last sync: <time>` text, and a
  cyan `Sync Now` button.
- `index.css` holds `.app-header`, `.header-info`, `.app-nav`, `.profile-select`,
  `.last-sync`, `.sync-btn`, `.app-main`, `.app-footer`, and responsive rules.
- No `lucide-react` dependency installed.

## Target Layout

```
┌────────────────────────────────────────────────────────┐
│ [☰]  [◉ SPRINT RISK RADAR]     [Sync Now] [Last sync] [👤] [⚙️] │
├────────┬───────────────────────────────────────────────┤
│ logo   │  Content (light bg)                           │
│ 📊     │  Routes render here                           │
│ 👔     │  (margin-left adapts to docked rail)          │
│ 📆     │                                               │
│ © …    │                                               │
└────────┴───────────────────────────────────────────────┘
   sidebar (dark, collapsible)
```

## Requirements (confirmed decisions)

### Top strip (dark, ~52px, sticky) — replaces the old top bar
- **Hamburger button** (mobile only; hidden on desktop).
- **Branding block** (radar icon + "SPRINT RISK RADAR") — shown ONLY when the
  left nav is in its **collapsed** state. When the sidebar is expanded, branding
  lives in the sidebar and the strip shows none.
- **Right-aligned action group** (`.top-strip-actions`, pushed right with
  `margin-left: auto`), inline in this order:
  - **Sync Now** button — cyan styling, `RefreshCw` icon from `lucide-react`
    (spins while syncing).
  - **Last sync** text.
  - **Profile icon** (`User` icon) — replaces the old `<select>` dropdown;
    no dropdown for now. Title/label shows the active profile slug/label.
  - **Settings ⚙️** (`Settings` icon) — routes to `/settings`.

### Left sidebar navigation (dark theme)
- **Desktop**: collapsed to an icon-only rail (~56px) by default; expands to
  ~200px with labels on **hover or click** (state + CSS width transition).
- **Mobile**: hidden off-canvas; opens as an **overlay drawer** via the
  hamburger; closes on backdrop click and Escape.
- **Logo** at top of sidebar: icon-only when collapsed; radar icon + "SPRINT
  RISK RADAR" text when expanded/mobile.
- Nav items (lucide icons + labels when expanded):
  - Dashboard → `/` (`LayoutDashboard`)
  - Executive → `/executive` (`BarChart3` or `BriefcaseBusiness`)
  - Sprint Projects → `/sprints` (`CalendarDays`)
- **Settings is NOT in the sidebar** — only the ⚙️ in the strip.
- **Copyright footer** at the bottom of the sidebar (shown when expanded):
  `© <year> SPRINT RISK RADAR` and `Multi-scrum-master SaaS · Made for Scrum
  Masters`. Replaces the old page-level `.app-footer`.
- `NavLink` active state highlighted.

### Theme
- Dark sidebar + dark strip = one continuous dark frame.
- Light content area (existing card styling preserved).
- No page-level footer (copyright moved into the sidebar).

### Responsive behavior
- Desktop: docked rail; content margin-left adapts to collapsed/expanded width.
- Mobile: hamburger in strip opens overlay drawer; sidebar hidden otherwise.
- On mobile the strip shows branding (nav is effectively collapsed).

## Implementation Steps

1. `npm install lucide-react` in `frontend/`.
2. Create `frontend/src/components/RadarLogo.tsx` — shared radar SVG logo component.
3. Create `frontend/src/components/TopStrip.tsx` (replaces `Header.tsx`):
   - Dark sticky strip (~52px).
   - Hamburger (mobile only), conditional branding block, right-aligned
     `.top-strip-actions` group: Sync Now (`RefreshCw`), last-sync text,
     profile `User` icon, Settings ⚙️ (`Settings` icon).
   - Props: `lastSync`, `syncing`, `onSyncNow`, `profiles`, `activeProfile`,
     `onToggleDrawer`, `showBranding`.
4. Create `frontend/src/components/NavSidebar.tsx`:
   - Desktop icon rail → expanded on hover/click; mobile overlay drawer.
   - Logo (shared `RadarLogo`); nav items with lucide icons + `NavLink` active
     states; copyright footer.
   - Props: `expanded`, `onHover`, `open`, `onClose`.
5. Update `App.tsx`:
   - Remove `<Header>` and the `<footer>`; render `<TopStrip>` + `<NavSidebar>`
     + `<main className="app-main">`.
   - Manage `expanded` (desktop) and `drawerOpen` (mobile) state.
   - Pass `showBranding={!expanded}` to TopStrip.
6. Update `index.css`:
   - Add `.top-strip`, `.top-strip-actions`, `.strip-brand`, `.profile-btn`,
     `.nav-sidebar` (+ `.collapsed`/`.expanded`), `.drawer`,
     `.sidebar-backdrop`, `.sidebar-footer`, nav/active states, logo states.
   - Remove `.app-header`, `.header-info`, `.app-nav`, `.app-footer`,
     `.profile-select` (unused after the dropdown removal).
   - Mobile breakpoint hides the sidebar and shows the hamburger.
7. Restore/keep `frontend/src/components/Sidebar.tsx` — the right-side blockers
   drawer (title/subtitle/onClose/children) used by RiskRadar and
   NextSprintOverview. Do NOT rename it (nav sidebar is `NavSidebar.tsx`).
8. Verify: `npx tsc -b`, `npm run lint`, `npm run build` in `frontend/`.

## Acceptance Criteria

- No purple top bar remains; replaced by slim dark strip + left sidebar.
- Desktop shows an icon-only sidebar rail that expands on hover/click with labels.
- Mobile shows a hamburger in the strip that opens a left overlay drawer; backdrop
  and Escape close it.
- Settings accessible only via ⚙️ in the strip (not in sidebar nav).
- Sync Now, last-sync, and the profile **icon** live in the strip, right-aligned
  inline with the Settings icon; no profile dropdown.
- Branding (radar icon + "SPRINT RISK RADAR") shows in the strip when the nav is
  collapsed, and in the sidebar when expanded.
- Copyright message is at the bottom of the left sidebar, not the page footer.
- Logo collapses to icon in the rail, full in the drawer/expanded sidebar.
- `tsc`, lint, and build all pass.
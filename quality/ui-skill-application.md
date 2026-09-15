# UI Implementation Quality Skill v0.2 — Application Record

Status: IN PROGRESS

Required skill: `ui-implementation-quality` v0.2
Source: ChatGPT Library `ui-implementation-skill-v0.2.zip`

## Product/task framing
- Primary flow: Open/create resource pack → choose asset → edit → inspect save/validation state → validate → export ZIP.
- Platform: Web/PWA.
- Inputs: keyboard, fine pointer, coarse pointer/touch, stylus where available.
- Data risk: local edits must not be lost silently; save state must be truthful.

## Selected patterns
- Workspace switching: `PATTERN.TABS` because peer editor surfaces share one project context.
- Pack import: `PATTERN.FILE_UPLOAD` using native file input plus optional drag/drop.
- Asset discovery: `PATTERN.SEARCH` with ordinary rich-row buttons, not listbox/tree semantics.
- Tool groups: native button groups; toolbar semantics only where directional roving-focus is implemented.
- Secondary panels on narrow screens: modal drawer/dialog behavior where background interaction is blocked.
- Status/errors: `PATTERN.NOTIFICATION`; validator problem list remains persistent when actionable.

## Canonical rules emphasized
`PURPOSE.01`, `PURPOSE.03`, `AGENCY.01`, `MENTAL.01`, `COG.03`, `DISC.01`, `DISC.02`, `SEARCH.03`, `DATA.01`, `DATA.02`, `PERF.02`, `PERF.06`, `VERIFY.01`–`VERIFY.09` as applicable.

## Platform overlay
`PLATFORM.WEB`: native HTML semantics first; logical DOM/focus order; keyboard-only access; capability queries for input; reflow/zoom; browser navigation semantics where applicable.

## Completion rule
Do not change `quality/ui-skill-gate.json` to PASS until review pipeline, runtime QA, and regression evidence are actually recorded.

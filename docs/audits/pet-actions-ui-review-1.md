# Pet Actions UI Review 1

```yaml
verdict: "FAIL"
route: "repair"
candidate: "b00a27f..b578ef2 (HEAD 5cb698c7e6b518f2036cb75acbda83c74cf7b82)"
spec_suspicion_precheck:
  result: "clean"
  evidence:
    - "Approved Plan P1 and frozen Spec REQ-008..REQ-013 / AC-008..AC-010 cover the reviewed UI, migration, and event-isolation boundary."
    - "Frozen Spec SHA-256 matches 21EABF0E8C2F896AAF78531926D57EA146DC22F4DBD4705353E83C027A1665EF."
    - "The current fail-closed pet-action stub is within UNIT-1 scope; no capture/model implementation is expected at this stage."
evidence:
  - id: "E-001"
    path: "docs/PLAN-pet-actions-v3.md; docs/SPEC-pet-actions-v3.yaml; docs/LEDGER-pet-actions-v3.md"
    hash: "SPEC SHA-256 21EABF0E8C2F896AAF78531926D57EA146DC22F4DBD4705353E83C027A1665EF"
  - id: "E-002"
    path: "git diff --find-renames --unified=12 b00a27f..b578ef2"
    hash: "candidate diff inspected; working tree was clean before report creation"
  - id: "E-003"
    path: "app/main/pet-actions-ui.unit.test.js; app/main/palette-trigger-contract.unit.test.js; app/main/pet-status.unit.test.js; app/main/palette-action-guards.unit.test.js"
    hash: "all four focused tests passed when rerun"
  - id: "E-004"
    path: "app/main/config.js; app/main/legacy-palette-migration.js; app/main/main.js; app/renderer/pet.js; app/renderer/settings.js; app/preload.js"
    hash: "node --check passed for every changed JavaScript file"
  - id: "E-005"
    path: "git diff --check b00a27f..b578ef2"
    hash: "passed"
  - id: "E-006"
    path: "app/package.json; app/node_modules/.bin/electron.cmd"
    hash: "Electron executable unavailable in this checkout; no desktop visual/runtime inspection performed"
findings:
  - id: "F-001"
    requirement_refs: ["REQ-012", "REQ-013", "AC-010"]
    location: "app/renderer/pet.js:293"
    statement: "When a hold-to-record gesture starts on the pet and the pointer is released over the action-row gap, the window mouseup handler takes the #action-row early return before its hold-mode isRecording check. The buttons become disabled while recording, but the row gaps remain hit-testable. This leaves the active microphone stream running after the user releases the recording gesture, violating pet/action gesture isolation and voice-state expectations."
    root_cause_assumptions: []
    confidence: "high"
    impact: "boundary"
    route: "repair"
    evidence: "app/renderer/pet.js:293-303 clears down, then returns for any mouseup target inside #action-row; stopRecording() is only called later at line 302. updateActionButtons() disables action buttons while listening, but does not disable the row or its gaps."
residual_evidence_gaps:
  - "Electron is absent, so rendered-window visual evidence for overlap/cropping at minimum/maximum scale is unavailable. Static geometry uses a 300x306 CSS body and matching scaled BrowserWindow bounds; fixed content sums to approximately 292 CSS px before status line-height, leaving nominal vertical space but not replacing runtime visual review."
  - "No live Windows runtime interaction was performed. Unit tests include source assertions and migration checks, not an actual pointer/recording session."
  - "reviewer-protocol.md was not present in this checkout; this report follows the repository's existing structured audit format."
next_cycle_brief:
  objective: "Repair the hold-record release path when mouseup lands anywhere in the action row, preserving button isolation, then rerun the focused UI/migration checks and obtain Electron visual evidence when the runtime is available."
  allowed_changes:
    - "Change only the pet gesture release handling and focused regression coverage needed for F-001."
    - "Capture visual evidence for the pet and button row at the supported scale bounds when Electron is available."
  checks:
    - "Start hold recording on the pet, release over an action-row gap, and verify recording stops without opening settings or activating a text action."
    - "Verify ordinary action clicks do not start/stop recording, drag the pet, open settings, or scale the window."
    - "Rerun pet-actions-ui.unit.test.js, palette-trigger-contract.unit.test.js, pet-status.unit.test.js, palette-action-guards.unit.test.js, node --check, and git diff --check."
  prohibited:
    - "Do not treat the UNIT-1 fail-closed stub as a missing capture/model implementation bug."
    - "Do not claim visual or live Windows runtime validation without executing it."
    - "Do not change the frozen Spec, Plan, approval threshold, or compatibility claims in this repair."
  carry_forward: ["F-001"]
```

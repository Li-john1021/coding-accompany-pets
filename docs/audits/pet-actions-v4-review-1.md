# Pet Actions v4 Independent Review 1

verdict: "FAIL"
route: "repair"
candidate: "288db0d8509a817b917a5c411b50a5ccfdcef6bf..c43f2afa1c3624368692924ab47918ecb68b6e94"

## Suspicion Precheck

The precheck is clean. Each Spec requirement traces to the approved v4 Plan and a named acceptance item. Dependencies and the Windows host-identification assumption have explicit validation routes. The v4 Plan, Spec, and ledger agree that ordinary hosts receive a one-click copy request, non-empty pipeline results publish directly, and named Windows runtime validation remains pending. No v3 confirmation, preview, or host-admission rules were applied.

## Evidence

- E-001: `docs/PLAN-pet-actions-v4.md`, approved v4 behavior and release boundary; candidate repository file.
- E-002: `docs/SPEC-pet-actions-v4.yaml`, SHA-256 `25b6fff0287f66f36241d8de4993ecc6692a48661a95e670cf023dc312cb785e`.
- E-003: `docs/LEDGER-pet-actions-v4.md`, implementation record says named Windows runtime validation is pending.
- E-004: `app/main/pet-action-capture.js`, candidate lines 141-158; copy request, settle, sequence comparison, and returned capture.
- E-005: `app/main/pet-action-capture.unit.test.js`; exercises ordinary Chrome/IDE/unknown routing, stale sequence rejection, same-value text on a new sequence, host chords, and target/voice guards.
- E-006: `app/main/pet-action-workflow.js` and `app/main/pet-action-workflow.unit.test.js`; direct write for non-empty degraded/raw text, empty/error handling, clipboard interleaving, and voice isolation.
- E-007: `app/renderer/pet.js`, candidate lines 103-112; action completion and delayed idle transition.
- E-008: `app/main/pet-actions-ui.unit.test.js`; three controls, disabled image placeholder, action row, and voice guards.
- E-009: `app/main/pet-action-clipboard.runtime.test.js`; static direct-clipboard assertion passes. The separate Windows capture runtime fixture was not run because this audit did not inject a key into or inspect the user's clipboard.
- E-010: `node app/main/<each *.unit.test.js>` and `node app/renderer/pet-live2d.unit.test.js`; all 15 app/main unit files and the renderer Live2D test passed.
- E-011: `node --check` for all 45 Git-tracked JavaScript files under `app/`, plus `git diff --check 288db0d..c43f2af`; passed.
- E-012: `git status --short --branch` before audit; clean `codex/palette-input-sources` at `2330f9b7be1737dab3a0d0e66f4fa12d835ed469`.

## Findings

- id: "F-001"
  requirement_refs: ["REQ-002"]
  statement: "Capture can authorize unrelated clipboard text instead of text produced by this click's copy request. `click` snapshots sequence S, sends the host chord, waits 180 ms, then accepts any non-empty text whenever the sequence differs from S (`pet-action-capture.js:141-155`). Reproduction: select text in an ordinary host, click Structure, let the copy chord produce no clipboard update, and have another app write non-empty text before the settle snapshot; the unchanged foreground target plus changed sequence authorizes that other text for `processText`. The current test only changes sequence through its simulated `copyEffect`, so it does not cover this interleaving. This violates request-bound capture and can send unintended text to the model."
  root_cause_assumptions: ["ASM-001"]
  confidence: "high"
  impact: "boundary"
  route: "repair"

- id: "F-002"
  requirement_refs: ["REQ-008"]
  statement: "The successful-action idle timer can overwrite a later voice state. After completion, line 112 schedules `setState('idle')` guarded only by `!activePetAction`; `finally` clears that flag immediately. Reproduction: complete an action, start recording within five seconds, then let the timer fire. `startRecording` sets `listening`, but the callback still changes the stage and Live2D state to idle while recording continues. The timer does not check the voice epoch, recording flags, or current voice stage."
  root_cause_assumptions: []
  confidence: "high"
  impact: "unit"
  route: "repair"

## Runtime Boundary

No named Windows runtime host/control pair was exercised in this audit. Windows Terminal, conhost, ordinary browser/IDE hosts, and unknown ordinary apps remain unverified as recorded in the ledger. No Linux/macOS support is claimed. The tracked `app/main/pet-action-capture.runtime.test.js` still imports the removed `probeNativeSelection` API and exercises the superseded native-selection fixture; it is not evidence for the v4 active-copy path and must be replaced or explicitly retired before treating runtime acceptance as complete.

## Next Cycle Brief

objective: "Repair request-bound freshness so only the active copy response authorizes source text, and prevent a completion timer from replacing a newer voice state."
allowed_changes: ["Evidence-supported fixes for F-001 and F-002; update focused regression coverage."]
checks: ["Exercise an unrelated clipboard write during the capture settle window and prove it cannot authorize text.", "Exercise voice start after successful text completion and before the idle timer fires; prove listening/transcribing state remains visible.", "Rerun app/main unit tests, renderer Live2D unit test, tracked syntax, and Spec hash check.", "Run named isolated Windows host/control validation only after the user-window and clipboard isolation boundary is available."]
prohibited: ["Do not reintroduce manual copy, second confirmation, preview gates, host allowlists, clipboard ownership-change rejection, or v3 behavior.", "Do not use the user's foreground window or clipboard contents as runtime test fixtures."]
carry_forward: ["F-001", "F-002", "Windows host runtime evidence pending"]

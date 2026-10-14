# Pet Actions UNIT-3 Model Workflow Review 1

```yaml
verdict: "CHANGES_REQUESTED"
route: "implementation_repair"
candidate: "7e8c598..c5cda3a (UNIT-3; reviewed at Ledger HEAD 2d14841a794c75a8e0ff01fd2f359a1cb784c080)"
spec_suspicion_precheck:
  result: "pass_with_scope_gaps"
  evidence:
    - "Approved Plan and frozen Spec hash agree with the approval Ledger; SHA-256 is 21EABF0E8C2F896AAF78531926D57EA146DC22F4DBD4705353E83C027A1665EF."
    - "UNIT-3 remains within the approved explicit-action workflow and does not alter the Plan or Spec."
    - "The Plan lists webpages and IDE editors among ordinary Ctrl+C candidates, while the frozen Spec defers browser/IDE integrations. UNIT-2 resolved this conservatively as manual-copy only without host/control evidence; this remains a product-scope gap, not a compatibility claim."
    - "Plan P3 calls for race-tested clipboard ownership preservation. The implementation performs an asynchronous snapshot check followed by a separate write, leaving a check/write race window."
evidence:
  - id: "E-001"
    path: "docs/SPEC-pet-actions-v3.yaml"
    hash: "SHA-256 21EABF0E8C2F896AAF78531926D57EA146DC22F4DBD4705353E83C027A1665EF"
  - id: "E-002"
    path: "app/main/pet-action-workflow.js; app/main/main.js; app/renderer/pet.js; app/renderer/preview.js"
    hash: "Reviewed against candidate diff 7e8c598..c5cda3a"
  - id: "E-003"
    path: "app/main/pet-action-workflow.unit.test.js; app/main/pet-action-capture.unit.test.js"
    hash: null
    details: "All app/main/*.unit.test.js passed. Tests cover mode routing, preview confirmation/no model call, capture authorization rejection, voice busy before/during capture, concurrency, degraded/empty/mismatched pipeline output, changed sequence before the snapshot, write rejection, explicit-copy preview, token consumption, and capture cancellation."
  - id: "E-004"
    path: "app/**/*.js"
    hash: null
    details: "node --check passed for all JavaScript files under app; git diff --check 7e8c598..c5cda3a passed."
  - id: "E-005"
    path: "runtime boundary"
    hash: null
    details: "Electron is not installed/resolvable in this checkout. No live pet-button, preview-window, clipboard, or voice interaction was exercised."
findings:
  - id: "F-001"
    requirement_refs: ["REQ-005", "REQ-017", "AC-007A", "AC-007B"]
    statement: >-
      Clipboard ownership is checked at app/main/pet-action-workflow.js:39-43 by awaiting getClipboardSnapshot(), then writing in a later statement. Another application can update the clipboard after the snapshot resolves but before writeClipboardText runs; this workflow will overwrite that newer value and report copied=true. The tests cover a sequence that is already changed when the snapshot is taken, but not a change in this check/write interval. This does not satisfy the Spec's unconditional preserve-newer-clipboard behavior under a race. Use an ownership-conditional write operation that can check and claim the clipboard atomically (or establish an equivalent native guard), and add a deterministic test that changes ownership between the check and write boundary.
    root_cause_assumptions:
      - "ASSUMPTION: Clipboard changes by another process can occur between the asynchronous snapshot and Electron clipboard write; the current adapter does not hold an OS clipboard lock across both operations."
    confidence: "high"
    impact: "data_integrity"
    route: "implementation_repair"
  - id: "F-002"
    requirement_refs: ["REQ-013", "AC-010"]
    statement: >-
      The workflow blocks text actions when voice is already active and rechecks voice after capture, but it does not coordinate a voice start during model processing. The existing global hotkey can start recording while petActionWorkflow.busy is true. When the text action resolves, app/renderer/pet.js sets the stage to done or error from its IPC response, overriding the active listening/transcribing display. The text operation can therefore regress the visible voice state while voice recording/submission is active. Add a cross-workflow guard or make action completion preserve the current voice stage, then cover starting voice while processText is pending and resolving the text operation afterward.
    root_cause_assumptions:
      - "ASSUMPTION: The global recording hotkey remains active during a text model request; registerHotkey does not check petActionWorkflow.busy."
    confidence: "high"
    impact: "voice_state_regression"
    route: "implementation_repair"
evidence_gaps:
  - "No Electron installation was available, so the renderer status/button behavior and result-only preview were not visually or interactively validated."
  - "No test injects a clipboard update after ownership snapshot completion but before result write."
  - "No runtime test starts voice while processText is pending and observes stage/busy-button behavior."
  - "UNIT-2's manual-copy-only handling for browser and IDE processes remains narrower than the Plan's ordinary-host candidates; no such host/control pair is claimed supported."
  - "Human copy in a browser or IDE followed by a pet click remains a product gap where UI focus changes can prevent fresh clipboard detection; resolving that requires host/runtime validation or a revised interaction decision."
next_cycle_brief:
  objective: "Repair clipboard conditional-write race and prevent pet-action completion from overriding active voice state, then re-review UNIT-3."
  allowed_changes:
    - "Add an ownership-conditional clipboard result write with a deterministic interleaving test."
    - "Coordinate voice start and text workflow completion so active voice state cannot be overwritten."
    - "Keep the frozen Plan and Spec unchanged unless separate approved planning evidence revises scope."
  checks:
    - "Run app/main/*.unit.test.js, node --check for app JavaScript, and git diff --check."
    - "Test clipboard change between ownership check and output write."
    - "Test voice activation while a model request is pending and confirm voice status is retained."
    - "When Electron is available, validate action highlight cleanup, explicit-copy preview, and concurrent voice/action interaction."
  prohibited:
    - "Do not claim browser, IDE, or terminal compatibility based on unit tests or manual copy alone."
    - "Do not add automatic paste, source replacement, or retry model calls on degraded output."
    - "Do not rewrite the frozen Spec or prior audit reports as part of implementation repair."
  carry_forward: ["F-001", "F-002", "browser/IDE manual-copy product gap", "Electron runtime validation"]
```

## Reconciliation

The model workflow only reaches `pipeline.processText` with a non-empty, mode-matched authorization result from the capture gate. Structure and Optimize pass their explicit mode. The capture module consumes pending confirmation state on the same-mode second click; stale mode/target/sequence, expiry, and voice changes cancel it. The workflow rejects empty, degraded, thrown, and mismatched-mode results before clipboard output, and falls back to the existing result-only preview when the observed clipboard has changed or the write throws. That preview hides insertion and transformation controls and exposes explicit copy only.

The unit coverage meaningfully exercises the gate and workflow contracts, but it is mock-based and does not drive the Electron IPC-to-renderer path. In particular, it misses the clipboard interleaving in F-001 and a voice start during an in-flight model operation in F-002. Legacy automatic palette entry remains retired by the existing trigger-contract tests; the UNIT-3 diff adds no fallback to it.

All requested static checks passed. Electron is unavailable, so GUI behavior is unverified. The Plan/Spec browser and IDE candidate boundary remains unresolved for product scope; UNIT-2 conservatively requires manual copy and no compatibility claim is made. Browser/IDE manual copy usability also remains an explicit product gap pending a reviewed interaction or host capability decision.

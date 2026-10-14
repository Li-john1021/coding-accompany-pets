# Pet Actions UNIT-3 Model Workflow Review 2

```yaml
verdict: "FAIL"
route: "repair"
candidate: "b7d376a..a7e1046 (repair reviewed at working HEAD 7eecdc21126a2b061b7dc50de83ae630de41b814)"
spec_suspicion_precheck:
  result: "pass_with_scope_gaps"
  evidence:
    - "Approved Plan and frozen Spec are present and agree with the recorded approval Ledger; Spec SHA-256 is 21EABF0E8C2F896AAF78531926D57EA146DC22F4DBD4705353E83C027A1665EF."
    - "REQ-005/REQ-017 map to AC-001/AC-002/AC-007A/AC-007B; REQ-013 maps to AC-010. The selected checks can observe clipboard write refusal and voice-state completion behavior, although the renderer error-rejection case is not covered."
    - "The Plan's browser/IDE candidate scope remains narrower in UNIT-2 implementation policy: those hosts currently use manual copy and have no named compatibility evidence. This is a carried planning/product gap, not a compatibility claim introduced by this repair."
    - "No contradiction requiring planning review was found."
evidence:
  - id: "E-001"
    path: "docs/SPEC-pet-actions-v3.yaml"
    hash: "SHA-256 21EABF0E8C2F896AAF78531926D57EA146DC22F4DBD4705353E83C027A1665EF"
  - id: "E-002"
    path: "app/main/pet-action-clipboard.js:22-44; app/main/pet-action-workflow.js:49-59"
    hash: "Candidate diff b7d376a..a7e1046"
    details: "The helper prepares movable global memory before OpenClipboard, compares sequence while holding the lock, and then EmptyClipboard/SetClipboardData. The deterministic unit fixture passes a changed sequence at the conditional-writer boundary and verifies explicit-copy fallback."
  - id: "E-003"
    path: "app/main/pet-action-workflow.unit.test.js:123-180; app/main/main.js:76-80, 193-199, 299-305, 344-350, 974-980"
    hash: "Candidate diff b7d376a..a7e1046"
    details: "A deferred-model fixture starts voice before resolving processText and confirms there is no write or result preview. Hotkey, side-button, submit, and renderer recording-flag starts advance the voice epoch and cancel pending clipboard writer processes."
  - id: "E-004"
    path: "app/renderer/pet.js:82-131"
    hash: "Candidate diff b7d376a..a7e1046"
    details: "Success responses return early when voice UI is active or the operation is superseded. The catch for a rejected IPC invocation still unconditionally changes the stage to idle."
  - id: "E-005"
    path: "commands: all app/main/*.unit.test.js; node --check app/**/*.js; git diff --check b7d376a..a7e1046"
    hash: null
    details: "All 14 app/main unit test files passed; all app JavaScript syntax checks passed; git diff --check passed."
  - id: "E-006"
    path: "command: node app/main/pet-action-clipboard.runtime.test.js"
    hash: null
    details: "Real Windows PowerShell smoke passed the mismatched-sequence no-write case and matching-sequence native write/readback. It conditionally restored the original recognized plain-text clipboard value. This validates the tested success and mismatch paths only; it does not exercise OpenClipboard, EmptyClipboard, or SetClipboardData failures."
  - id: "E-007"
    path: "runtime boundary"
    hash: null
    details: "Electron cannot be resolved in this checkout. No live renderer, pet UI, or IPC interaction was tested. Browser and VS Code host/control compatibility remain untested planning gaps."
findings:
  - id: "F-001"
    requirement_refs: ["REQ-005", "REQ-017", "AC-007A", "AC-007B"]
    statement: >-
      app/main/pet-action-clipboard.js:35 accepts a sequence match even when GetClipboardSequenceNumber() returns zero. The Windows API explicitly returns zero when the process lacks WINSTA_ACCESSCLIPBOARD access ([Microsoft documentation](https://learn.microsoft.com/windows/win32/api/winuser/nf-winuser-getclipboardsequencenumber)). If capture supplied expected sequence 0, this helper can continue through EmptyClipboard and SetClipboardData, replacing clipboard contents despite the ownership/version being unavailable. Reject zero on either the expected or observed side before EmptyClipboard. The native smoke uses a normal accessible window station and did not cover this fail-closed case.
    root_cause_assumptions:
      - "ASSUMPTION: A capture snapshot can carry sequence 0 into the writer; the writer itself accepts expected 0 at app/main/pet-action-clipboard.js:73 and does not separately validate the native sequence result."
    confidence: "high"
    impact: "data_integrity"
    route: "repair"
  - id: "F-002"
    requirement_refs: ["REQ-013", "AC-010"]
    statement: >-
      app/renderer/pet.js:125-127 handles a rejected petAction IPC promise by showing an error and calling setState('idle') without checking voiceUiBusy() or a voice-operation epoch. If a hotkey, side button, recording flag, or submit starts voice while the text request is pending and the IPC promise rejects (for example, renderer/main IPC failure), this catch can overwrite listening/transcribing with idle. The success path at lines 89-90 has a guard, but the error path does not. The current deferred-model unit resolves successfully and therefore does not cover this renderer rejection interleaving; add a renderer-level deterministic case or guard the catch before changing state.
    root_cause_assumptions:
      - "ASSUMPTION: petAction IPC can reject independently of the main workflow's normal voiceSuperseded result, as Electron invoke promises reject on IPC/runtime errors."
    confidence: "high"
    impact: "voice_state_regression"
    route: "repair"
next_cycle_brief:
  objective: "Fail closed when native clipboard sequence ownership is unavailable and preserve an active voice UI state when pet-action IPC rejects."
  allowed_changes:
    - "Reject expected or observed clipboard sequence 0 before EmptyClipboard and test the refusal path."
    - "Guard the renderer pet-action catch path against active listening/transcribing state and cover a rejected IPC promise during voice activity."
  checks:
    - "Run all app/main/*.unit.test.js, node --check for app JavaScript, git diff --check, and the frozen Spec hash check."
    - "Exercise the Windows conditional-write mismatch and matching paths; keep the smoke's clipboard backup/restoration safeguards."
    - "When Electron is available, validate voice start during a pending pet action and IPC error/success completion in the renderer."
  prohibited:
    - "Do not claim atomic or lossless clipboard replacement. EmptyClipboard may succeed before SetClipboardData fails; that failure can leave the clipboard empty, while the successful model result remains available only through the app preview fallback."
    - "Do not claim browser, IDE, or terminal compatibility from manual-copy policy or unit tests."
    - "Do not alter the frozen Plan, Spec, or prior audit report in this repair."
  carry_forward: ["F-001", "F-002", "Windows native failure-path coverage", "Electron runtime validation", "browser/IDE/terminal host evidence gap"]
```

## Reconciliation

The repair closes the earlier asynchronous snapshot/write interval: the sequence comparison, clipboard empty, and result publication are performed while this process owns the clipboard lock. Preallocating `GMEM_MOVEABLE` and freeing memory unless Windows takes ownership are correctly ordered. A valid hidden WinForms owner HWND is passed to `OpenClipboard`. The tested mismatch and success paths behaved as expected on Windows.

This is a conditional write, not a fully atomic or lossless clipboard transaction. If `EmptyClipboard` succeeds and `SetClipboardData` then fails, the old clipboard content has already been removed; the helper returns unavailable and the workflow opens the result-only preview, but it cannot restore arbitrary formats or guarantee the source text remains. `OpenClipboard` failure occurs before mutation and frees the allocation. `SetClipboardData` failure closes the lock and frees the untransferred allocation, but does not restore the emptied clipboard. The sequence-zero case is a separate fail-closed defect captured as F-001.

Voice-start notification now reaches the main workflow from the global hotkey, mouse side-button, renderer recording flag, and audio submit routes. A model result superseded during processing is not published to clipboard or result preview. The renderer success result is guarded, but its promise-rejection catch is not, leaving F-002 open.

The Spec suspicion precheck found no planning contradiction. The Plan/Spec browser and IDE candidate boundary is still unresolved at runtime: current implementation uses conservative manual-copy policy, and no such host/control pair is claimed supported. Electron is unavailable, so desktop GUI and IPC renderer behavior remain unverified. The frozen Spec hash matches the approved value.

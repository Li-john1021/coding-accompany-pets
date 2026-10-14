# Palette Trigger Fix Plan

Status: approved for implementation planning, v1
Scope: automatic selection palette trigger safety only. This plan does not authorize a new shortcut, palette redesign, or unrelated UI changes.

## Product request

Show the automatic palette only for a real, non-empty text selection made by a left-button gesture whose down and up points resolve to the same editable, non-read-only text control. Do not show it for window movement, borders, files or other objects, web page content, chat/history content, PDFs, read-only material, terminals, or the desktop. Foreground keyboard focus alone is not evidence that the mouse gesture selected text.

Passive detection must not synthesize Ctrl+C, change the clipboard, move focus, or alter the selection. The user's own copy action remains unaffected. Any failed or ambiguous probe denies the automatic palette. Recording suppresses it. Apply the configured character threshold only after confirming an actual non-empty text selection. Processing remains an explicit button action; if the selection/control can no longer be trusted at click time, revalidate and cancel concurrent or stale work. Preserve existing palette UI and voice behavior.

Editable-control detection may use UI Automation TextPattern selection and Win32 EM_GETSEL where appropriate. If a browser `contenteditable` selection cannot be confirmed without side effects, automatic mode must not show the palette there.

## Known root cause

`app/main/main.js` calls `captureAndShowPalette` after a drag or multi-click. It samples the foreground process and focused control after the gesture, but does not record or compare the control under the mouse at button-down and button-up. `getSelectionContext` falls back from focused HWND to caret HWND and then foreground HWND, so system focus can authorize a gesture that occurred elsewhere. `palette-gate.js` currently rejects only disabled/recording/recent-copy/own-UI cases; its editable-control helper is not required by `shouldShowPalette`, and the gate otherwise permits all processes. Palette display currently happens before checking whether a real non-empty selection exists. Actual text is read only after a palette action through `insert.js` `readSelection`, which writes a marker to the clipboard and simulates Ctrl+C. That behavior is incompatible with passive, no-side-effect eligibility detection and must not be used to decide whether the automatic palette appears.

## Prior-spec conflicts

- `docs/SPEC-anti-answer-and-on-demand.md` §8 explicitly excludes UI Automation selection reading; this approved change permits passive UIA TextPattern selection inspection for trigger eligibility.
- §9.3's editable-control suggestion is not an enforced rule in the current implementation; §10 explicitly says the gate is fully open apart from recording and recent Ctrl+C.
- §3.2/UC-01 describe simulated copying to read selection and saving the clipboard. The new product request forbids that during passive detection. Existing explicit processing and insertion behavior must be reviewed so the user's own Ctrl+C and clipboard are not altered by eligibility checks.
- The old acceptance criteria allow arbitrary applications and do not require the same editable control at both mouse endpoints or a confirmed non-empty selection before thresholding. This plan supersedes those trigger criteria only.

## Requirements and scenario acceptance

| ID | Requirement | Source | Acceptance scenario |
|---|---|---|---|
| R1 | Show automatically only for a confirmed non-empty text selection inside one editable, non-read-only control, with mouse down and up resolving to that same control. | Product request; §9.3 intent | Select text within an editable input: show. Drag from an editor into another control, across a border, or over an object: do not show. Empty selection: do not show. |
| R2 | Deny desktop, Explorer/file/object selection, menus, web read-only content, chat/history, PDFs/read-only documents, terminals, and ambiguous or failed probes. Focus alone is insufficient. | Product request; §9.3; §9.6 | Exercise each listed source and probe timeout/error; none shows the palette, even when another editable control owns keyboard focus. |
| R3 | Passive eligibility detection does not synthesize Ctrl+C, modify clipboard, shift focus, or change selection. A user's own copy action is not intercepted or suppressed. | Product request; §3.2 safeguard | Observe input/clipboard/focus/selection during eligibility probe; all remain unchanged. A user Ctrl+C still copies normally. |
| R4 | Suppress palette during recording. | Product request; §3.2; §9.6 | Complete an otherwise eligible selection while recording; no palette appears. |
| R5 | Evaluate minimum-character threshold only after confirming a real, non-empty selected string. | Product request; §4.3; §10 | No selection and failed selection retrieval are denied as such; a confirmed selection below threshold is denied by threshold; one at/above threshold proceeds. |
| R6 | Keep model processing behind an explicit palette button click; revalidate eligibility before acting if needed, and cancel stale/concurrent work. | Product request; §3.2 | Showing/dismissing palette causes no processing. On click, stale/changed control or selection cancels without applying a result; concurrent attempts cannot apply to the wrong target. |
| R7 | Preserve existing palette UI and voice functions. | Product request; §2, §5 UC-02; §9.2 scope boundary | Regression review confirms no palette redesign and existing voice recording/transcription paths remain functionally unchanged. |
| R8 | Browser editable areas are eligible only when non-side-effecting inspection can positively confirm editable selection; otherwise fail closed. | Product request; §9.3 | Browser contenteditable with positively confirmed selection can proceed; read-only page text and unconfirmable selection do not show. |

## Implementation units and validation boundaries

1. **U1: Passive trigger probe and gate.** Capture gesture endpoints and passively identify the hit editable control and selected text. Require endpoint identity, positive editability/non-read-only evidence, non-empty selection, enabled state, and not recording. Fail closed for unsupported controls and probe errors. Preserve ordinary user input. Validate the gate with unit cases and source-level checks for absence of synthetic copy/clipboard/focus/selection mutation in the passive path.
2. **U2: Trigger integration and stale-action guard.** Connect mouse-down/up gesture state to U1, reject mismatched or non-text gestures, then apply the threshold. Keep processing click-gated; revalidate target/selection before applying asynchronous results and cancel stale or overlapping runs. Validate eligible and denied scenario matrix, including races and action-time target change.
3. **U3: Compatibility review.** Check existing palette UI, explicit processing, recording, and voice workflows. Validate Windows controls that expose safe selection data and document unsupported cases; browser contenteditable is denied when safe confirmation is unavailable.

Validation is limited to the trigger safety behavior, preserving current UI/voice contracts, and targeted Windows compatibility. No visual redesign, new shortcut, broad settings work, or performance redesign is in scope. Tests are to run in a clean context after implementation, with independent review of each committed unit as authorized by the user.

## Compatibility limits and unresolved details

Windows UI Automation providers and Win32 controls expose different selection patterns. UIA TextPattern selection is the preferred passive source where supported; EM_GETSEL is suitable only for native edit controls and must not be treated as proof of selected text by itself. Some editors, elevated windows, remote sessions, and custom controls may not expose enough information; those cases fail closed. Browser page selection is not accepted unless the focused editable region and its selected text are positively identified without changing browser state. Exact per-control probing details are implementation choices constrained by the invariants above.

## Approval evidence

Approved to begin by the user instruction in the current task handoff, which records the user's latest product requirements and prior direction about preventing false palette popups. This plan is the authority for the implementation cycle; the compiled YAML is a frozen, traceable snapshot.

Frozen spec ledger: `docs/SPEC-palette-trigger-fix.yaml` SHA-256 `606830FB0DAA45A47EAE07C316204EE5F4952236AD21FB327501080C61123B50`.

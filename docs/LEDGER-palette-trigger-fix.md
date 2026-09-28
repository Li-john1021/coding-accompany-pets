# Palette Trigger Fix Ledger

Plan: `docs/PLAN-palette-trigger-fix.md` v1 (approved)
Frozen Spec: `docs/SPEC-palette-trigger-fix.yaml`
Frozen Spec SHA-256: `606830FB0DAA45A47EAE07C316204EE5F4952236AD21FB327501080C61123B50`
Base: `046135b606313bf4467735d873b64166148102b1`
Branch: `codex/palette-trigger-fix`

## WU-001

Status: implemented; deterministic checks passed. Independent boundary review is pending.

Changes: passive UIA point probe requires the same hit Edit control, positive non-readonly ValuePattern, TextPattern selection, and identical non-empty selected text at both endpoints. Probe errors and timeout return no evidence. The pure gate rejects missing evidence, terminal process names, recording, disabled state, and recent user copy. Character threshold helper rejects unconfirmed/empty input before comparing length.

Checks:

- `node app/main/palette-gate.unit.test.js` — pass.
- `node app/main/palette-probe.unit.test.js` — pass.
- `node app/main/palette-run-guards.unit.test.js` — pass.
- `git diff --check` — pass.
- Frozen Spec hash rechecked — matches.

Evidence limits: these checks exercise pure JavaScript policy, parsing, generated-probe invariants, and existing interaction guards. They do not exercise Windows UIA providers or actual selections in native/browser controls. Supported provider scenarios remain unverified pending targeted Windows validation; unsupported or ambiguous providers fail closed.

Validation boundary: VB-001 / L1 is warranted because probing crosses process/provider boundaries. Reviewer evidence is not yet recorded.

## WU-002

Status: implemented; deterministic checks passed. Independent boundary review is pending.

Changes: left-button gesture start/end coordinates and a monotonically increasing gesture id are carried into the probe; only drag or multi-click candidates are considered. The confirmed selection is thresholded before display. The displayed selection id is bound through preload and renderer IPC for run/copy/dismiss actions. Stale probes, stale IPC responses, and delayed dismissals cannot act on a newer selection. Processing has a reentry lock and revalidates the same selected text/control before starting and after model work. Click-time revalidation requires the UIA focused Edit to match the selection control. Guarded paste additionally checks foreground process and focused Edit identity in the native injection process immediately before Ctrl+V; probe failure cancels and conditionally restores the clipboard if it still contains this attempt's output.

Compatibility/timing note: palette window remains `focusable: false` and uses `showInactive()`. If clicking it nevertheless changes the original focused Edit, the action is canceled. This assumption is not yet verified on Windows. The last-moment native guard narrows the race to the instant after the check and before `SendInput`; Windows does not provide an atomic focus-check-and-keystroke operation here.

Checks:

- `node app/main/palette-gate.unit.test.js` — pass.
- `node app/main/palette-probe.unit.test.js` — pass.
- `node app/main/palette-action-guards.unit.test.js` — pass.
- `node app/main/palette-paste-guard.unit.test.js` — pass, including Windows PowerShell parser validation of generated final-injection guard.
- Every `app/main/*.unit.test.js` — pass.
- `node --check` on changed main/preload/renderer JavaScript — pass.
- `git diff --check` — pass.
- Frozen Spec hash rechecked — matches.

Failure/repair evidence: one full-suite run initially failed the probe parser test because its whitespace-selection fixture omitted the now-required `processName`; the fixture was corrected to include provider identity. The rerun of every `app/main/*.unit.test.js` passed.

Evidence limits: PowerShell parser validation proves only generated guard syntax. Tests do not execute UIA providers, foreground comparisons, or end-to-end paste routing. No Windows control/browser scenario is claimed as tested.

Validation boundary: VB-002 / L1 is warranted because asynchronous processing and cross-process paste affect target state. Reviewer evidence is not yet recorded.

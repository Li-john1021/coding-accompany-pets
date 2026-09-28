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

## WU-003

Status: compatibility review documented; deterministic regression checks passed. Independent boundary review and targeted Windows validation are pending.

Changes: expanded explicit terminal process denial and denied common PDF viewer process names; documented the strict UIA capability contract, candidate providers, unsupported/fail-closed cases, runtime validation gaps, and the remaining check-to-SendInput race in `docs/COMPATIBILITY-palette-trigger-fix.md`.

Checks:

- Every `app/main/*.unit.test.js` — pass.
- `node --check` on changed JavaScript — pass.
- `git diff --check` — pass.
- Frozen Spec hash rechecked — matches.
- `git diff --quiet 046135b606313bf4467735d873b64166148102b1 -- app/main/pipeline.js app/renderer/palette.html app/renderer/pet.js app/renderer/pet-live2d.js` — pass; voice pipeline, existing palette HTML, and pet renderers are unchanged.

Validation boundary: VB-003 / L1 is warranted because providers differ and trigger changes share the app process with voice flows. UIA compatibility and focusable-false behavior remain unverified on actual Windows controls; no runtime test is claimed.

## Independent Review 1 Repairs

Scope: repair only F-001 and F-002 from immutable `docs/audits/palette-trigger-review-1.md`; frozen Spec unchanged.

- F-001: guarded paste now has a reusable passive target test. It runs after the initial delay before IME state query, again before the initial Shift, and before Ctrl+V. IME restoration Shift is conditional on the original foreground PID, focused Edit runtime identity, and selected text still matching. A failed guard exits before sending input; a failed post-paste restore check skips the Shift instead of targeting another window.
- F-002: the gate explicitly rejects Explorer and named desktop/shell process identities (`explorer`, `progman`, `workerw`, `ShellExperienceHost`, `StartMenuExperienceHost`, `SearchHost`, `SearchApp`, `ApplicationFrameHost`, `ShellHost`, `Taskbar`, `Dv2ControlHost`) independent of UIA element type.
- `node app/main/palette-paste-guard.unit.test.js` — pass; verifies the initial guard precedes IME query, each IME Shift and Ctrl+V has a preceding target check, and post-paste restoration is conditional. On this Windows host, the test parses the fully composed PowerShell paste script with `System.Management.Automation.Language.Parser`.
- `node app/main/palette-gate.unit.test.js` — pass; covers Explorer and named shell process denials independent of UIA evidence.
- Every `app/main/*.unit.test.js` — pass.
- `node --check` on changed JavaScript — pass.
- `git diff --check` — pass.
- Frozen Spec SHA-256 rechecked — matches.
- `git diff --quiet 3295294b0ebcad997a56f9f5b9d1c48dbebdde2c -- docs/audits/palette-trigger-review-1.md` — pass; review report unchanged.
- Failure/repair evidence: after the guard helper changed from inline reject conditions to a reusable boolean predicate, one source assertion still expected the former `$... -ne` form and failed. The assertion now checks the pass predicate and generated-script ordering; the complete test suite then passed.
- F-003: live Windows UIA, focus-preserving palette click, ordinary Ctrl+C, stale timing, and voice workflow evidence remain pending a dedicated test agent; no GUI execution is claimed.

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

## Independent Review 2 Repairs

Scope: repair only F-004/F-005 from immutable `docs/audits/palette-trigger-review-2.md`; F-001/F-002 are retained, and frozen Plan/Spec are unchanged.

- F-004: generated guarded paste now runs `Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes -ErrorAction Stop` before defining guard functions. The unit test launches a new `powershell.exe`, verifies `AutomationElement` resolves at runtime, and invokes both guards against an impossible PID; both must fail closed.
- F-005: pre-paste `Test-V2PPasteTarget` still requires the exact selected text and editable/non-readonly state. Post-paste `RESTORE_SHIFT_IF_TARGET` now calls `Test-V2PPasteTargetIdentity`, which checks original foreground PID and focused Edit runtime identity only, so a consumed selection does not prevent IME restoration. If identity changes, restore Shift is skipped.
- `node app/main/palette-paste-guard.unit.test.js` — pass; verifies guard distinction/order, parses the composed script, and runs the fresh PowerShell runtime smoke.
- Every `app/main/*.unit.test.js` — pass.
- `node --check` on changed JavaScript — pass.
- `git diff --check` — pass.
- Frozen Spec SHA-256 rechecked — matches.
- `git diff --quiet 243a1e8d3c37a0fcee9692974edaeb0edcc9b306 -- docs/audits/palette-trigger-review-2.md` — pass; review report unchanged.
- F-003 actual Windows UIA/provider matrix, GUI paste, focus-preserving palette click, user Ctrl+C, stale timing, and voice observations remain pending the dedicated test agent. This runtime smoke is guard/type execution only, not end-to-end application evidence.

## Production Probe Point Runtime Repair

Scope: address the concrete Point runtime failure recorded in immutable `docs/TEST-REPORT-palette-trigger-fix.md`; Plan, Spec, and reports remain unchanged.

- `app/main/palette-probe.js` now explicitly loads `WindowsBase` with the UI Automation assemblies before calling `System.Windows.Point`.
- `app/main/palette-probe.runtime.test.js` builds the production probe, extracts its actual `Add-Type` line and `AutomationElement.FromPoint(New-Object System.Windows.Point(...))` line, and runs those lines in a fresh `powershell.exe`. It no longer substitutes a hard-coded legacy assembly list.
- `node app/main/palette-probe.runtime.test.js` — Point runtime passed using production-generated lines. Live fixture selection/UIA scenarios printed `BLOCKED` because the tool session could not focus the isolated fixture Edit; no provider scenario is claimed passed.
- `node app/main/palette-probe.runtime.test.js` — exit 0; generated production probe parsed and the production-loaded WindowsBase/Point/FromPoint runtime smoke passed. The isolated fixture scenario remained `BLOCKED` because the tool-session UIA desktop tree could not focus its Edit control.
- Every `app/main/*.unit.test.js` — pass (9 files).
- `node --check` on every `app/**/*.js` — pass (26 files).
- `node app/main/palette-paste-guard.unit.test.js` — pass, including fresh-process PowerShell runtime guard smoke.
- `git diff --check` — pass.
- Frozen Spec SHA-256 — matched `606830FB0DAA45A47EAE07C316204EE5F4952236AD21FB327501080C61123B50`.
- Plan, Spec, and existing review/test reports are unchanged; no `PaletteUiaFixture` process remains after the blocked test.

## Native Edit Passive Selection Repair

Scope: repair the positive selection failure reported by immutable `docs/TEST-REPORT-palette-trigger-fix.md` while retaining the WPF `0xC0000005` evidence and fail-closed behavior.

- Runtime evidence: WPF `TextPatternRange.GetText(4096)` still exits with `0xC0000005`; the production-generated probe now returns `unsupported-provider` before calling it and the child process exits normally.
- Runtime evidence: a real `CreateWindowEx("EDIT")` fixture is visible on the input desktop. The production native helper resolves both endpoint HWNDs to the same Edit, reads the 71-unit document with bounded Unicode `WM_GETTEXT`, reads selection bounds 8..56 with `EM_GETSEL`, confirms foreground/focused HWND ownership and `ES_READONLY` clear, and returns the expected 48-character text hash. The production `probeSelection()` reports provider `win32-edit`; readonly, object, window background, and cross-control cases deny.
- Runtime write-back evidence: the runtime fixture directly calls `insertText()` without model processing. A guarded paste replaces the selected range; after focus moves to a second writable Edit, another call cancels before input, leaves that Edit unchanged, and restores clipboard text. The test saves/restores clipboard text and compares supported text formats; clipboard logs contain hashes/lengths only.
- `node app/main/palette-probe.runtime.test.js` — pass; generated probe parses, WindowsBase/Point smoke passes, WPF unsupported check passes, native positive/negative matrix and guarded write-back/cancel scenarios pass. Direct WPF TextPattern diagnostic records the provider crash as unsupported evidence.
- Native fixture selected text includes Chinese characters; positive selection hash/text and post-paste replacement match the expected UTF-16 selection boundaries.
- Every `app/main/*.unit.test.js` — pass (9 files).
- `node --check` on every `app/**/*.js` — pass (27 files).
- `node app/main/palette-paste-guard.unit.test.js` — pass, including generated PowerShell parser and fresh-process guard runtime checks.
- `git diff --check` — pass.
- Frozen Spec SHA-256 — matches `606830FB0DAA45A47EAE07C316204EE5F4952236AD21FB327501080C61123B50`.
- Plan, Spec, `docs/TEST-REPORT-palette-trigger-fix.md`, and existing audit reports — unchanged.
- Failure/repair evidence: the new probe unit initially expected an earlier WPF reason phrase; the test now checks the explicit `unsupported-provider` marker used by production.
- Remaining evidence: browser editable/read-only/contenteditable, ordinary user Ctrl+C observation, recording session, IME-open state restoration, and voice recording/transcription are untested and remain with the final test agent.

## Independent Review 4 Repairs

Scope: repair only F-001/F-002 from immutable `docs/audits/palette-trigger-review-4.md`; Plan, Spec, prior audits, and test reports remain unchanged.

- F-001: native target identity now includes HWND, owner PID, UI thread ID, parent HWND, and dialog control ID. Every strict/focus check requires `IsWindow(hwnd)`, matching `ProcessId(hwnd)`, matching thread/parent/control ID, enabled writable `Edit`, a valid foreground HWND owned by the same PID, and exact GUI focused HWND. Probe rechecks identity after reading selection. The runtime fixture verifies a wrong expected owner PID is denied. It does not simulate HWND destruction followed by reuse; matching same-process/same-thread/same-parent/same-control-ID reuse remains a residual identity limitation.
- F-002: native probe returns `EM_GETSEL` start/end with selected text, verifies bounds against UTF-16 text length, and checks the selection did not move during read. Endpoint checks, palette token, pre/post-model revalidation, and the final paste guard all bind the exact range as well as the text. The native fixture selects `identical selection text` at two offsets in the same Edit; production probing observes equal text and distinct ranges, and guarded `insertText()` cancels the stale first range without changing the document.
- Production PowerShell transport moved to short-lived UTF-16 script files because the complete generated probe Base64 command exceeded the Windows command-line size limit. Paste guard expected selection text is sent over the child stdin as base64 and is absent from the temporary script; the runner removes its isolated temp directory on spawn failure, timeout, output overflow, and child completion. Probe and paste scripts are cleaned in the child callback. `app/main/powershell-file.unit.test.js` checks temp file removal, and guard tests assert dynamic selection data is absent from script contents.
- `node app/main/palette-probe.runtime.test.js` — pass on Windows: production WPF probe returns `unsupported-provider` and exits normally after the retained direct TextPattern AV evidence; native Edit confirms with all identity/range fields; wrong owner PID denies; guarded paste positive replacement passes; changed focus cancels; equal-text different-offset stale paste cancels; clipboard text/formats restore. A diagnostic showed one WPF endpoint coordinate could be occluded by Chrome, so WPF fail-closed runtime check now probes the same fixture point at both endpoints; no browser behavior is inferred.
- Every `app/main/*.unit.test.js` — pass (10 files), including Windows PowerShell parser and fresh-process guard runtime smoke.
- `node --check` on every `app/**/*.js` — pass (29 files).
- `git diff --check` — pass.
- Frozen Spec SHA-256 — matches `606830FB0DAA45A47EAE07C316204EE5F4952236AD21FB327501080C61123B50`; Plan, Spec, and existing review/test reports are unchanged.
- Remaining evidence: actual HWND destruction/reuse, browser editable/read-only/contenteditable, ordinary user Ctrl+C, recording session, IME-open restoration, focus-preserving palette interaction, and voice recording/transcription remain untested. Same-process same-thread same-parent HWND reuse cannot be fully distinguished by the current Win32 identity tuple alone.

# Palette Trigger Fix Test Report

Date: 2026-09-29
Branch: `codex/palette-trigger-fix`
Starting HEAD: `b0966c46c70d44660a2abbe0f2d644f47a8f36c5`
Retested candidate: `97f7b1c0f686922122d3ae5a9da837ed57ed4159`
Windows: `10.0.22631` (build `22631`)
PowerShell runtime: `7.6.5`
Frozen Spec SHA-256: `606830FB0DAA45A47EAE07C316204EE5F4952236AD21FB327501080C61123B50` (matched)

## Retest Revision at 97f7b1c

This revision supersedes the initial runtime status below for the current candidate. The original report is retained as evidence from commit `eb36c65`; its Point-construction failure was repaired by commit `97f7b1c`, which loads `WindowsBase`.

The generated production probe now parses and constructs `System.Windows.Point` successfully in a fresh Windows PowerShell child process. A WPF fixture was then found in the UIA tree: its HWND owner PID matched the fixture PID, `IsWindowVisible` was true, fixture and probe process were both in session `3`, and the window, current thread, and input desktop names all matched `Default`. UIA `RootElement` found 12 elements for the PID, including three `ControlType.Edit` (`50004`) TextBoxes.

The writable WPF TextBox exposed `ValuePattern` with `IsReadOnly=false`; the read-only TextBox reported `IsReadOnly=true`. The production probe returned no selection for the read-only control, object button, and window background. The positive selected-text case did not pass: a direct `TextPatternRange.GetText(100000)` call crashed its Windows PowerShell child with exit code `3221225477` (`0xC0000005`), and production `probeSelection` returned `null`. The runtime test therefore exits `1`. This records an observed provider/runtime failure, not a UIA desktop access block.

The fixture run's before/after assertion passed for foreground HWND, focused control identity, and clipboard SHA-256 digest. Selection preservation itself could not be observed because reading the selected range crashes the provider call. No clipboard write or Ctrl+C injection was performed. The fixture window/process was closed, the previous foreground window was restored without a reported failure, and no fixture process remained.

### Current AC Results

| AC | Result | Evidence and limit |
|---|---|---|
| AC-001 | Not passed; positive selection unproven | WPF hit testing and Edit identity are available, but selected-text retrieval crashes with `0xC0000005`; the palette does not receive a confirmed selection. Cross-control endpoint comparison was not reached. |
| AC-002 | Partial | Live WPF read-only, button/object, and background cases fail closed. Explorer, terminal, PDF, browser, chat/history, menu, and other provider cases remain covered only by deterministic policy or untested. |
| AC-003 | Partial | Probe leaves foreground HWND, focused-control ID, and clipboard digest unchanged during the failing positive case. Selection preservation and ordinary Ctrl+C were not observed. The test does not write the shared clipboard. |
| AC-004 | Partial | The recording gate unit test denies `recording: true`; no recording session was run. |
| AC-005 | Partial | Unit threshold cases pass; the real selected string cannot be returned due to the TextPattern crash. |
| AC-006 | Partial | Deterministic stale/concurrency guards and paste-guard runtime smoke pass. No live selection race, click/write-back, overlapping action, or IME restoration case was run. |
| AC-007 | Partial | Palette show remains click-gated in unit coverage; voice recording/transcription were not run. |
| AC-008 | Not verified | No browser editable, read-only page, or `contenteditable` runtime case was run. |

F-003 remains open. The `WindowsBase` Point defect is resolved in this candidate; the WPF TextPattern crash is new concrete runtime failure evidence. No production code was changed during this retest.

### Retest Commands

| Check | Result |
|---|---|
| Run every `app/main/*.unit.test.js` with Node | Exit `0`; 9 files, 0 failed |
| `node --check` for every `app/**/*.js` file | Exit `0`; 26 files |
| `node app/main/palette-probe.runtime.test.js` | Exit `1`; probe parse and Point runtime pass; WPF TextPattern read exits `3221225477`; read-only/object/background denials pass |
| `node app/main/palette-paste-guard.unit.test.js` | Exit `0`; generated script parses and a fresh PowerShell child resolves UIA types and executes fail-closed guards |
| `powershell.exe -NoProfile -NonInteractive -Command '$PSVersionTable.PSVersion.ToString()'` | Exit `0`; `5.1.22621.6133` (actual child used by `powershell.exe`; the report header's `7.6.5` is the invoking shell) |
| `Get-FileHash docs/SPEC-palette-trigger-fix.yaml -Algorithm SHA256` | Matched frozen hash above |
| `git diff --check` | Exit `0` |
| Check for remaining `PaletteUiaFixture` processes | None |

No external model/API call was made. No user configuration or persistent application data was accessed.

## Initial Summary (eb36c65)

The nine existing `app/main/*.unit.test.js` files pass, as do JavaScript syntax checks for 26 files, generated PowerShell parsing for the passive probe, the paste-guard parser/runtime smoke, and `git diff --check`.

The new Windows runtime test reproduces a production defect and exits `1`: with the exact UI Automation assemblies loaded by `palette-probe.js`, Windows PowerShell cannot construct `System.Windows.Point`. Adding `WindowsBase` makes that constructor and `AutomationElement.FromPoint` succeed. The production probe catches the missing-type error and reports an unconfirmed probe, so automatic selection detection fails closed. No production code was changed in this test phase.

The real-control UIA matrix remains blocked by this host session. A temporary WinForms fixture compiled and opened, but its Edit control was not visible in the session's UIA desktop tree and could not be focused; the fixture was closed and no fixture process remains. Therefore this is not evidence that the provider scenarios passed or failed. The test runner does not write the clipboard. Its optional before/after check compares only a SHA-256 digest and is skipped when the fixture cannot be focused.

## Initial Runtime Finding (superseded by retest)

`app/main/palette-probe.js` loads `UIAutomationClient` and `UIAutomationTypes`, then constructs `System.Windows.Point` for `AutomationElement.FromPoint`. On this host, a fresh PowerShell process using those same assembly loads emitted `POINT_FAIL_WITH_PRODUCTION_LOAD`. With `Add-Type -AssemblyName WindowsBase` added, it emitted `POINT_OK_WITH_WINDOWBASE`. `ValuePattern.Pattern` and `TextPattern.Pattern` type lookups both succeeded, but actual provider support was not established because the test fixture could not be reached through UIA.

The production script catches the point-construction exception and returns `{ ok = false; reason = 'probe-failed' }`; `parseProbeOutput` turns that into `null`. This is a concrete fail-closed regression in the candidate. The runtime regression is preserved in `app/main/palette-probe.runtime.test.js`. Repair should be handled in the production-change phase, then this test and the live control matrix should be rerun.

## Initial Acceptance Evidence

| AC | Result | Evidence and limit |
|---|---|---|
| AC-001 | Partial; runtime blocked | Gate tests accept only confirmed non-empty selections and reject unconfirmed input; threshold unit cases pass. The positive native Edit runtime case could not be exercised. The Point runtime failure would prevent the production probe from confirming it on this host. |
| AC-002 | Partial; runtime not covered | Unit tests deny Explorer and listed shell, terminal, and PDF processes; unconfirmed probe output fails closed. Desktop, files/objects, menus, read-only documents, browser pages, chat history, and terminal controls were not exercised as live UIA providers. |
| AC-003 | Partial; observation not covered | Source review confirms the passive probe does not synthesize input, access the clipboard, set focus, or change selection. No ordinary Ctrl+C observation was made. The runtime fixture test does not write the shared clipboard; the optional runtime comparison hashes its contents instead of printing them. |
| AC-004 | Partial; runtime not covered | Gate unit test denies `recording: true`; no real recording session was started. |
| AC-005 | Partial | Unit tests cover missing/unconfirmed/empty text and below/at/above threshold decisions. A real selected string could not reach the production probe because of the Point runtime failure and fixture access block. |
| AC-006 | Partial; runtime not covered | Deterministic tests cover selection IDs, concurrency guards, revalidation ordering, and generated paste-guard execution against an impossible process ID. No live palette click, selection/target race, concurrent action, write-back, or IME restoration was exercised. |
| AC-007 | Partial; voice runtime not covered | Palette tests confirm the show event does not start model processing; renderer and pet-state unit regressions pass. Voice recording/transcription were not run. |
| AC-008 | Not verified | Browser `contenteditable`, read-only page text, and unsupported browser selection providers were not exercised. |

The F-003 release evidence gap remains open. The runtime finding above is separate concrete failure evidence; it does not close the untested provider, gesture, clipboard-copy, race, palette-focus, and voice scenarios.

## Initial Commands

| Check | Result |
|---|---|
| Run every `app/main/*.unit.test.js` with Node | Exit `0`; 9 files, 0 failed |
| `node --check` for every `app/**/*.js` file | Exit `0`; 26 files |
| `node app/main/palette-probe.runtime.test.js` | Exit `1`; generated probe parses, Point runtime assertion fails, live fixture scenario reports blocked |
| `node app/main/palette-paste-guard.unit.test.js` | Exit `0`; generated script parses and fresh PowerShell process resolves UIA types and executes fail-closed guards |
| `Get-FileHash docs/SPEC-palette-trigger-fix.yaml -Algorithm SHA256` | Matched frozen hash above |
| `git diff --check` | Exit `0` |
| Check for remaining `PaletteUiaFixture` processes | None |

No external model/API call was made. No user configuration or persistent application data was accessed. The test window and temporary executable were removed after the run.

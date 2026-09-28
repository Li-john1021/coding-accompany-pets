# Palette Trigger Fix Test Report

Date: 2026-09-29
Branch: `codex/palette-trigger-fix`
Starting HEAD: `b0966c46c70d44660a2abbe0f2d644f47a8f36c5`
Windows: `10.0.22631` (build `22631`)
PowerShell runtime: `7.6.5`
Frozen Spec SHA-256: `606830FB0DAA45A47EAE07C316204EE5F4952236AD21FB327501080C61123B50` (matched)

## Summary

The nine existing `app/main/*.unit.test.js` files pass, as do JavaScript syntax checks for 26 files, generated PowerShell parsing for the passive probe, the paste-guard parser/runtime smoke, and `git diff --check`.

The new Windows runtime test reproduces a production defect and exits `1`: with the exact UI Automation assemblies loaded by `palette-probe.js`, Windows PowerShell cannot construct `System.Windows.Point`. Adding `WindowsBase` makes that constructor and `AutomationElement.FromPoint` succeed. The production probe catches the missing-type error and reports an unconfirmed probe, so automatic selection detection fails closed. No production code was changed in this test phase.

The real-control UIA matrix remains blocked by this host session. A temporary WinForms fixture compiled and opened, but its Edit control was not visible in the session's UIA desktop tree and could not be focused; the fixture was closed and no fixture process remains. Therefore this is not evidence that the provider scenarios passed or failed. The test runner does not write the clipboard. Its optional before/after check compares only a SHA-256 digest and is skipped when the fixture cannot be focused.

## Runtime Finding

`app/main/palette-probe.js` loads `UIAutomationClient` and `UIAutomationTypes`, then constructs `System.Windows.Point` for `AutomationElement.FromPoint`. On this host, a fresh PowerShell process using those same assembly loads emitted `POINT_FAIL_WITH_PRODUCTION_LOAD`. With `Add-Type -AssemblyName WindowsBase` added, it emitted `POINT_OK_WITH_WINDOWBASE`. `ValuePattern.Pattern` and `TextPattern.Pattern` type lookups both succeeded, but actual provider support was not established because the test fixture could not be reached through UIA.

The production script catches the point-construction exception and returns `{ ok = false; reason = 'probe-failed' }`; `parseProbeOutput` turns that into `null`. This is a concrete fail-closed regression in the candidate. The runtime regression is preserved in `app/main/palette-probe.runtime.test.js`. Repair should be handled in the production-change phase, then this test and the live control matrix should be rerun.

## Acceptance Evidence

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

## Commands

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

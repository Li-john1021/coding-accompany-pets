# Palette Trigger Fix Final Test Report

Date: 2026-09-29  
Branch: `codex/palette-trigger-fix`  
Starting HEAD: `a5642b74f0b65faa1faff6832330e9e65e5b6dce`  
Frozen Spec SHA-256: `606830FB0DAA45A47EAE07C316204EE5F4952236AD21FB327501080C61123B50` (matched)

## Test Evidence

| Check | Result | Evidence type |
|---|---|---|
| `node app/main/palette-probe.runtime.test.js` | Passed before Ctrl+C augmentation; two later reruns exited 1 before the Ctrl+C step | The earlier standalone run exercised the real Windows fixtures and confirmed native Edit selection, collapsed-selection rejection, wrong-owner rejection, same HWND at both endpoints, cross-control/read-only/object/background rejection, guarded write-back, focus-change cancellation, equal text at changed offsets cancellation, and clipboard restoration. After adding real Ctrl+C observation, two runs stopped earlier because the visible native fixture Edit did not retain keyboard focus (`focus-mismatch`); neither reached nor sent Ctrl+C. |
| All `app/main/*.unit.test.js` | Exit 0; 11 files | Unit/simulated, including PowerShell guard parser and fresh child-process smoke. Added `palette-trigger-contract.unit.test.js` covers threshold boundaries, recording gate, unsupported providers, passive-path mutation absence, Ctrl+C non-interception in the hook, and explicit-button processing contract. |
| `node --check` for all `app/**/*.js` | Exit 0; 30 files | Static syntax check. |
| `git diff --check` | Exit 0 | Whitespace check. |
| Spec hash check | Matched frozen hash above | Integrity check. |
| Fixture process cleanup | No `PaletteUiaFixture` or `PaletteNativeEditFixture` process remained | Runtime cleanup check. |

Clipboard comparison in the probe checks only a digest and never prints clipboard text. The guarded write-back runtime test uses the shared clipboard only after validating its contents/formats, then restores the original text and supported text formats. The new Ctrl+C runtime path sends the shortcut only after a safe-format clipboard snapshot and a focused-fixture request; it checks only a digest and restores the original text/formats in `finally`. On the two latest runs, the earlier focus assertion failed before this path, so no Ctrl+C key or clipboard write occurred. No external model/API was used.

## Acceptance Criteria

| AC | Result | Evidence and limits |
|---|---|---|
| AC-001 | Partial, native path passed | Real native Win32 Edit selection passes; empty selection, different Edit, read-only Edit, button/object, and window background are denied. The fixture uses explicit points rather than exercising a physical left-button drag. Native Edit is the only supported control class. |
| AC-002 | Partial | Shell/terminal/PDF process denials and failed/unconfirmed probe behavior are unit-tested; native read-only/object/background and WPF UIA-only denial were observed live. Explorer file selection, menus, chat/history, PDF, terminal, and browser read-only windows were not separately exercised as live targets. |
| AC-003 | Partial; real Ctrl+C unverified | Live passive-probe snapshots showed foreground/focus identity and clipboard digest unchanged; source/static checks find no synthetic input, clipboard access, focus change, or selection mutation in the passive probe. The key hook observes Ctrl+C without prevention calls. A real fixture Ctrl+C check is implemented with digest-only assertion and clipboard restoration, but two recent GUI runs lost fixture Edit focus before reaching it. |
| AC-004 | Partial | Recording denial is covered in gate unit tests and the late-probe completion guard is source-checked. No live recording session was active during a GUI selection. |
| AC-005 | Passed for native Edit and deterministic gate | Runtime confirmed a collapsed selection is rejected before eligibility. Unit tests cover missing/unconfirmed/empty, below threshold, exactly threshold, and above threshold. The runtime selected text passes at configured threshold and fails at a higher threshold. |
| AC-006 | Partial | Real fixture write-back replaced the selected range; changed focus and same text at different offsets canceled. Unit/source guards cover overlapping actions, revalidation around model work, and show/dismiss being click-gated. No external model was called; a live async model race or IME-open write-back was not exercised. |
| AC-007 | Partial | Existing palette UI unit checks pass and verify explicit-mode submission. Source diff is limited to tests/fixture/report. Voice recording and transcription workflows were not run in the application. |
| AC-008 | Not verified at browser runtime | WPF/UIA-only selection is positively observed to fail closed, and static parsing rejects UIA/browser provider evidence. Browser editable inputs, `contenteditable`, and read-only page text were not opened or exercised. Current compatibility scope documents browser inputs as unsupported. |

## Remaining Limits

The fixture uses real Windows controls and production probing/write-back code but does not synthesize a user drag. The Ctrl+C path is implemented but remains unverified because the native Edit lost keyboard focus on both recent attempts; the test aborted before sending the key. Browser, recording-session, voice, and IME-open behavior also remain unverified. The known HWND reuse limitation remains: a destroyed/reused HWND with the same process/thread/parent/control ID, same text, and same range cannot be distinguished by the current identity tuple. No production implementation files were changed in this test phase.

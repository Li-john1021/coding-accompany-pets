# Pet Actions v3 Approval Ledger

Status: Windows v1 implementation approved. This ledger records product decisions and freezes the approved v3 Spec revision; it does not claim that any host integration is already compatible.

## Approved artifacts

| Artifact | Commit | Frozen content identity |
|---|---|---|
| `docs/PLAN-pet-actions-v3.md` | `84ff4187149314bde2899e1fc6de637809b79280` | Approval plan commit |
| `docs/SPEC-pet-actions-v3.yaml` | `6da4a95b85992dca3c342f3f674c7bfb134e553f` | Git blob SHA-1 `81c63d6cc8a6c9a971338eb7f350b8ca4ee0ba0b`; SHA-256 `21eabf0e8c2f896aaf78531926d57ea146dc22f4dbd4705353e83c027a1665ef` |

The Spec content hashes identify the committed Git blob at the Spec commit, independent of working-tree line-ending conversion. Later changes must create a new approved Spec revision and ledger entry rather than altering this frozen revision in place.

## Approval evidence

- The user explicitly authorized updating the Plan and Spec to `approved-for-Windows-implementation` / `approved`, resolving DEC-002 and DEC-003 using the bounded clipboard and Windows host policies, and recording the frozen Spec hash in a separate ledger.
- The user selected the DEC-001 policy asynchronously: when an action click yields fresh non-empty clipboard text but selection semantics cannot be proved, display a short preview marked unverified and require a second click on the same action button before calling the model.
- Approval is limited to Windows v1 implementation. It does not authorize compatibility claims for any particular application/control before named runtime validation, nor macOS/Linux implementation claims.

## Resolved decisions

| Decision | Approved rule |
|---|---|
| DEC-001: unverified selection | Proven fresh non-empty selection may proceed after one click. Otherwise, only a fresh non-empty clipboard change within the explicit bounded capture window can open a short preview. Mark it `selection unverified`; require the same mode button a second time. Expiration, clipboard change, mode/target change, or voice recording/transcription cancels it. Clipboard content never proves selection by itself. |
| DEC-002: clipboard ownership | Copying source text after an explicit action click is intentional. On model failure, leave that source text on clipboard. Do not promise lossless restoration of arbitrary prior rich clipboard formats. Before output write-back, compare ownership/version; if user clipboard data changed, preserve it and leave the result in the app preview/copy path for explicit copy. |
| DEC-003: Windows host policy | Ordinary non-terminal text hosts, including webpage and IDE editor candidates, use Ctrl+C after an action click, then proven-selection one-click or fresh-copy preview confirmation. Windows Terminal and conhost use their host-specific chord only when the adapter can establish safe capture; otherwise require manual copy and a fresh preview. VS Code integrated terminal and unknown terminals use manual copy by default. These remain candidates until tested individually. |

## Scope guard

The three equal-width controls are Structure, Optimize, and disabled Image Recognition. Legacy automatic drag/double-click palette behavior must be disabled even for existing `paletteEnabled=true` configuration, while mouse side-button recording remains available. Results are copied only when the captured clipboard ownership is still current; no automatic paste or source replacement is authorized. macOS/Linux are architecture targets only. Host compatibility remains evidence-gated.

## Stage commits

| Stage | Commit | Content |
|---|---|---|
| Initial v3 Plan draft | `8524bbe99b43f9825168e5e3b5a23e2112725a7b` | Initial unapproved Plan; retained as history |
| Initial v3 Spec draft | `f0fcda68f20f7c17e215157a04285d9834f66f14` | Initial pending Spec; retained as history |
| Approved Plan | `84ff4187149314bde2899e1fc6de637809b79280` | Resolved policy and Windows implementation boundary |
| Approved frozen Spec | `6da4a95b85992dca3c342f3f674c7bfb134e553f` | Approved requirements and acceptance criteria |
| UNIT-1: Pet action UI and config migration | `b578ef282ceb54b67763df0fc3e27d5d4fce8335` | Three-button row and fail-closed action states; `paletteEnabled` migration and retired automatic trigger; mouse side-button route retained |
| F-001 repair | `3f6acb088fd58c5446442e65a9913fc41d60fa38` | Hold recording now stops when the body gesture releases over the action row; unpaired button release remains inert |
| UNIT-2: Host-aware capture contract and adapters | `9f30bcfe0985611dcf49dd07e458d68586cd5bc8` | Typed capture authorization/preview gate, Windows foreground and clipboard sequence snapshot, conservative host policy, and bounded cancellation |

## UNIT-1 Evidence

- Focused checks passed: `pet-actions-ui.unit.test.js`, `palette-trigger-contract.unit.test.js`, `pet-status.unit.test.js`, and `palette-action-guards.unit.test.js`.
- `node --check` passed for changed JavaScript files; `git diff --check` passed.
- The Electron runtime is not installed in this checkout, so desktop visual review and overlap confirmation were not performed.
- Structure and Optimize currently return a visible fail-closed placeholder response. No capture adapter, model call, clipboard operation, host compatibility, or end-to-end action is claimed by UNIT-1.
- F-001 regression checks exercise row release during hold recording, an action-row mouseup without a preceding pet-body mousedown, click-mode row and body releases, hold-mode settings click, and drag release cleanup.
- The frozen Spec remains unchanged at SHA-256 `21eabf0e8c2f896aaf78531926d57ea146dc22f4dbd4705353e83c027a1665ef`.

## UNIT-2 Evidence

- The capture gate returns typed `authorized`, `preview`, `rejected`, or `cancelled` results. Only a focused, non-empty native Win32 Edit selection with stable target identity is directly authorized. Ordinary copy text requires a changed Win32 clipboard sequence and non-empty text; a changed sequence with equal text remains unverified and requires the same mode button a second time.
- Automatic Ctrl+C is limited to process-name candidates `Notepad`, `Notepad++`, `WordPad`, `WINWORD`, `EXCEL`, and `POWERPNT`. These are implementation candidates only and have no named runtime compatibility claim. Browser processes, all VS Code windows, other IDEs, Windows Terminal, conhost, and unknown/custom hosts use a bounded manual-copy window. In particular, browsers and IDEs are not guessed to be ordinary text controls because embedded terminals cannot be classified reliably here. No Windows Terminal or conhost chord is currently sent; the adapters have no terminal selection proof to establish safe injection.
- Manual-copy capture prompts while its 10-second action window is open. A fresh non-empty text change opens an unverified short preview; same-button confirmation is accepted only while the target and clipboard sequence are unchanged and voice is idle. A bounded 10-second monitor cancels pending state on target, clipboard, voice, or expiry changes. Capture does not call a model, write output clipboard text, or paste.
- Passed focused checks: `pet-action-capture.unit.test.js`, `pet-actions-ui.unit.test.js`, `palette-trigger-contract.unit.test.js`, `palette-probe.unit.test.js`, `palette-action-guards.unit.test.js`, and `palette-run-guards.unit.test.js`; changed JavaScript passed `node --check`; `git diff --check` passed.
- Windows foreground snapshot smoke passed for the current `Qoder CN` foreground window and returned an HWND/focus identity plus clipboard sequence without reading clipboard text. The positive/empty native Edit runtime fixture compiled and launched, but Windows denied the fixture foreground switch; both positive/negative selection assertions were therefore blocked. No copy chord or clipboard mutation was attempted. The active-copy runtime path remains unverified.
- This unit does not establish compatibility for the allowlisted applications, browsers, VS Code, IDEs, or terminals. The separate Windows host validation unit remains outstanding. The frozen Spec remains unchanged at SHA-256 `21eabf0e8c2f896aaf78531926d57ea146dc22f4dbd4705353e83c027a1665ef`.

## UNIT-3 Evidence

- Code commit: `c5cda3a` (`feat: connect pet actions to text pipeline`). The main-process workflow passes only the capture gate's non-empty, mode-matched authorization token text into `pipeline.processText` for the selected Structure or Optimize mode. Invalid, canceled, stale, empty, unsupported, concurrent, or voice-busy actions make no model call. A voice-busy transition detected after capture authorization also blocks processing.
- A non-empty result is copied only when the current Windows clipboard sequence still matches the sequence recorded by capture. Pipeline errors, empty results, degraded results, and results returned under a different mode do not overwrite the source clipboard. A changed/unavailable clipboard or rejected write retains the full successful output in the existing preview window's result-only mode; its only output action is explicit copy. No paste or source replacement is invoked.
- Mock-only workflow coverage passed for Structure/Optimize routing, unverified preview/no model call, invalid and consumed authorization, voice state, concurrency, empty/degraded/mismatched results, changed clipboard sequence, write rejection, and explicit result-copy fallback. Capture gate and UI action tests also passed.
- All `app/main/*.unit.test.js` tests passed. Every `app/**/*.js` passed `node --check`; `git diff --check` passed. The frozen Spec SHA-256 remains `21eabf0e8c2f896aaf78531926d57ea146dc22f4dbd4705353e83c027a1665ef`.
- Electron is absent from this checkout (`app/node_modules/electron` is missing and Node cannot resolve `electron`), so desktop runtime and visual verification were not performed. UNIT-4 must handle clean-context desktop validation and independent review. No named host/control compatibility is claimed.

## UNIT-3 Repair Evidence (F-001 / F-002)

- Code repair commit: `a7e1046` (`fix: guard pet action clipboard and voice races`). The result path no longer does an asynchronous sequence snapshot followed by `clipboard.writeText`. A Windows native helper allocates movable global memory, prepares Unicode text before opening the clipboard, then uses a valid hidden WinForms owner HWND and performs `OpenClipboard`, `GetClipboardSequenceNumber`, comparison, `EmptyClipboard`, and `SetClipboardData(CF_UNICODETEXT)` under the same clipboard lock. All unsuccessful paths close the clipboard and free memory not transferred to Windows. Result text is passed as base64 through stdin, not embedded in the helper script or logged. The result-only preview remains the fallback when the sequence mismatches or the native write fails.
- Deterministic workflow tests inject a clipboard change at the conditional-writer boundary and assert no write occurs and the result remains in explicit-copy preview. Script contract checks assert the owner is non-null, sequence comparison is under the lock and precedes EmptyClipboard/SetClipboardData, and GMEM_MOVEABLE is used. A Windows PowerShell runtime smoke passed both the mismatch/no-write case and the matching write case; it backed up only recognized text-family formats, wrote a test marker, conditionally restored the original plain-text value, and did not print the original clipboard text. Arbitrary format restoration is not claimed.
- Voice starts now advance a workflow epoch and cancel pending native clipboard writer processes from global hotkey, side-button, renderer recording-start, and audio-submit routes. Text model completions from an earlier epoch return canceled before clipboard publication or preview. Pet renderer completion handling preserves active voice state and ignores results superseded by a voice start, including a voice startup that subsequently fails.
- Deferred-model tests start voice while `processText` is pending, resolve the model afterward, and assert no clipboard write or preview. Writer cancellation, renderer state guards, capture gate, and action UI tests passed. All `app/main/*.unit.test.js` passed; every `app/**/*.js` passed `node --check`; `git diff --check` passed.
- Frozen Plan and Spec are unchanged. The Spec SHA-256 remains `21eabf0e8c2f896aaf78531926d57ea146dc22f4dbd4705353e83c027a1665ef`. Electron remains unavailable, so live pet UI/IPC visual interaction was not validated. Browser/IDE/terminal policy was not changed and no host compatibility claim is added.

## UNIT-3 Repair Evidence (Model Review 2)

- Code repair commit: `32770f1` (`fix: fail closed on zero clipboard sequence`). The JavaScript writer rejects expected sequence `0` without starting PowerShell. The native helper independently rejects expected sequence `0`, and after opening the clipboard rejects observed `GetClipboardSequenceNumber() == 0` before any `EmptyClipboard` call. The workflow unit checks both generated native guard order and the mock zero-input refusal; the Windows runtime smoke invokes the native helper with expected sequence zero and verifies it returns `unavailable`, then reruns mismatch and matching write/restore cases.
- Renderer action settlement now records a local voice epoch and routes both resolved and rejected IPC promises through a shared settlement guard. If listening/transcribing is active or the voice epoch advanced while the action was pending, the completion does not show a text error or set the pet state to idle. A deterministic rejected-promise test starts voice before rejecting the IPC promise and confirms the stale failure is ignored; an ordinary rejection still reports failure.
- All `app/main/*.unit.test.js` passed, including the new renderer rejection test. Every `app/**/*.js` passed `node --check`; `git diff --check` passed. The frozen Spec SHA-256 remains `21eabf0e8c2f896aaf78531926d57ea146dc22f4dbd4705353e83c027a1665ef`.
- Clipboard write remains conditional but is not a lossless transaction: if `EmptyClipboard` succeeds and `SetClipboardData` fails, the previous clipboard content may already be gone. The helper closes the clipboard and frees memory not transferred to Windows; the successful model output remains in the result-only preview for explicit copy. No guarantee is made that the source clipboard value survives this native failure path or that arbitrary previous formats can be restored.
- Electron remains unavailable, so live renderer/IPC interaction was not exercised. Browser/IDE/terminal host policy and claims are unchanged. The Plan, Spec, and prior audit reports remain untouched.

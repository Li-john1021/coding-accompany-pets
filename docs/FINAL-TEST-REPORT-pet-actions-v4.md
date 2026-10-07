# Pet Actions v4 Final Test Report

Date: 2026-10-07 (Asia/Shanghai)
Base under test: `codex/palette-input-sources` at `a6bb3819d30ec518566fd8a10a0a00faf4b03a13`.
Test addition: `d43e2550bb3e8457ed3badf8e5eb70ee05c81ec3` (`app/main/pet-actions-v4.e2e.test.js`).
Approved Spec SHA-256: `25b6fff0287f66f36241d8de4993ecc6692a48661a95e670cf023dc312cb785e` (matched).

## Acceptance Results

| Check | Evidence and result | Real versus simulated |
|---|---|---|
| AC-001 | PASS. The isolated Electron E2E selects text in an ordinary host and confirms selection alone neither copies nor calls the model. One production pet button click then reaches the action workflow. The pet window is non-focusable; the source window retains focus. | Real Electron windows, production `pet.html`, renderer, preload and IPC; mouseDown/mouseUp are sent through Electron `webContents.sendInputEvent`. Model response only is mocked. |
| AC-002 | PASS. The real host's selected text reaches the mock exactly. The empty-selection action leaves a pre-existing clipboard sentinel untouched and causes zero model calls. Existing capture unit coverage also exercises empty copied text, unchanged sequence, equal text on a new sequence, ordinary host routing, and stable owner checks. | Real ordinary Electron host selection, Windows Ctrl+C injection through production uIOhook, PowerShell foreground/clipboard snapshots, and OS clipboard. Other capture edge cases are adapter/unit fixtures. |
| AC-003 | PASS. Normal Structure and Optimize results, raw degraded output, degraded fallback output, and a delayed result after a second clipboard copy are checked against the actual system clipboard. The delayed result wins. Existing workflow tests cover empty output, processing exception, and clipboard-write exception. | Result publication and mid-flight clipboard change are real Electron system clipboard writes. Model outputs are deterministic mocks. Empty/error/write-failure cases use unit workflow adapters; OS write failure itself was not injected. |
| AC-004 | PASS for the requested routing regression. Existing `pet-action-capture.unit.test.js` calls production `sendWindowsCopy` and records the exact key/modifier tuples: ordinary Ctrl+C, Windows Terminal Ctrl+Insert, and conhost Ctrl+Insert; it also checks the separate Ctrl+Shift+C terminal route. | The ordinary Ctrl+C chord was exercised end-to-end against a real isolated Electron host. Terminal/conhost routes were enumerated with a keyTap recorder, not sent to real terminal windows. Real Windows Terminal and conhost runtime behavior remains untested. |
| AC-005 | PASS. E2E verifies the three production controls, disabled image placeholder, unchanged source value, retained source focus, and no auto-paste. Main workflow/UI unit tests cover busy/concurrent isolation and voice exclusion. | The control row, source preservation, focus, and manual-paste behavior were checked in real Electron windows. Voice and overlapping-action guards use unit tests. |

## Commands

All commands below exited `0` on Windows:

- `node app/main/pet-actions-v4.e2e.test.js` — real Electron ordinary-host to production action to system-clipboard flow.
- `Get-ChildItem app/main -Filter *.unit.test.js | ForEach-Object { node $_.FullName; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }` — all app/main unit tests.
- `node app/renderer/pet-live2d.unit.test.js` — renderer Live2D regression.
- `node app/main/pet-action-capture.runtime.test.js` — capture adapter runtime fixture.
- `node app/main/pet-action-clipboard.runtime.test.js` — direct publication path check.
- `git ls-files | Where-Object { $_ -like '*.js' -and $_ -like 'app/*' }` with `node --check` for each tracked JavaScript file, plus `node --check app/main/pet-actions-v4.e2e.test.js` — syntax checks.
- `git diff --check` — whitespace validation.
- `Get-FileHash docs/SPEC-pet-actions-v4.yaml -Algorithm SHA256` — matched frozen Spec hash above.

The E2E fixture used an isolated temporary `userData` directory and a synthetic configuration with empty provider lists. It replaced only `pipeline.processText`; production main, pet renderer, preload, IPC, capture adapters, PowerShell snapshot, uIOhook copy request, and Electron OS clipboard APIs remained active. No provider was contacted and no existing Voice2Prompt window or user configuration was used. The fixture restores clipboard text, HTML, RTF, and image data from an in-memory snapshot and removes its temporary profile.

## Runtime Boundary

The named real host/control pair validated here is an ordinary Electron BrowserWindow with a read-only textarea and Ctrl+C. This is evidence for an ordinary Windows GUI host, not a compatibility claim for Chrome, Edge, Firefox, an IDE, Windows Terminal, or conhost. Windows Terminal and conhost were verified only through the production chord-routing function's recorded calls. Linux/macOS remain untested. Provider behavior is outside this run because the only model response was mocked. OS clipboard write failure reporting is covered by the workflow unit adapter, not by forcing a real system clipboard failure.

# Pet Actions v4 Approval Ledger

Status: approved for Windows implementation. This independent ledger freezes the v4 Plan/Spec evidence; it is not implementation or runtime validation evidence.

## Frozen inputs

| Item | Identity |
|---|---|
| Base branch and commit | `codex/palette-input-sources` at `ed53cf25e67f817494c36653d8420f784539c6e6` |
| Pre-edit worktree | Clean at the base commit |
| Approved Plan | `docs/PLAN-pet-actions-v4.md`; frozen in this documentation commit |
| Spec | `docs/SPEC-pet-actions-v4.yaml`; SHA-256 recorded below |
| Approval evidence | Current task-thread user message confirming the interaction recap and authorizing document correction; exact approved decisions are transcribed in the v4 Plan |

## Spec content identity

SHA-256: `25b6fff0287f66f36241d8de4993ecc6692a48661a95e670cf023dc312cb785e`

Hash command: `Get-FileHash -Algorithm SHA256 docs/SPEC-pet-actions-v4.yaml`.

## Scope

The approval froze v4 planning artifacts and authorized Windows implementation. Linux/macOS shortcuts remain unverified design context. Runtime host support requires named evidence in the implementation record below. Historical v3 records are not edited.

## Implementation Record

Status: implemented; named Windows host runtime validation remains pending.

| Unit | Commit | Result |
|---|---|---|
| Capture | `e92b388850791bdaf154272cb3a6de7b163cbf2c` | One-click copy request; ordinary windows use Ctrl+C, Windows Terminal/conhost/console-focus use Ctrl+Insert, recognized independent terminals use Ctrl+Shift+C. Clipboard text is read in the same PowerShell snapshot as a stable sequence check. |
| Workflow and UI | `c43f2afa1c3624368692924ab47918ecb68b6e94` | Every non-empty pipeline return is written through Electron `clipboard.writeText`; degraded/raw/fallback results are accepted. Manual preview/confirmation UI and clipboard ownership writer were removed from the active path. |

## Automated Evidence

- All `app/main/*.unit.test.js` passed, including capture freshness/host routing, workflow result classes, voice isolation, pet UI, and existing palette tests.
- `app/main/pet-action-clipboard.runtime.test.js` passed its static check that the active pet action path uses direct clipboard writing.
- `app/renderer/pet-live2d.unit.test.js` passed.
- `node --check` passed for every Git-tracked JavaScript file under `app/`.
- `git diff --check` passed. The approved Spec hash remains `25b6fff0287f66f36241d8de4993ecc6692a48661a95e670cf023dc312cb785e`.

## Runtime Boundary

No copy key was sent to a user window and no real model request was made. Windows Terminal, conhost, Chrome/Edge/Firefox, VS Code/Cursor/Qoder, and an unknown ordinary app still require named runs in isolated test windows. The implementation does not claim runtime compatibility for Linux or macOS.

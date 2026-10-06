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

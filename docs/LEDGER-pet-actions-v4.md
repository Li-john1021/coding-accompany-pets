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

Only v4 planning artifacts are introduced. No production code is changed. The approval authorizes Windows implementation; Linux/macOS shortcuts remain unverified design context. Runtime host support requires named evidence in the implementation ledger. Historical v3 records are not edited.

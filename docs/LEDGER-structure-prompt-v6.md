# Structure Prompt v6 Ledger

Status: planning documents prepared; implementation has not started.

## Frozen inputs

| Item | Identity |
|---|---|
| Branch and base | `codex/palette-input-sources` at `89d61c29d96cb149077a323b571b8b75ccc54ae7` |
| Merge base with origin/main | `a9bc8555446ef4ac8c491952633d02e86e8f12dd` |
| Pre-edit worktree | Clean at base; no ignored evidence inspected or changed |
| Approval evidence | User task instruction dated 2026-10-09, recorded in `docs/PLAN-structure-prompt-v6.md` |
| Baseline prompt | `bd52106c7723006ddcc2a56268d9d17377571fe6:app/main/config.js`, `STRUCTURE_ONLY_PROMPT` lines 77-88 |
| Current input contract | `app/main/text-prompts.js` `sourceMessage(text)` JSON source; structure routing in `app/main/pipeline.js` |
| Plan | `docs/PLAN-structure-prompt-v6.md` |
| Frozen Spec | `docs/SPEC-structure-prompt-v6.yaml` |

## Planning checks

- Read the long-task-loop-quality skill and its Spec Compiler and loop prompt template references.
- Confirmed the target worktree is on the named branch and exact base commit; `.codegraph/` is absent.
- Scope is prompt-only. No production code, tests, provider/model/ASR/key/profile access, GUI automation, or live prompt evaluation has occurred in this documentation phase.
- The Spec maps each requirement to an acceptance check and records dependencies, assumption, invariants, forbidden effects, implementation unit, validation boundary, and release limit.
- The existing v5 evaluation budget is exhausted; its artifacts are historical and must not be changed.

## Content hashes

Plan SHA-256: `35A09E7F6AABC2FD765C94C3A1D7FFCE2070014E6B85BD47B8BE3D8D4306C524`.
Spec SHA-256: `587E3CBBC142652D719B7B779B4ABF83255E86F6F885E3E15964FDF3C4B0A1D0`; frozen for implementation.

Hash command: `Get-FileHash -Algorithm SHA256 docs/PLAN-structure-prompt-v6.md, docs/SPEC-structure-prompt-v6.yaml`.

## Handoff

This documentation-only change is to be committed separately. After the root agent reads the frozen Plan and Spec, implementation may proceed as WU-001 under this contract. No merge, push, release, or portable-app restart is authorized.

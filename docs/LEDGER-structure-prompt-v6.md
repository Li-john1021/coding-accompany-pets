# Structure Prompt v6 Ledger

Status: WU-001 implemented in candidate commit `c2b43c000b9dd0163f1f3c50dc5e62ca89efeb06`; deterministic checks passed. Independent review and clean tester remain pending.

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

The planning documents were committed separately as `ec2eac66fd1d27758483a5d7c726c9407bcc4a80`. WU-001 candidate work is committed separately; the next action is independent review followed by the clean tester. No release action is part of this handoff.

## WU-001 implementation record

| Item | Result |
|---|---|
| Candidate commit | `c2b43c000b9dd0163f1f3c50dc5e62ca89efeb06` (`feat: restore main structure prompt behavior`) |
| Scope | Restored the Main baseline as the exact structure-prompt prefix; appended short context-sensitive cleanup and JSON source instructions; updated the v5 config prompt assertion; added shared synthetic cases and an actual pipeline mock-routing test. |
| Prompt file SHA-256 | `B619B25320DDB5385D2BD2A9E37EBD297CA046549167D4A3F1FFA4CB9E528CD5` (`app/main/text-prompts.js`) |
| Provider/model/ASR/key/profile/GUI access | 0; no live evaluation was run. The pipeline test made five mocked `chatCompletion` invocations. |
| Prompt quality | Not live evaluated; no semantic quality claim. |

Checks run (all exit 0):

- `node app/main/pet-actions-v5-config.unit.test.js` — config round-trip and default-prompt contract passed.
- `node app/main/structure-prompt-v6-pipeline.unit.test.js` — five synthetic inputs each routed once with the structure system prompt and JSON source; mock transport only.
- `node app/main/pipeline-delivery.unit.test.js` — existing deferred voice/pipeline JSON-source checks passed.
- `node app/main/palette-run-guards.unit.test.js` — retired trigger guard passed.
- `node app/main/palette-busy.unit.test.js` — busy/mode guards passed.
- `node --check` on `text-prompts.js`, the updated config test, and both new synthetic fixture/pipeline test files — passed.
- `git diff --check 89d61c29d96cb149077a323b571b8b75ccc54ae7..HEAD` — passed.

The candidate commit changes only the structure prompt and its focused tests/fixture. `DEFAULT_PROMPT`, `sourceMessage`, pipeline implementation, models/config, UI fallback, and v5 live-evaluation artifacts are unchanged. This record is separate from the candidate commit; independent review and clean testing must be recorded after they occur.

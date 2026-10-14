# Pet Actions v5 Planning Ledger

Status: approved Plan and compiled Spec frozen for implementation. No implementation, provider call, prompt evaluation, or runtime test has been performed in this documentation cycle.

## Frozen inputs

| Item | Identity |
|---|---|
| Base branch and commit | `codex/palette-input-sources` at `48c555e5467fe27ebe061a30cc90d5200042b885` |
| Pre-edit worktree | Clean at the base commit |
| Approval evidence | Current user task message explicitly authorizing the v5 settings, prompt, undo, terminal, voice, validation and documentation requirements; recorded in `docs/PLAN-pet-actions-v5.md` |
| Approved Plan | `docs/PLAN-pet-actions-v5.md` |
| Compiled Spec | `docs/SPEC-pet-actions-v5.yaml` |
| Current pointer | `docs/CURRENT-pet-actions.md` |
| Research dependency | `docs/RESEARCH-prompt-quality-v5.md` (research only; not evidence of prompt improvement) |

## Content identities

Plan SHA-256: `51361A1A30D0EB4B14C67620E89FCC59FB510E4617E702C0FCB1E311CAFC5DDB`
Spec SHA-256: `1A00857FC1AA9E6896C1B865A82C2315A36E7338113652ED2EB704FA3C95D125`

Hash command: `Get-FileHash -Algorithm SHA256 docs/PLAN-pet-actions-v5.md, docs/SPEC-pet-actions-v5.yaml`.

## Planning checks and evidence

- Plan approval is evidenced by the user's current message. No approval was inferred from earlier v4 artifacts.
- Spec source refs map each requirement to a Plan section. Every requirement has at least one acceptance item; each AC states a check and evidence artifact.
- Dependencies DEP-001 through DEP-003 were verified against the existing config/settings, pet-action workflow, and voice/preview pipeline. DEP-004 and DEP-005 remain assumed and must be validated within WU-3/WU-4; uncertainty must take the clipboard-only safe path.
- The v5 YAML Spec is parsed and its requirement-to-acceptance links are checked before commit; `git diff --cached --check` is run on the complete staged documentation change. No application tests were run because this cycle creates planning documents only.
- Provider/model calls: 0. Prompt quality: not live evaluated. No improvement percentage or optimality claim is made.
- Planned real-model A/B budget, if separately run during implementation: at most 8 public synthetic inputs, old/new once each, 16 total calls, no retries, no user transcript. A no-call run must record “prompt quality not live evaluated.”

## Scope and implementation handoff

Only the v5 planning cycle is current. v3/v4 Plan, Spec, Ledger and runtime reports remain unchanged historical records. Implementation handoff starts at WU-1 in the frozen Spec. The implementation Ledger must be extended in a new implementation record or separate ledger update without changing the frozen Spec; any scope/decision change requires a newly approved Plan and recompiled Spec.

Release remains bounded by the acceptance evidence: host/platform claims require named runtime pairs; prompt quality claims require the bounded evaluation evidence. Passing code tests alone does not establish prompt quality or untested platform support.

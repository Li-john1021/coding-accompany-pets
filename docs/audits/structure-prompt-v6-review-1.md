# Structure Prompt v6 Review 1

verdict: "FAIL"
route: "repair"
candidate: "89d61c29d96cb149077a323b571b8b75ccc54ae7..bb80aee02acf0020637c09122f54ec67d9a854ef"

## Code Review

The inspected prompt and deterministic mock path showed no implementation gap against the reviewed prompt contract. The Main baseline is the exact prefix of `STRUCTURE_ONLY_PROMPT`; the added rules address context-sensitive cleanup, correction, preservation, and JSON source boundaries. The focused pipeline test asserts one normal-path mocked call per synthetic case and captures the structure prompt and JSON source. This is routing/transport evidence only; MiMo semantic quality was not evaluated.

This code inspection is not a PASS audit because the review execution violated the explicit no-GUI/no-desktop-E2E boundary. A different clean-context reviewer must complete the candidate audit.

## Evidence

- E-001: Candidate HEAD is `bb80aee02acf0020637c09122f54ec67d9a854ef`; reviewed range is recorded above. `git status --short --branch` was clean before this report. `git diff --check 89d61c29d96cb149077a323b571b8b75ccc54ae7..bb80aee02acf0020637c09122f54ec67d9a854ef` passed.
- E-002: Approved Plan is `docs/PLAN-structure-prompt-v6.md`; frozen Spec hash is `587E3CBBC142652D719B7B779B4ABF83255E86F6F885E3E15964FDF3C4B0A1D0`, matching the supplied hash.
- E-003: `app/main/text-prompts.js` SHA-256 is `E548E850004E54A1932FEE4A549269E1288783B9E523D1A7C211FF3BFCD76641`. Its prompt begins with the Main baseline from `bd52106c7723006ddcc2a56268d9d17377571fe6:app/main/config.js`. The candidate diff does not change `DEFAULT_PROMPT`, `sourceMessage`, `app/main/pipeline.js`, `app/main/models.js`, `app/main/config.js`, renderer/UI paths, or v5 evaluation artifacts.
- E-004: Passed: `node app/main/pet-actions-v5-config.unit.test.js`; `node app/main/structure-prompt-v6-pipeline.unit.test.js` (five cases, mock transport only); `node app/main/pipeline-delivery.unit.test.js`; `node app/main/models-thinking.unit.test.js`; `node app/main/palette-run-guards.unit.test.js`; `node app/main/palette-busy.unit.test.js`; `node app/main/pet-status.unit.test.js`; `node app/main/voice-delivery-ipc.unit.test.js`; and `node --check` on `text-prompts.js` and the three focused config/fixture/pipeline test files.
- E-005: Unexpected command `node app/main/pet-actions-v5.e2e.test.js` exited 1 with `Timeout: native foreground source`. The test source identifies itself as a real Electron/native paste-and-undo fixture. Its wrapper `finally` recursively removes its `v2p-v5-*` temp directory; the fixture `finally` destroys the source window, restores the previous clipboard contents, and quits the app. A read-only process check found no matching node/electron process afterward. The pipeline model and ASR functions in this test are stubbed; no provider, key, or profile access is evidenced. Electron/native GUI activity did occur, so this was not a zero-GUI review.
- E-006: Unexpected command `node app/main/pet-actions-v4.e2e.test.js` was also launched during the same parallel check. Its exit status was not captured by the orchestration output. A later read-only process check found no matching pet-actions-v4/v5 node/electron process. Existing `pet-actions-*` temp directories were dated 2026-10-07; no cleanup or other action was taken on them. No provider/key/profile access from this command is evidenced, but its effects and exit status are not fully verified.
- E-007: `docs/LEDGER-structure-prompt-v6.md` SHA-256 is `AC07B17E95F322EA5D71108C22D53674A1BB4752A23482C1B63BE424A0734E35`. Ledger statements are treated as implementation records, not as proof of semantic prompt quality.

## Findings

- id: "F-001"
  requirement_refs: ["REQ-005"]
  statement: "The reviewer launched two desktop/native E2E commands despite the explicit zero-GUI review constraint. The v5 command failed at native foreground-source setup; the v4 exit status is unknown. This invalidates the review's no-GUI certification and requires a fresh independent audit. It is a review-execution failure, not evidence of a prompt implementation defect."
  root_cause_assumptions: ["The reviewer misclassified pet-actions E2E workflow tests as in-scope local checks."]
  confidence: "high"
  impact: "boundary"
  route: "repair"

## Next Cycle Brief

next_cycle_brief:
  objective: "Have a different clean-context reviewer audit the same frozen candidate and complete the Spec reconciliation under the no-GUI boundary."
  allowed_changes: ["Audit report only; no candidate implementation, Plan, Spec, or threshold changes."]
  checks: ["Recheck candidate diff, frozen Spec/Plan hashes, prompt and source contract, and permitted non-GUI deterministic tests."]
  prohibited: ["GUI, Electron/native/desktop E2E, provider/model/ASR/key/profile access, network, implementation edits, Plan/Spec edits, or live-quality claims."]
  carry_forward: ["F-001", "E-005", "E-006"]

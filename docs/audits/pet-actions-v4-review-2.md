# Pet Actions v4 Independent Review 2

verdict: "PASS"
route: "accept"
candidate: "288db0d8509a817b917a5c411b50a5ccfdcef6bf..9df41ef5470b69168b6cb9ffb157e0224c4b15b6"
repair_range: "48ecc8bb5a5339363232124d929159665815b0b3..9df41ef5470b69168b6cb9ffb157e0224c4b15b6"

## Suspicion Precheck

The approved v4 Plan and frozen Spec agree on the reviewed behavior: one ordinary-app Ctrl+C request per action click, no preview/manual-copy/allowlist gate, direct clipboard publication for every non-empty result including raw or degraded output, user copies do not block publication, and recognized terminal hosts use their dedicated copy chord. The Plan supersedes v3 interaction rules. The Spec SHA-256 matches `25b6fff0287f66f36241d8de4993ecc6692a48661a95e670cf023dc312cb785e`. No scope ambiguity or unaddressed precheck suspicion blocks this review.

## Evidence

- E-001: `docs/PLAN-pet-actions-v4.md`; approved one-click capture, direct publication, and manual-paste contract.
- E-002: `docs/SPEC-pet-actions-v4.yaml`; SHA-256 `25b6fff0287f66f36241d8de4993ecc6692a48661a95e670cf023dc312cb785e`.
- E-003: `docs/LEDGER-pet-actions-v4.md`; implementation record distinguishes fixture evidence from named Windows host runtime validation and notes weaker evidence for unknown owners.
- E-004: `app/main/pet-action-capture.js:48-56, 157-172`; stable clipboard snapshot includes sequence and owner identity; a positive foreign owner PID is rejected before authorization, a matching PID is accepted, and missing/zero owner PID remains compatible with `ownerMatched: false`.
- E-005: `app/main/pet-action-capture.unit.test.js` and `app/main/pet-action-workflow.unit.test.js`; foreign-process clipboard content is rejected with zero model calls; same-process and unknown-owner captures retain compatibility.
- E-006: `app/main/pet-action-capture.runtime.test.js`; fixture now imports `buildSnapshotScript`, `createPetActionCapture`, and `parseSnapshot` from the active API; same-process, foreign-process, and unknown-owner cases pass. No stale `probeNativeSelection` reference remains in this fixture.
- E-007: `app/renderer/pet.js:45-72, 116-139, 213-228, 278-286, 384-400`; idle callbacks capture voice and UI state epochs. A voice transition or any subsequent state change, including a new text action, invalidates an earlier completion/error timer.
- E-008: `app/main/pet-action-renderer-epoch.unit.test.js`; renderer VM regression proves a completion timer does not replace a newer listening state and ordinary completion still returns to idle. The shared helper is also used for action errors and other delayed idle transitions.
- E-009: all `app/main/*.unit.test.js` files passed; `app/renderer/pet-live2d.unit.test.js` passed.
- E-010: `node app/main/pet-action-capture.runtime.test.js` and `node app/main/pet-action-clipboard.runtime.test.js` passed.
- E-011: `node --check` passed for all 45 Git-tracked JavaScript files under `app/`; `git diff --check 288db0d..9df41ef` passed.
- E-012: Spec hash matched the frozen value; stale fixture reference search passed; review began at clean `codex/palette-input-sources` HEAD `1c292aff5d60769f0f875e001b87a038ba9a0c1c`.

## Findings

No concrete, reproducible defect found in the reviewed repair scope.

## Capture Attribution Boundary

A positive clipboard owner PID different from the selected host PID is rejected before text reaches the model. A same-process owner is accepted for compatibility; PID equality does not identify the exact owner window or prove that this specific copy request caused the write. If Windows reports no owner PID, a stable sequence/owner snapshot remains accepted and evidence records `ownerMatched: false`. These are compatibility rules with varying attribution strength, not a universal causal guarantee. The adapter fixtures are not named real-host Windows runs.

## Runtime Boundary

The automated capture fixture and static clipboard fixture pass. No real user window, clipboard, model request, Windows Terminal, conhost, browser, IDE, or unknown app was exercised here. Named isolated Windows host/control validation remains pending as recorded in the ledger; this review does not claim runtime support for untested host/control pairs or Linux/macOS.

# Palette Trigger Fix Ledger

Plan: `docs/PLAN-palette-trigger-fix.md` v1 (approved)
Frozen Spec: `docs/SPEC-palette-trigger-fix.yaml`
Frozen Spec SHA-256: `606830FB0DAA45A47EAE07C316204EE5F4952236AD21FB327501080C61123B50`
Base: `046135b606313bf4467735d873b64166148102b1`
Branch: `codex/palette-trigger-fix`

## WU-001

Status: implemented; deterministic checks passed. Independent boundary review is pending.

Changes: passive UIA point probe requires the same hit Edit control, positive non-readonly ValuePattern, TextPattern selection, and identical non-empty selected text at both endpoints. Probe errors and timeout return no evidence. The pure gate rejects missing evidence, terminal process names, recording, disabled state, and recent user copy. Character threshold helper rejects unconfirmed/empty input before comparing length.

Checks:

- `node app/main/palette-gate.unit.test.js` — pass.
- `node app/main/palette-probe.unit.test.js` — pass.
- `node app/main/palette-run-guards.unit.test.js` — pass.
- `git diff --check` — pass.
- Frozen Spec hash rechecked — matches.

Evidence limits: these checks exercise pure JavaScript policy, parsing, generated-probe invariants, and existing interaction guards. They do not exercise Windows UIA providers or actual selections in native/browser controls. Supported provider scenarios remain unverified pending targeted Windows validation; unsupported or ambiguous providers fail closed.

Validation boundary: VB-001 / L1 is warranted because probing crosses process/provider boundaries. Reviewer evidence is not yet recorded.

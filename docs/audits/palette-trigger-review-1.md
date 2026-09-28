# Palette Trigger Fix Review 1

```yaml
verdict: "FAIL"
route: "repair"
candidate: "046135b606313bf4467735d873b64166148102b1..7138a4ce084f3cb68265dd65ad596922196d2d58"
spec_suspicion_precheck: "clean"
evidence:
  - id: "E-001"
    path: "docs/PLAN-palette-trigger-fix.md; docs/SPEC-palette-trigger-fix.yaml; docs/LEDGER-palette-trigger-fix.md"
    hash: "SPEC SHA-256 606830FB0DAA45A47EAE07C316204EE5F4952236AD21FB327501080C61123B50"
  - id: "E-002"
    path: "git diff --find-renames --unified=5 046135b606313bf4467735d873b64166148102b1..7138a4c"
    hash: "candidate commits 154c296, 3718097, 7138a4c; HEAD 7138a4ce084f3cb68265dd65ad596922196d2d58"
  - id: "E-003"
    path: "app/main/*.unit.test.js"
    hash: "review rerun: all discovered unit tests passed; tests are deterministic JS/source/parser tests, not live Windows UIA scenarios"
  - id: "E-004"
    path: "git diff --check 046135b606313bf4467735d873b64166148102b1..7138a4c"
    hash: "passed"
findings:
  - id: "F-001"
    requirement_refs: ["REQ-006", "AC-006", "VB-002", "INV-003"]
    statement: "The guarded paste path sends a possible Shift tap before validating the target in the child PowerShell process. If the user switches to another IME-enabled application during the initial delay, ImeOpen observes that application and TapShift sends synthetic input there; the later target guard then cancels Ctrl+V but cannot undo the earlier input."
    root_cause_assumptions: ["ASM-002"]
    confidence: "high"
    impact: "boundary"
    route: "repair"
  - id: "F-002"
    requirement_refs: ["REQ-002", "AC-002", "VB-001"]
    statement: "The eligibility gate denies only terminal and named PDF processes. It has no Explorer/shell process denial, so an Explorer Edit exposing the required UIA patterns and selection can pass the gate, contrary to the explicit Explorer/files/objects exclusion. Whether a particular Explorer provider exposes those patterns is not tested."
    root_cause_assumptions: ["ASM-001"]
    confidence: "medium"
    impact: "boundary"
    route: "repair"
  - id: "F-003"
    requirement_refs: ["REQ-001", "REQ-002", "REQ-003", "REQ-006", "REQ-007", "REQ-008", "AC-001", "AC-002", "AC-003", "AC-006", "AC-007", "AC-008", "VB-001", "VB-002", "VB-003"]
    statement: "Required runtime evidence is absent. Unit tests do not execute Windows UIA providers, actual native/browser selections, focus-preserving palette clicks, stale-target timing, normal user Ctrl+C behavior, or voice workflows. Compatibility documentation explicitly leaves these scenarios pending; therefore the named acceptance evidence and all three validation boundaries are not established."
    root_cause_assumptions: ["ASM-001", "ASM-002"]
    confidence: "high"
    impact: "release"
    route: "repair"
next_cycle_brief:
  objective: "Repair the pre-guard input side effect and enforce the Explorer/file-object denial, then produce evidence for the frozen Spec's Windows and compatibility acceptance scenarios."
  allowed_changes: ["Move or restructure guarded injection so no synthetic key is sent before target validation", "Explicitly deny Explorer/file-object contexts or prove an equivalent UIA classification", "Add deterministic race/policy tests and record targeted Windows observations"]
  checks: ["Re-run all app/main/*.unit.test.js", "Test a target switch during the IME preamble and confirm no input reaches the new foreground app", "Exercise eligible native edit, Explorer/file selection, read-only/browser, focus mismatch, user Ctrl+C, recording, stale selection, and overlapping action cases", "Exercise existing voice recording/transcription and palette UI; record supported/unsupported browser providers"]
  prohibited: ["Lowering the character threshold", "Treating PowerShell parsing or source-string assertions as provider/runtime evidence", "Claiming untested Windows GUI scenarios passed"]
  carry_forward: ["F-001", "F-002", "F-003", "ASM-001", "ASM-002"]
```

## Spec Suspicion Precheck

The frozen Spec is internally traceable: each REQ cites a Plan source and has at least one proving AC; the ACs name observable evidence; DEP-002 through DEP-005 and ASM-001/002 are explicitly assumptions with validation routes. The Plan, Spec version, and listed risk boundaries do not conflict. No planning-layer contradiction was found. The Spec SHA-256 matches the Plan and Ledger value.

## Reconciliation

| Requirement | Review result | Evidence / gap |
|---|---|---|
| REQ-001 | Partial; AC-001 unproven | Probe code compares endpoint identity and selected text (`app/main/palette-probe.js:30-59`); tests inspect generated source but do not exercise a real control/provider. |
| REQ-002 | Fail | Gate rejects known terminal/PDF names but not Explorer (`app/main/palette-gate.js:2-3, 22-24`); see F-002. No scenario record for the other named deny cases. |
| REQ-003 | Partial; AC-003 unproven | Passive probe source contains no clipboard/input/focus/selection mutation (`app/main/palette-probe.js:27-65`); the global Ctrl+C handler timestamps and dismisses without a suppression call (`app/main/main.js:963-972`). No Windows observation confirms copy behavior or absence of provider side effects. |
| REQ-004 | Code path supported; AC-004 unproven | Recording is checked after probe completion and again by the gate (`app/main/main.js:693-700`); no trigger scenario record. |
| REQ-005 | Deterministic policy passes | Empty/unconfirmed selection is rejected before threshold length comparison (`app/main/palette-gate.js:27-32`); gate unit tests cover the policy helper. |
| REQ-006 | Fail | Selection ids, revalidation, and reentry guard exist (`app/main/main.js:675-688, 736-808`), but F-001 permits synthetic Shift before native target validation (`app/main/insert.js:58-62`). No runtime stale/overlap scenario record. |
| REQ-007 | Unproven | Diff leaves the voice pipeline and palette HTML unchanged, but AC-007 requires voice recording/transcription exercise and a regression record; neither is present. |
| REQ-008 | Unproven | Strict UIA capability check is present (`app/main/palette-probe.js:39-50`); browser support and read-only denial have not been observed in a real browser/provider. |

### Validation Boundaries

- **VB-001:** Not satisfied. Parser/policy tests do not establish UIA hit testing, actual selection text, readonly status, process identity, Explorer handling, or focus mismatch across providers.
- **VB-002:** Not satisfied. Source tests cover stale IDs and guard construction, but do not drive target/selection changes during processing or the native injection preamble. F-001 identifies a pre-guard race.
- **VB-003:** Not satisfied. The compatibility note correctly labels provider support as candidate-only and focusable-false behavior as unverified. No browser or voice runtime records are included.

## Review Commands

- `Get-FileHash docs/SPEC-palette-trigger-fix.yaml -Algorithm SHA256` — matched frozen hash.
- `Get-ChildItem app/main/*.unit.test.js | ForEach-Object { node $_.FullName }` — all discovered unit tests passed.
- `git diff --check 046135b606313bf4467735d873b64166148102b1..7138a4c` — passed.
- `git status --porcelain=v1` before this report — clean; no pre-existing worktree modifications.

## Next Cycle

Address F-001 and F-002 without changing the frozen Spec or threshold. Add deterministic regression coverage for the pre-guard injection ordering and Explorer policy. Then collect the actual Windows observations required by AC-001/002/003/004/006/007/008, documenting provider/app/version and outcomes; a source review or PowerShell parser result is not a substitute. A different clean-context reviewer must audit the resulting candidate.

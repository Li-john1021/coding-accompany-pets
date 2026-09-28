# Palette Trigger Fix Review 2

```yaml
verdict: "FAIL"
route: "repair"
candidate: "3295294..1993b27b436bad709fcf8482b5e00bbea18b5a05"
spec_suspicion_precheck: "clean"
prior_finding_boundary:
  F-001: "PASS for the reported pre-guard synthetic-Shift ordering defect; runtime paste behavior is separately blocked by F-004."
  F-002: "PASS for deterministic process-name denial of Explorer and the enumerated shell processes."
repair_boundary_verdict: "FAIL"
overall_spec_acceptance: "INCOMPLETE; F-003 runtime evidence remains outstanding."
evidence:
  - id: "E-001"
    path: "docs/SPEC-palette-trigger-fix.yaml"
    hash: "SHA-256 606830FB0DAA45A47EAE07C316204EE5F4952236AD21FB327501080C61123B50; matches frozen value in Plan and Ledger."
  - id: "E-002"
    path: "git candidate"
    hash: "HEAD 1993b27b436bad709fcf8482b5e00bbea18b5a05; repair boundary starts at 3295294."
  - id: "E-003"
    path: "app/main/*.unit.test.js"
    hash: "All discovered unit tests passed on this Windows host. These deterministic tests do not exercise live application paste or UIA provider behavior."
  - id: "E-004"
    path: "app/main/palette-paste-guard.js; app/main/insert.js"
    hash: "PowerShell check without Add-Type returned TYPE_FAIL for System.Windows.Automation.AutomationElement; the same type resolved after Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes. The current guarded script has no such assembly load."
  - id: "E-005"
    path: "git diff --check 3295294..HEAD; node --check on changed JavaScript"
    hash: "Both checks passed. Candidate changes do not modify the frozen Spec, Plan, palette HTML, pipeline, or pet renderers."
findings:
  - id: "F-003"
    requirement_refs: ["REQ-001", "REQ-002", "REQ-003", "REQ-006", "REQ-007", "REQ-008", "AC-001", "AC-002", "AC-003", "AC-006", "AC-007", "AC-008", "VB-001", "VB-002", "VB-003"]
    statement: "Required runtime evidence is still absent: no Windows UIA/native or browser selection matrix, foreground-preserving palette interaction, ordinary Ctrl+C observation, stale/overlap timing exercise, or voice recording/transcription regression record is present. The compatibility note continues to label these cases unverified. This remains an acceptance gap, not a claim that the scenarios failed."
    root_cause_assumptions: ["ASM-001", "ASM-002"]
    confidence: "high"
    impact: "release"
    route: "release_boundary"
  - id: "F-004"
    requirement_refs: ["REQ-006", "AC-006", "VB-002", "INV-003"]
    statement: "The repair removed the UI Automation assembly load from buildPasteTargetGuard. The generated function references System.Windows.Automation.AutomationElement and related types at palette-paste-guard.js:13-14, 26, and 28, but the function catches all errors and returns false at lines 36-38. On this host, PowerShell cannot resolve AutomationElement until UIAutomationClient/UIAutomationTypes are loaded. In insert.js:64, REQUIRE_TARGET therefore exits before paste for every guarded target; insert.js:82-83 reports this as cancelled. The parser-only test does not resolve runtime types."
    root_cause_assumptions: []
    confidence: "high"
    impact: "boundary"
    route: "repair"
  - id: "F-005"
    requirement_refs: ["REQ-006", "REQ-007", "AC-006", "VB-002", "INV-004"]
    statement: "RESTORE_SHIFT_IF_TARGET reuses the full original-selection check after Ctrl+V (palette-paste-guard.js:44; insert.js:72-74). A normal paste replacing selected text consumes that selection, so the post-paste check is expected to return false and skip the Shift intended to restore IME state. This behavior could not be exercised end-to-end because F-004 currently cancels guarded paste; verify it after F-004 is corrected and guard restoration against the original foreground/control identity without requiring the consumed selection text."
    root_cause_assumptions: []
    confidence: "medium"
    impact: "boundary"
    route: "repair"
next_cycle_brief:
  objective: "Correct the guarded paste regression while retaining pre-injection target checks, then collect the still-required Windows compatibility and voice evidence before claiming Spec acceptance."
  allowed_changes:
    - "Restore explicit UIAutomationClient/UIAutomationTypes loading in the guarded PowerShell runtime and exercise the composed script, not only its syntax."
    - "Make post-paste IME restoration conditional on the original target identity/foreground state without requiring the replaced selection to remain selected."
    - "Collect the AC-001/002/003/004/006/007/008 observations listed in the frozen Spec and retain the application/Windows/provider and outcome record."
  checks:
    - "Run all app/main/*.unit.test.js and parse the composed PowerShell script."
    - "Exercise a guarded paste with an active supported edit control and confirm target-switch cases do not send Shift or Ctrl+V to a different foreground target."
    - "Verify IME state is restored after replacing a selection and is not changed in another application after a target switch."
    - "Record the Windows UIA, browser, copy, stale/overlap, palette-focus, recording, and voice scenarios required by F-003."
  prohibited:
    - "Changing the frozen Spec, Plan, character threshold, or acceptance evidence requirements."
    - "Treating PowerShell syntax parsing or source-string assertions as Windows runtime/provider evidence."
    - "Claiming overall Spec PASS while F-003 evidence is absent."
  carry_forward: ["F-003", "F-004", "F-005", "ASM-001", "ASM-002"]
```

## Spec Suspicion Precheck

Clean. Each REQ has a Plan source reference and at least one proving AC; the ACs name observable evidence. Dependencies and assumptions are explicitly marked and have validation routes. The invariants, forbidden effects, implementation units, and validation boundaries are compatible. The Spec version and SHA-256 match the approved Plan/Ledger reference. No planning-layer contradiction was found.

## Repair Boundary

| Prior finding | Result | Evidence |
|---|---|---|
| F-001: possible Shift before target validation | PASS for the reported ordering defect. The composed template places a target check before IME query, another before the initial Shift, and another before Ctrl+V (`app/main/insert.js:62-72`). Runtime guarded paste is currently blocked by F-004; the documented check-to-SendInput race remains a residual limitation. | `node app/main/palette-paste-guard.unit.test.js` verifies these source-order assertions and parses the composed script. |
| F-002: Explorer/shell not denied | PASS for the enumerated process policy. `isShellProcess` strips `.exe` and case-insensitively matches Explorer, desktop, and shell process names (`app/main/palette-gate.js:4, 14-15`); the gate applies it before positive-selection acceptance (`:22`). The unit test covers Explorer, Progman, WorkerW, ShellExperienceHost, and SearchHost (`app/main/palette-gate.unit.test.js:34-40`). | `node app/main/palette-gate.unit.test.js` passed. This is deterministic policy coverage, not a live Explorer/UIA observation. |
| New regression: guarded paste cannot resolve UIA types | FAIL. Previous code loaded the two UIA assemblies in the generated guard; current code removed that load. On this host a fresh PowerShell process reports `TYPE_FAIL`, while adding the two assemblies resolves the type. The caught failure returns false, making every guarded target exit at the first `REQUIRE_TARGET`. | `app/main/palette-paste-guard.js:8-14, 36-44`; `app/main/insert.js:62-65, 82-83`; local PowerShell type-resolution check. |
| New regression risk: IME restoration after paste | FAIL pending correction and runtime confirmation. Restoration calls the same predicate that requires the original selected text after Ctrl+V has replaced that selection. | `app/main/palette-paste-guard.js:35, 44`; `app/main/insert.js:72-74`. |

## Acceptance Status

F-003 remains open. The candidate includes deterministic JS policy/source tests and a PowerShell syntax parse, but no observation record for real UIA providers, ordinary Ctrl+C, browser editable/read-only cases, recording, target/selection races, palette focus preservation, or voice workflows. No overall Spec PASS is warranted. In addition, F-004 means palette processing that reaches guarded paste currently cancels before sending Ctrl+V, which must be fixed before meaningful paste-runtime acceptance can be collected.

## Review Commands

- `Get-FileHash docs/SPEC-palette-trigger-fix.yaml -Algorithm SHA256` — matched the frozen hash.
- `Get-ChildItem app/main/*.unit.test.js | ForEach-Object { node $_.FullName }` — all discovered unit tests passed.
- `node --check` on changed JavaScript files — passed.
- `node app/main/palette-paste-guard.unit.test.js` — source-order assertions and PowerShell parser passed; parser success does not resolve runtime UIA types.
- PowerShell type-resolution check without `Add-Type` — `TYPE_FAIL`; with `Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes` — resolved `System.Windows.Automation.AutomationElement`.
- `git diff --check 3295294..HEAD` — passed.
- `git diff 3295294..HEAD -- docs/PLAN-palette-trigger-fix.md docs/SPEC-palette-trigger-fix.yaml app/main/pipeline.js app/renderer/palette.html app/renderer/pet.js app/renderer/pet-live2d.js` — empty.

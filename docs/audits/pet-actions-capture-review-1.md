# Pet Actions UNIT-2 Capture Review 1

## Structured Audit

```yaml
verdict: PLANNING_REVIEW
route: planning_review
candidate: 74c7cac..9f30bcf (UNIT-2 implementation; reviewed at Ledger HEAD fa66dc1)
precheck:
  result: pass_with_scope_gap
  plan: docs/PLAN-pet-actions-v3.md at approved version recorded in docs/LEDGER-pet-actions-v3.md
  spec: docs/SPEC-pet-actions-v3.yaml
  spec_sha256: 21EABF0E8C2F896AAF78531926D57EA146DC22F4DBD4705353E83C027A1665EF
  notes: Requirements map to acceptance criteria; the Spec hash matches the frozen Ledger. The browser/IDE candidate scope does not match the narrower host classifier, so that coverage decision is routed to planning rather than silently calling it supported.
evidence:
  - id: E-001
    path: docs/SPEC-pet-actions-v3.yaml
    hash: 21EABF0E8C2F896AAF78531926D57EA146DC22F4DBD4705353E83C027A1665EF
  - id: E-002
    path: app/main/pet-action-capture.js
    hash: 293D3AE9A596FFC0116F092FE54007566B7CF88B26CDE006A67CC6721383C951
  - id: E-003
    path: app/main/win32-edit.js
    hash: F55D4867A168618C18DE8D2705645BA672CA0CD99B5E6E19853DBE59EEBD465C
  - id: E-004
    path: app/main/pet-action-capture.unit.test.js
    hash: 90D1152EE550ED93E44E9464E0D75E4DD1ECE21B4D3803E6435BD28EAD2E1CC7
  - id: E-005
    path: app/main/pet-action-capture.runtime.test.js
    hash: E8CE17439F5F9FA2F5CAD35D7E85CC534FCF9B849C9481E2E1B4E73375B54276
  - id: E-006
    path: focused commands
    hash: null
    details: Six focused unit tests passed; node --check passed for all 8 changed JavaScript files; git diff --check 74c7cac..9f30bcf passed; Windows foreground/native Edit positive and empty-selection fixture passed with clipboard sequence unchanged.
  - id: E-007
    path: runtime boundary
    hash: null
    details: Electron is unavailable in this checkout. The native fixture is not an Electron action-click test and does not validate any named browser, VS Code, Windows Terminal, or conhost runtime pairing.
findings:
  - id: F-001
    requirement_refs: [REQ-002]
    statement: >-
      The approved Plan names webpages and IDE editors as ordinary Ctrl+C candidates (docs/PLAN-pet-actions-v3.md:50), and the Spec lists webpages and IDE editors as initial candidates (docs/SPEC-pet-actions-v3.yaml:274). However, classifyHost only maps an explicit native-app allowlist to ordinary (app/main/pet-action-capture.js:71-81); Chrome becomes unknown and every Code process becomes vscode (app/main/pet-action-capture.unit.test.js:49-52). Since click treats every non-ordinary host as manual (app/main/pet-action-capture.js:224-230), both browser and VS Code editor actions require the user to copy manually. This is a material product coverage gap for the planned browser/VS Code editor workflow, even though it correctly avoids claiming untested compatibility and avoids injecting a guessed key. The Spec also lists browser/IDE integrations as deferred (docs/SPEC-pet-actions-v3.yaml:66-69), so planning must decide whether manual-only is the intended v1 boundary or whether a reliable control/profile capability is required.
    root_cause_assumptions:
      - ASM-001: Foreground process/window identity alone is insufficient to distinguish a browser or VS Code editor from embedded terminal/content controls safely.
    confidence: high
    impact: boundary
    route: planning_review
next_cycle_brief:
  objective: Resolve the Windows browser and VS Code editor coverage boundary, then validate only the approved named host/control pairs.
  allowed_changes:
    - Add only an approved, evidence-backed way to distinguish supported ordinary text controls from embedded terminal or custom controls.
    - Keep manual-copy paths for Windows Terminal, conhost, VS Code integrated terminal, and unknown terminals unless safe host/control evidence is available.
  checks:
    - Rerun capture-focused unit tests, node --check, and git diff --check.
    - Exercise stale/equal/empty clipboard, target/mode/voice cancellation, preview expiry, and denied terminal injection.
    - Run named Electron host/control tests before making any compatibility claim.
  prohibited:
    - Claim browser, VS Code, terminal, or other host compatibility from fixtures or unit tests alone.
    - Weaken sequence freshness, same-button confirmation, or terminal no-key safety.
    - Edit or replace the frozen Plan/Spec as part of implementation without approved planning evidence.
  carry_forward: [F-001, E-007]
```

## Reconciliation

The frozen Spec hash matches the approval Ledger. The capture contract uses Win32 foreground/focus identity and clipboard sequence snapshots, and permits direct authorization only for a non-empty selection read from a focused standard `Edit` control. A changed clipboard sequence with non-empty text is still tagged unverified and stored behind a one-use token. Confirmation rechecks target, sequence, voice state, and the 10-second expiry; bounded monitoring cancels pending authorization on target, clipboard, voice, or timeout changes.

The key policy is conservative: only the explicit native app allowlist receives Ctrl+C. Windows Terminal, conhost, VS Code, browser processes, and unknown hosts receive no injected chord. This meets the requested no-dangerous-key behavior for terminal/unknown candidates. Clipboard freshness uses sequence change, so equal text copied as a new clipboard event remains unverified rather than becoming selection proof. The preview is normalized, truncated, and passed through the existing `textContent` bubble path. UNIT-2 contains no model routing, output clipboard write, or paste path.

F-001 is a scope/acceptance gap, not a compatibility finding: browser and VS Code editor candidates are currently manual-copy only. The current code and tests make no claim that those applications are compatible. The plan lists ordinary webpages/IDE editors as Ctrl+C candidates, while the Spec also defers browser/IDE integrations and the implementation chooses manual handling because process identity cannot reliably distinguish editor content from embedded terminals. Planning must decide whether manual-only is acceptable for v1 or define the required host/control capability before changing that policy.

The focused unit suite, changed-file syntax checks, and candidate whitespace check passed. The Windows native Edit fixture also passed on this machine, including empty-selection denial and an unchanged clipboard sequence. Electron is not installed in this checkout, so the actual pet-button-to-foreground-host workflow and named app host matrix remain unverified. No compatibility claim follows from this review.

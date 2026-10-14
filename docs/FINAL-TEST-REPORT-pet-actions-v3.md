# Pet Actions v3 Final Windows Test Report

Date: 2026-10-07 (Asia/Shanghai)
Branch / HEAD: `codex/palette-input-sources` / `c9e5376`
Scope: Windows clean-context validation. No production implementation was changed. No real API keys or external model calls were used.

## Outcome

The main-process unit suite, Windows native conditional clipboard smoke, all JavaScript syntax checks, whitespace check, and frozen Spec hash check passed. A real Electron application launch and `webContents.capturePage` verified the default pet UI, legacy config migration, and side-button hook registration.

Pet scale acceptance fails in the real Electron runtime. At scale `0.8`, the action row is clipped entirely from the `240x245` pet window. At scale `2.5`, the `750x765` window grows but rendered content remains near its default dimensions, leaving most of the window blank. Scale screenshots are included under `docs/evidence/pet-actions/`.

The Windows native selection fixture could not take foreground ownership in this session. It did not send a key or modify the clipboard. Named browser, IDE, Windows Terminal, conhost, and VS Code terminal host/control compatibility therefore remains unverified. macOS and Linux were unavailable.

## Commands and Evidence

| Check | Result |
|---|---|
| `npm ci` in `app/` | Exit 0; 408 packages installed. npm reported 15 dependency vulnerabilities (9 moderate, 4 high, 2 critical); dependencies were not changed. |
| Serial `node app/main/<file>.unit.test.js` for all `app/main/*.unit.test.js` | Exit 0; all 15 test files passed. |
| `node app/main/pet-action-capture.runtime.test.js` | Exit 0, but output was `BLOCKED foreground fixture could not acquire Windows foreground permission`; no copy key or clipboard mutation was attempted. This is not a runtime pass. |
| `node app/main/pet-action-clipboard.runtime.test.js` | Exit 0; native expected-sequence-zero guard, mismatch refusal, matching synthetic marker write/readback, and guarded text restoration passed. No clipboard source text was printed. |
| `node --check` for all `app/**/*.js` | Exit 0; all 42 JavaScript files passed. |
| `git diff --check` | Exit 0. |
| SHA-256 `docs/SPEC-pet-actions-v3.yaml` | `21EABF0E8C2F896AAF78531926D57EA146DC22F4DBD4705353E83C027A1665EF`; matches the frozen value. |
| Real app startup with isolated temporary `userData` and synthetic providers with empty keys | Pass at scale `1.0`; pet screenshot captured at `300x306`. Startup migrated `paletteEnabled=true` to `false`, preserved `mouseRecord=true`, and logged `[mouse] hook on`. No model call was made. |
| Real app startup/capture at scales `0.8` and `2.5` | Scale acceptance failure; see screenshots and findings below. Both windows launched and captured. |

Temporary `userData` directories used only synthetic provider records and empty API keys. No existing user `APPDATA` configuration was read or changed. Each Electron process and the capture fixture launched for this run was closed. No remaining process matched the test userData or fixture paths.

## Acceptance Criteria

`mock` means deterministic unit-test dependencies; `static` means source or policy inspection; `real runtime` means the Windows/Electron or native helper actually ran. A passing mock/static check does not establish named host compatibility.

| AC | Result | Evidence / limit |
|---|---|---|
| AC-001 | PASS (mock); host runtime blocked | Workflow unit tests cover Structure routing, authorization, conditional output write, preview fallback, and no paste. Native selection fixture was blocked before a live selection action. |
| AC-002 | PASS (mock); host runtime blocked | Workflow unit tests cover Optimize routing and guarded result behavior. No live host selection or external model call was used. |
| AC-003 | PASS (mock/static) | UI and workflow unit tests assert no automatic model run and no legacy watcher action. Real app launch was passive; no exhaustive live hover/movement/clipboard mutation run was performed. |
| AC-004 | PASS (mock); host runtime blocked | Capture/workflow unit tests cover stale, empty, inaccessible, unsupported, ambiguous, and no-fresh-copy denials with zero model calls. Foreground selection fixture could not acquire the test window. |
| AC-004A | PASS (mock) | Unit tests cover fresh unverified preview and same-mode confirmation gating. No fresh clipboard preview was induced in live Electron. |
| AC-004B | PASS (mock) | Unit tests cover timeout, clipboard, target, mode, and voice cancellation. No live preview was opened. |
| AC-005 | PASS (mock/static); host runtime unverified | Policy/unit tests ensure Windows Terminal receives no guessed `Ctrl+Shift+C`; no named Windows Terminal session was available for interaction testing. |
| AC-006 | PASS (mock/static); host runtime unverified | Policy/unit tests deny unsafe conhost copy injection; no conhost selection session was run. |
| AC-007 | PASS (mock); partial-write failure untested | Workflow tests cover model errors, empty/degraded/stale results, cancellation, and active-state cleanup. Native clipboard smoke passed the supported write paths; it did not force `SetClipboardData` failure after `EmptyClipboard`. |
| AC-007A | PASS (mock) | Workflow tests inject clipboard ownership change and assert no overwrite plus explicit result preview. |
| AC-007B | PASS (mock); native write path pass | Workflow tests cover unavailable/rejected clipboard writer and preview fallback. Native matching-sequence marker write/readback and guarded restore passed. OS-level write rejection was not forced. |
| AC-008 | FAIL (real runtime) | Default `1.0` screenshot shows three equal-width buttons in order. At `0.8`, the buttons are below the captured `240x245` viewport and are entirely clipped. At `2.5`, buttons appear but the window is `750x765` while content remains near default size. Static UI tests cover order/disabled state; no image-recognition side effect was invoked. |
| AC-009 | PASS (real runtime + static) | Isolated startup changed `paletteEnabled=true` to `false`, kept `mouseRecord=true`, and successfully registered `[mouse] hook on`. Legacy drag/double-click behavior is additionally covered by unit contracts, not live gesture simulation. |
| AC-010 | PASS (mock/static); live gesture matrix unverified | UI, renderer settlement, and voice-epoch unit tests cover button isolation, busy/disabled state, voice superseding, and rejected IPC settlement. A full pointer/body and active-voice interaction matrix was not automated in the live window. |
| AC-011 | PASS (static) | Plan, Spec, Ledger, and audits consistently make host/platform claims evidence-gated. No browser/IDE/terminal/macOS/Linux compatibility is claimed by this report. |
| AC-012 | PASS (mock/static); host runtime unverified | Unit and source policy checks confirm manual-copy handling and no guessed terminal chord for Windows Terminal, conhost, VS Code integrated terminal, and unknown terminals. No named terminal host runtime was exercised. |

## Findings

### F-001: Pet controls clip at minimum scale

At the real application startup scale `0.8`, `createPetWindow()` created a `240x245` window and `capturePage()` returned a `240x245` image. The pet and status text are visible, but the action buttons do not appear; the viewport ends before the action row. This violates the Plan's explicit requirement that controls remain below the pet and not clip at minimum/default/maximum scale. Screenshot: [`pet-scale-0.8.png`](evidence/pet-actions/pet-scale-0.8.png), SHA-256 `CA172C0CAB01741C3036DC81AED6E5A0D11678DD46FAE414A7DBFDBC1C666033`, 23,327 bytes, 240x245 pixels.

### F-002: Maximum scale enlarges the window without the pet UI

At scale `2.5`, the real app window and captured image were `750x765`, but rendered content remained near the default-size region at the top-left, leaving most of the window empty. This indicates the content zoom/bounds are not synchronized at the maximum scale even though the button row itself remains visible. Screenshot: [`pet-scale-2.5.png`](evidence/pet-actions/pet-scale-2.5.png), SHA-256 `8946C813711E6E1A5127A226284F749FFCBF77ED1A1A81367D3C9255AC1FB0A`, 32,869 bytes, 750x765 pixels.

### F-003: Native selection fixture could not acquire foreground

`pet-action-capture.runtime.test.js` compiled and launched its disposable Win32 Edit fixture, but the foreground snapshot did not identify the fixture. The test correctly stopped without issuing a copy key or changing the clipboard. Positive/empty selection probing and any named host claim remain unverified on this machine.

## Compatibility Boundary

Only the application shell and native conditional clipboard writer were exercised on Windows. This run does not establish compatibility for any browser, IDE editor/chat, Windows Terminal, conhost, VS Code integrated terminal, remote session, or custom host/control. No macOS/Linux test machine was available. No external model/provider was called.

## Final Acceptance Revision (clean-context candidate)

Date: 2026-10-07 (Asia/Shanghai)
Candidate range: `b00a27ffb79df87ba11c512768362f6b661cda8d..7db955650cfa797c691538db721755b5d7f37332`
Host: Windows 11 Home Simplified Chinese, version `10.0.22631`, build `22631`; Node.js `v24.14.0`; Electron `v31.7.7` from `app/node_modules`.
Scope: independent clean-context final acceptance. No production source was changed. No external model/API call was made and no model credentials were used.

### Spec Suspicion Precheck

The frozen Spec SHA-256 is `21EABF0E8C2F896AAF78531926D57EA146DC22F4DBD4705353E83C027A1665EF`, matching the approval Ledger. The approved Plan, Spec, Ledger, Unit-2 planning review, Unit-3 Review 3, and scale review were reconciled before execution. No new contradiction was found in the clipboard authorization/write guards, voice supersession, or scale repair. The already-recorded Unit-2 scope gap remains: webpages and IDE editors are listed as implementation candidates in the Plan/Spec, while current policy classifies browsers and VS Code as manual-copy hosts because process identity cannot establish the focused control. This run does not resolve that planning gap and makes no browser/IDE support claim. Windows Terminal, conhost, VS Code integrated terminal, and unknown terminals remain manual or otherwise fail-closed as documented; none was runtime-tested.

### Commands and Runtime Evidence

| Check | Result |
|---|---|
| Serial `node app/main/<file>.unit.test.js` for all `app/main/*.unit.test.js` | Exit 0; all 16 files passed. |
| `node --check` for all tracked `app/**/*.js` (excluding installed dependencies) | Exit 0; all 44 application JavaScript files passed. |
| `node app/main/pet-action-clipboard.runtime.test.js` | Exit 0; native expected-sequence-zero refusal, mismatch refusal, matching marker write/readback, and guarded text restoration passed. |
| `node app/main/pet-action-capture.runtime.test.js` | Exit 0 with `BLOCKED foreground fixture could not acquire Windows foreground permission`; no copy key or clipboard mutation was attempted. This is blocked evidence, not a runtime pass. |
| Isolated Electron DevTools renderer click probe | Exit 1 in the temporary test harness because Chromium returned no serializable assertion value. The bridge was replaced with a local stub before attempted clicks, so no capture/model/clipboard IPC was reachable; no button-event runtime result is claimed. The temporary harness was removed. |
| `git diff --check b00a27f..HEAD` | Exit 0. |
| SHA-256 `docs/SPEC-pet-actions-v3.yaml` | `21EABF0E8C2F896AAF78531926D57EA146DC22F4DBD4705353E83C027A1665EF`; matches the frozen value. |
| Isolated Electron startup and built-in `--shot=pet=...` at scales `0.8`, `1`, `2.5` | All three windows launched and captured. PNG dimensions were `240x245`, `300x306`, and `750x765`; hashes were `e56cfc35c9eba2606c6c284e0deefb4c83532967c4cbb8626dde3644750c52d`, `c9e7626b0b61664038d697b5ef7b5301b4fbdc396fdf6f753a8dae86fbb6cdf0`, and `92584dc381ec97254e262140321da7576108f18195255f406ec7ca47978cf891`. Visual inspection at `0.8` and `2.5` showed the pet, status, and all three controls fully in frame. |
| Legacy migration in isolated Electron profiles | Each profile started with synthetic empty-key providers, `paletteEnabled=true`, and `mouseRecord=false`; after startup the persisted value was `paletteEnabled=false` at all three scales. No existing user profile was used. A post-run metadata check found `%APPDATA%\\Voice2Prompt\\config.json` still had `paletteEnabled=true`, `mouseRecord=true`, and unchanged length `4346`. |

The isolated screenshot evidence was created under a unique `%TEMP%\\pet-actions-final-*` directory. The three Electron runs were stopped after capture; no process remained for those profiles. The app's configured profile was isolated with `--user-data-dir`; the existing Voice2Prompt config was not used or modified. Only its palette/mouse flags and file length were checked afterward; credential values were not printed or used. Screenshots were inspected directly during this run and were not added to the repository. Real pet-button click/IPC behavior was not successfully verified in Electron; button event and voice-state assertions below are mock/static evidence only.

### Acceptance Criteria

`mock` denotes deterministic unit-test dependencies, `static` denotes source/policy inspection, and `real runtime` denotes the Windows native helper or isolated Electron app actually running. `PARTIAL` means some evidence exists but the full criterion or named host workflow remains unverified.

| AC | Current result | Evidence and remaining boundary |
|---|---|---|
| AC-001 | PARTIAL | `mock`: workflow tests cover Structure authorization/routing, no-paste behavior, guarded output write, and explicit result preview. `real runtime`: capture fixture was blocked before a live selection; no named host-to-button workflow or external model call was exercised. |
| AC-002 | PARTIAL | `mock`: workflow tests cover Optimize authorization/routing and guarded output behavior. `real runtime`: same foreground-fixture block as AC-001; no named host-to-button workflow or external model call was exercised. |
| AC-003 | PARTIAL | `mock/static`: UI, capture, and workflow tests assert no automatic action/model call and legacy watcher retirement. The Electron launches were passive startup/capture only; live hover, movement, clipboard-change, and voice transitions were not driven. |
| AC-004 | PASS (mock/static) | Capture/workflow tests reject stale, empty, ambiguous, inaccessible, unsupported, and no-fresh-copy cases with zero model calls; unsupported-host policy was inspected. Live foreground capture was blocked, so no host-runtime claim follows. |
| AC-004A | PASS (mock) | Capture and renderer tests cover fresh unverified preview and same-mode confirmation before model routing. No fresh preview was induced through a live Electron click. |
| AC-004B | PASS (mock) | Capture tests cover timeout, clipboard, target, mode, and voice cancellation with no model call. No live pending preview was opened. |
| AC-005 | PASS (mock/static) | Policy and unit assertions deny unsafe Windows Terminal `Ctrl+Shift+C`; no Windows Terminal session was exercised. |
| AC-006 | PASS (mock/static) | Policy and unit assertions deny unsafe conhost `Ctrl+C`; no conhost session was exercised. |
| AC-007 | PARTIAL | `mock`: workflow tests cover model error, empty/degraded/stale result, cancellation, and active-state cleanup. `real runtime`: native successful conditional-write paths passed, but no live model failure was induced; OS failure after `EmptyClipboard` remains unforced and may lose the captured source text as recorded by Model Review 3. |
| AC-007A | PASS (mock) | Workflow test injects a clipboard ownership/sequence change during processing and asserts no overwrite plus explicit result preview. No timed user-copy race was induced in Electron. |
| AC-007B | PARTIAL | `mock`: write rejection retains output in result-only preview. `real runtime`: native matching/mismatch/zero-sequence smoke passed; OS-level write denial was not forced. |
| AC-008 | PARTIAL | `real runtime`: pet/status/three-button row is visible and unclipped at `0.8`, `1`, and `2.5`; all three screenshots have expected dimensions. `mock/static`: order, equal grid columns, disabled image button, and pointer isolation are asserted. Actual click events, disabled-button side effects, and row/body gestures were not driven in Electron. |
| AC-009 | PARTIAL | `real runtime`: each isolated legacy `paletteEnabled=true` profile migrated to `false`. `mock/static`: migration preserves `mouseRecord=true`, and the hook remains configured. The live migration profiles used `mouseRecord=false`, so actual side-button hook registration was not re-exercised here. |
| AC-010 | PARTIAL | `mock`: UI, renderer settlement, and workflow tests cover action isolation, busy/voice guards, and voice superseding, including rejected IPC settlement. No real Electron pointer/body-gesture or active voice interaction matrix was driven. |
| AC-011 | PASS (static) | Approved artifacts and current report keep compatibility claims evidence-gated. No browser, IDE, terminal, macOS, or Linux compatibility is claimed. |
| AC-012 | PASS (mock/static) | Policy and capture tests require manual copy for VS Code integrated/unknown terminals and prevent guessed hazardous terminal chords; fresh clipboard plus same-button confirmation remains required. Named terminal runtime behavior was not exercised. |

### Final Boundary

The earlier AC-008 failure at `0.8` and `2.5` remains preserved above as historical evidence; the isolated Electron captures in this revision pass the repaired scale geometry at all three configured scales. No new production defect was found in this acceptance pass. This is not a clean-context release pass for real selection capture: foreground acquisition remained blocked, real action-button clicks were not driven, and browser, IDE, Windows Terminal, conhost, VS Code terminal, and arbitrary host/control compatibility remains unverified. macOS/Linux were unavailable. The known Plan/Spec candidate coverage gap for browser and IDE editor capture remains unresolved and should not be represented as supported.

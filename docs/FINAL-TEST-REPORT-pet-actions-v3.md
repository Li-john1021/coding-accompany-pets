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

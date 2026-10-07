# Pet Actions v5 final clean-context acceptance

Date: 2026-10-07. Result: **PARTIAL / required v4 desktop regression blocked by foreground changes**. Settings UI, native input guard, v5 desktop workflows, all 25 main unit files, Live2D and all 65 tracked JavaScript syntax checks passed. This report does not turn the two failed v4 attempts into a pass or authorize release.

The tester did not participate in implementation or independent source review and used no child agents. Starting clean HEAD was `b0e6a3970ca8333c5ed1feef4da6d38bd70b6671`; reviewed production candidate was `e9413c5619731d5da375b10d94dd1b219a081fc6`. New settings regression commit is `be67204505c7c52349e363170f381d9fdb40cb4d`. Production implementation, frozen Plan/Spec and old failure audits were not changed. No `.codegraph/` exists, so CodeGraph was skipped per the supplied AGENTS instruction.

Read the approved Plan, frozen Spec, review 3 and implementation ledger. Review 3's source/deterministic PASS remains separate from the runtime results below. No new evidence-backed production defect was found in this phase; required v4 runtime acceptance remains incomplete.

## User-flow acceptance matrix

| User flow / acceptance case | Expected observable outcome | Evidence and result |
|---|---|---|
| Open settings with default config (AC-001/002) | Auto-paste checked from canonical `paste`; duration 10 | New production settings UI E2E: PASS |
| Open settings with legacy `clipboard` (AC-001) | Checkbox stays unchecked; saving unchanged preserves `clipboard` | New settings UI E2E: PASS, isolated legacy profile |
| Uncheck, save, close and reopen settings (AC-001) | Disk and IPC both return `clipboard`; reopened UI unchecked | New settings UI E2E: PASS |
| Check, save, close and reopen settings (AC-001) | Disk and IPC both return `paste`; reopened UI checked; no competing `autoPaste` field | New settings UI E2E: PASS |
| Set duration and restart app (AC-002) | Saved 37 seconds and clipboard mode survive a fresh Electron process | New settings UI E2E: PASS for both initial profiles |
| Set duration endpoints / malformed values (AC-002) | 1 and 120 survive; 0 becomes 1, 121 becomes 120, 12.9 becomes 12 | New settings UI E2E: PASS through real save handler/IPC/disk |
| Select text and click Structure with auto-paste off (AC-001/004/005) | Exact captured source processed; result copied; target unchanged; Undo copies source | v5 real Electron textarea E2E: PASS; ASR/LLM mocked |
| Select text and Optimize with auto-paste on (AC-001/004) | Result remains on clipboard and native Ctrl+V replaces selection | v5 Windows/Electron textarea E2E: PASS |
| Undo in Electron target without affirmative writable evidence (AC-005) | Processed target unchanged; original copied to clipboard | v5 E2E: PASS, conservative fallback |
| Undo a clean native Edit selected-text replacement (AC-005) | Native Ctrl+Z restores original selected text without another model call | v5 and native-input-guard E2E: PASS |
| Submit voice to native Edit then Undo (AC-005) | Result pasted; atomic restoration packet leaves initial synthetic ASR in Edit | v5 and native-input-guard E2E: PASS; ASR/LLM mocked |
| Edit/reprocess voice preview, finalize and Undo (AC-005) | Clipboard returns immutable initial ASR, with no new ASR/LLM request | v5 production preview/IPC E2E: PASS |
| Raw-only voice / short preview bypass then Undo (AC-001/005) | Nonempty output copied; Undo restores initial ASR | v5 E2E: PASS; provider outputs mocked |
| Type external input before final native Undo dispatch (AC-004/005/006) | Generation mismatch refuses Ctrl+Z; own Edit remains `PASTED1` | Native E2E: PASS, real external injected unmarked key, not physical human typing |
| Switch focus child before initial native paste (AC-004) | Final native identity check refuses paste | Native E2E: PASS on own second Edit |
| Input after paste injection but before JS settlement (AC-005/006) | Dirty generation survives; Undo copies source only and preserves `PASTED1` | Native E2E: PASS with delayed bridge response |
| New result / stale token / timeout / duplicate Undo (AC-002) | Only newest unexpired token acts; old token cannot restore earlier operation | Result-delivery unit: PASS; synthetic timers/state |
| Dirty target, uncertain target, external click or target switch (AC-004/005) | Result stays copied; unsafe Undo/paste refused; source fallback with note | Delivery, capture, target-key and input-guard units: PASS; native rows above add real dispatch evidence |
| Capture/model in progress or voice/preview busy; concurrent submissions (AC-006) | Admission rejects conflicting Undo/work; no premature clipboard writes; listeners unique | Production IPC/admission, workflow, renderer epoch and input-guard units: PASS |
| Terminal paste and Undo (AC-004/005) | Host-specific paste chord; no generic Undo, clear, Enter or appended original; clipboard fallback | Routing/source review and synthetic units: PASS; real terminal runtime NOT TESTED |
| Custom prompt / exact legacy built-in prompt / delimited source (AC-003) | Custom survives; only exact old built-in migrates; faithful bounded prompts and one default model call | Config/pipeline units and review 3: PASS; runtime workflow providers mocked |
| Read-only selection, degraded/fallback output, intervening clipboard copy, v4 renderer regression (AC-001/004/006) | One click processes original selection and always publishes nonempty output | Deterministic units PASS; required v4 desktop E2E BLOCKED twice, not accepted as runtime PASS |
| Prompt fidelity comparison (AC-007) | Bounded paired synthetic observation with disclosed limits | Existing 8-pair/16-call artifact retained and hash checked; no calls rerun |

## Executed commands and results

All commands used the candidate worktree. Desktop E2E commands ran strictly serially in this order; the only desktop retry was the single v4 retry shown here. Each E2E created and cleaned its own temporary profile and fixtures. No user profile/key was read, no provider was called by this tester, and no user app/pet/skin/settings was restarted or changed.

| Command | Result |
|---|---|
| `node app/main/pet-actions-v5-settings.e2e.test.js` | PASS: default and legacy-clipboard profiles, each with checkbox/save/reopen/duration bounds plus a fresh-process persistence check |
| `node app/main/native-input-guard.e2e.test.js` | Exit 0: `PASS actual native own packet/voice Undo, external-origin input and target switch before final dispatch, and post-paste bridge dirty preservation` |
| `node app/main/pet-actions-v4.e2e.test.js` attempt 1 | Exit 1: actual foreground was Edge, not own fixture; exact diagnostic below |
| Same v4 command, sole retry | Exit 1: structure model-call wait timed out after capture observed ChatGPT; exact diagnostic below |
| `node app/main/pet-actions-v5.e2e.test.js` | Exit 0: `PASS v5 real Electron/native selected-text paste+undo, nonfocusable toast and mocked voice initial-ASR undo` |
| Enumerate `app/main/*.unit.test.js`, sorted; run each with Node serially after desktop tests exited | Exit 0: `MAIN_UNIT_FILES=25 FAILED=0` |
| `node app/renderer/pet-live2d.unit.test.js` | Exit 0: render-before-sampling and empty-frame fallback PASS |
| `node --check` for every `git ls-files '*.js'` | Exit 0: `TRACKED_JS_SYNTAX_PASS=65` |
| `git diff --check` and `git diff --check 48ccd24e895ca6bb4c729965d0c95fe377e9b166..HEAD` | Exit 0 |
| `git diff --exit-code e9413c5619731d5da375b10d94dd1b219a081fc6..HEAD` for production main/config/delivery/native/prompt/preload/settings files | Exit 0; no production change |
| SHA-256 of frozen Spec and retained Plan/evaluation/code evidence | Match, identities below |

### Retained failures and bounded handling

1. Initial development run of the new hidden settings fixture used `webContents.sendInputEvent`; a hidden nonfocusable window did not activate the checkbox. The assertion `Chromium checkbox click toggles UI` failed. The test now uses `HTMLElement.click()` for Chromium checkbox activation and the existing production Save listener, with actual IPC/disk/reopened DOM assertions. This is a hidden-test input mechanism correction; no production behavior/expected value was changed. The subsequent four scenario/process checks passed.
2. v4 attempt 1: `v4 fixture must hold actual Windows foreground: {"hwnd":1906452,"pid":11536,"threadId":30472,"windowClass":"Chrome_WidgetWin_1","focusHwnd":1906452,"focusClass":"Chrome_WidgetWin_1","processName":"msedge"}`. It stopped at the foreground precondition. Exit 1 retained.
3. v4 sole retry: `Timed out waiting for structure model call; capture=[{"target":{"hwnd":202424,"pid":51300,"threadId":35204,"windowClass":"Chrome_WidgetWin_1","focusHwnd":202424,"focusClass":"Chrome_WidgetWin_1","processName":"ChatGPT"},"sequence":3158}]; message=无法读取当前目标窗口`. Actual capture target left the own fixture, so production safely refused the action; the required model-call/selection regression did not complete. Exit 1 retained. No target/selection/dirty assertion was weakened and no third v4 attempt was made in this phase.
4. An attempted retry tool launch contained a mistyped working directory and was rejected before process creation (`os error 267`); it performed no test or desktop action. The corrected command is the sole executed retry above.
5. An initial main-unit run overlapped the still-running v5 E2E. Two unit tests scan shared TEMP directories: `native-input-session.unit.test.js` observed `v2p-palette-ps-yWhVIm`, and `powershell-file.unit.test.js` observed `v2p-palette-ps-HMwUjE`, where they expected no newly remaining temporary directories. That contaminated run exited 1 with 23/25 passing. The tester corrected execution order, waited for v5 to exit, and reran all 25 main tests serially; all passed without source/test assertion changes. The clean rerun is the acceptance evidence; the contaminated failures remain recorded here.

## Evidence identities

| Artifact | SHA-256 |
|---|---|
| `docs/PLAN-pet-actions-v5.md` | `51361A1A30D0EB4B14C67620E89FCC59FB510E4617E702C0FCB1E311CAFC5DDB` |
| `docs/SPEC-pet-actions-v5.yaml` | `1A00857FC1AA9E6896C1B865A82C2315A36E7338113652ED2EB704FA3C95D125` |
| `docs/EVAL-prompt-quality-v5.synthetic.json` | `7DFEED779EC20A13CB2C6095BA028F93E563800E94E681B5B7CA77BDD0E33DE5` |
| `app/main/main.js` | `2319C2A96520E16820E5B7F9FE5F0404DC8121630E5391B3B3E9FC2D700D2AB8` |
| `app/main/config.js` | `01825C2557FBCDA93339F40DE9B9BC0E87C97B58CD0971FD4E96F72AB84FDADC` |
| `app/main/result-delivery.js` | `8E924A272FCF5D5B4AD408024083CC10F132BB72FCD7AFB63D42F634EF2DCA16` |
| `app/main/native-input-session.js` | `FE1F532D60F6293DA8085D3EED71679AAA0047B54E6F18B9425CE18F639F0DE7` |
| `app/main/native-input-guard.cs` | `CCBD84EC85BB7C00D808D44BF3AAED0AAC1E0D7A381685764D82CD8770DCB81F` |
| `app/renderer/settings.html` | `9C3AEE934DAB3C3DFC284002A8BCDE01EBD0886657670170611B850CBA33C248` |
| `app/renderer/settings.js` | `E83A7F8E2945FA1F4DC5603FDC4E60EFF8DCEDCF44C77205367103BC26AC8D36` |
| `app/preload.js` | `57AC6A1AC6625D81BC78A1F9E08F632602007841E9D60B790380C6EA44401F0A` |
| New settings UI E2E | `FC550F191D786C86BF3EE2BF937BE210CF110739D28DD8E5DB8BBE4BD71AFC78` |

## Runtime and evaluation limits

Observed runtime pairs: Windows / Electron BrowserWindow textarea (real capture and Ctrl+V, unknown-writable Undo conservatively copies source); Windows / native Win32 Edit (real selection Ctrl+Z and voice restoration packet); Windows / hidden production Electron settings with production preload/config IPC/disk; Electron preview with synthetic ASR/model results. The native guard test uses a real unmarked external injected key and a test-only barrier, not a claim about physical human typing. The toast was asserted nonfocusable and fixed-size in v5. An already submitted native atomic packet cannot be recalled; this is not transactional control over arbitrary editors.

No Windows Terminal/conhost, macOS or Linux native runtime was tested. Terminal safety is supported by source/synthetic routing checks only, not compatibility certification. The failed v4 read-only textarea workflow remains a specific required runtime gap despite passing capture/workflow units and successful v5 fixtures.

ASR and LLM are mocked in workflow E2E. Unit/integration passes show orchestration, preservation, routing and Undo behavior, not model/recognition quality. The retained separate prompt evaluation contains only eight public synthetic pairs, 16 attempted/returned calls, zero failures and zero retries; no new calls were made and its budget is exhausted. It is a small observation on one configured model, not optimality or universal improvement proof. It discloses both versions dropping `但是` in one connector case. Exact model/settings provenance is redacted in the retained report, limiting external reconstruction. No user transcript was used by this tester.

The next legal action is a specifically coordinated foreground window for the unresolved v4 runtime check, or evidence-supported fixture investigation by the parent, followed by planner-authorized release consideration. Review 3's PASS and the successes here do not override this incomplete final gate.

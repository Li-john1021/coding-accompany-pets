# Pet Actions v5 independent review 1

```yaml
verdict: FAIL
route: repair
candidate: 48ccd24e895ca6bb4c729965d0c95fe377e9b166..4c1fe6ae27105cbc8878200f8d96e9148b9d8d28
review_date: 2026-10-07
independence: Clean-context reviewer; no implementation, research, evaluation, or previous review participation; no child agents.
precheck: PASS
provider_calls_by_reviewer: 0
findings:
  - id: F-001
    priority: P1
    requirement_refs: [REQ-011, REQ-016, INV-003, FORB-004, AC-005, AC-006]
    statement: User input after the JavaScript dirty check but before native SendInput does not cancel host Undo.
    locations: ["app/main/result-delivery.js:90", "app/main/result-delivery.js:91", "app/main/target-keys.js:28", "app/main/target-keys.js:39", "app/main/target-keys.js:55"]
    root_cause_assumptions: [ASM-001, DEP-004]
    confidence: high
    impact: boundary
    route: repair
  - id: F-002
    priority: P2
    requirement_refs: [REQ-008, REQ-013, REQ-016, INV-005, AC-004, AC-006]
    statement: An old Undo can overwrite the clipboard while a previously admitted pet capture is waiting to read its fresh copy.
    locations: ["app/main/main.js:388", "app/main/main.js:946", "app/main/result-delivery.js:86", "app/main/pet-action-capture.js:171", "app/main/pet-action-capture.js:176"]
    root_cause_assumptions: [ASM-001, DEP-004]
    confidence: high
    impact: boundary
    route: repair
evidence:
  - id: E-001
    path: docs/PLAN-pet-actions-v5.md
    hash: 51361A1A30D0EB4B14C67620E89FCC59FB510E4617E702C0FCB1E311CAFC5DDB
  - id: E-002
    path: docs/SPEC-pet-actions-v5.yaml
    hash: 1A00857FC1AA9E6896C1B865A82C2315A36E7338113652ED2EB704FA3C95D125
  - id: E-003
    path: docs/EVAL-prompt-quality-v5.synthetic.json
    hash: 7DFEED779EC20A13CB2C6095BA028F93E563800E94E681B5B7CA77BDD0E33DE5
  - id: E-004
    path: app/main/result-delivery.js
    hash: 2977918168CE576BA9F278684204DE513AD7DB8DC9B0402A99016F2BE4F93BC0
  - id: E-005
    path: app/main/target-keys.js
    hash: B11F09549F9FF13FE928E6C589D721C273D1CF960B97119061417E7BD471730A
  - id: E-006
    path: "Independent deterministic reproductions and verification output recorded below"
next_cycle_brief:
  objective: Close the native dirty-input window and serialize Undo with already admitted capture operations; obtain a passing v4 runtime regression.
  allowed_changes: [Evidence-supported concurrency/native dispatch repairs and focused regression checks]
  checks: [Dirty input during native startup, Undo during pending fresh-copy capture, 22 main unit files, Live2D unit, v4 and v5 Electron E2E, tracked syntax, diff check, frozen Spec hash]
  prohibited: [Frozen Plan/Spec edits, old audit deletion, weaker target assertions, provider calls, unrelated scope]
  carry_forward: [F-001, F-002, E-001, E-002, E-003, v4-runtime-failure]
```

The Plan contains explicit approval evidence. Every REQ has a Plan source reference and a proving AC; the AC checks are observable. DEP-004/005 and ASM-001/002 have explicit validation routes and conservative fallback requirements. No planning contradiction or stale Spec hash was found. The supplied fingerprint is SHA-256, not SHA-1. Frozen v5 Plan/Spec and historical v4 Plan/Spec/Ledger/final report have no changes in the candidate range. The absence of `.codegraph/` was checked before locating code.

## F-001: native startup outlives the dirty check

For a clean, unchanged, writable target, `undo()` checks `op.dirty` at result-delivery.js:90 and immediately starts `sendChord`. The Windows implementation then starts PowerShell and compiles C# before it reaches `SendInput`. During that asynchronous startup, `markDirty()` does update `undoing.dirty` at line 30, but the native routine validates only target identity. Neither the native routine nor the pending send consumes that updated dirty state. Typing in the same control during this interval can therefore be undone by Ctrl+Z. Voice restoration additionally pastes the ASR over the resulting state. The UI still reports `restored: true`.

This is distinct from a foreground change: HWND/PID/thread/child/class/process can all remain identical while the user edits the control. Checking dirty after the native promise resolves would be too late. The repair needs a dirty/input generation or equivalent cancellation/commit guard that remains effective until native injection, with own injected events distinguished from user events. Preserve the existing native identity checks and single voice restoration packet.

The following deterministic reproduction was run from the repository root against the unchanged production delivery module. A deferred adapter models the actual asynchronous native startup boundary; it does not claim that a human typing race was exercised in the native fixture.

```javascript
const assert = require('assert');
const { createResultDelivery } = require('./app/main/result-delivery');
const target = { hwnd: 1, pid: 2, threadId: 3, focusHwnd: 4,
  windowClass: 'Host', focusClass: 'Edit', processName: 'fixture', readOnly: false };
let token, enter, release, sent = false;
const entered = new Promise(r => enter = r);
const pendingNative = new Promise(r => release = r);
(async () => {
  const delivery = createResultDelivery({ platform: 'win32',
    writeClipboard: async () => {}, snapshot: async () => ({ target }),
    guardAvailable: () => true, onShow: p => token = p.token,
    sendChord: async chord => {
      if (chord === 'ctrl-z') { enter(); await pendingNative; sent = true; }
      return true;
    } });
  await delivery.deliver({ original: 'old', text: 'new', target, insertMode: 'paste' });
  const undo = delivery.undo(token);
  await entered; delivery.markDirty(); release();
  const result = await undo;
  assert.equal(sent, true); assert.equal(result.restored, true);
  delivery.clear();
})();
```

Observed: `REPRO F2: user dirty signal during pending native launch still sends Ctrl+Z and reports restored=true` (exit 0; the exploratory run used this output label before final finding numbering).

## F-002: reverse ordering bypasses the workflow lock

`v2p:pet-action` checks `resultDelivery.busy` before admitting a capture. The opposite ordering is not protected: once capture is active, `v2p:undo` does not check `petActionWorkflow.busy`, recording, or voice processing. The old token remains available until a new result is delivered. Consequently, clicking the old Undo toast during a capture's Ctrl+C settle/read interval overwrites the newly copied selection with the previous source.

The real capture validator then correctly rejects the app-owned replacement clipboard as `clipboard-owner-mismatch`; the requested new action is lost. This remains reproducible with the old operation already dirty, matching the physical pet click's dirty signal. It does not rely on disabling the keyboard hook or on unsafe capture acceptance. Serialize both admission directions, or otherwise make Undo and capture clipboard transactions mutually exclusive before either publishes text. Preserve v4's approved active-copy capture contract; do not introduce an editability capture gate.

A second exploratory clean-token reproduction also demonstrated a pending voice restore consuming a newer capture's clipboard after native startup. However, an ordinary physical pet click normally dirties the old operation first. That stronger outcome is conditional on a clean token and programmatic admission, and is not asserted as the default physical-click behavior.

The following production-module reproduction includes the physical-click-equivalent dirty state and uses the real capture owner checks:

```javascript
const assert = require('assert');
const { createResultDelivery } = require('./app/main/result-delivery');
const { createPetActionWorkflow } = require('./app/main/pet-action-workflow');
const { createPetActionCapture } = require('./app/main/pet-action-capture');
const target = { hwnd: 1, pid: 2, threadId: 3, focusHwnd: 4,
  windowClass: 'Host', focusClass: 'Edit', processName: 'fixture', readOnly: false };
let release, token, copied = false, clip = 'VOICE RESULT', sequence = 1, ownerPid = 2;
const settle = new Promise(r => release = r);
(async () => {
  const delivery = createResultDelivery({ platform: 'win32',
    snapshot: async () => ({ target }), guardAvailable: () => true,
    writeClipboard: async text => { clip = text; sequence++; ownerPid = 99; },
    sendChord: async () => true, onShow: p => token = p.token });
  await delivery.deliver({ original: 'FIRST ASR', text: 'VOICE RESULT',
    kind: 'voice', target, insertMode: 'paste' });
  delivery.markDirty();
  const capture = createPetActionCapture({ platform: 'win32',
    snapshot: async include => ({ target, sequence, ownerPid,
      text: include ? clip : undefined, stable: true }),
    sendCopy: () => { clip = 'NEW SELECTED TEXT'; sequence++; ownerPid = 2; copied = true; },
    sleep: () => settle, readClipboard: () => clip });
  const workflow = createPetActionWorkflow({ isVoiceBusy: () => false, capture,
    processText: async () => { throw Error('must not call'); }, onCaptureResult: r => r });
  const action = workflow.run('structure');
  while (!copied) await Promise.resolve();
  const undo = await delivery.undo(token);
  assert.equal(undo.copiedOnly, true);
  release(); const result = await action;
  assert.equal(result.reason, 'clipboard-owner-mismatch');
  delivery.clear();
})();
```

Observed: `CONFIRMED F1 physical-click-equivalent dirty state: pending Ctrl+C source replaced by old Undo; production capture rejects=clipboard-owner-mismatch; clipboard=FIRST ASR` (exit 0; exploratory output numbering differs from final findings).

## Independent verification and scope

| Check | Independent result |
|---|---|
| All `app/main/*.unit.test.js` | PASS, 22 files, no failed files |
| `node app/renderer/pet-live2d.unit.test.js` | PASS |
| `node --check` for every `git ls-files '*.js'` entry | PASS, 59 tracked files |
| `git diff --check 48ccd24..4c1fe6a` | PASS |
| v5 frozen Spec hash | Exact match to E-002 |
| `node app/main/pet-actions-v5.e2e.test.js` | PASS, exit 0 |
| `node app/main/pet-actions-v4.e2e.test.js`, two serial attempts | FAIL, both parent exit 1; child emitted the same structure-model-call timeout |

Both v4 attempts produced:

```text
AssertionError [ERR_ASSERTION]: Electron fixture returned no result (exit 0): PET_ACTIONS_V4_E2E_RESULT:{"ok":false,"error":"Timed out waiting for structure model call"}
at ChildProcess.<anonymous> (app/main/pet-actions-v4.e2e.test.js:247:14)
```

The v4 fixture uses a Windows/Electron BrowserWindow read-only textarea and clipboard-only delivery. It did not reach its first structure model assertion in either independent run. This is failed runtime evidence, not a pass. The timeout alone does not establish the exact foreground/capture rejection cause; no assertion was weakened and no claim that native foreground was successfully held is made. The existing implementation ledger's earlier v4 success is historical evidence, not an independent current-tree pass.

The passing v5 run used its own temporary profile, synthetic ASR/model responses, its own Electron window and native Edit fixture. Observed named pairs are Windows / Electron BrowserWindow textarea (real selection copy and Ctrl+V; unknown writable classification correctly gives clipboard-only Undo) and Windows / native Win32 Edit (real selection replacement/Ctrl+Z and voice Ctrl+Z then Ctrl+V restoring initial synthetic ASR). The non-focusable small toast and preview edit/reprocess, raw-only, and short-preview paths passed. These successful ordinary-control checks do not validate the concurrent native-startup window in F-001. Windows Terminal/conhost native runtime, macOS and Linux remain unvalidated; terminal chord/fallback assertions are synthetic only. The tests were run serially with no other reviewer GUI task, and did not use the user's existing profile, keys, or application windows as fixtures.

Source reconciliation found the canonical insertMode checkbox, duration clamping/default, exact-old-default-only prompt migration, immutable preview initialRaw, clipboard-first ordinary delivery, selection Ctrl+Z versus voice native restore packet, terminal clipboard fallback, latest-only token consumption/expiry, singleton hook registration and Windows screen-to-DIP toast exclusion implemented as specified outside the findings. No extra persistent undo store or source/result logging was introduced. Target polling is serial and token checked; its asynchronous callback has no catch, but the current production getWindowsSnapshot adapter converts execution/parse failures to resolved null. An injected rejecting snapshot would expose a robustness issue, but no currently reachable production rejection was established, so it is not a blocking finding here.

The prompt source uses JSON source data and three examples per mode with explicit preservation/no-answer boundaries. Online retry/degradation remains exception handling, not a default reflection chain. The existing evaluation records exactly eight paired synthetic cases/16 calls without retries and bounded observations, and E-003 matches. This reviewer did not invoke the evaluator live, read provider credentials, or call any provider. The artifact does not expose the selected model/settings, so the reported same-model/settings provenance cannot be independently reconstructed from its redacted payload; this is a provenance limit, not evidence of an additional call or universal-quality claim. The report explicitly records the shared omitted contrast word in its connector case rather than claiming perfect preservation.

This review authorizes no release. Repair F-001/F-002, retain this audit, form a new candidate, and use a different clean-context reviewer for the next acceptance boundary.

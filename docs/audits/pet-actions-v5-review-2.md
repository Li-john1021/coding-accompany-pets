# Pet Actions v5 independent review 2

```yaml
verdict: FAIL
route: repair
candidate: 48ccd24e895ca6bb4c729965d0c95fe377e9b166..c5ef5d762f6918eaae7076a487e3857b93be03e3
review_date: 2026-10-07
independence: Clean-context reviewer; no implementation or earlier audit participation; no child agents.
precheck: PASS
provider_calls_by_reviewer: 0
desktop_e2e_by_reviewer: not_run_reserved_for_clean_tester
findings:
  - id: F-001
    priority: P1
    status: partially_repaired_still_open
    requirement_refs: [REQ-011, REQ-016, INV-005, FORB-004, AC-005, AC-006]
    statement: Dirty input after the JavaScript COMMIT grant but before native SendInput cannot cancel Undo and is reported as a successful restoration.
    locations: ["app/main/target-keys.js:71", "app/main/target-keys.js:73", "app/main/target-keys.js:48", "app/main/target-keys.js:39", "app/main/result-delivery.js:33", "app/main/result-delivery.js:96"]
    root_cause_assumptions: [ASM-001, DEP-004, DEP-005]
    confidence: high
    impact: boundary
    route: repair
  - id: F-003
    priority: P1
    status: new
    requirement_refs: [REQ-011, REQ-013, REQ-016, FORB-004, AC-005, AC-006]
    statement: Input after the initial paste is injected but before the asynchronous adapter finishes is discarded, allowing a later generic host Undo against a dirty target.
    locations: ["app/main/result-delivery.js:30", "app/main/result-delivery.js:51", "app/main/result-delivery.js:62", "app/main/result-delivery.js:65", "app/main/result-delivery.js:70", "app/main/powershell-file.js:59"]
    root_cause_assumptions: [ASM-001, DEP-004, DEP-005]
    confidence: high
    impact: boundary
    route: repair
resolved_previous_findings:
  - id: F-002
    status: closed_by_source_and_deterministic_regression
    evidence: Production Undo admission now rejects capture/model/recording/voice/preview/delivery busy states before token consumption or clipboard writes; reverse admissions reject pending delivery/Undo.
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
    path: docs/audits/pet-actions-v5-review-1.md
    hash: FCCCE7ACED5BD3B3368BDC6AC9B179A741ABC1E0EAAA0E18519D6E10C5B67BC6
  - id: E-005
    path: app/main/result-delivery.js
    hash: 67620C58EE16F01B1527422FE48CDE4D5C74A75FB2CC862FF24794858924FD8F
  - id: E-006
    path: app/main/target-keys.js
    hash: 482FB0194CCC7076F7A8DCCBBDF92F72642F24E0969F5AACFF917CAD52CD835D
  - id: E-007
    path: app/main/input-dirty-guard.js
    hash: 28B2ABD065EE16F1B85281D2838E4962E7148FB9CCCE72EBAC97C72D7EA834F4
  - id: E-008
    path: app/main/undo-admission.unit.test.js
    hash: 0EEB95BB55B86020CA2AD4E32FAFEAE9523787346E3D401CC931C9B83B1B54C3
  - id: E-009
    path: app/main/target-keys-cancel.unit.test.js
    hash: 41FCAFCA61C3FC58F1553779B058EB34E0FEE10D9B344E3FA9436DFBBE078757
  - id: E-010
    path: docs/IMPLEMENTATION-pet-actions-v5.md
    hash: 01BC4443818EE2308A51638801F5270A49BD31C53911CA45C3FBF1F2E0DA91F1
  - id: E-011
    path: docs/EVAL-prompt-quality-v5.md
    hash: 47B2FEC480882F634B55322749F3D1306568EA55F09C8B0791D53280B198925D
  - id: E-012
    path: Independent commands and deterministic reproductions below
next_cycle_brief:
  objective: Preserve every genuine post-paste dirty event and keep Undo safe through the actual native injection boundary, then obtain clean runtime acceptance on the repaired candidate.
  allowed_changes: [Evidence-supported native dispatch and dirty-state repairs, focused regression checks, evidence ledger updates]
  checks: [Dirty input after READY/COMMIT but before SendInput, dirty input after initial paste before adapter completion, existing startup cancellation and real child cleanup, both admission directions, 24 main unit files, Live2D unit, tracked JavaScript syntax, diff check, frozen hashes, serial clean v4/v5 desktop E2E]
  prohibited: [Frozen Plan/Spec edits, failed audit deletion, treating JavaScript grant as completed native injection, weaker target or dirty assertions, provider calls, user key/profile reads, unrelated scope]
  carry_forward: [F-001, F-003, E-001, E-002, E-003, E-004, pending_current_candidate_desktop_e2e]
```

The applicable AGENTS instruction was read. No `.codegraph/` exists at this repository root, so CodeGraph was skipped before locating code. The approved Plan, complete frozen Spec, reviewer protocol and validation-boundary instructions were read. Every requirement has a Plan source and a proving acceptance item; dependencies/assumptions have explicit validation routes and conservative fallback requirements. The Plan and Spec hashes match the planning ledger. No Spec/Plan contradiction was established. The worktree was clean at the exact candidate SHA before this audit. The full candidate range, including the first audit and repair, was inspected; frozen v5 Plan/Spec and historical v4 Plan/Spec/Ledger/final report are unchanged.

## F-001: COMMIT grant precedes native injection

The repair now cancels before spawn and during PowerShell startup, waits for the native child callback/cleanup, and rejects dirty input before the READY handler grants COMMIT. Those are real improvements and their tests pass. However, `target-keys.js:71-73` sets `committed`, removes the abort listener and calls `onCommit` before writing COMMIT to the child's stdin. The child must still consume that line, enter `V2PTargetKeys.Send`, perform multiple identity API calls and create the input array before `SendInput` at line 39. This is an asynchronous, schedulable interval before injection, distinct from an already submitted atomic SendInput packet.

During that interval `markDirty()` sets `undoing.dirty` but refuses to abort because `op.committed` is already true. The completion path only checks the abort signal, so it still returns `restored: true`. The native routine checks target identity but does not check a dirty/input generation. Typing in the same control preserves all checked identity fields and can therefore be undone; voice restoration also pastes the initial ASR. `input-dirty-guard.js:7` forwards every keydown without distinguishing physical input from the operation's injected events. The new unit expectation that any `markDirty` after `onCommit` should be ignored consequently also permits physical input in this interval; it does not prove origin discrimination.

R1 below uses the unchanged production delivery and target-key modules, replacing only the PowerShell runner with a controllable child. It holds that child before injection, lets the production READY handler grant COMMIT, then delivers a dirty signal before completing the native packet. Observed: no child cancellation and `restored: true`. This is a deterministic adapter-boundary reproduction, not a claim that a physical human/native GUI race was exercised. Source ordering establishes that the production child has work remaining after the grant.

The finding does not require eliminating a CPU instruction-level race immediately around SendInput or canceling a packet already submitted atomically. It concerns the earlier cross-process grant, before the native identity checks and actual dispatch, with no user-input validation remaining in that native path.

## F-003: initial paste completion loses dirty input

`deliver()` clears `latest` before starting the native paste and does not assign the new operation to `latest` until after `sendChord` resolves. During that await, `markDirty()` has neither `latest` nor `undoing` to update. In production, the native routine invokes SendInput, writes its status and then exits; `runPowerShellFile` resolves the adapter only on the child's `close` event after cleanup. Genuine input can reach the same control after the paste but before this completion. The operation is subsequently armed with `dirty: false`, so a later Undo sends Ctrl+Z instead of using clipboard fallback. A user edit may be undone, or voice restoration may paste over it.

R2 models exactly this interval with a deferred paste adapter and the unchanged production delivery closure. A dirty signal after the modeled injection but before adapter completion is discarded. The later Undo sends `ctrl-z` and reports restoration. This gap is independent of R1: it occurs while establishing the original pasted operation, before the user requests Undo. Dirty tracking needs to survive that interval while distinguishing own injection from real user events or conservatively declining host Undo when that distinction is uncertain.

## Reproduction command and output

Executed from the repository root using a PowerShell literal here-string piped to `node`; no test or implementation file was created or edited. The runner below sends no native keys and reads no user profile.

```javascript
const assert = require('assert'); const fs = require('fs'); const vm = require('vm');
const { EventEmitter } = require('events');
const { createResultDelivery } = require('./app/main/result-delivery');
const target = { hwnd: 1, pid: 2, threadId: 3, focusHwnd: 4,
  windowClass: 'Host', focusClass: 'Edit', processName: 'fixture', readOnly: false };
(async () => {
  let child, nativeCallback, token, killed = 0, grant = '';
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync('./app/main/target-keys.js', 'utf8'), {
    module, Buffer, process: { platform: 'win32' },
    require: () => ({ runPowerShellFile: (_script, _options, cb) => {
      nativeCallback = cb;
      child = { stdout: new EventEmitter(),
        stdin: { end: data => { grant = data; } }, kill: () => { killed++; } };
      return child;
    } })
  });
  const delivery = createResultDelivery({ platform: 'win32',
    writeClipboard: async () => {}, snapshot: async () => ({ target }),
    guardAvailable: () => true, onShow: p => { token = p.token; },
    sendChord: (chord, host, options) => chord === 'ctrl-v'
      ? Promise.resolve(true) : module.exports.sendTargetChord(chord, host, options) });
  await delivery.deliver({ original: 'INITIAL ASR', text: 'result', kind: 'voice',
    target, insertMode: 'paste' });
  const pending = delivery.undo(token);
  while (!child) await Promise.resolve();
  child.stdout.emit('data', Buffer.from('V2P_READY\n'));
  assert.equal(grant, 'COMMIT\n');
  delivery.markDirty(); // Synthetic user signal before the child injects.
  assert.equal(killed, 0);
  nativeCallback(null, 'V2P_READY\nV2P_SENT');
  assert.equal((await pending).restored, true);
  delivery.clear();

  let entered, release, token2;
  const started = new Promise(r => { entered = r; });
  const waiting = new Promise(r => { release = r; }); const chords = [];
  const pasteDelivery = createResultDelivery({ platform: 'win32',
    writeClipboard: async () => {}, snapshot: async () => ({ target }),
    guardAvailable: () => true, onShow: p => { token2 = p.token; },
    sendChord: async chord => {
      chords.push(chord);
      if (chord === 'ctrl-v') { entered(); await waiting; }
      return true;
    } });
  const paste = pasteDelivery.deliver({ original: 'original', text: 'processed',
    target, insertMode: 'paste' });
  await started;
  pasteDelivery.markDirty(); // After modeled paste, before adapter completion.
  release(); await paste;
  assert.equal((await pasteDelivery.undo(token2)).restored, true);
  assert.deepEqual(chords, ['ctrl-v', 'ctrl-z']);
  pasteDelivery.clear();
})().catch(e => { console.error(e); process.exitCode = 1; });
```

Both reproductions completed with exit 0. The executed version emitted `REPRO R1 PASS: dirty after READY/COMMIT grant but before native packet is ignored; killed=0 restored=true` and `REPRO R2 PASS: real input after native paste but before adapter completion is discarded; later Ctrl+Z allowed restored=true`. Here “real input” labels the modeled user-origin dirty signal; no physical input/native packet was generated by these reproductions.

## Complete Spec reconciliation and independent checks

| Acceptance | Evidence and current result |
|---|---|
| AC-001 / REQ-001,002 | Config/settings map only canonical insertMode; shared delivery publishes non-empty results to clipboard before target/paste routing; raw/degraded outputs retain the same path. Config, workflow, pipeline and IPC checks passed. |
| AC-002 / REQ-003,007 | Default 10, integer 1-120 duration, opaque latest-only tokens, replacement/expiry/duplicate rejection and memory-only closure reviewed; tests passed. Toast construction uses focusable:false and showInactive. Current native focus behavior awaits clean desktop testing. No new persisted undo payload or source/result logging found. |
| AC-003 / REQ-004,005,006 | Exact-old-default-only migration and custom prompt retention passed. Source review confirms JSON source data, three examples per mode and explicit preservation/no-answer/no-invention constraints. Default online path remains one call; existing error/direct-answer retries are not a default reflection chain. Synthetic outputs reviewed with their stated limitations. |
| AC-004 / REQ-008,009,014 | Captured target survives capture/workflow; capture has no editability gate. Clipboard precedes delivery cancellation. Native dispatcher rechecks HWND/PID/thread/focus/classes/process, uses Ctrl+V or terminal Shift+Insert on Windows, and contains no Enter. Tests passed; no untested platform compatibility inferred. |
| AC-005 / REQ-010,011,012 | Initial ASR remains immutable through preview and finalization; raw-only and clipboard fallback/no ASR/model Undo checks passed. Terminal Undo copies source with its terminal note and sends no undo/clear/Enter. REQ-011 fails at the two proven dirty-state intervals, F-001/F-003. Current desktop restoration acceptance remains pending. |
| AC-006 / REQ-013,016 | Input listeners register once, automatic selection remains retired, side key and both admission directions have passing checks. Previous F-002 is closed. Dirty tracking is incomplete per F-003; full current-candidate runtime acceptance remains pending. |
| AC-007 / REQ-015 | Eight paired synthetic cases/16 returned outputs and zero retries are recorded; hashes and dry-run prompt fingerprints match. The report limits conclusions to this ordered run and discloses the shared dropped connector. No reviewer provider calls. Redacted artifact omits model/settings identity, so the claimed same-model/settings provenance is not independently reconstructable from the artifact. |

Independent commands, all exit 0:

- Enumerated and ran every `app/main/*.unit.test.js` with Node, failing immediately on any nonzero exit: all 24 files passed, including pending native cancellation/real child cleanup and production Undo admission regressions.
- `node app/renderer/pet-live2d.unit.test.js`: passed.
- Ran `node --check` on all `git ls-files '*.js'`: 61 tracked files passed.
- `git diff --check 48ccd24e895ca6bb4c729965d0c95fe377e9b166..c5ef5d7`: passed.
- `node app/main/prompt-quality.eval.js` without live/config flags: eight cases, 16 planned calls, matching old/new fingerprints, zero provider calls.
- `Get-FileHash -Algorithm SHA256` for frozen Plan/Spec, synthetic artifact and E-004 through E-011: identities recorded above; expected frozen hashes matched.

No desktop E2E was run during this audit, as the clean tester owns the final desktop phase. The implementation ledger and first audit describe observed Windows / Electron BrowserWindow textarea and Windows / native Win32 Edit ordinary-control runs on the earlier candidate; they do not certify this repaired candidate. The first audit retains its v4 runtime timeout, and no current-candidate v4 success was supplied or inferred. Native terminal/conhost, macOS and Linux runtime compatibility remains unvalidated; terminal checks here are synthetic/source evidence only. No user keys/profile were read and no provider calls were made. This audit edits only its own document and authorizes no release.

Retain both failed audits, repair F-001/F-003 with evidence, form a new frozen candidate and use a different clean-context reviewer. Final clean serial desktop validation and planner-authorized release remain separate boundaries.

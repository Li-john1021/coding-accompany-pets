const assert = require('assert');
const { buildSnapshotScript, createPetActionCapture, parseSnapshot } = require('./pet-action-capture');

async function runCapture(ownerPid) {
  const target = { hwnd: 10, pid: 20, threadId: 30, windowClass: 'Browser', focusHwnd: 11,
    focusClass: 'Edit', processName: 'chrome' };
  const state = { sequence: 5, text: 'selected browser text', ownerPid: 0 };
  const capture = createPetActionCapture({
    platform: 'win32',
    snapshot: async (includeText) => ({ target, sequence: state.sequence,
      ...(includeText ? { stable: true, text: state.text, ownerPid: state.ownerPid } : {}) }),
    sendCopy: () => { state.sequence++; state.ownerPid = ownerPid; },
    sleep: async () => {}
  });
  return capture.click('structure', false);
}

(async () => {
  const script = buildSnapshotScript(true);
  assert.match(script, /GetClipboardOwner/);
  assert.match(script, /GetWindowThreadProcessId\(\$ownerAfter/);
  assert.match(script, /sequenceBefore -eq \$sequenceAfter -and \$ownerBefore -eq \$ownerAfter/);
  const parsed = parseSnapshot('{"ok":true,"hwnd":10,"pid":20,"threadId":30,"windowClass":"Browser","focusHwnd":11,"focusClass":"Edit","processName":"chrome","sequence":6,"ownerHwnd":12,"ownerPid":20,"stable":true,"text64":"cwBlAGwAZQBjAHQAZQBkAA=="}');
  assert.strictEqual(parsed.ownerPid, 20);
  assert.strictEqual(parsed.text, 'selected');

  const ownCopy = await runCapture(20);
  assert.strictEqual(ownCopy.kind, 'authorized');
  assert.strictEqual(ownCopy.text, 'selected browser text');
  const otherCopy = await runCapture(999);
  assert.strictEqual(otherCopy.kind, 'rejected');
  assert.strictEqual(otherCopy.reason, 'clipboard-owner-mismatch');
  const unknownOwner = await runCapture(0);
  assert.strictEqual(unknownOwner.kind, 'authorized');
  assert.strictEqual(unknownOwner.evidence.ownerMatched, false);
  console.log('PASS active-copy capture runtime path with same-process, foreign-process, and unknown-owner fixtures');
})().catch((error) => { console.error(error); process.exitCode = 1; });

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { invoke } = require('../renderer/pet-action-settlement');

(async () => {
  const rendererPath = path.join(__dirname, '..', 'renderer', 'pet.js');
  const renderer = fs.readFileSync(rendererPath, 'utf8');
  assert.match(renderer, /window\.petActionSettlement\.invoke\([\s\S]*?voiceUiBusy\(\) \|\| actionVoiceEpoch !== voiceUiEpoch[\s\S]*?setState\('idle'\)/,
    'the IPC error path only resets the stage when no voice transition superseded it');

  let rejectRequest;
  let voiceBusy = false;
  let voiceEpoch = 3;
  let errorCount = 0;
  const actionEpoch = voiceEpoch;
  const pending = invoke(
    () => new Promise((_resolve, reject) => { rejectRequest = reject; }),
    () => voiceBusy || actionEpoch !== voiceEpoch,
    () => { errorCount++; }
  );
  while (!rejectRequest) await new Promise((resolve) => setImmediate(resolve));
  voiceBusy = true;
  voiceEpoch++;
  rejectRequest(new Error('simulated IPC rejection'));
  assert.deepStrictEqual(await pending, { status: 'superseded' });
  assert.strictEqual(errorCount, 0, 'a rejected IPC promise after voice start does not report text error/reset state');

  const ordinaryFailure = await invoke(async () => { throw new Error('ordinary failure'); }, () => false, () => { errorCount++; });
  assert.deepStrictEqual(ordinaryFailure, { status: 'rejected' });
  assert.strictEqual(errorCount, 1, 'ordinary text-action IPC failures still show an error');
  console.log('PASS pet action IPC rejection preserves voice state after voice epoch change');
})().catch((error) => { console.error(error); process.exitCode = 1; });

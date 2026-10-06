const assert = require('assert');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getWindowsSnapshot, probeNativeSelection } = require('./pet-action-capture');

if (process.platform !== 'win32') {
  console.log('SKIP Windows pet action capture fixture');
  process.exit(0);
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2p-pet-capture-'));
const fixtureSource = path.join(__dirname, 'fixtures', 'palette-probe-runtime-win32-edit.cs');
const fixtureExe = path.join(tempDir, 'PetActionCaptureFixture.exe');
const readyFile = path.join(tempDir, 'ready.json');
const stopFile = path.join(tempDir, 'stop');
const focusRequestFile = path.join(tempDir, 'focus-request');
const focusAckFile = path.join(tempDir, 'focus-ack');
const keepFrontFile = path.join(tempDir, 'keep-front');
const csc = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
let fixture;

async function waitFor(predicate, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    if (fixture && fixture.exitCode !== null) throw new Error(`fixture exited early (${fixture.exitCode})`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(message);
}

async function focus(target) {
  try { fs.rmSync(focusAckFile, { force: true }); } catch {}
  fs.writeFileSync(focusRequestFile, target);
  await waitFor(() => fs.existsSync(focusAckFile) && fs.readFileSync(focusAckFile, 'utf8') === target,
    3000, `fixture focus request ${target} timed out`);
}

async function run() {
  const compile = spawnSync(csc, ['/nologo', '/target:winexe', '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll',
    `/out:${fixtureExe}`, fixtureSource], { encoding: 'utf8', timeout: 20000, windowsHide: true });
  assert.strictEqual(compile.status, 0, `fixture compile failed: ${compile.stderr || compile.stdout}`);
  fixture = spawn(fixtureExe, [readyFile, stopFile, focusRequestFile, focusAckFile, keepFrontFile], {
    windowsHide: false, stdio: 'ignore'
  });
  await waitFor(() => fs.existsSync(readyFile), 10000, 'fixture did not become ready');
  await focus('a');
  const before = await getWindowsSnapshot();
  if (!before || before.target.processName !== 'PetActionCaptureFixture') {
    console.log('BLOCKED foreground fixture could not acquire Windows foreground permission; no copy key or clipboard mutation was attempted');
    return;
  }
  assert.ok(before && before.target.processName === 'PetActionCaptureFixture',
    `foreground snapshot mismatch: ${JSON.stringify(before && { ...before.target, sequence: before.sequence })}`);
  assert.strictEqual(before.target.focusClass, 'Edit');
  const selected = await probeNativeSelection(before.target);
  assert.ok(selected && selected.text.length === 66, 'focused fixture selection is positively read');
  const afterSelected = await getWindowsSnapshot();
  assert.strictEqual(afterSelected.sequence, before.sequence, 'native selection read does not change clipboard sequence');
  assert.deepStrictEqual(afterSelected.target, before.target, 'native selection read preserves foreground target');

  await focus('empty');
  const emptyTarget = await getWindowsSnapshot();
  assert.ok(emptyTarget && emptyTarget.target.processName === 'PetActionCaptureFixture');
  assert.strictEqual(await probeNativeSelection(emptyTarget.target), null, 'collapsed native Edit selection is denied');
  const afterEmpty = await getWindowsSnapshot();
  assert.strictEqual(afterEmpty.sequence, before.sequence, 'negative selection probe also leaves clipboard untouched');
  console.log('PASS Windows foreground identity and native Edit positive/empty selection fixture; clipboard sequence unchanged');
}

run().catch((error) => { console.error('FAIL Windows pet capture fixture:', error.stack || error); process.exitCode = 1; })
  .finally(async () => {
    try { fs.writeFileSync(stopFile, 'stop'); } catch {}
    if (fixture) await Promise.race([
      new Promise((resolve) => fixture.once('exit', resolve)),
      new Promise((resolve) => setTimeout(() => { if (fixture.exitCode === null) fixture.kill(); resolve(); }, 1000))
    ]);
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  });

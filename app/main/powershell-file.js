const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function createPowerShellFile(script) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'v2p-palette-ps-'));
  const file = path.join(directory, 'script.ps1');
  fs.writeFileSync(file, '\uFEFF' + script, 'utf16le');
  return { file, cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

function runPowerShellFile(script, options, callback) {
  let temporary;
  try { temporary = createPowerShellFile(script); }
  catch (error) { callback(error, ''); return null; }
  let child;
  try {
    child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', temporary.file], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore']
    });
  } catch (error) {
    temporary.cleanup();
    callback(error, '');
    return null;
  }
  const chunks = [];
  let outputBytes = 0;
  let completed = false;
  let timedOut = false;
  let overflow = false;
  let stdinFailed = false;
  const finish = (error) => {
    if (completed) return;
    completed = true;
    clearTimeout(timer);
    try { temporary.cleanup(); } catch { /* ignore temp cleanup failure */ }
    callback(error, Buffer.concat(chunks).toString('utf8'));
  };
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, options.timeout);
  child.on('error', (error) => finish(error));
  child.stdin.on('error', () => {
    stdinFailed = true;
    child.kill();
  });
  child.stdout.on('data', (chunk) => {
    outputBytes += chunk.length;
    if (outputBytes > options.maxBuffer) {
      overflow = true;
      child.kill();
      return;
    }
    chunks.push(chunk);
  });
  child.on('close', (code) => {
    if (timedOut) return finish(new Error('PowerShell script timed out'));
    if (overflow) return finish(new Error('PowerShell output exceeded limit'));
    if (stdinFailed) return finish(new Error('PowerShell stdin closed before payload was consumed'));
    if (code !== 0) return finish(new Error(`PowerShell script exited with code ${code}`));
    finish(null);
  });
  try { child.stdin.end(options.stdin || ''); }
  catch {
    stdinFailed = true;
    child.kill();
  }
  return child;
}

module.exports = { createPowerShellFile, runPowerShellFile };

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { createPowerShellFile } = require('./powershell-file');

class NativeInputSession {
  constructor({ onDirty = () => {}, onUnavailable = () => {}, spawnProcess = spawn, testMode = false, onTestWait = () => {}, onTestResponse } = {}) {
    this.onDirty = onDirty; this.onUnavailable = onUnavailable; this.spawnProcess = spawnProcess;
    this.child = null; this.running = false; this.sessionId = null; this.pending = new Map(); this.sequence = 0;
    this.testMode = testMode; this.onTestWait = onTestWait; this.onTestResponse = onTestResponse;
  }
  start() {
    if (this.running) return Promise.resolve(true);
    if (this.starting) return this.starting;
    if (this.child) return Promise.resolve(false); // A killed session must close before replacement.
    if (process.platform !== 'win32') return Promise.resolve(false);
    this.sessionId = randomUUID();
    this.starting = new Promise((resolve) => {
      let temporary; let child; let buffer = '';
      const done = (value) => { clearTimeout(startTimer); resolve(value); };
      const startTimer = setTimeout(() => { if (child) this.invalidate(child); done(false); }, 7000);
      try {
        const source = (this.testMode ? '#define V2P_NATIVE_TEST\n' : '') + fs.readFileSync(path.join(__dirname, 'native-input-guard.cs'), 'utf8');
        temporary = createPowerShellFile(`[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)\nAdd-Type -TypeDefinition @"\n${source}\n"@ -ReferencedAssemblies 'System.Web.Extensions.dll' -ErrorAction Stop\n[V2PInputSession]::Run()`);
        child = this.spawnProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', temporary.file], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
        this.child = child;
        const closed = () => {
          if (this.child !== child) return;
          this.invalidate(child); this.child = null; this.closing = false; done(false);
        };
        child.on('error', () => { this.invalidate(child); done(false); });
        child.on('close', () => { try { temporary.cleanup(); } catch {} closed(); });
        child.stdin.on('error', () => this.invalidate(child));
        child.stdout.on('data', (chunk) => {
          buffer += chunk.toString();
          if (buffer.length > 65536) { this.invalidate(child); return; }
          let end;
          while ((end = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
            let value; try { value = JSON.parse(line); } catch { continue; }
            if (!this.sessionId) continue;
            if (value.type === 'ready') { this.running = true; this.generation = value.generation; done(true); }
            else if (value.type === 'unavailable') { this.invalidate(child); done(false); }
            else if (value.type === 'dirty') { this.generation = value.generation; this.onDirty(value.generation); }
            else if (this.testMode && value.type === 'test-wait') this.onTestWait(value.id);
            else if (this.pending.has(value.id)) {
              const finish = this.pending.get(value.id).finish;
              const result = { ...value, sessionId: this.sessionId };
              if (this.testMode && value.sent && this.onTestResponse) this.onTestResponse(result, () => finish(result));
              else finish(result);
            }
          }
        });
      } catch { if (temporary) temporary.cleanup(); if (child) this.invalidate(child); else { this.running = false; this.sessionId = null; } done(false); }
    }).finally(() => { this.starting = null; });
    return this.starting;
  }
  invalidate(child = this.child) {
    if (child !== this.child) return;
    const active = !!this.sessionId;
    this.running = false; this.sessionId = null;
    for (const request of [...this.pending.values()]) request.finish({ sent: false, reason: 'session-lost' });
    if (active) this.onUnavailable();
    if (child && !this.closing) { this.closing = true; child.kill(); }
  }
  request(metadata, { signal } = {}) {
    if (!this.running || !this.child || (signal && signal.aborted)) return Promise.resolve({ sent: false });
    const id = ++this.sequence;
    return new Promise((resolve) => {
      const finish = (value) => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id); clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', abort);
        resolve(value);
      };
      const abort = () => this.invalidate(); // Kill unsent work, not merely its response.
      const timer = setTimeout(() => this.invalidate(), 5000);
      this.pending.set(id, { finish });
      if (signal) signal.addEventListener('abort', abort, { once: true });
      try { this.child.stdin.write(JSON.stringify({ ...metadata, id }) + '\n'); }
      catch { this.invalidate(); }
    });
  }
  async send(events, target, { signal, expectedGeneration, sessionId, testWaitFile } = {}) {
    if (signal && signal.aborted) return { sent: false };
    // A stale operation can never restart a lost session and use its new counter.
    if (sessionId && (!this.running || sessionId !== this.sessionId)) return { sent: false, reason: 'session-lost' };
    if (!this.running && !(await this.start())) return { sent: false };
    return this.request({ type: 'send', target, keys: events.map((e) => e[0]), flags: events.map((e) => e[1]), expectedGeneration: Number.isSafeInteger(expectedGeneration) ? expectedGeneration : -1,
      ...(this.testMode && testWaitFile ? { testWaitFile } : {}) }, { signal });
  }
  setToastBounds(bounds) { return this.request({ type: 'bounds', ...(bounds || { hwnd: 0, left: 0, top: 0, right: 0, bottom: 0 }) }); }
  stop() { this.invalidate(); }
}
const nativeInputSession = new NativeInputSession();
module.exports = { NativeInputSession, nativeInputSession };

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const MAX_LINE_BYTES = 96 * 1024 * 1024;

function buildWorkerScript() {
  return String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
Add-Type -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
public static class V2PCaptureWorker {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  public static string Capture(int x, int y, int width, int height) {
    using (var bitmap = new Bitmap(width, height, PixelFormat.Format32bppArgb))
    using (var graphics = Graphics.FromImage(bitmap))
    using (var stream = new MemoryStream()) {
      graphics.CopyFromScreen(x, y, 0, 0, bitmap.Size, CopyPixelOperation.SourceCopy);
      bitmap.Save(stream, ImageFormat.Png);
      return Convert.ToBase64String(stream.ToArray());
    }
  }
}
"@ -ReferencedAssemblies 'System.Drawing' -ErrorAction Stop
[void][V2PCaptureWorker]::SetProcessDpiAwarenessContext([IntPtr](-4))
[Console]::Out.WriteLine('{"ready":true}')
while (($line = [Console]::In.ReadLine()) -ne $null) {
  $requestId = $null
  try {
    $request = $line | ConvertFrom-Json -ErrorAction Stop
    $requestId = [string]$request.id
    $screens = @([System.Windows.Forms.Screen]::AllScreens)
    $captures = @($request.monitors | ForEach-Object {
      $target = $_
      $matches = @($screens | Where-Object {
        [Math]::Abs($_.Bounds.X - [int]$target.x) -le 2 -and [Math]::Abs($_.Bounds.Y - [int]$target.y) -le 2 -and
        [Math]::Abs($_.Bounds.Width - [int]$target.width) -le 2 -and [Math]::Abs($_.Bounds.Height - [int]$target.height) -le 2
      })
      if ($matches.Count -ne 1) { throw ('Physical monitor identity is ambiguous for display ' + [string]$target.id) }
      $screen = $matches[0]
      $width = [int]$screen.Bounds.Width; $height = [int]$screen.Bounds.Height
      if ($width -lt 1 -or $height -lt 1 -or $width -gt 16384 -or $height -gt 16384) { throw 'Capture bounds are outside limits' }
      [PSCustomObject]@{ id = [string]$target.id; x = $screen.Bounds.X; y = $screen.Bounds.Y; width = $screen.Bounds.Width; height = $screen.Bounds.Height; png = [V2PCaptureWorker]::Capture($screen.Bounds.X, $screen.Bounds.Y, $width, $height) }
    })
    @{ id = $requestId; captures = $captures } | ConvertTo-Json -Compress -Depth 5 | ForEach-Object { [Console]::Out.WriteLine($_) }
  } catch {
    @{ id = $requestId; error = $_.Exception.Message } | ConvertTo-Json -Compress | ForEach-Object { [Console]::Out.WriteLine($_) }
  }
}`;
}

function createScreenshotCaptureWorker(options = {}) {
  const platform = options.platform || process.platform;
  const spawnProcess = options.spawn || spawn;
  const timeout = options.timeout || 10000;
  let child = null;
  let sourceFile = null;
  let sequence = 0;
  let pending = null;
  let readyResolve = null;
  let readyReject = null;
  let readyTimer = null;
  let stdout = '';
  let disposed = false;
  let warmPromise = null;

  function ensureSource() {
    if (sourceFile) return sourceFile;
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'v2p-capture-worker-'));
    sourceFile = path.join(directory, 'capture-worker.ps1');
    fs.writeFileSync(sourceFile, '\uFEFF' + buildWorkerScript(), 'utf16le');
    return sourceFile;
  }

  function rejectPending(error) {
    if (!pending) return;
    const current = pending;
    pending = null;
    clearTimeout(current.timer);
    current.reject(error);
  }

  function start() {
    if (disposed) throw new Error('Screenshot capture worker is disposed');
    if (child && child.exitCode === null && !child.killed) return child;
    if (platform !== 'win32') throw new Error('Persistent native screenshot capture is only available on Windows');
    child = spawnProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ensureSource()], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'ignore']
    });
    stdout = '';
    const started = child;
    child.stdout.on('data', (chunk) => {
      if (child !== started) return;
      stdout += chunk.toString('utf8');
      if (Buffer.byteLength(stdout) > MAX_LINE_BYTES) {
        child.kill();
        rejectPending(new Error('Screenshot capture worker output exceeded limit'));
        return;
      }
      let newline;
      while ((newline = stdout.indexOf('\n')) >= 0) {
        const line = stdout.slice(0, newline).trim();
        stdout = stdout.slice(newline + 1);
        if (line === '{"ready":true}') {
          clearTimeout(readyTimer);
          readyTimer = null;
          readyResolve?.(true);
          readyResolve = null;
          readyReject = null;
        } else if (line) handleLine(line);
      }
    });
    child.on('error', (error) => { if (child === started) { readyReject?.(error); rejectPending(error); } });
    child.on('close', (code) => {
      if (child !== started) return;
      clearTimeout(readyTimer);
      readyReject?.(new Error(`Screenshot capture worker exited during startup (${code})`));
      readyResolve = null;
      readyReject = null;
      rejectPending(new Error(`Screenshot capture worker exited (${code})`));
      child = null;
      warmPromise = null;
    });
    return child;
  }

  function handleLine(line) {
    let response;
    try { response = JSON.parse(line); }
    catch { rejectPending(new Error('Screenshot capture worker returned invalid JSON')); return; }
    if (!pending || response.id !== pending.id) return;
    const current = pending;
    pending = null;
    clearTimeout(current.timer);
    if (response.error) current.reject(new Error(String(response.error).slice(0, 200)));
    else current.resolve(response.captures || []);
  }

  function capture(monitors, options = {}) {
    if (!Array.isArray(monitors) || !monitors.length) return Promise.reject(new Error('At least one monitor is required'));
    if (options.signal?.aborted) return Promise.reject(new Error('Screenshot capture cancelled'));
    let process;
    try { process = start(); }
    catch (error) { return Promise.reject(error); }
    if (pending) return Promise.reject(new Error('Screenshot capture worker is already busy'));
    const id = String(++sequence);
    return new Promise((resolve, reject) => {
      const signal = options.signal;
      const onAbort = () => {
        rejectPending(new Error('Screenshot capture cancelled'));
        if (child === process) process.kill();
      };
      const timer = setTimeout(() => {
        const failure = new Error('Screenshot capture worker timed out');
        rejectPending(failure);
        if (child === process) process.kill();
      }, timeout);
      pending = { id, timer, resolve: (value) => { signal?.removeEventListener('abort', onAbort); resolve(value); },
        reject: (error) => { signal?.removeEventListener('abort', onAbort); reject(error); } };
      signal?.addEventListener('abort', onAbort, { once: true });
      try { process.stdin.write(JSON.stringify({ id, monitors }) + '\n'); }
      catch (error) { rejectPending(error); process.kill(); }
    });
  }

  function warm() {
    if (disposed || platform !== 'win32') return Promise.resolve(false);
    if (!warmPromise) {
      try {
        start();
        warmPromise = new Promise((resolve, reject) => {
          readyResolve = resolve;
          readyReject = reject;
          readyTimer = setTimeout(() => {
            readyTimer = null;
            readyReject = null;
            readyResolve = null;
            reject(new Error('Screenshot capture worker startup timed out'));
            if (child) child.kill();
          }, timeout);
        }).catch(() => { warmPromise = null; return false; });
      } catch (error) { warmPromise = Promise.reject(error).catch(() => false); }
    }
    return warmPromise;
  }

  function dispose() {
    disposed = true;
    clearTimeout(readyTimer);
    readyReject?.(new Error('Screenshot capture worker disposed'));
    readyResolve = null; readyReject = null; warmPromise = null;
    rejectPending(new Error('Screenshot capture worker disposed'));
    if (child) { try { child.kill(); } catch {} child = null; }
    if (sourceFile) {
      try { fs.rmSync(path.dirname(sourceFile), { recursive: true, force: true }); } catch {}
      sourceFile = null;
    }
  }

  return { capture, warm, dispose, get running() { return !!child && child.exitCode === null && !child.killed; } };
}

module.exports = { buildWorkerScript, createScreenshotCaptureWorker };

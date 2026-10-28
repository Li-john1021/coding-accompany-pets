'use strict';

// Shared native mouse helper for Windows runtime tests (SendInput + SetCursorPos).

const { spawn } = require('child_process');

function startInputHelper() {
  const script = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class V2PInput {
  [StructLayout(LayoutKind.Sequential)] public struct MOUSE { public int x,y; public uint data,flags,time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] public struct UNION { [FieldOffset(0)] public MOUSE mouse; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public UNION data; }
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
  public static uint Down() { INPUT[] i = new INPUT[1]; i[0].type=0; i[0].data.mouse.flags=0x0002; return SendInput(1,i,Marshal.SizeOf(typeof(INPUT))); }
  public static uint Up() { INPUT[] i = new INPUT[1]; i[0].type=0; i[0].data.mouse.flags=0x0004; return SendInput(1,i,Marshal.SizeOf(typeof(INPUT))); }
  public static uint Wheel(int delta) { INPUT[] i = new INPUT[1]; i[0].type=0; i[0].data.mouse.flags=0x0800; i[0].data.mouse.data=(uint)delta; return SendInput(1,i,Marshal.SizeOf(typeof(INPUT))); }
}
"@ -ErrorAction Stop
[void][V2PInput]::SetProcessDpiAwarenessContext([IntPtr](-4))
[Console]::Out.WriteLine('INPUT_READY')
while (($line = [Console]::In.ReadLine()) -ne $null) {
  $p = $line.Split(' ')
  try {
    switch ($p[0]) {
      'move' { [void][V2PInput]::SetCursorPos([int]$p[1],[int]$p[2]); Start-Sleep -Milliseconds 50 }
      'down' { if ([V2PInput]::Down() -ne 1) { throw 'SendInput down failed' }; Start-Sleep -Milliseconds 70 }
      'up' { if ([V2PInput]::Up() -ne 1) { throw 'SendInput up failed' }; Start-Sleep -Milliseconds 70 }
      'wheel' { if ([V2PInput]::Wheel([int]$p[1]) -ne 1) { throw 'SendInput wheel failed' }; Start-Sleep -Milliseconds 100 }
    }
    [Console]::Out.WriteLine('OK ' + $line)
  } catch { [Console]::Out.WriteLine('ERR ' + $_.Exception.Message) }
}`;
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '';
  let readyResolve;
  const ready = new Promise((resolve) => { readyResolve = resolve; });
  const waiters = [];
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line === 'INPUT_READY') { readyResolve(); continue; }
      const waiter = waiters.shift();
      if (waiter) waiter(line.startsWith('OK') ? null : new Error(line));
    }
  });
  child.stderr.on('data', () => {});
  return {
    ready,
    send(command) {
      return new Promise((resolve, reject) => {
        waiters.push((error) => error ? reject(error) : resolve());
        child.stdin.write(command + '\n');
      });
    },
    close() { try { child.kill(); } catch {} }
  };
}

module.exports = { startInputHelper };
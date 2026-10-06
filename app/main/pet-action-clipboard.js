const { runPowerShellFile } = require('./powershell-file');

function buildConditionalWriteScript() {
  return `
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class V2PConditionalClipboard {
  [DllImport("user32.dll", SetLastError = true)] static extern bool OpenClipboard(IntPtr owner);
  [DllImport("user32.dll", SetLastError = true)] static extern bool CloseClipboard();
  [DllImport("user32.dll", SetLastError = true)] static extern bool EmptyClipboard();
  [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetClipboardData(uint format, IntPtr memory);
  [DllImport("user32.dll")] static extern uint GetClipboardSequenceNumber();
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr GlobalAlloc(uint flags, UIntPtr bytes);
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr GlobalLock(IntPtr memory);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool GlobalUnlock(IntPtr memory);
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr GlobalFree(IntPtr memory);

  public static string Write(uint expected, string text, IntPtr owner) {
    byte[] bytes = Encoding.Unicode.GetBytes(text + "\\0");
    IntPtr memory = GlobalAlloc(0x0002, (UIntPtr)bytes.Length); // GMEM_MOVEABLE
    if (memory == IntPtr.Zero) return "unavailable";
    bool transferred = false;
    bool opened = false;
    try {
      IntPtr data = GlobalLock(memory);
      if (data == IntPtr.Zero) return "unavailable";
      try { Marshal.Copy(bytes, 0, data, bytes.Length); }
      finally { GlobalUnlock(memory); }
      if (!OpenClipboard(owner)) return "unavailable";
      opened = true;
      if (GetClipboardSequenceNumber() != expected) return "changed";
      if (!EmptyClipboard()) return "unavailable";
      IntPtr result = SetClipboardData(13, memory); // CF_UNICODETEXT
      if (result == IntPtr.Zero) return "unavailable";
      transferred = true;
      return "written";
    } finally {
      if (opened) CloseClipboard();
      if (!transferred) GlobalFree(memory);
    }
  }
}
"@ -ErrorAction Stop
$owner = New-Object System.Windows.Forms.Form
$owner.ShowInTaskbar = $false
$owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedToolWindow
$owner.Size = New-Object System.Drawing.Size(1, 1)
$ownerHandle = $owner.Handle
try {
  $payload = [Console]::In.ReadToEnd()
  $separator = $payload.IndexOf([char]10)
  if ($separator -lt 0) { throw 'payload invalid' }
  $expected = [uint32]::Parse($payload.Substring(0, $separator).Trim())
  $text = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($payload.Substring($separator + 1).Trim()))
  $result = [V2PConditionalClipboard]::Write($expected, $text, $ownerHandle)
  [Console]::Out.WriteLine($result)
} catch { [Console]::Out.WriteLine('unavailable'); exit 2 }
finally { $owner.Dispose() }
`;
}

function createWindowsConditionalClipboardWriter(options = {}) {
  const runScript = options.runPowerShellFile || runPowerShellFile;
  const platform = options.platform || process.platform;
  const children = new Set();
  let cancelEpoch = 0;
  return {
    writeClipboardIfSequence(sequence, text) {
      if (platform !== 'win32' || !Number.isInteger(sequence) || sequence < 0 || typeof text !== 'string') {
        return Promise.resolve(false);
      }
      const startedAt = cancelEpoch;
      const payload = `${sequence}\n${Buffer.from(text, 'utf16le').toString('base64')}\n`;
      return new Promise((resolve) => {
        let child = null;
        let completed = false;
        child = runScript(buildConditionalWriteScript(), { timeout: 5000, maxBuffer: 1024, stdin: payload }, (error, stdout) => {
          completed = true;
          if (child) children.delete(child);
          resolve(startedAt === cancelEpoch && !error && String(stdout || '').trim().split(/\r?\n/).pop() === 'written');
        });
        if (child && !completed) children.add(child);
        if (startedAt !== cancelEpoch && child && typeof child.kill === 'function') child.kill();
      });
    },
    cancelPendingWrites() {
      cancelEpoch++;
      for (const child of children) {
        try { child.kill(); } catch { /* Ignore processes that already exited. */ }
      }
      children.clear();
    }
  };
}

module.exports = { buildConditionalWriteScript, createWindowsConditionalClipboardWriter };

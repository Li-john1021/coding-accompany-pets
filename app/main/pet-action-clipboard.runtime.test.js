const assert = require('assert');
const { runPowerShellFile } = require('./powershell-file');
const { createWindowsConditionalClipboardWriter } = require('./pet-action-clipboard');

function readSafeClipboardSnapshot() {
  const script = `
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
Add-Type -TypeDefinition @"
using System.Runtime.InteropServices;
public static class V2PClipboardRuntimeSnapshot {
  [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
}
"@ -ErrorAction Stop
try {
  $data = [Windows.Forms.Clipboard]::GetDataObject()
  if ($null -eq $data) { @{ safe = $true; empty = $true; sequence = [V2PClipboardRuntimeSnapshot]::GetClipboardSequenceNumber() } | ConvertTo-Json -Compress; exit 0 }
  $formats = @($data.GetFormats($false))
  $allowed = @('UnicodeText', 'Text', 'OEMText', 'Locale')
  $safe = $formats.Count -gt 0 -and @($formats | Where-Object { $_ -notin $allowed }).Count -eq 0
  $value = ''
  if ($safe) { $value = [Windows.Forms.Clipboard]::GetText() }
  @{ safe = $safe; empty = $false; formats = $formats; text64 = if ($safe) { [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($value)) } else { '' }; sequence = [V2PClipboardRuntimeSnapshot]::GetClipboardSequenceNumber() } | ConvertTo-Json -Compress
} catch { @{ safe = $false } | ConvertTo-Json -Compress }
`;
  return new Promise((resolve) => runPowerShellFile(script, { timeout: 5000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => {
    if (error) return resolve(null);
    try { resolve(JSON.parse(String(stdout || '').trim().split(/\r?\n/).pop())); }
    catch { resolve(null); }
  }));
}

(async () => {
  if (process.platform !== 'win32') {
    console.log('SKIP Win32 conditional clipboard smoke is Windows-only');
    return;
  }
  const initial = await readSafeClipboardSnapshot();
  if (!initial || !initial.safe || !Number.isInteger(initial.sequence)) {
    console.log('SKIP clipboard formats could not be safely backed up; no clipboard write attempted');
    return;
  }
  const writer = createWindowsConditionalClipboardWriter();
  const originalText = initial.empty ? '' : Buffer.from(initial.text64, 'base64').toString('utf16le');
  const marker = `Voice2Prompt conditional clipboard smoke ${Date.now()}`;
  let markerWritten = false;
  let restoreOk = initial.empty;
  try {
    if (initial.empty) {
      console.log('SKIP initial clipboard was empty; native no-write guard is covered by unit fixtures');
      return;
    }
    const mismatchedSequence = initial.sequence === 0xffffffff ? 0 : initial.sequence + 1;
    assert.strictEqual(await writer.writeClipboardIfSequence(mismatchedSequence, marker), false,
      'a mismatched sequence must be refused while holding the native clipboard lock');
    const afterMismatch = await readSafeClipboardSnapshot();
    assert.ok(afterMismatch && afterMismatch.safe && afterMismatch.sequence === initial.sequence,
      'mismatch refusal leaves the clipboard untouched');
    markerWritten = await writer.writeClipboardIfSequence(initial.sequence, marker);
    if (!markerWritten) {
      console.log('SKIP clipboard changed or native clipboard write was unavailable; existing content was not overwritten');
      return;
    }
    const afterWrite = await readSafeClipboardSnapshot();
    assert.ok(afterWrite && afterWrite.safe && !afterWrite.empty);
    assert.strictEqual(Buffer.from(afterWrite.text64, 'base64').toString('utf16le'), marker);
    restoreOk = await writer.writeClipboardIfSequence(afterWrite.sequence, originalText);
    assert.strictEqual(restoreOk, true, 'original plain clipboard text is restored only if the test still owns the clipboard');
    console.log('PASS native conditional clipboard write and guarded text restoration');
  } finally {
    if (markerWritten && !restoreOk) {
      const last = await readSafeClipboardSnapshot();
      if (last && last.safe && !last.empty && Buffer.from(last.text64, 'base64').toString('utf16le') === marker) {
        restoreOk = await writer.writeClipboardIfSequence(last.sequence, originalText);
      }
      if (!restoreOk) throw new Error('test clipboard text could not be safely restored; newer clipboard content, if any, was left untouched');
    }
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });

// insert.js — 结果写入光标：剪贴板 + 模拟 Ctrl+V（SendInput），失败兜底仅剪贴板
//
// 关键坑（实测复现）：中文输入法打开时，SendKeys/SendInput 注入的 Ctrl+V 会被
// IME 拦截转成 VK_PROCESSKEY（Chromium 里 e.key="Process"），应用永远收不到，
// 结果就是"只进了剪贴板，还是要手动 Ctrl+V"。
// 解法：注入前先敲一下 Shift 让 IME 切到英文直通，粘完再敲一下恢复原状态；
// IME 未打开（纯英文键盘）则直接 SendInput。另外必须 -EncodedCommand：
// -Command 传参经过双层解析会把引号拆进按键流。
const { clipboard } = require('electron');
const { execFile } = require('child_process');
const { buildPasteTargetGuard } = require('./palette-paste-guard');

// true=注入成功（按键发出去了；目标是否受理无法检测，交给 copiedOnly 兜底语义）
function pasteViaSendInput(target) {
  return new Promise((resolve) => {
    let targetGuard = '';
    if (target) {
      targetGuard = buildPasteTargetGuard(target);
      if (!targetGuard) { resolve('cancelled'); return; }
    }
    const script = `
Start-Sleep -Milliseconds 100
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential)]
public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
[StructLayout(LayoutKind.Sequential)]
public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
[StructLayout(LayoutKind.Explicit)]
public struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
[StructLayout(LayoutKind.Sequential)]
public struct INPUT { public uint type; public INPUTUNION u; }
public class V2PPaste {
  [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("imm32.dll")] public static extern IntPtr ImmGetDefaultIMEWnd(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  static void Key(ushort vk, uint flags) {
    var a = new INPUT[1]; a[0].type = 1; a[0].u.ki.wVk = vk; a[0].u.ki.dwFlags = flags;
    SendInput(1, a, Marshal.SizeOf(typeof(INPUT)));
  }
  public static void Paste() {
    Key(0x11, 0); System.Threading.Thread.Sleep(30);
    Key(0x56, 0); System.Threading.Thread.Sleep(40);
    Key(0x56, 2); System.Threading.Thread.Sleep(30);
    Key(0x11, 2);
  }
  public static void TapShift() { Key(0x10, 0); System.Threading.Thread.Sleep(50); Key(0x10, 2); }
  public static bool ImeOpen() {
    IntPtr ime = ImmGetDefaultIMEWnd(GetForegroundWindow());
    if (ime == IntPtr.Zero) return false;
    return SendMessage(ime, 0x0283, (IntPtr)0x0005, IntPtr.Zero) != IntPtr.Zero; // IMC_GETOPENSTATUS
  }
}
"@
Start-Sleep -Milliseconds 60
$ime = [V2PPaste]::ImeOpen()
if ($ime) { [V2PPaste]::TapShift(); Start-Sleep -Milliseconds 120 }
${targetGuard}
[V2PPaste]::Paste()
Start-Sleep -Milliseconds 160
if ($ime) { [V2PPaste]::TapShift() }
`;
    const b64 = Buffer.from(script, 'utf16le').toString('base64');
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', b64],
      { timeout: 8000, windowsHide: true },
      (err, stdout) => {
        if (target && (err || String(stdout || '').includes('V2P_CANCEL'))) resolve('cancelled');
        else resolve(!err);
      }
    );
  });
}

// 返回 { inserted: boolean }
async function insertText(text, mode, options = {}) {
  const guarded = !!options.target;
  const oldClipboard = guarded ? clipboard.readText() || '' : '';
  clipboard.writeText(text);
  if (mode !== 'paste') return { inserted: false, copiedOnly: true };
  const result = await pasteViaSendInput(options.target);
  if (result === 'cancelled') {
    if (guarded && clipboard.readText() === text) {
      try { clipboard.writeText(oldClipboard); } catch { /* ignore */ }
    }
    return { inserted: false, copiedOnly: false, cancelled: true };
  }
  const ok = !!result;
  return { inserted: ok, copiedOnly: !ok };
}

// 模拟 Ctrl+C（选区浮条读选中文本用）；失败返回 false
function copyViaSendInput() {
  return new Promise((resolve) => {
    const script = `
Start-Sleep -Milliseconds 80
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential)]
public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
[StructLayout(LayoutKind.Explicit)]
public struct INPUTUNION { [FieldOffset(0)] public KEYBDINPUT ki; }
[StructLayout(LayoutKind.Sequential)]
public struct INPUT { public uint type; public INPUTUNION u; }
public class V2PCopy {
  [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
  static void Key(ushort vk, uint flags) {
    var a = new INPUT[1]; a[0].type = 1; a[0].u.ki.wVk = vk; a[0].u.ki.dwFlags = flags;
    SendInput(1, a, Marshal.SizeOf(typeof(INPUT)));
  }
  public static void Copy() {
    Key(0x11, 0); System.Threading.Thread.Sleep(25);
    Key(0x43, 0); System.Threading.Thread.Sleep(35);
    Key(0x43, 2); System.Threading.Thread.Sleep(25);
    Key(0x11, 2);
  }
}
"@
[V2PCopy]::Copy()
`;
    const b64 = Buffer.from(script, 'utf16le').toString('base64');
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', b64],
      { timeout: 5000, windowsHide: true },
      (err) => resolve(!err)
    );
  });
}

// 读取当前选中文字：备份剪贴板 → Ctrl+C → 读文本
async function readSelection() {
  const old = clipboard.readText() || '';
  const marker = ' v2p#' + Date.now();
  clipboard.writeText(marker);
  let pressed = false;
  try {
    const { uIOhook, UiohookKey } = require('uiohook-napi');
    uIOhook.keyTap(UiohookKey.C, [UiohookKey.Ctrl]);
    pressed = true;
  } catch (e) {
    pressed = await copyViaSendInput();
  }
  if (!pressed) {
    clipboard.writeText(old);
    return { text: '', oldClipboard: old, ok: false };
  }
  await new Promise((r) => setTimeout(r, 150));
  let text = clipboard.readText() || '';
  if (text === marker) {
    await copyViaSendInput();
    await new Promise((r) => setTimeout(r, 160));
    text = clipboard.readText() || '';
  }
  if (text === marker) {
    clipboard.writeText(old);
    return { text: '', oldClipboard: old, ok: true };
  }
  return { text, oldClipboard: old, ok: true };
}

module.exports = { insertText, readSelection, copyViaSendInput };

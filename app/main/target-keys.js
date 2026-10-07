const { runPowerShellFile } = require('./powershell-file');
// Re-check the captured HWND, process, thread, classes and focused child in the same
// native routine that sends a single chord. Never activate a target or send Enter.
function buildTargetKeysScript(chord, target) {
  const keys = { 'ctrl-v': [0x11, 0x56], 'shift-insert': [0x10, 0x2d], 'ctrl-shift-v': [0x11, 0x10, 0x56], 'ctrl-z': [0x11, 0x5a] }[chord];
  if (!keys || !target || !['hwnd', 'pid', 'threadId', 'focusHwnd'].every((key) => Number.isSafeInteger(target[key]) && target[key] > 0)) return null;
  // Base64 keeps class/process strings data, not executable PowerShell source.
  const encoded = Buffer.from(JSON.stringify(target), 'utf8').toString('base64');
  return `
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices; using System.Text;
public class V2PTargetKeys {
 [StructLayout(LayoutKind.Sequential)] public struct RECT { public int l,t,r,b; }
 [StructLayout(LayoutKind.Sequential)] public struct GUI { public int size,flags; public IntPtr active,focus,capture,menu,move,caret; public RECT rect; }
 [StructLayout(LayoutKind.Sequential)] public struct KEY { public ushort vk,scan; public uint flags,time; public IntPtr extra; }
 [StructLayout(LayoutKind.Sequential)] public struct MOUSE { public int x,y; public uint data,flags,time; public IntPtr extra; }
 [StructLayout(LayoutKind.Explicit)] public struct UNION { [FieldOffset(0)] public KEY key; [FieldOffset(0)] public MOUSE mouse; }
 [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public UNION data; }
 [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint t, ref GUI g);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,StringBuilder b,int n);
 [DllImport("user32.dll")] static extern uint SendInput(uint n,INPUT[] i,int size);
 static string Class(IntPtr h) { var b=new StringBuilder(256); GetClassName(h,b,256); return b.ToString(); }
 public static bool Send(long hwnd,uint pid,uint thread,long focus,string wc,string fc,string process,ushort[] keys) {
  var h=GetForegroundWindow(); uint p; var t=GetWindowThreadProcessId(h,out p);
  var g=new GUI(); g.size=Marshal.SizeOf(g);
  if(h.ToInt64()!=hwnd || p!=pid || t!=thread || !GetGUIThreadInfo(t,ref g) || g.focus.ToInt64()!=focus || Class(h)!=wc || Class(g.focus)!=fc) return false;
  if(System.Diagnostics.Process.GetProcessById((int)p).ProcessName!=process) return false;
  var input=new INPUT[keys.Length*2];
  for(int i=0;i<keys.Length;i++) { input[i].type=1; input[i].data.key.vk=keys[i]; input[keys.Length+i].type=1; input[keys.Length+i].data.key.vk=keys[keys.Length-1-i]; input[keys.Length+i].data.key.flags=2; }
  return SendInput((uint)input.Length,input,Marshal.SizeOf(typeof(INPUT)))==input.Length;
 }
}
"@ -ErrorAction Stop
$t = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')) | ConvertFrom-Json
$sent = [V2PTargetKeys]::Send($t.hwnd,$t.pid,$t.threadId,$t.focusHwnd,$t.windowClass,$t.focusClass,$t.processName,[ushort[]]@(${keys.join(',')}))
if ($sent) { 'V2P_SENT' }
`;
}
function sendTargetChord(chord, target) {
  const script = process.platform === 'win32' && buildTargetKeysScript(chord, target);
  if (!script) return Promise.resolve(false);
  return new Promise((resolve) => runPowerShellFile(script, { timeout: 5000, maxBuffer: 4096 },
    (error, stdout) => resolve(!error && String(stdout).trim() === 'V2P_SENT')));
}
module.exports = { buildTargetKeysScript, sendTargetChord };

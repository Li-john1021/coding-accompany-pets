const { runPowerShellFile } = require('./powershell-file');
// Re-check the captured HWND, process, thread, classes and focused child in the same
// native routine that sends a single chord. Never activate a target or send Enter.
function buildTargetKeysScript(chord, target, waitForCommit = false) {
  const packets = { 'ctrl-v': [[0x11, 0x56]], 'shift-insert': [[0x10, 0x2d]], 'ctrl-shift-v': [[0x11, 0x10, 0x56]], 'ctrl-z': [[0x11, 0x5a]], 'voice-restore': [[0x11, 0x5a], [0x11, 0x56]] }[chord];
  if (!packets || !target || !['hwnd', 'pid', 'threadId', 'focusHwnd'].every((key) => Number.isSafeInteger(target[key]) && target[key] > 0)) return null;
  const events = packets.flatMap((keys) => [...keys.map((key) => [key, 0]), ...keys.slice().reverse().map((key) => [key, 2])]);
  // Base64 keeps class/process strings data, not executable PowerShell source.
  const encoded = Buffer.from(JSON.stringify(target), 'utf8').toString('base64');
  return `
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices; using System.Text;
public class V2PTargetKeys {
 public static string Status = "V2P_TARGET_CHANGED";
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
 [DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint n,INPUT[] i,int size);
 static string Class(IntPtr h) { var b=new StringBuilder(256); GetClassName(h,b,256); return b.ToString(); }
 public static bool Send(long hwnd,uint pid,uint thread,long focus,string wc,string fc,string process,ushort[] keys,uint[] flags) {
  var h=GetForegroundWindow(); uint p; var t=GetWindowThreadProcessId(h,out p);
  var g=new GUI(); g.size=Marshal.SizeOf(g);
  if(h.ToInt64()!=hwnd) { Status="V2P_HWND_CHANGED"; return false; }
  if(p!=pid || t!=thread) { Status="V2P_PROCESS_THREAD_CHANGED"; return false; }
  if(!GetGUIThreadInfo(t,ref g)) { Status="V2P_FOCUS_UNAVAILABLE"; return false; }
  if(g.focus.ToInt64()!=focus) { Status="V2P_FOCUS_CHANGED"; return false; }
  if(Class(h)!=wc || Class(g.focus)!=fc) { Status="V2P_CLASS_CHANGED"; return false; }
  if(System.Diagnostics.Process.GetProcessById((int)p).ProcessName!=process) { Status="V2P_PROCESS_CHANGED"; return false; }
  var input=new INPUT[keys.Length];
  for(int i=0;i<keys.Length;i++) { input[i].type=1; input[i].data.key.vk=keys[i]; input[i].data.key.flags=flags[i]; }
  var sent = SendInput((uint)input.Length,input,Marshal.SizeOf(typeof(INPUT)))==input.Length;
  Status = sent ? "V2P_SENT" : "V2P_INPUT_FAILED_" + Marshal.GetLastWin32Error();
  return sent;
 }
}
"@ -ErrorAction Stop
$t = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')) | ConvertFrom-Json
${waitForCommit ? `[Console]::Out.WriteLine('V2P_READY')
[Console]::Out.Flush()
if ([Console]::In.ReadLine() -ne 'COMMIT') { exit 0 }` : ''}
try {
 $sent = [V2PTargetKeys]::Send($t.hwnd,$t.pid,$t.threadId,$t.focusHwnd,$t.windowClass,$t.focusClass,$t.processName,[uint16[]]@(${events.map((event) => event[0]).join(',')}),[uint32[]]@(${events.map((event) => event[1]).join(',')}))
} catch { [V2PTargetKeys]::Status = 'V2P_NATIVE_ERROR: ' + $_.Exception.Message }
[V2PTargetKeys]::Status
`;
}
function sendTargetChord(chord, target, { signal, onCommit } = {}) {
  if (signal && signal.aborted) return Promise.resolve(false);
  const script = process.platform === 'win32' && buildTargetKeysScript(chord, target, !!signal);
  if (!script) return Promise.resolve(false);
  return new Promise((resolve) => {
    let child = null;
    let settled = false;
    let aborted = false;
    let committed = false;
    let output = '';
    const onAbort = () => { if (committed) return; aborted = true; if (child) child.kill(); };
    const onData = (chunk) => {
      output += chunk.toString();
      if (!committed && output.split(/\r?\n/).includes('V2P_READY')) {
        if (aborted || signal.aborted) { onAbort(); return; }
        // End startup cancellation immediately before granting the one native packet.
        committed = true;
        signal.removeEventListener('abort', onAbort);
        try { if (onCommit) onCommit(); child.stdin.end('COMMIT\n'); }
        catch { aborted = true; child.kill(); }
      }
    };
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      if (child && child.stdout && signal) child.stdout.removeListener('data', onData);
      resolve(value);
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    try {
      child = runPowerShellFile(script, { timeout: 5000, maxBuffer: 4096, keepStdinOpen: !!signal },
        (error, stdout) => finish(!aborted && (!signal || committed) && !error && String(stdout).trim().split(/\r?\n/).pop() === 'V2P_SENT'));
      if (child && child.stdout && signal) child.stdout.on('data', onData);
      if (aborted && child) child.kill();
      if (!child && !settled) finish(false);
    } catch { finish(false); }
  });
}
module.exports = { buildTargetKeysScript, sendTargetChord };

// Isolated Windows native tests: no user profile, no model/ASR, own Edit HWND only.
const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { once } = require('events');
const ARG = '--native-input-fixture'; const PREFIX = 'NATIVE_INPUT_E2E:';
async function waitFor(predicate, label) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) { const value = await predicate(); if (value) return value; await new Promise((r) => setTimeout(r, 30)); }
  throw Error('Timeout: ' + label);
}
async function run() {
  const { app, clipboard } = require('electron'); const directory = process.env.V2P_NATIVE_TEST_DIR;
  app.setPath('userData', directory); await app.whenReady();
  const previous = { text: clipboard.readText(), html: clipboard.readHTML(), rtf: clipboard.readRTF(), image: clipboard.readImage() };
  const { NativeInputSession } = require('./native-input-session'); const { keyEvents } = require('./target-keys');
  const { getWindowsSnapshot } = require('./pet-action-capture'); const { createResultDelivery } = require('./result-delivery');
  const { runPowerShellFile, createPowerShellFile } = require('./powershell-file'); const { buildNativeEditPowerShell } = require('./win32-edit');
  let form, injector, temporary; const session = new NativeInputSession({ testMode: true });
  const stopFile = path.join(directory, 'stop');
  try {
    const exe = path.join(directory, 'EditFixture.exe'); const readyFile = path.join(directory, 'ready.json');
    execFileSync(path.join(process.env.WINDIR, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'), ['/nologo', '/target:winexe', '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', '/out:' + exe, path.join(__dirname, 'fixtures', 'palette-probe-runtime-win32-edit.cs')], { windowsHide: true, timeout: 20000 });
    form = spawn(exe, [readyFile, stopFile, path.join(directory, 'focus'), path.join(directory, 'ack'), path.join(directory, 'keep-front')], { windowsHide: true, stdio: 'ignore' });
    const own = await waitFor(() => fs.existsSync(readyFile) && JSON.parse(fs.readFileSync(readyFile, 'utf8')), 'native source');
    const focus = (handle) => new Promise((resolve, reject) => runPowerShellFile(`
Add-Type -TypeDefinition @"
using System;using System.Runtime.InteropServices;
public class OwnNativeFocus {
 [DllImport("user32.dll")]static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")]static extern IntPtr GetAncestor(IntPtr h,uint f);
 [DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("kernel32.dll")]static extern uint GetCurrentThreadId();
 [DllImport("user32.dll")]static extern bool AttachThreadInput(uint a,uint b,bool on);
 [DllImport("user32.dll")]static extern bool BringWindowToTop(IntPtr h);
 [DllImport("user32.dll")]static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")]static extern IntPtr SetFocus(IntPtr h);
 public static void Focus(long edit) {uint p;var current=GetCurrentThreadId();var fg=GetWindowThreadProcessId(GetForegroundWindow(),out p);var target=GetWindowThreadProcessId((IntPtr)edit,out p);AttachThreadInput(current,fg,true);AttachThreadInput(current,target,true);var root=GetAncestor((IntPtr)edit,2);BringWindowToTop(root);SetForegroundWindow(root);SetFocus((IntPtr)edit);AttachThreadInput(current,target,false);AttachThreadInput(current,fg,false);}
}
"@
[OwnNativeFocus]::Focus(${handle})`, { timeout: 5000, maxBuffer: 4096 }, (error) => error ? reject(error) : resolve()));
    await focus(own.hwnd);
    const focused = await waitFor(async () => { const s = await getWindowsSnapshot(false, true); return s && s.target.pid === own.pid && s.target.focusHwnd === own.hwnd && s; }, 'own native foreground');
    const target = focused.target;
    const ps = (code) => new Promise((resolve, reject) => runPowerShellFile(buildNativeEditPowerShell() + '\n' + code, { timeout: 5000, maxBuffer: 8192 }, (error, stdout) => error ? reject(error) : resolve(String(stdout).trim())));
    const text = () => ps(`[V2PNativeEdit]::ReadText([IntPtr]${own.hwnd})`);
    const clear = () => ps(`Add-Type -TypeDefinition @"
using System;using System.Runtime.InteropServices; public class TestOwnEdit { [DllImport("user32.dll",CharSet=CharSet.Unicode,EntryPoint="SendMessageW")] public static extern IntPtr Set(IntPtr h,uint m,IntPtr w,string s); }
"@
[void][TestOwnEdit]::Set([IntPtr]${own.hwnd},12,[IntPtr]::Zero,"")`);
    assert.equal(await session.start(), true); await clear(); clipboard.writeText('OWN PASTE');
    const sent = await session.send(keyEvents('ctrl-v'), target); assert.equal(sent.sent, true);
    assert.equal(await text(), 'OWN PASTE');
    assert.equal((await session.request({ type: 'snapshot' })).generation, sent.generation, 'own marker must not dirty the native generation');
    assert.equal((await session.send(keyEvents('ctrl-z'), target, { expectedGeneration: sent.generation, sessionId: sent.sessionId })).sent, true);
    assert.equal(await text(), '');
    clipboard.writeText('VOICE PROCESSED'); const voice = await session.send(keyEvents('ctrl-v'), target);
    clipboard.writeText('INITIAL ASR');
    assert.equal((await session.send(keyEvents('voice-restore'), target, { expectedGeneration: voice.generation, sessionId: voice.sessionId })).sent, true);
    assert.equal(await text(), 'INITIAL ASR', 'own native voice packet restores initial ASR in the input box');

    // A precompiled external injector waits on stdin. Its key carries extraInfo=0.
    temporary = createPowerShellFile(`Add-Type -TypeDefinition @"
using System;using System.Runtime.InteropServices;
public class ExternalTestKey {
 [StructLayout(LayoutKind.Sequential)] public struct K { public ushort vk,scan;public uint flags,time;public IntPtr extra; }
 [StructLayout(LayoutKind.Sequential)] public struct M { public int x,y;public uint data,flags,time;public IntPtr extra; }
 [StructLayout(LayoutKind.Explicit)] public struct U { [FieldOffset(0)]public K key;[FieldOffset(0)]public M mouse; }
 [StructLayout(LayoutKind.Sequential)] public struct I {public uint type;public U data;}
 [DllImport("user32.dll")]static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")]static extern uint SendInput(uint n,I[] a,int size);
 public static bool Send(long h) { if(GetForegroundWindow().ToInt64()!=h)return false;var a=new I[2];for(int i=0;i<2;i++){a[i].type=1;a[i].data.key.vk=49;a[i].data.key.flags=(uint)(i*2);}return SendInput(2,a,Marshal.SizeOf(typeof(I)))==2; }
}
"@
[Console]::Out.WriteLine('READY');[Console]::Out.Flush()
while([Console]::In.ReadLine() -eq 'GO') { if([ExternalTestKey]::Send(${target.hwnd})){[Console]::Out.WriteLine('SENT')}else{[Console]::Out.WriteLine('REJECTED')};[Console]::Out.Flush() }`);
    injector = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', temporary.file], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    let injectorOutput = ''; injector.stdout.on('data', (x) => { injectorOutput += x.toString(); });
    await waitFor(() => injectorOutput.includes('READY'), 'external injector compiled');
    const inject = async () => { injectorOutput = ''; injector.stdin.write('GO\n'); await waitFor(() => injectorOutput.includes('SENT'), 'external input delivered to own Edit'); };

    // F-001: native identity work completed; pause before its final pump/check.
    await clear(); clipboard.writeText('PASTED'); const baseline = await session.send(keyEvents('ctrl-v'), target);
    const releaseFile = path.join(directory, 'release-native'); let external;
    session.onTestWait = () => { external = inject(); setTimeout(() => fs.writeFileSync(releaseFile, 'release'), 100); };
    const refused = await session.send(keyEvents('ctrl-z'), target, { expectedGeneration: baseline.generation, sessionId: baseline.sessionId, testWaitFile: releaseFile });
    await external; assert.equal(refused.sent, false); assert.equal(refused.reason, 'dirty');
    assert.equal(await text(), 'PASTED1', 'real external input survives; native final check must not send Undo');

    // Initial paste has no expected generation, so its final identity recheck is essential.
    const windowRelease = path.join(directory, 'release-window'); let switched;
    session.onTestWait = () => { switched = focus(own.hwndB).then(() => fs.writeFileSync(windowRelease, 'release')); };
    const changed = await session.send(keyEvents('ctrl-v'), target, { testWaitFile: windowRelease });
    await switched; assert.equal(changed.sent, false); assert.equal(changed.reason, 'target-changed');
    assert.equal(await text(), 'PASTED1'); await focus(own.hwnd);

    // F-003: native paste completed, but deliberately hold its JS response.
    await clear(); let entered, resume, token; const injected = new Promise((resolve) => { entered = resolve; });
    session.onTestResponse = (_value, finish) => { session.onTestResponse = null; resume = finish; entered(); };
    const chords = []; let delivery;
    delivery = createResultDelivery({ platform: 'win32', snapshot: () => getWindowsSnapshot(false, true), guardAvailable: () => session.running,
      writeClipboard: async (value) => clipboard.writeText(value), onShow: (p) => { token = p.token; },
      sendChord: (chord, host, options) => { chords.push(chord); return session.send(keyEvents(chord), host, options); } });
    session.onDirty = () => delivery.markDirty();
    const pending = delivery.deliver({ original: 'ORIGINAL', text: 'PASTED', target, insertMode: 'paste' });
    await injected; await inject(); resume(); await pending;
    const undo = await delivery.undo(token); assert.equal(undo.restored, false); assert.deepEqual(chords, ['ctrl-v']);
    assert.equal(await text(), 'PASTED1'); assert.equal(clipboard.readText(), 'ORIGINAL');
    delivery.clear();
    console.log(PREFIX + JSON.stringify({ ok: true, host: 'Windows native Win32 Edit', ownMarker: true, preSendDirtyRejected: true, preSendTargetChangedRejected: true, postPasteBridgeDirtyPreserved: true }));
  } catch (error) { console.error(PREFIX + JSON.stringify({ ok: false, error: error.stack })); process.exitCode = 1; }
  finally { session.stop(); if(injector) injector.kill(); if(temporary) temporary.cleanup(); if(form) { fs.writeFileSync(stopFile, 'stop'); form.kill(); } clipboard.write(previous); app.quit(); }
}
if(process.argv.includes(ARG)) run();
else {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'v2p-native-input-'));
  const child = spawn(require('electron'), [__filename, ARG], { windowsHide: true, env: { ...process.env, V2P_NATIVE_TEST_DIR: directory }, stdio: ['ignore','pipe','pipe'] });
  let output=''; child.stdout.on('data',(x)=>{output+=x;}); child.stderr.on('data',(x)=>{output+=x;});
  const timeout=setTimeout(()=>child.kill(),90000);
  child.on('close',(code)=>{clearTimeout(timeout);try {const line=output.split(/\r?\n/).find((x)=>x.startsWith(PREFIX));assert.ok(line,output.slice(-1200));const result=JSON.parse(line.slice(PREFIX.length));assert.equal(result.ok,true,result.error);assert.equal(code,0);console.log('PASS actual native own packet/voice Undo, external-origin input and target switch before final dispatch, and post-paste bridge dirty preservation');}catch(error){console.error(error);process.exitCode=1;}finally{fs.rmSync(directory,{recursive:true,force:true});}});
}

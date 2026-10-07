using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

// This process receives target/key metadata only. It never reads target text.
public static class V2PInputSession {
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int x, y; }
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int l,t,r,b; }
    [StructLayout(LayoutKind.Sequential)] struct GUI { public int size,flags; public IntPtr active,focus,capture,menu,move,caret; public RECT rect; }
    [StructLayout(LayoutKind.Sequential)] struct KEY { public ushort vk,scan; public uint flags,time; public IntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct MOUSE { public int x,y; public uint data,flags,time; public IntPtr extra; }
    [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public KEY key; [FieldOffset(0)] public MOUSE mouse; }
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION data; }
    [StructLayout(LayoutKind.Sequential)] struct KHOOK { public uint vk,scan,flags,time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct MHOOK { public POINT point; public uint data,flags,time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public UIntPtr w; public IntPtr l; public uint time; public POINT point; }
    delegate IntPtr Hook(int code, IntPtr w, IntPtr l);
    delegate void WinEvent(IntPtr hook, uint type, IntPtr hwnd, int obj, int child, uint thread, uint time);
    [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, Hook callback, IntPtr module, uint thread);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook,int code,IntPtr w,IntPtr l);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern bool PostThreadMessage(uint thread,uint message,UIntPtr w,IntPtr l);
    [DllImport("user32.dll")] static extern int GetMessage(out MSG msg,IntPtr hwnd,uint min,uint max);
    [DllImport("user32.dll")] static extern bool PeekMessage(out MSG msg,IntPtr hwnd,uint min,uint max,uint remove);
    [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG msg);
    [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG msg);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
    [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread,ref GUI info);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,StringBuilder b,int n);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT point);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h,uint flags);
    [DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint count,INPUT[] inputs,int size);
    [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min,uint max,IntPtr module,WinEvent callback,uint process,uint thread,uint flags);
    [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
    static readonly ConcurrentQueue<Dictionary<string,object>> commands = new ConcurrentQueue<Dictionary<string,object>>();
    static readonly JavaScriptSerializer json = new JavaScriptSerializer();
    static readonly object outputLock = new object();
    static readonly Hook keyboard = Keyboard, mouse = Mouse;
    static readonly WinEvent windowChanged = WindowChanged;
    static long generation;
    static ulong marker;
    static uint messageThread;
    static IntPtr toast;
    static RECT toastRect;
    static void Output(object value) { lock(outputLock) { Console.Out.WriteLine(json.Serialize(value)); Console.Out.Flush(); } }
    static void Dirty() { generation++; Output(new { type="dirty", generation=generation }); }
    static bool IsOwn(ulong extra) { return extra==marker; }
    static IntPtr Keyboard(int code,IntPtr w,IntPtr l) {
        if(code>=0) { var input=(KHOOK)Marshal.PtrToStructure(l,typeof(KHOOK)); if(!IsOwn(input.extra.ToUInt64())) Dirty(); }
        return CallNextHookEx(IntPtr.Zero,code,w,l);
    }
    static bool OverToast(POINT point) {
        return toast!=IntPtr.Zero && IsWindowVisible(toast) && point.x>=toastRect.l && point.x<toastRect.r && point.y>=toastRect.t && point.y<toastRect.b && GetAncestor(WindowFromPoint(point),2)==toast;
    }
    static IntPtr Mouse(int code,IntPtr w,IntPtr l) {
        int message=w.ToInt32();
        if(code>=0 && (message==0x201 || message==0x204 || message==0x207 || message==0x20B || message==0x20A || message==0x20E)) {
            var input=(MHOOK)Marshal.PtrToStructure(l,typeof(MHOOK));
            if(!IsOwn(input.extra.ToUInt64()) && !OverToast(input.point)) Dirty();
        }
        return CallNextHookEx(IntPtr.Zero,code,w,l);
    }
    static void WindowChanged(IntPtr hook,uint type,IntPtr hwnd,int obj,int child,uint thread,uint time) { Dirty(); }
    static long Number(Dictionary<string,object> value,string key) { return Convert.ToInt64(value[key]); }
    static string Class(IntPtr hwnd) { var b=new StringBuilder(256); GetClassName(hwnd,b,256); return b.ToString(); }
    static bool SameTarget(Dictionary<string,object> target) {
        var hwnd=GetForegroundWindow(); uint pid; var thread=GetWindowThreadProcessId(hwnd,out pid);
        var info=new GUI(); info.size=Marshal.SizeOf(typeof(GUI));
        return hwnd.ToInt64()==Number(target,"hwnd") && pid==Number(target,"pid") && thread==Number(target,"threadId") &&
            GetGUIThreadInfo(thread,ref info) && info.focus.ToInt64()==Number(target,"focusHwnd") &&
            Class(hwnd)==(string)target["windowClass"] && Class(info.focus)==(string)target["focusClass"] &&
            Process.GetProcessById((int)pid).ProcessName==(string)target["processName"];
    }
    static bool PumpPendingInput() {
        MSG message; bool commandPending=false, quit=false; int count=0;
        // Drain LL-hook/window callbacks without recursively executing send commands.
        while(PeekMessage(out message,IntPtr.Zero,0,0,1)) {
            if(++count>4096) return false;
            if(message.message==0x8001) commandPending=true;
            else if(message.message==0x12) quit=true;
            else { TranslateMessage(ref message); DispatchMessage(ref message); }
        }
        if(commandPending) PostThreadMessage(messageThread,0x8001,UIntPtr.Zero,IntPtr.Zero);
        if(quit) PostThreadMessage(messageThread,0x12,UIntPtr.Zero,IntPtr.Zero);
        return !quit;
    }
    static void Command(Dictionary<string,object> command) {
        long id=Number(command,"id");
        try {
            string type=(string)command["type"];
            if(type=="bounds") {
                toast=new IntPtr(Number(command,"hwnd"));
                toastRect=new RECT { l=(int)Number(command,"left"),t=(int)Number(command,"top"),r=(int)Number(command,"right"),b=(int)Number(command,"bottom") };
                Output(new { id=id, ok=true }); return;
            }
            if(type=="snapshot") { Output(new { id=id, generation=generation }); return; }
            if(type=="close") { PostThreadMessage(messageThread,0x12,UIntPtr.Zero,IntPtr.Zero); return; }
            if(type!="send") throw new InvalidOperationException("unsupported metadata command");
            var target=(Dictionary<string,object>)command["target"];
            var keys=(System.Collections.ArrayList)command["keys"];
            var flags=(System.Collections.ArrayList)command["flags"];
            var inputs=new INPUT[keys.Count];
            for(int i=0;i<inputs.Length;i++) { inputs[i].type=1; inputs[i].data.key.vk=Convert.ToUInt16(keys[i]); inputs[i].data.key.flags=Convert.ToUInt32(flags[i]); inputs[i].data.key.extra=new IntPtr(unchecked((long)marker)); }
            if(!SameTarget(target)) { Output(new { id=id,sent=false,generation=generation,reason="target-changed" }); return; }
#if V2P_NATIVE_TEST
            // This barrier is absent from production and used only by isolated tests.
            if(command.ContainsKey("testWaitFile")) {
                Output(new { type="test-wait", id=id });
                var deadline=DateTime.UtcNow.AddSeconds(2);
                while(!System.IO.File.Exists((string)command["testWaitFile"]) && DateTime.UtcNow<deadline) Thread.Sleep(1);
            }
#endif
            // Hooks and this command run on the same message thread. This is the last
            // check before the single atomic packet, after all identity/API work.
            if(!PumpPendingInput()) { Output(new { id=id,sent=false,generation=generation,reason="guard-unavailable" }); return; }
            long baseline=generation;
            long expected=Number(command,"expectedGeneration");
            if(expected>=0 && baseline!=expected) { Output(new { id=id,sent=false,generation=baseline,reason="dirty" }); return; }
            bool sent=SendInput((uint)inputs.Length,inputs,Marshal.SizeOf(typeof(INPUT)))==inputs.Length;
            Output(new { id=id,sent=sent,generation=baseline,reason=sent?"sent":"input-failed" });
        } catch { Output(new { id=id,sent=false,generation=generation,reason="metadata-error" }); }
    }
    public static void Run() {
        var random=new byte[8]; using(var rng=new RNGCryptoServiceProvider()) rng.GetBytes(random);
        marker=BitConverter.ToUInt64(random,0); if(marker==0) marker=1;
        messageThread=GetCurrentThreadId(); MSG msg; PeekMessage(out msg,IntPtr.Zero,0,0,0);
        var module=GetModuleHandle(null);
        var keyHook=SetWindowsHookEx(13,keyboard,module,0);
        var mouseHook=SetWindowsHookEx(14,mouse,module,0);
        var foregroundHook=SetWinEventHook(3,3,IntPtr.Zero,windowChanged,0,0,0);
        var focusHook=SetWinEventHook(0x8005,0x8005,IntPtr.Zero,windowChanged,0,0,0);
        if(keyHook==IntPtr.Zero || mouseHook==IntPtr.Zero || foregroundHook==IntPtr.Zero || focusHook==IntPtr.Zero) {
            Output(new { type="unavailable" });
        } else {
            var reader=new Thread(()=> {
                var parser=new JavaScriptSerializer();
                string line; while((line=Console.In.ReadLine())!=null) {
                    try { commands.Enqueue(parser.Deserialize<Dictionary<string,object>>(line)); PostThreadMessage(messageThread,0x8001,UIntPtr.Zero,IntPtr.Zero); } catch { }
                }
                PostThreadMessage(messageThread,0x12,UIntPtr.Zero,IntPtr.Zero);
            }); reader.IsBackground=true; reader.Start();
            Output(new { type="ready", generation=generation });
            while(GetMessage(out msg,IntPtr.Zero,0,0)>0) {
                if(msg.message==0x8001) { Dictionary<string,object> command; if(commands.TryDequeue(out command)) Command(command); }
                else { TranslateMessage(ref msg); DispatchMessage(ref msg); }
            }
        }
        if(keyHook!=IntPtr.Zero) UnhookWindowsHookEx(keyHook);
        if(mouseHook!=IntPtr.Zero) UnhookWindowsHookEx(mouseHook);
        if(foregroundHook!=IntPtr.Zero) UnhookWinEvent(foregroundHook);
        if(focusHook!=IntPtr.Zero) UnhookWinEvent(focusHook);
    }
}

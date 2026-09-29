// Passive helpers for standard Win32 Edit controls; all cross-process reads are bounded.
const NATIVE_EDIT_HELPER = `
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class V2PNativeEdit {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; public POINT(int x, int y) { X=x; Y=y; } }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct GUITHREADINFO {
    public int cbSize; public int flags; public IntPtr hwndActive; public IntPtr hwndFocus; public IntPtr hwndCapture;
    public IntPtr hwndMenuOwner; public IntPtr hwndMoveSize; public IntPtr hwndCaret; public RECT rcCaret;
  }
  [StructLayout(LayoutKind.Sequential)] public struct Selection { public int Start, End; public string Text; }
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT point);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr hwnd, StringBuilder name, int max);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetGUIThreadInfo(uint threadId, ref GUITHREADINFO info);
  [DllImport("user32.dll", EntryPoint="GetWindowLongW")] public static extern int GetWindowLong32(IntPtr hwnd, int index);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] public static extern IntPtr GetWindowLong64(IntPtr hwnd, int index);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, EntryPoint="SendMessageTimeoutW", SetLastError=true)]
  public static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
  public static int Style(IntPtr hwnd) { return IntPtr.Size == 8 ? GetWindowLong64(hwnd, -16).ToInt32() : GetWindowLong32(hwnd, -16); }
  public static string ClassName(IntPtr hwnd) {
    var name = new StringBuilder(256);
    GetClassNameW(hwnd, name, name.Capacity);
    return name.ToString();
  }
  public static uint ProcessId(IntPtr hwnd) {
    uint pid; GetWindowThreadProcessId(hwnd, out pid); return pid;
  }
  public static uint ThreadId(IntPtr hwnd) { uint pid; return GetWindowThreadProcessId(hwnd, out pid); }
  public static bool IsTarget(IntPtr hwnd, uint expectedPid, uint expectedThreadId, IntPtr expectedParent, int expectedControlId) {
    if (hwnd == IntPtr.Zero || !IsWindow(hwnd) || ProcessId(hwnd) != expectedPid ||
        ThreadId(hwnd) != expectedThreadId || GetParent(hwnd) != expectedParent ||
        GetDlgCtrlID(hwnd) != expectedControlId || !IsWindowEnabled(hwnd) ||
        !String.Equals(ClassName(hwnd), "Edit", StringComparison.OrdinalIgnoreCase) || (Style(hwnd) & 0x0800) != 0) return false;
    return true;
  }
  public static bool IsFocusedTarget(IntPtr hwnd, uint expectedPid, uint expectedThreadId, IntPtr expectedParent, int expectedControlId) {
    if (!IsTarget(hwnd, expectedPid, expectedThreadId, expectedParent, expectedControlId)) return false;
    IntPtr foreground = GetForegroundWindow();
    if (foreground == IntPtr.Zero || !IsWindow(foreground) || ProcessId(foreground) != expectedPid) return false;
    uint foregroundPid; uint thread = GetWindowThreadProcessId(foreground, out foregroundPid);
    var info = new GUITHREADINFO(); info.cbSize = Marshal.SizeOf(typeof(GUITHREADINFO));
    return GetGUIThreadInfo(thread, ref info) && info.hwndFocus == hwnd;
  }
  public static string ReadText(IntPtr hwnd) {
    if (hwnd == IntPtr.Zero || !String.Equals(ClassName(hwnd), "Edit", StringComparison.OrdinalIgnoreCase))
      throw new InvalidOperationException("not an Edit");
    IntPtr lengthResult;
    if (SendMessageTimeout(hwnd, 0x000E, IntPtr.Zero, IntPtr.Zero, 0x0002, 200, out lengthResult) == IntPtr.Zero)
      throw new TimeoutException("WM_GETTEXTLENGTH timed out");
    int length = lengthResult.ToInt32();
    if (length < 0 || length > 100000) throw new InvalidOperationException("Edit text length outside supported bounds");
    IntPtr textBuffer = Marshal.AllocHGlobal((length + 1) * 2);
    try {
      IntPtr textResult;
      if (SendMessageTimeout(hwnd, 0x000D, (IntPtr)(length + 1), textBuffer, 0x0002, 200, out textResult) == IntPtr.Zero)
        throw new TimeoutException("WM_GETTEXT timed out");
      return Marshal.PtrToStringUni(textBuffer) ?? "";
    } finally {
      Marshal.FreeHGlobal(textBuffer);
    }
  }
  public static Selection ReadSelection(IntPtr hwnd) {
    if (hwnd == IntPtr.Zero || !IsWindow(hwnd) || !IsWindowEnabled(hwnd) || !String.Equals(ClassName(hwnd), "Edit", StringComparison.OrdinalIgnoreCase) || (Style(hwnd) & 0x0800) != 0)
      throw new InvalidOperationException("not an enabled writable Edit");
    string text = ReadText(hwnd);
    IntPtr startPtr = Marshal.AllocHGlobal(4), endPtr = Marshal.AllocHGlobal(4);
    try {
      Marshal.WriteInt32(startPtr, 0); Marshal.WriteInt32(endPtr, 0);
      IntPtr selResult;
      if (SendMessageTimeout(hwnd, 0x00B0, startPtr, endPtr, 0x0002, 200, out selResult) == IntPtr.Zero)
        throw new TimeoutException("EM_GETSEL timed out");
      int start = Marshal.ReadInt32(startPtr), end = Marshal.ReadInt32(endPtr);
      if (start < 0 || end <= start || end > text.Length) throw new InvalidOperationException("Edit has no valid non-empty selection");
      var selection = new Selection(); selection.Start = start; selection.End = end;
      selection.Text = text.Substring(start, end - start);
      IntPtr verifyStart = Marshal.AllocHGlobal(4), verifyEnd = Marshal.AllocHGlobal(4);
      try {
        Marshal.WriteInt32(verifyStart, 0); Marshal.WriteInt32(verifyEnd, 0);
        if (SendMessageTimeout(hwnd, 0x00B0, verifyStart, verifyEnd, 0x0002, 200, out selResult) == IntPtr.Zero ||
            Marshal.ReadInt32(verifyStart) != start || Marshal.ReadInt32(verifyEnd) != end)
          throw new InvalidOperationException("Edit selection changed during read");
      } finally { Marshal.FreeHGlobal(verifyStart); Marshal.FreeHGlobal(verifyEnd); }
      return selection;
    } finally { Marshal.FreeHGlobal(startPtr); Marshal.FreeHGlobal(endPtr); }
  }
  public static string ReadSelectedText(IntPtr hwnd) { return ReadSelection(hwnd).Text; }
}
`;

function buildNativeEditPowerShell() {
  return `Add-Type -TypeDefinition @"\n${NATIVE_EDIT_HELPER}\n"@ -ErrorAction Stop`;
}

module.exports = { NATIVE_EDIT_HELPER, buildNativeEditPowerShell };

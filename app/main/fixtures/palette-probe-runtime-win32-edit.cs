using System;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

internal static class PaletteProbeWin32EditFixture
{
    private const uint WS_CHILD = 0x40000000;
    private const uint WS_VISIBLE = 0x10000000;
    private const uint WS_BORDER = 0x00800000;
    private const uint ES_AUTOHSCROLL = 0x0080;
    private const uint ES_READONLY = 0x0800;
    private const uint EM_SETSEL = 0x00B1;

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRect { public int Left, Top, Right, Bottom; }

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateWindowEx(uint exStyle, string className, string windowName,
        uint style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool GetWindowRect(IntPtr hwnd, out NativeRect rect);

    [DllImport("user32.dll")]
    private static extern IntPtr SetFocus(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(IntPtr hwnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);

    [DllImport("user32.dll")]
    private static extern IntPtr WindowFromPoint(Point point);

    [DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);

    private static string readyPath;
    private static string stopPath;
    private static string focusRequestPath;
    private static string focusAckPath;
    private static string keepFrontPath;
    private static Form form;
    private static IntPtr editable;
    private static IntPtr editableB;
    private static IntPtr readOnly;
    private static Button objectButton;

    [STAThread]
    private static void Main(string[] args)
    {
        if (args.Length != 5) return;
        readyPath = args[0];
        stopPath = args[1];
        focusRequestPath = args[2];
        focusAckPath = args[3];
        keepFrontPath = args[4];
        Application.EnableVisualStyles();

        objectButton = new Button { Text = "Object target", Left = 36, Top = 226, Width = 180, Height = 36 };
        form = new Form {
            Text = "V2P native Edit probe fixture",
            Width = 560,
            Height = 350,
            TopMost = true,
            StartPosition = FormStartPosition.CenterScreen
        };
        form.Controls.Add(objectButton);

        var timer = new Timer { Interval = 100 };
        timer.Tick += (sender, eventArgs) => {
            if (File.Exists(stopPath)) form.Close();
            if (File.Exists(focusRequestPath)) {
                string requested = "a";
                try { requested = File.ReadAllText(focusRequestPath).Trim(); } catch {}
                try { File.Delete(focusRequestPath); } catch {}
                SetWindowPos(form.Handle, new IntPtr(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0040);
                form.Activate();
                SetForegroundWindow(form.Handle);
                IntPtr target = requested == "b" ? editableB : (requested == "readonly" ? readOnly : editable);
                SetFocus(target);
                if (target == editable || target == editableB) SendMessage(target, EM_SETSEL, (IntPtr)8, (IntPtr)74);
                File.WriteAllText(focusAckPath, requested, new UTF8Encoding(false));
            }
            if (File.Exists(keepFrontPath)) {
                SetWindowPos(form.Handle, new IntPtr(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0040);
                SetForegroundWindow(form.Handle);
            }
        };
        form.Shown += (sender, eventArgs) => {
            editable = CreateEdit(form.Handle, 36, 36, false);
            editableB = CreateEdit(form.Handle, 36, 86, false);
            readOnly = CreateEdit(form.Handle, 36, 136, true);
            if (editable == IntPtr.Zero || editableB == IntPtr.Zero || readOnly == IntPtr.Zero) throw new InvalidOperationException("CreateWindowEx EDIT failed");
            SetWindowPos(form.Handle, new IntPtr(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0040);
            form.Activate();
            SetForegroundWindow(form.Handle);
            SetFocus(editable);
            SendMessage(editable, EM_SETSEL, (IntPtr)8, (IntPtr)74);
            SendMessage(editableB, EM_SETSEL, (IntPtr)8, (IntPtr)74);
            SendMessage(readOnly, EM_SETSEL, (IntPtr)8, (IntPtr)74);
            timer.Start();
            WriteReady();
        };
        form.FormClosed += (sender, eventArgs) => timer.Stop();
        Application.Run(form);
    }

    private static IntPtr CreateEdit(IntPtr parent, int x, int y, bool isReadOnly)
    {
        uint style = WS_CHILD | WS_VISIBLE | WS_BORDER | ES_AUTOHSCROLL;
        if (isReadOnly) style |= ES_READONLY;
        return CreateWindowEx(0, "EDIT", "Native Edit fixture has enough selected text for the palette threshold. \u4E2D\u6587",
            style, x, y, 460, 30, parent, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
    }

    private static Point CenterOf(IntPtr hwnd)
    {
        NativeRect rect;
        if (!GetWindowRect(hwnd, out rect)) throw new InvalidOperationException("GetWindowRect failed");
        return new Point((rect.Left + rect.Right) / 2, (rect.Top + rect.Bottom) / 2);
    }

    private static string PointJson(Point point)
    {
        return "{\"x\":" + point.X + ",\"y\":" + point.Y + "}";
    }

    private static void WriteReady()
    {
        NativeRect editRect;
        if (!GetWindowRect(editable, out editRect)) throw new InvalidOperationException("GetWindowRect(edit) failed");
        var a1 = new Point(editRect.Left + 12, (editRect.Top + editRect.Bottom) / 2);
        var a2 = new Point(editRect.Right - 12, (editRect.Top + editRect.Bottom) / 2);
        var json = "{\"pid\":" + System.Diagnostics.Process.GetCurrentProcess().Id +
            ",\"hwnd\":" + editable.ToInt64() +
            ",\"hwndB\":" + editableB.ToInt64() +
            ",\"readonlyHwnd\":" + readOnly.ToInt64() +
            ",\"window\":" + PointJson(CenterOf(form.Handle)) +
            ",\"a1\":" + PointJson(a1) +
            ",\"a2\":" + PointJson(a2) +
            ",\"b\":" + PointJson(CenterOf(editableB)) +
            ",\"a1Hit\":" + WindowFromPoint(a1).ToInt64() +
            ",\"a2Hit\":" + WindowFromPoint(a2).ToInt64() +
            ",\"readonly\":" + PointJson(CenterOf(readOnly)) +
            ",\"object\":" + PointJson(objectButton.PointToScreen(new Point(objectButton.Width / 2, objectButton.Height / 2))) + "}";
        File.WriteAllText(readyPath, json, new UTF8Encoding(false));
    }
}

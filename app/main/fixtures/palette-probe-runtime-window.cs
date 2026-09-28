using System;
using System.Drawing;
using System.IO;
using System.Text;
using System.Windows.Forms;

internal static class PaletteProbeRuntimeWindow
{
    private static string readyPath;
    private static string stopPath;
    private static Form form;
    private static TextBox editableA;
    private static TextBox editableB;
    private static TextBox readOnly;
    private static Button objectButton;

    [STAThread]
    private static void Main(string[] args)
    {
        if (args.Length != 2) return;
        readyPath = args[0];
        stopPath = args[1];
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        form = new Form {
            Text = "V2P palette probe runtime fixture",
            Width = 680,
            Height = 500,
            TopMost = true,
            StartPosition = FormStartPosition.CenterScreen
        };
        editableA = AddTextBox("editable A", 20, false);
        editableB = AddTextBox("editable B", 125, false);
        readOnly = AddTextBox("readonly selection fixture", 230, true);
        objectButton = new Button {
            Name = "objectButton",
            Text = "Object target",
            Location = new Point(20, 335),
            Size = new Size(180, 40)
        };
        form.Controls.Add(objectButton);

        var stopTimer = new Timer { Interval = 100 };
        stopTimer.Tick += (sender, eventArgs) => {
            if (File.Exists(stopPath)) form.Close();
        };
        form.Shown += (sender, eventArgs) => {
            editableA.Focus();
            editableA.Select(8, 48);
            editableB.Select(8, 48);
            readOnly.Select(8, 48);
            stopTimer.Start();
            WriteReady();
        };
        form.FormClosed += (sender, eventArgs) => stopTimer.Dispose();
        Application.Run(form);
    }

    private static TextBox AddTextBox(string label, int top, bool isReadOnly)
    {
        var box = new TextBox {
            Name = label.Replace(" ", ""),
            Text = "Runtime fixture has enough selected text to exceed palette threshold.",
            Location = new Point(20, top),
            Size = new Size(610, 70),
            Multiline = true,
            ReadOnly = isReadOnly,
            ScrollBars = ScrollBars.None
        };
        form.Controls.Add(box);
        return box;
    }

    private static Point Center(Control control, int horizontalOffset)
    {
        return control.PointToScreen(new Point(Math.Min(horizontalOffset, control.Width - 8), control.Height / 2));
    }

    private static string PointJson(Point point)
    {
        return "{\"x\":" + point.X + ",\"y\":" + point.Y + "}";
    }

    private static void WriteReady()
    {
        var json = "{\"pid\":" + System.Diagnostics.Process.GetCurrentProcess().Id +
            ",\"window\":" + PointJson(Center(form, form.ClientSize.Width / 2)) +
            ",\"a1\":" + PointJson(Center(editableA, 16)) +
            ",\"a2\":" + PointJson(Center(editableA, editableA.Width - 16)) +
            ",\"b\":" + PointJson(Center(editableB, 100)) +
            ",\"readonly\":" + PointJson(Center(readOnly, 100)) +
            ",\"object\":" + PointJson(Center(objectButton, objectButton.Width / 2)) + "}";
        File.WriteAllText(readyPath, json, new UTF8Encoding(false));
    }
}

using System;
using System.IO;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Threading;

internal static class PaletteProbeRuntimeWindow
{
    private static string readyPath;
    private static string stopPath;
    private static Window window;
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

        var canvas = new Canvas();
        editableA = AddTextBox(canvas, "editableA", 20);
        editableB = AddTextBox(canvas, "editableB", 115);
        readOnly = AddTextBox(canvas, "readOnly", 210, true);
        objectButton = new Button {
            Name = "objectButton",
            Content = "Object target",
            Width = 180,
            Height = 40
        };
        Canvas.SetLeft(objectButton, 20);
        Canvas.SetTop(objectButton, 325);
        canvas.Children.Add(objectButton);

        window = new Window {
            Title = "V2P palette probe runtime fixture",
            Width = 680,
            Height = 460,
            Topmost = true,
            ShowActivated = true,
            WindowStartupLocation = WindowStartupLocation.CenterScreen,
            Content = canvas
        };
        var stopTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(100) };
        stopTimer.Tick += (sender, eventArgs) => {
            if (File.Exists(stopPath)) window.Close();
        };
        window.Loaded += (sender, eventArgs) => {
            editableA.Focus();
            editableA.Select(8, 48);
            editableB.Select(8, 48);
            readOnly.Select(8, 48);
            stopTimer.Start();
            WriteReady();
        };
        window.Closed += (sender, eventArgs) => stopTimer.Stop();
        new Application().Run(window);
    }

    private static TextBox AddTextBox(Canvas canvas, string name, double top, bool isReadOnly = false)
    {
        var box = new TextBox {
            Name = name,
            Text = "Runtime fixture has enough selected text to exceed palette threshold.",
            Width = 610,
            Height = 70,
            IsReadOnly = isReadOnly,
            AcceptsReturn = true,
            TextWrapping = TextWrapping.NoWrap,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled
        };
        Canvas.SetLeft(box, 20);
        Canvas.SetTop(box, top);
        canvas.Children.Add(box);
        return box;
    }

    private static Point ScreenPoint(FrameworkElement element, double x)
    {
        return element.PointToScreen(new Point(Math.Min(x, element.ActualWidth - 8), element.ActualHeight / 2));
    }

    private static string PointJson(Point point)
    {
        return "{\"x\":" + point.X + ",\"y\":" + point.Y + "}";
    }

    private static void WriteReady()
    {
        var hwnd = new WindowInteropHelper(window).Handle;
        var json = "{\"pid\":" + System.Diagnostics.Process.GetCurrentProcess().Id +
            ",\"session\":" + System.Diagnostics.Process.GetCurrentProcess().SessionId +
            ",\"hwnd\":" + hwnd.ToInt64() +
            ",\"visible\":" + (window.IsVisible ? "true" : "false") +
            ",\"window\":" + PointJson(window.PointToScreen(new Point(window.ActualWidth / 2, window.ActualHeight / 2))) +
            ",\"a1\":" + PointJson(ScreenPoint(editableA, 16)) +
            ",\"a2\":" + PointJson(ScreenPoint(editableA, editableA.ActualWidth - 16)) +
            ",\"b\":" + PointJson(ScreenPoint(editableB, 100)) +
            ",\"readonly\":" + PointJson(ScreenPoint(readOnly, 100)) +
            ",\"object\":" + PointJson(ScreenPoint(objectButton, objectButton.ActualWidth / 2)) + "}";
        File.WriteAllText(readyPath, json, new UTF8Encoding(false));
    }
}

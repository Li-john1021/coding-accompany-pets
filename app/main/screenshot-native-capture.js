const { runPowerShellFile } = require('./powershell-file');

const DPI_AWARENESS = `Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class V2PScreenshotDpi {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
}
"@ -ErrorAction Stop
[void][V2PScreenshotDpi]::SetProcessDpiAwarenessContext([IntPtr](-4))`;

function buildCaptureScript(bounds) {
  const values = [bounds.x, bounds.y, bounds.width, bounds.height].map((value) => {
    if (!Number.isInteger(value)) throw new TypeError('Capture bounds must be integers');
    return String(value);
  });
  const [x, y, width, height] = values;
  if (width < 1 || height < 1 || width > 16384 || height > 16384) throw new RangeError('Capture bounds are outside limits');
  return `
$ErrorActionPreference = 'Stop'
${DPI_AWARENESS}
Add-Type -AssemblyName System.Drawing -ErrorAction Stop
$bitmap = New-Object System.Drawing.Bitmap(${width}, ${height}, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
  $graphics.CopyFromScreen(${x}, ${y}, 0, 0, $bitmap.Size, [System.Drawing.CopyPixelOperation]::SourceCopy)
  $stream = New-Object System.IO.MemoryStream
  try { $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png); [Console]::Out.WriteLine([Convert]::ToBase64String($stream.ToArray())) }
  finally { $stream.Dispose() }
} finally { $graphics.Dispose(); $bitmap.Dispose() }
`;
}

function buildMonitorBoundsScript() {
  return `
$ErrorActionPreference = 'Stop'
${DPI_AWARENESS}
Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
[System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
  [PSCustomObject]@{ name = $_.DeviceName; x = $_.Bounds.X; y = $_.Bounds.Y; width = $_.Bounds.Width; height = $_.Bounds.Height; primary = $_.Primary }
} | ConvertTo-Json -Compress
`;
}

function getPhysicalMonitorBounds(run = runPowerShellFile) {
  return new Promise((resolve, reject) => {
    run(buildMonitorBoundsScript(), { timeout: 5000, maxBuffer: 64 * 1024 }, (error, stdout) => {
      if (error) { reject(error); return; }
      try {
        const value = JSON.parse(String(stdout || '').trim().split(/\r?\n/).pop());
        const monitors = (Array.isArray(value) ? value : [value]).map((entry) => ({
          name: String(entry.name || ''), x: Number(entry.x), y: Number(entry.y),
          width: Number(entry.width), height: Number(entry.height), primary: entry.primary === true
        }));
        if (!monitors.length || monitors.some((monitor) => !Number.isInteger(monitor.x) || !Number.isInteger(monitor.y) ||
            !Number.isInteger(monitor.width) || !Number.isInteger(monitor.height) || monitor.width < 1 || monitor.height < 1)) {
          throw new Error('Windows monitor inventory is invalid');
        }
        resolve(monitors);
      } catch (failure) { reject(new Error(`Unable to read Windows monitor bounds: ${failure.message || failure}`)); }
    });
  });
}

function mapDisplaysToPhysical(electronDisplays, physicalMonitors, convertedBounds = (display) => display.nativeBounds || ({
  x: display.nativeOrigin?.x, y: display.nativeOrigin?.y,
  width: Math.round(display.bounds.width * display.scaleFactor), height: Math.round(display.bounds.height * display.scaleFactor)
})) {
  const matches = electronDisplays.map((display) => {
    const expected = convertedBounds(display);
    const sizeMatches = physicalMonitors.filter((monitor) =>
      Math.abs(monitor.width - expected.width) <= 2 && Math.abs(monitor.height - expected.height) <= 2);
    if (sizeMatches.length <= 1) return sizeMatches;
    if (![expected.x, expected.y, expected.width, expected.height].every(Number.isFinite)) return [];
    const overlap = (monitor) => {
      const width = Math.max(0, Math.min(expected.x + expected.width, monitor.x + monitor.width) - Math.max(expected.x, monitor.x));
      const height = Math.max(0, Math.min(expected.y + expected.height, monitor.y + monitor.height) - Math.max(expected.y, monitor.y));
      return width * height;
    };
    const ranked = sizeMatches.map((monitor) => ({ monitor, area: overlap(monitor) })).sort((a, b) => b.area - a.area);
    return ranked.length > 0 && ranked[0].area > 0 && (ranked.length === 1 || ranked[0].area > ranked[1].area)
      ? [ranked[0].monitor] : [];
  });
  if (matches.some((items) => items.length !== 1) || new Set(matches.map((items) => items[0]?.name)).size !== matches.length) {
    throw new Error('Windows display identity is ambiguous for the available monitor bounds');
  }
  return electronDisplays.map((display, index) => ({ id: String(display.id), ...matches[index][0] }));
}

function captureWindowsDisplay(bounds, run = runPowerShellFile) {
  return new Promise((resolve, reject) => {
    let script;
    try { script = buildCaptureScript(bounds); }
    catch (error) { reject(error); return; }
    run(script, { timeout: 10000, maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => {
      if (error) { reject(error); return; }
      const value = String(stdout || '').trim().split(/\r?\n/).pop();
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) { reject(new Error('Windows screen capture returned invalid PNG data')); return; }
      resolve(`data:image/png;base64,${value}`);
    });
  });
}

module.exports = { buildCaptureScript, buildMonitorBoundsScript, getPhysicalMonitorBounds, mapDisplaysToPhysical, captureWindowsDisplay };

function intersect(a, b) {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > left && bottom > top ? { x: left, y: top, width: right - left, height: bottom - top } : null;
}

function normalizeRect(a, b) {
  if (![a?.x, a?.y, b?.x, b?.y].every(Number.isFinite)) return null;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const width = Math.abs(a.x - b.x);
  const height = Math.abs(a.y - b.y);
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

function planComposition(selection, screens) {
  if (!selection || !Number.isFinite(selection.x) || !Number.isFinite(selection.y) ||
      !Number.isFinite(selection.width) || !Number.isFinite(selection.height) ||
      selection.width <= 0 || selection.height <= 0) return null;
  const parts = [];
  for (const screen of screens || []) {
    const logical = intersect(selection, screen.bounds);
    if (!logical || !Number.isFinite(screen.pixelWidth) || !Number.isFinite(screen.pixelHeight) ||
        screen.pixelWidth <= 0 || screen.pixelHeight <= 0) continue;
    const sx = screen.pixelWidth / screen.bounds.width;
    const sy = screen.pixelHeight / screen.bounds.height;
    const left = Math.round((logical.x - screen.bounds.x) * sx);
    const top = Math.round((logical.y - screen.bounds.y) * sy);
    const right = Math.round((logical.x + logical.width - screen.bounds.x) * sx);
    const bottom = Math.round((logical.y + logical.height - screen.bounds.y) * sy);
    parts.push({
      id: screen.id, logical,
      source: { x: left, y: top, width: right - left, height: bottom - top },
      scaleX: sx, scaleY: sy
    });
  }
  if (!parts.length) return null;
  const scale = Math.max(...parts.flatMap((part) => [part.scaleX, part.scaleY]));
  const width = Math.max(1, Math.round(selection.width * scale));
  const height = Math.max(1, Math.round(selection.height * scale));
  for (const part of parts) {
    const left = Math.round((part.logical.x - selection.x) * scale);
    const top = Math.round((part.logical.y - selection.y) * scale);
    const right = Math.round((part.logical.x + part.logical.width - selection.x) * scale);
    const bottom = Math.round((part.logical.y + part.logical.height - selection.y) * scale);
    part.destination = { x: left, y: top, width: right - left, height: bottom - top };
  }
  return { width, height, scale, parts };
}

function isSelectionWithinDisplays(selection, screens) {
  if (!selection || ![selection.x, selection.y, selection.width, selection.height].every(Number.isFinite) ||
      selection.width <= 0 || selection.height <= 0 || !screens?.length) return false;
  const left = Math.min(...screens.map((screen) => screen.bounds.x));
  const top = Math.min(...screens.map((screen) => screen.bounds.y));
  const right = Math.max(...screens.map((screen) => screen.bounds.x + screen.bounds.width));
  const bottom = Math.max(...screens.map((screen) => screen.bounds.y + screen.bounds.height));
  // Staggered monitors leave gaps in the virtual desktop. Keep those gaps in
  // the rectangular result while composing only the actual monitor pixels.
  return selection.x >= left && selection.y >= top && selection.x + selection.width <= right &&
    selection.y + selection.height <= bottom && screens.some((screen) => intersect(selection, screen.bounds));
}

module.exports = { intersect, normalizeRect, planComposition, isSelectionWithinDisplays };

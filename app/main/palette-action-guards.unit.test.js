// palette-action-guards.unit.test.js — stale and wrong-target action barriers
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
const renderer = fs.readFileSync(path.join(__dirname, '../renderer/palette.js'), 'utf8');
const insert = fs.readFileSync(path.join(__dirname, 'insert.js'), 'utf8');
const pasteGuard = fs.readFileSync(path.join(__dirname, 'palette-paste-guard.js'), 'utf8');
const runStart = main.indexOf("ipcMain.handle('v2p:palette-run'");
const rawStart = main.indexOf("ipcMain.handle('v2p:palette-copy-raw'");
assert.ok(runStart >= 0 && rawStart > runStart, 'palette run handler exists');
const run = main.slice(runStart, rawStart);

assert.ok(run.includes('paletteRunActive'), 'overlapping actions are rejected');
assert.ok(run.includes('selection.id !== selectionId'), 'button event is bound to the displayed selection');
const firstRevalidate = run.indexOf('revalidatePaletteSelection(selection)');
const process = run.indexOf('pipeline.processText(selection.text');
const secondRevalidate = run.indexOf('revalidatePaletteSelection(selection)', firstRevalidate + 1);
assert.ok(firstRevalidate >= 0 && process > firstRevalidate && secondRevalidate > process,
  'selection is checked before and after model work');
assert.ok(run.includes("insertText(r.text, 'paste', { target: selection })"),
  'paste receives the captured target for last-moment validation');
assert.ok(preload.includes("{ mode, selectionId }"), 'preload forwards selection identity');
assert.ok(renderer.includes('const selectionId = activeSelectionId;') && renderer.includes('paletteRun(mode, selectionId)'),
  'renderer submits displayed selection identity');
assert.ok(renderer.includes("paletteDismiss('done', selectionId)"), 'delayed dismissal is bound to its original selection');
assert.ok(renderer.includes('if (selectionId !== activeSelectionId) return;'), 'late IPC results do not update a newer palette');
assert.ok(insert.includes("resolve('cancelled')"), 'invalid target cancels injection');
assert.ok(pasteGuard.includes('$foregroundPid -eq ${match[1]}') && pasteGuard.includes('$focusedId -eq'),
  'native paste checks foreground process and focused control identity');
assert.ok(pasteGuard.includes('$textPattern.GetSelection()') && pasteGuard.includes('$selectedText -ceq $expectedText'),
  'native paste checks the original selection text immediately before injection');
assert.ok(insert.indexOf('${targetGuard}') < insert.indexOf('[V2PPaste]::Paste()'),
  'native target guard runs before simulated paste');
assert.ok(insert.includes("clipboard.readText() === text"), 'cancel only restores clipboard if this attempt still owns it');
assert.ok(!main.includes('readSelection'), 'automatic palette path does not use simulated-copy selection reading');
const captureStart = main.indexOf('async function captureAndShowPalette');
const captureEnd = main.indexOf('function isPaletteVisible', captureStart);
const capture = main.slice(captureStart, captureEnd);
assert.ok(capture.indexOf('shouldShowPalette') < capture.indexOf('meetsMinimumCharacters') &&
  capture.indexOf('meetsMinimumCharacters') < capture.indexOf('showPaletteAt'),
  'threshold and display follow confirmed selection gating');

console.log('PASS palette stale/action-target guards');

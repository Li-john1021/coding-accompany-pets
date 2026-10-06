const fs = require('fs');
const path = require('path');
const s = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const i = s.indexOf('v2p:palette-run');
const j = s.indexOf('v2p:palette-copy-raw');
if (i < 0 || j < 0) {
  console.log('FAIL locate palette-run');
  process.exit(1);
}
const blk = s.slice(i, j);
if (blk.includes('hidePalette')) {
  console.log('FAIL hidePalette inside palette-run');
  process.exit(1);
}
if (/uIOhook\.on\('mousemove'|captureAndShowPalette\(gesture\.start/.test(s)) {
  console.log('FAIL legacy automatic drag palette trigger is active');
  process.exit(1);
}
console.log('PASS legacy automatic drag palette trigger remains retired');

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
assert.match(main, /clipboard\.writeText\(text\)/, 'pet action publishes through Electron clipboard.writeText');
assert.doesNotMatch(main, /createWindowsConditionalClipboardWriter|writeClipboardIfSequence/,
  'pet action publication has no clipboard sequence ownership gate');
console.log('PASS pet action clipboard path is direct; live clipboard mutation is reserved for named test-window runtime validation');

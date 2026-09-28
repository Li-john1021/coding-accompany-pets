// palette-probe.unit.test.js — parser and passive probe invariants
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildProbeScript, parseProbeOutput } = require('./palette-probe.js');

let fail = 0;
function t(name, fn) {
  try { fn(); console.log('PASS', name); }
  catch (e) { fail++; console.log('FAIL', name, e.message); }
}

t('parses only positive non-empty confirmed evidence', () => {
  assert.deepEqual(parseProbeOutput('{"ok":true,"controlId":"1|2|3","text":"hello","processName":"notepad"}'), {
    confirmed: true, controlId: '1|2|3', text: 'hello', processName: 'notepad'
  });
  for (const output of ['', 'not json', '{"ok":false}', '{"ok":true,"controlId":"","text":"x"}',
    '{"ok":true,"controlId":"1","text":""}']) assert.equal(parseProbeOutput(output), null);
  assert.equal(parseProbeOutput('{"ok":true,"controlId":"1","text":"  ","processName":"notepad"}').text, '  ');
});

t('probe compares hit elements and reads only UIA selected text', () => {
  const script = buildProbeScript({ x: 10, y: 20 }, { x: 30, y: 40 });
  assert.ok(script.includes('AutomationElement]::FromPoint'));
  assert.ok(script.includes('TextPattern]::Pattern'));
  assert.ok(script.includes('ValuePattern]::Pattern'));
  assert.ok(script.includes('$a.controlId -ne $b.controlId'));
  assert.ok(script.includes('$a.text -cne $b.text'));
  assert.ok(!/SendInput|keyTap|clipboard|FocusedElement|SetFocus|Select\(/i.test(script));
  const actionScript = buildProbeScript({ x: 10, y: 20 }, { x: 30, y: 40 }, { requireFocusedTarget: true });
  assert.ok(actionScript.includes('AutomationElement]::FocusedElement'));
  assert.ok(actionScript.includes('$focusId -ne $a.controlId'));
  assert.throws(() => buildProbeScript({ x: NaN, y: 0 }, { x: 1, y: 1 }));
});

t('production probe has bounded timeout and errors fail closed', () => {
  const source = fs.readFileSync(path.join(__dirname, 'palette-probe.js'), 'utf8');
  assert.ok(source.includes('timeout: PROBE_TIMEOUT_MS'));
  assert.ok(source.includes('resolve(err ? null : parseProbeOutput(stdout))'));
});

if (fail) { console.log('PALETTE PROBE FAIL', fail); process.exitCode = 1; }
else console.log('PALETTE PROBE ALL PASS');

// palette-paste-guard.unit.test.js — validates the final native paste guard.
const assert = require('assert');
const { execFileSync } = require('child_process');
const { buildPasteTargetGuard } = require('./palette-paste-guard');

const sample = { controlId: '123|456|7.8.9', text: 'selected text 漢字' };
const script = buildPasteTargetGuard(sample);
assert.ok(script.includes('$foregroundPid -ne 123'));
assert.ok(script.includes("$focusedId -ne '123|456|7.8.9'"));
assert.ok(script.includes('$selectedText -cne $expectedText'));
assert.ok(script.includes(Buffer.from(sample.text, 'utf8').toString('base64')));
assert.ok(!script.includes(sample.text), 'selection is base64 encoded before script construction');
assert.equal(buildPasteTargetGuard({ controlId: 'bad', text: 'text' }), null);
assert.equal(buildPasteTargetGuard({ controlId: '1|2|3', text: ' ' }), null);

if (process.platform === 'win32') {
  const encoded = Buffer.from(script, 'utf8').toString('base64');
  const parse = `$source = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')); ` +
    '$tokens = $null; $errors = $null; ' +
    '[System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors) | Out-Null; ' +
    'if ($errors.Count -gt 0) { $errors | ForEach-Object { [Console]::Error.WriteLine($_.Message) }; exit 1 }';
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', parse], { stdio: 'inherit' });
  console.log('PASS generated PowerShell guard parses');
} else {
  console.log('SKIP PowerShell parser (non-Windows host)');
}

console.log('PASS palette paste guard construction');

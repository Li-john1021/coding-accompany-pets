const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPowerShellFile, runPowerShellFile } = require('./powershell-file');

const marker = 'private-selection-marker';
const temp = createPowerShellFile("[Console]::Out.WriteLine('fixed-script')");
assert.ok(!fs.readFileSync(temp.file, 'utf16le').includes(marker));
const filePath = temp.file;
temp.cleanup();
assert.equal(fs.existsSync(filePath), false, 'temporary script cleanup removes its file and directory');

if (process.platform === 'win32') {
  const before = new Set(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('v2p-palette-ps-')));
  runPowerShellFile("[Console]::Out.WriteLine('PASS_TEMP_SCRIPT_RUN')", { timeout: 5000, maxBuffer: 1024 }, (error, stdout) => {
    assert.ifError(error);
    assert.ok(stdout.includes('PASS_TEMP_SCRIPT_RUN'));
    const after = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('v2p-palette-ps-'));
    assert.deepEqual(after.filter((name) => !before.has(name)), [], 'runner removes its temporary script after child exit');
    console.log('PASS PowerShell temp runner keeps selection data out of files and cleans up');
    const beforeEarlyExit = new Set(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('v2p-palette-ps-')));
    runPowerShellFile('exit 0', {
      timeout: 5000,
      maxBuffer: 1024,
      stdin: 'x'.repeat(533336)
    }, (earlyError) => {
      assert.ok(earlyError, 'early child exit with pending stdin is a normal failed invocation');
      const afterEarlyExit = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('v2p-palette-ps-'));
      assert.deepEqual(afterEarlyExit.filter((name) => !beforeEarlyExit.has(name)), [],
        'early stdin close is consumed and temp directory is removed');
      console.log('PASS early PowerShell exit with large stdin is contained and cleaned up');
    });
  });
} else {
  console.log('PASS PowerShell temp file creation/cleanup');
}

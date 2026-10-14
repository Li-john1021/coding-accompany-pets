#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'prompt-quality-v5.json');
const BASELINE = 'f9a22d7341ecfdfb57ff9459c78ee1afbdda9248';

function parseArgs(argv) {
  const opts = { live: false, config: '', maxCalls: 0 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--live') opts.live = true;
    else if (argv[i] === '--config') opts.config = argv[++i] || '';
    else if (argv[i] === '--max-calls') opts.maxCalls = Number(argv[++i]);
    else if (argv[i] === '--help' || argv[i] === '-h') opts.help = true;
    else throw new Error('Unknown argument');
  }
  return opts;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function readBaselinePrompts() {
  const source = execFileSync('git', ['show', `${BASELINE}:app/main/config.js`], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  });
  function extract(name) {
    const match = source.match(new RegExp('const ' + name + ' = `([\\s\\S]*?)`;'));
    if (!match) throw new Error('Baseline prompt unavailable');
    return match[1];
  }
  return {
    optimize: extract('DEFAULT_PROMPT'),
    structure: extract('STRUCTURE_ONLY_PROMPT')
  };
}

function loadCurrentPrompts() {
  const prompts = require('./text-prompts');
  return { optimize: prompts.DEFAULT_PROMPT, structure: prompts.STRUCTURE_ONLY_PROMPT, sourceMessage: prompts.sourceMessage };
}

function redlineFromConfigSource(source) {
  const match = source.match(/const REDLINE_SUFFIX = `([\s\S]*?)`;/);
  if (!match) throw new Error('Prompt wrapper unavailable');
  return (prompt) => {
    const system = String(prompt || '');
    return !system || /禁止回答|绝不回答/.test(system) ? system : system + match[1];
  };
}

function loadBaselineRedline() {
  const source = execFileSync('git', ['show', `${BASELINE}:app/main/config.js`], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  });
  return redlineFromConfigSource(source);
}

function loadCurrentRedline() {
  return redlineFromConfigSource(fs.readFileSync(path.join(__dirname, 'config.js'), 'utf8'));
}

function loadConfig(filePath) {
  const parsed = JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
  const list = Array.isArray(parsed.llmProviders) ? parsed.llmProviders : [];
  const provider = list.find((entry) => entry && entry.id === parsed.activeLlmId);
  if (!provider || !provider.baseUrl || !provider.model || !provider.apiKey) {
    throw new Error('Selected LLM configuration is incomplete');
  }
  const apiKey = typeof provider.apiKey === 'string' && provider.apiKey.startsWith('b64:')
    ? Buffer.from(provider.apiKey.slice(4), 'base64').toString('utf8')
    : provider.apiKey;
  return { cfg: parsed, provider: { ...provider, apiKey } };
}

function inspectResult(text, mustInclude) {
  const output = typeof text === 'string' ? text : '';
  const missing = mustInclude.filter((fact) => !output.includes(fact));
  return {
    shape: typeof text,
    nonEmpty: output.trim().length > 0,
    characters: output.length,
    requiredFactsPresent: missing.length === 0,
    missingFacts: missing,
    numberedLines: (output.match(/^\s*(?:\d+[.、)]|[-*•])\s/gm) || []).length
  };
}

function dryRun(cases, oldPrompts, newPrompts) {
  const rows = cases.map((item) => {
    const oldSystem = oldPrompts[item.mode];
    const newSystem = newPrompts[item.mode];
    const oldInput = item.input;
    const newInput = newPrompts.sourceMessage(item.input);
    return {
      id: item.id,
      mode: item.mode,
      inputCharacters: item.input.length,
      oldPromptSha256: sha256(oldSystem),
      newPromptSha256: sha256(newSystem),
      oldInputCharacters: oldInput.length,
      newInputCharacters: newInput.length,
      callsPlanned: 2
    };
  });
  return {
    kind: 'dry-run',
    baseline: BASELINE,
    cases: rows,
    totalPlannedCalls: rows.reduce((sum, row) => sum + row.callsPlanned, 0),
    note: 'No provider calls. Hashes identify prompt text; results require a human review.'
  };
}

async function liveRun(cases, oldPrompts, newPrompts, oldEnsureRedline, configFile) {
  const { cfg, provider } = loadConfig(configFile);
  const { chatCompletion } = require('./models');
  const currentEnsureRedline = loadCurrentRedline();
  const results = [];

  async function oneCall(systemPrompt, userText, mode) {
    const start = Date.now();
    const originalLog = console.log;
    try {
      console.log = () => {};
      const text = await chatCompletion(provider, systemPrompt, userText, { mode, cfg });
      return { latencyMs: Date.now() - start, output: text, inspection: inspectResult(text, []) };
    } catch (error) {
      return { latencyMs: Date.now() - start, errorType: error && error.name || 'Error' };
    } finally {
      console.log = originalLog;
    }
  }

  for (const item of cases) {
    const oldSystem = oldEnsureRedline(oldPrompts[item.mode]);
    const newSystem = currentEnsureRedline(newPrompts[item.mode]);
    const old = await oneCall(oldSystem, item.input, item.mode);
    const current = await oneCall(newSystem, newPrompts.sourceMessage(item.input), item.mode);
    for (const result of [old, current]) {
      if (result.output !== undefined) result.inspection = inspectResult(result.output, item.mustInclude);
    }
    results.push({
      id: item.id,
      mode: item.mode,
      input: item.input,
      expectedFormat: item.expectedFormat,
      qualitativeChecks: item.qualitativeChecks,
      mustInclude: item.mustInclude,
      old,
      new: current
    });
  }
  return {
    kind: 'paired-live-observation',
    baseline: BASELINE,
    cases: results,
    calls: results.length * 2,
    note: 'One call per version per case; no retries. Observations are not a statistical or cross-model claim. Review every output and qualitative check manually.'
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write('Usage: node app/main/prompt-quality.eval.js [--live --config PATH --max-calls 16]\n');
    return;
  }
  const cases = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
  if (!Array.isArray(cases) || cases.length !== 8) throw new Error('Expected exactly eight fixture cases');
  const oldPrompts = readBaselinePrompts();
  const newPrompts = loadCurrentPrompts();
  if (!opts.live) {
    if (opts.config || opts.maxCalls) throw new Error('Live options require --live');
    process.stdout.write(JSON.stringify(dryRun(cases, oldPrompts, newPrompts), null, 2) + '\n');
    return;
  }
  if (!opts.config || opts.maxCalls !== 16) throw new Error('Live mode requires --config PATH --max-calls 16');
  const report = await liveRun(cases, oldPrompts, newPrompts, loadBaselineRedline(), opts.config);
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

main().catch((error) => {
  process.stderr.write(`Evaluation stopped: ${error.message}\n`);
  process.exitCode = 1;
});

#!/usr/bin/env node

const path = require('path');
const { spawnSync } = require('child_process');

const mode = process.argv[2] || 'build';
const dryRun = process.argv.includes('--dry-run');

if (mode !== 'dev' && mode !== 'build') {
  console.error("Usage: node run-tauri-before-command.js <dev|build> [--dry-run]");
  process.exit(2);
}

const scriptDir = __dirname;
const backendDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(backendDir, '..');
const ensureScript = path.join(scriptDir, 'ensure-built-in-plugins.js');
const frontendDir = path.join(repoRoot, 'Frontend');

if (dryRun) {
  console.log(`mode=${mode}`);
  console.log(`cwd=${process.cwd()}`);
  console.log(`ensureScript=${ensureScript}`);
  console.log(`frontendDir=${frontendDir}`);
  process.exit(0);
}

function run(cmd, args, cwd) {
  const spawnOpts = { cwd, stdio: 'inherit' };
  if (
    process.platform === 'win32' &&
    (cmd === 'npm' || cmd.toLowerCase().endsWith('.cmd') || cmd.toLowerCase().endsWith('.bat'))
  ) {
    spawnOpts.shell = true;
  }

  const res = spawnSync(cmd, args, spawnOpts);
  if (res.error) {
    console.error(`Failed to run ${cmd}:`, res.error);
    process.exit(res.status || 1);
  }
  if (res.status !== 0) {
    process.exit(res.status);
  }
}

run(process.execPath, [ensureScript], backendDir);

if (mode === 'build' && process.env.FRONTEND_SKIP_BUILD === '1') {
  console.log('FRONTEND_SKIP_BUILD=1; skipping Frontend build step.');
  process.exit(0);
}

const npmBin = 'npm';
run(npmBin, ['run', mode], frontendDir);

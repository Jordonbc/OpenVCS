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
const npmExecutable = process.platform === 'win32' ? process.execPath : 'npm';
const npmArgsPrefix = process.platform === 'win32' ? [resolveNpmCli()] : [];

if (dryRun) {
  console.log(`mode=${mode}`);
  console.log(`cwd=${process.cwd()}`);
  console.log(`ensureScript=${ensureScript}`);
  console.log(`frontendDir=${frontendDir}`);
  process.exit(0);
}

function run(cmd, args, cwd, env) {
  const spawnOpts = { cwd, stdio: 'inherit', windowsHide: true };
  if (env) {
    spawnOpts.env = { ...process.env, ...env };
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

function resolveNpmCli() {
  const localNodeModules = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (require('fs').existsSync(localNodeModules)) {
    return localNodeModules;
  }

  return require.resolve('npm/bin/npm-cli.js');
}

const ensureEnv = mode === 'dev' && !process.env.OPENVCS_UPDATE_CHANNEL
  ? { OPENVCS_UPDATE_CHANNEL: 'dev' }
  : null;
run(process.execPath, [ensureScript], backendDir, ensureEnv);

if (mode === 'build' && process.env.FRONTEND_SKIP_BUILD === '1') {
  console.log('FRONTEND_SKIP_BUILD=1; skipping Frontend build step.');
  process.exit(0);
}

run(npmExecutable, [...npmArgsPrefix, 'run', mode], frontendDir);

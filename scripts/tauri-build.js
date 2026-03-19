#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

/**
 * Loads key/value pairs from a dotenv-style file into process.env.
 * Existing environment values are preserved.
 *
 * @param {string} filePath - Path to the dotenv file.
 */
function loadLocalEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

/**
 * Normalizes the Tauri signing key into the format expected by TAURI_SIGNING_PRIVATE_KEY.
 *
 * @param {string} raw - Raw key content.
 * @returns {string} Normalized key value.
 */
function normalizeSigningKey(raw) {
  let key = raw;
  // Tauri expects TAURI_SIGNING_PRIVATE_KEY to be base64 of the minisign key box text.
  // If this is a minisign file content, encode the whole content as base64.
  if (/^untrusted comment:/m.test(key)) {
    return Buffer.from(key, 'utf8').toString('base64');
  }
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(key)) {
    key = key.slice(key.indexOf('=') + 1);
  }
  key = key.trim().replace(/^"/, '').replace(/"$/, '');
  key = key.replace(/_/g, '/').replace(/-/g, '+');
  return key;
}

/**
 * Prompts for sensitive input without echoing typed characters.
 *
 * @param {string} question - Prompt text.
 * @returns {Promise<string>} User-provided value.
 */
function promptHidden(question) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    let password = '';
    stdout.write(question);
    stdin.resume();
    stdin.setEncoding('utf8');
    if (stdin.isTTY) stdin.setRawMode(true);
    const onData = (ch) => {
      if (ch === '\u0003') process.exit(130);
      if (ch === '\r' || ch === '\n') {
        stdin.removeListener('data', onData);
        if (stdin.isTTY) stdin.setRawMode(false);
        stdout.write('\n');
        resolve(password);
        return;
      }
      if (ch === '\u007f' || ch === '\b') {
        password = password.slice(0, -1);
        return;
      }
      password += ch;
    };
    stdin.on('data', onData);
  });
}

/**
 * Returns repository and Backend directories based on this script location.
 *
 * @returns {{repoRoot: string, backendDir: string}} Build directory paths.
 */
function resolvePaths() {
  const cwdRepoRoot = process.cwd();
  const cwdBackendDir = path.join(cwdRepoRoot, 'Backend');
  const cwdTauriConfig = path.join(cwdBackendDir, 'tauri.conf.json');
  if (fs.existsSync(cwdTauriConfig)) {
    return { repoRoot: cwdRepoRoot, backendDir: cwdBackendDir };
  }

  const scriptRepoRoot = path.resolve(__dirname, '..');
  const scriptBackendDir = path.join(scriptRepoRoot, 'Backend');
  return { repoRoot: scriptRepoRoot, backendDir: scriptBackendDir };
}

async function main() {
  const { repoRoot, backendDir } = resolvePaths();
  loadLocalEnv(path.join(repoRoot, '.env.tauri.local'));

  if (process.env.TAURI_SIGNING_PRIVATE_KEY_FILE && !process.env.TAURI_SIGNING_PRIVATE_KEY) {
    console.log('Signing: loading key from TAURI_SIGNING_PRIVATE_KEY_FILE');
    const raw = fs.readFileSync(process.env.TAURI_SIGNING_PRIVATE_KEY_FILE, 'utf8');
    process.env.TAURI_SIGNING_PRIVATE_KEY = normalizeSigningKey(raw);
  }

  if (process.env.TAURI_SIGNING_PRIVATE_KEY && !process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
    console.log('Signing: key loaded, password required');
    process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = await promptHidden(
      'TAURI signing key password: '
    );
  } else if (process.env.TAURI_SIGNING_PRIVATE_KEY) {
    console.log('Signing: key and password already set in environment');
  } else {
    console.log('Signing: no key configured; build will be unsigned');
  }

  process.env.NO_STRIP = process.env.NO_STRIP || 'true';

  const child = spawn('cargo', ['tauri', 'build'], {
    cwd: backendDir,
    stdio: 'inherit',
    env: process.env,
  });

  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 1);
  });
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});

#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

/**
 * Returns normalized desktop channel metadata for Tauri CLI config overrides.
 *
 * @param {string | undefined} raw
 * @returns {{slug: string, productName: string, identifier: string, windowTitle: string, updaterEndpoints: string[]}}
 */
function resolveChannelConfig(raw) {
  const slug = (raw || 'stable').trim().toLowerCase();
  const repo = process.env.OPENVCS_REPO || 'https://github.com/Jordonbc/OpenVCS';
  const stableEndpoint = `${repo}/releases/latest/download/latest.json`;
  const betaEndpoint = `${repo}/releases/download/openvcs-beta/latest.json`;
  const nightlyEndpoint = `${repo}/releases/download/openvcs-nightly/latest.json`;

  if (slug === 'beta') {
    return {
      slug: 'beta',
      productName: 'OpenVCS Beta',
      identifier: 'dev.jordon.openvcs.beta',
      windowTitle: 'OpenVCS Beta',
      updaterEndpoints: [betaEndpoint, stableEndpoint],
    };
  }

  if (slug === 'nightly') {
    return {
      slug: 'nightly',
      productName: 'OpenVCS Nightly',
      identifier: 'dev.jordon.openvcs.nightly',
      windowTitle: 'OpenVCS Nightly',
      updaterEndpoints: [nightlyEndpoint, stableEndpoint],
    };
  }

  return {
    slug: 'stable',
    productName: 'OpenVCS',
    identifier: 'dev.jordon.openvcs',
    windowTitle: 'OpenVCS',
    updaterEndpoints: [stableEndpoint],
  };
}

/**
 * Writes a temporary Tauri merge config matching the requested channel.
 *
 * @param {string} repoRoot
 * @param {{productName: string, identifier: string, windowTitle: string, updaterEndpoints: string[]}} channel
 * @returns {string}
 */
function writeChannelConfigOverride(repoRoot, channel) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openvcs-tauri-config-'));
  const configPath = path.join(tmpDir, 'tauri.channel.conf.json');
  const override = {
    productName: channel.productName,
    identifier: channel.identifier,
    app: {
      windows: [
        {
          title: channel.windowTitle,
        },
      ],
    },
    plugins: {
      updater: {
        endpoints: channel.updaterEndpoints,
      },
    },
  };

  fs.writeFileSync(configPath, JSON.stringify(override, null, 2));
  return configPath;
}

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

async function main() {
  const repoRoot = process.cwd();
  loadLocalEnv(path.join(repoRoot, '.env.tauri.local'));
  const channel = resolveChannelConfig(process.env.OPENVCS_UPDATE_CHANNEL);
  const channelConfigPath = writeChannelConfigOverride(repoRoot, channel);

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
  console.log(`Tauri channel: ${channel.slug} (${channel.productName})`);

  const child = spawn('cargo', ['tauri', 'build', '--config', channelConfigPath], {
    stdio: 'inherit',
    env: process.env,
  });

  child.on('exit', (code, signal) => {
    try {
      fs.rmSync(path.dirname(channelConfigPath), { recursive: true, force: true });
    } catch {}
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 1);
  });
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});

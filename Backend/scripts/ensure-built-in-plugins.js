#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const scriptDir = __dirname;
const backendDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(backendDir, '..');
const pluginSources = path.join(backendDir, 'built-in-plugins');
const pluginBundles = path.join(repoRoot, 'target', 'openvcs', 'built-in-plugins');
const nodeRuntimeDir = path.join(repoRoot, 'target', 'openvcs', 'node-runtime');

const skipDirs = new Set(['target', '.git', 'node_modules', 'dist']);

function latestSourceTime(dir) {
  let latest = 0;
  let hasFile = false;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const name = entry.name;
      const full = path.join(current, name);
      if (entry.isDirectory()) {
        if (skipDirs.has(name)) continue;
        stack.push(full);
        continue;
      }
      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;
      hasFile = true;
      latest = Math.max(latest, stat.mtimeMs);
    }
  }
  return hasFile ? latest : null;
}

function pluginOutdated(name) {
  const bundlePath = path.join(pluginBundles, `${name}.ovcsp`);
  if (!fs.existsSync(bundlePath)) return true;
  const bundleStat = fs.statSync(bundlePath);
  const srcPath = path.join(pluginSources, name);
  const srcTime = latestSourceTime(srcPath);
  return srcTime === null || srcTime > bundleStat.mtimeMs;
}

function findOutdatedPlugin() {
  if (!fs.existsSync(pluginSources)) return null;
  const entries = fs.readdirSync(pluginSources, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (pluginOutdated(entry.name)) {
      return entry.name;
    }
  }
  return null;
}

function ensureBundlesDir() {
  fs.mkdirSync(pluginBundles, { recursive: true });
}

function ensureNodeRuntimeDir() {
  fs.mkdirSync(nodeRuntimeDir, { recursive: true });
}

function ensureBundledNodeRuntime() {
  const src = process.execPath;
  const outName = process.platform === 'win32' ? 'node.exe' : 'node';
  const dest = path.join(nodeRuntimeDir, outName);

  let shouldCopy = true;
  if (fs.existsSync(dest)) {
    try {
      const srcStat = fs.statSync(src);
      const destStat = fs.statSync(dest);
      shouldCopy = srcStat.size !== destStat.size || srcStat.mtimeMs > destStat.mtimeMs;
    } catch {
      shouldCopy = true;
    }
  }

  if (!shouldCopy) return;

  fs.copyFileSync(src, dest);
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(dest, 0o755);
    } catch {
      // Ignore chmod errors on restricted filesystems.
    }
  }
  console.log(`Bundled node runtime -> ${dest}`);
}

function runDistCommand() {
  console.log('Built-in plugin bundles need rebuilding; running cargo openvcs dist …');
  const pluginDirArg = 'built-in-plugins';
  const outArg = path.relative(backendDir, pluginBundles);
  const res = spawnSync(
    'cargo',
    ['openvcs', 'dist', '--all', '--plugin-dir', pluginDirArg, '--out', outArg],
    { cwd: backendDir, stdio: 'inherit' }
  );
  if (res.error) {
    console.error('Failed to run cargo openvcs dist:', res.error);
    process.exit(res.status || 1);
  }
  if (res.status !== 0) {
    process.exit(res.status);
  }
}

ensureBundlesDir();
ensureNodeRuntimeDir();
ensureBundledNodeRuntime();

const outdated = findOutdatedPlugin();
if (outdated) {
  runDistCommand();
} else {
  console.log('Built-in plugin bundles are up to date.');
}

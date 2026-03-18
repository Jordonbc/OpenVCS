#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const scriptDir = __dirname;
const backendDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(backendDir, '..');
const workspaceRoot = path.resolve(repoRoot, '..');
const sdkDir = path.join(workspaceRoot, 'SDK');
const pluginSources = path.join(backendDir, 'built-in-plugins');
const pluginBundles = path.join(repoRoot, 'target', 'openvcs', 'built-in-plugins');
const nodeRuntimeDir = path.join(repoRoot, 'target', 'openvcs', 'node-runtime');
const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';

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

function bundleFileNameForPlugin(name) {
  const manifestPath = path.join(pluginSources, name, 'openvcs.plugin.json');
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const pluginId = typeof manifest.id === 'string' ? manifest.id.trim() : '';
    if (pluginId) {
      return `${pluginId}.ovcsp`;
    }
  } catch {
    // Fall back to the directory name so the missing/invalid manifest still
    // forces a rebuild attempt and surfaces the real packaging error later.
  }
  return `${name}.ovcsp`;
}

function pluginOutdated(name) {
  const bundlePath = path.join(pluginBundles, bundleFileNameForPlugin(name));
  if (!fs.existsSync(bundlePath)) return true;
  const bundleStat = fs.statSync(bundlePath);
  const srcPath = path.join(pluginSources, name);
  const srcTime = latestSourceTime(srcPath);
  return srcTime === null || srcTime > bundleStat.mtimeMs;
}

function findOutdatedPlugins() {
  if (!fs.existsSync(pluginSources)) return [];
  const entries = fs.readdirSync(pluginSources, { withFileTypes: true });
  const outdated = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (pluginOutdated(entry.name)) {
      outdated.push(entry.name);
    }
  }
  return outdated;
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

function getFileMtime(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function nodeModulesFresh(pluginDir) {
  const nodeModulesDir = path.join(pluginDir, 'node_modules');
  if (!fs.existsSync(nodeModulesDir)) return false;
  const lockPath = path.join(pluginDir, 'package-lock.json');
  const jsonPath = path.join(pluginDir, 'package.json');
  const nmMtime = getFileMtime(nodeModulesDir);
  if (getFileMtime(lockPath) > nmMtime) return false;
  if (getFileMtime(jsonPath) > nmMtime) return false;
  return true;
}

function ensurePluginDependencies(pluginDir) {
  const packageJsonPath = path.join(pluginDir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return;
  }

  if (nodeModulesFresh(pluginDir)) {
    return;
  }

  const hasPackageLock = fs.existsSync(path.join(pluginDir, 'package-lock.json'));
  const installArgs = hasPackageLock ? ['ci'] : ['install'];
  console.log(`Installing built-in plugin dependencies in ${pluginDir}...`);
  const res = spawnSync(npmExecutable, installArgs, {
    cwd: pluginDir,
    stdio: 'inherit',
  });
  if (res.error) {
    console.error(`Failed to install dependencies for ${pluginDir}:`, res.error);
    process.exit(res.status || 1);
  }
  if (res.status !== 0) {
    process.exit(res.status);
  }
}

function runDistCommand(pluginNames) {
  console.log(`Built-in plugin bundles need rebuilding: ${pluginNames.join(', ')}`);
  for (const pluginName of pluginNames) {
    const pluginDir = path.join(pluginSources, pluginName);
    ensurePluginDependencies(pluginDir);
    console.log(`Packaging built-in plugin ${pluginName} via SDK CLI...`);
    const res = spawnSync(
      npmExecutable,
      ['--prefix', sdkDir, 'run', 'openvcs', '--', 'dist', '--plugin-dir', pluginDir, '--out', pluginBundles],
      { cwd: backendDir, stdio: 'inherit' }
    );
    if (res.error) {
      console.error(`Failed to run SDK packager for ${pluginName}:`, res.error);
      process.exit(res.status || 1);
    }
    if (res.status !== 0) {
      process.exit(res.status);
    }
  }
}

ensureBundlesDir();
ensureNodeRuntimeDir();
ensureBundledNodeRuntime();

const outdated = findOutdatedPlugins();
if (outdated.length > 0) {
  runDistCommand(outdated);
} else {
  console.log('Built-in plugin bundles are up to date.');
}

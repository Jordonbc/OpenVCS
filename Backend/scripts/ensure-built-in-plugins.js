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
const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const forceRebuild = process.argv.includes('--force');

const skipDirs = new Set(['target', '.git', 'node_modules', 'dist']);

/**
 * Returns the newest file mtime (ms) under a directory, ignoring known build dirs.
 *
 * @param {string} dir - Directory to scan.
 * @returns {number|null} Latest mtime or null when no files are present.
 */
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

/**
 * Resolves the canonical built-in plugin bundle filename from plugin metadata.
 *
 * @param {string} name - Plugin source directory name.
 * @returns {string} Expected `.ovcsp` filename.
 */
function bundleFileNameForPlugin(name) {
  const manifestPath = path.join(pluginSources, name, 'openvcs.plugin.json');
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const pluginId = typeof manifest.id === 'string' ? manifest.id.trim() : '';
    if (pluginId) {
      return `${pluginId}.ovcsp`;
    }
  } catch (e) {
    console.debug(`Manifest unavailable for ${name}; using directory-name fallback.`, e);
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

/**
 * Lists all plugin directories regardless of build state.
 *
 * @returns {string[]} Plugin directory names.
 */
function findAllPlugins() {
  if (!fs.existsSync(pluginSources)) return [];
  return fs
    .readdirSync(pluginSources, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
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

/**
 * Copies plugin archive(s) created by `npm run dist` into the app bundle output.
 *
 * @param {string} pluginName - Plugin directory name.
 * @param {string} pluginDir - Plugin directory path.
 */
function copyPackagedBundles(pluginName, pluginDir) {
  ensureBundlesDir();
  const distDir = path.join(pluginDir, 'dist');
  if (!fs.existsSync(distDir)) {
    console.error(`Missing dist directory for ${pluginName}: ${distDir}`);
    process.exit(1);
  }

  const archiveEntries = fs
    .readdirSync(distDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ovcsp'));

  if (archiveEntries.length === 0) {
    console.error(`No .ovcsp bundle produced for ${pluginName} in ${distDir}`);
    process.exit(1);
  }

  const preferredName = bundleFileNameForPlugin(pluginName);
  const preferred = archiveEntries.find((entry) => entry.name === preferredName);
  const sourceArchive = preferred
    ? path.join(distDir, preferred.name)
    : path.join(distDir, archiveEntries[0].name);
  const destArchive = path.join(pluginBundles, preferredName);

  if (archiveEntries.length > 1) {
    console.warn(
      `Multiple .ovcsp archives found for ${pluginName}; using ${path.basename(sourceArchive)}.`
    );
  }

  fs.copyFileSync(sourceArchive, destArchive);
  console.log(`Built-in plugin bundle copied -> ${destArchive}`);
}

function runDistCommand(pluginNames) {
  const header = forceRebuild
    ? `Forcing rebuild of built-in plugins: ${pluginNames.join(', ')}`
    : `Built-in plugin bundles need rebuilding: ${pluginNames.join(', ')}`;
  console.log(header);
  for (const pluginName of pluginNames) {
    const pluginDir = path.join(pluginSources, pluginName);
    const packageJsonPath = path.join(pluginDir, 'package.json');

    if (!fs.existsSync(packageJsonPath)) {
      console.warn(`Skipping non-code plugin ${pluginName} (no package.json).`);
      continue;
    }

    ensurePluginDependencies(pluginDir);
    console.log(`Packaging built-in plugin ${pluginName} via npm run dist...`);
    const res = spawnSync(npmExecutable, ['run', 'dist'], {
      cwd: pluginDir,
      stdio: 'inherit',
    });
    if (res.error) {
      console.error(`Failed to run npm dist for ${pluginName}:`, res.error);
      process.exit(res.status || 1);
    }
    if (res.status !== 0) {
      process.exit(res.status);
    }

    copyPackagedBundles(pluginName, pluginDir);
  }
}

ensureBundlesDir();
ensureNodeRuntimeDir();
ensureBundledNodeRuntime();

const targets = forceRebuild ? findAllPlugins() : findOutdatedPlugins();
if (targets.length > 0) {
  runDistCommand(targets);
} else if (forceRebuild) {
  console.log('Force rebuild requested, but no built-in plugins were found.');
} else {
  console.log('Built-in plugin bundles are up to date.');
}

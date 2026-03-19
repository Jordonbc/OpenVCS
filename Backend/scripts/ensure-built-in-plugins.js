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
const npmExecutable = 'npm';

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

function runCommand(command, args, cwd, label) {
  const res = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (res.error) {
    console.error(`Failed to ${label}:`, res.error);
    process.exit(res.status || 1);
  }
  if (res.status !== 0) {
    process.exit(res.status);
  }
}

function readPackageJson(pluginDir) {
  const packageJsonPath = path.join(pluginDir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  } catch {
    return null;
  }
}

function ensurePluginPackagingManifest(pluginDir, pluginName) {
  const existing = readPackageJson(pluginDir);
  if (existing && existing.scripts && existing.scripts.dist) {
    return null;
  }

  if (!existing) {
    console.log(
      `Built-in plugin ${pluginName} has no package.json; generating a transient npm packaging manifest.`
    );
  } else {
    console.log(
      `Built-in plugin ${pluginName} has no npm dist script; generating a transient npm packaging manifest.`
    );
  }

  const packageJsonPath = path.join(pluginDir, 'package.json');
  const packageLockPath = path.join(pluginDir, 'package-lock.json');
  const nodeModulesPath = path.join(pluginDir, 'node_modules');
  const tempPackageJson = {
    name: `@openvcs/${pluginName.toLowerCase()}-built-in-packager`,
    private: true,
    scripts: {
      dist: 'node ./node_modules/@openvcs/sdk/bin/openvcs.js dist --plugin-dir . --out dist',
    },
    devDependencies: {
      '@openvcs/sdk': '^0.2',
    },
  };

  fs.writeFileSync(packageJsonPath, `${JSON.stringify(tempPackageJson, null, 2)}\n`);

  return () => {
    try {
      fs.rmSync(packageJsonPath, { force: true });
      fs.rmSync(packageLockPath, { force: true });
      fs.rmSync(nodeModulesPath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup failures in transient packaging files.
    }
  };
}

function copyPluginBundle(pluginDir, pluginName) {
  const bundleName = bundleFileNameForPlugin(pluginName);
  const sourceBundle = path.join(pluginDir, 'dist', bundleName);
  const destBundle = path.join(pluginBundles, bundleName);
  if (!fs.existsSync(sourceBundle)) {
    console.error(`Expected built-in plugin bundle at ${sourceBundle}`);
    process.exit(1);
  }
  fs.copyFileSync(sourceBundle, destBundle);
}

function packagePlugin(pluginDir, pluginName) {
  const cleanupPackagingManifest = ensurePluginPackagingManifest(pluginDir, pluginName);
  try {
    ensurePluginDependencies(pluginDir);
    console.log(`Packaging built-in plugin ${pluginName} via npm run dist...`);
    runCommand(npmExecutable, ['run', 'dist'], pluginDir, `package ${pluginName}`);
    copyPluginBundle(pluginDir, pluginName);
  } finally {
    cleanupPackagingManifest?.();
  }
}

function runDistCommand(pluginNames) {
  console.log(`Built-in plugin bundles need rebuilding: ${pluginNames.join(', ')}`);
  for (const pluginName of pluginNames) {
    const pluginDir = path.join(pluginSources, pluginName);
    packagePlugin(pluginDir, pluginName);
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

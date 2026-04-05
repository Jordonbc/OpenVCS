#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const scriptDir = __dirname;
const backendDir = path.resolve(scriptDir, '..');
const clientDir = path.resolve(backendDir, '..');
const builtInConfigPath = path.join(clientDir, 'openvcs.plugins.json');
const builtInOutputDir = path.join(clientDir, 'target', 'openvcs', 'built-in-plugins');
const nodeRuntimeDir = path.join(clientDir, 'target', 'openvcs', 'node-runtime');
const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function shouldUseWindowsShell(command) {
  if (process.platform !== 'win32') {
    return false;
  }

  return (
    command === 'npm' ||
    command === 'npm.cmd' ||
    command.toLowerCase().endsWith('.cmd') ||
    command.toLowerCase().endsWith('.bat')
  );
}

function runCommand(command, args, cwd, label) {
  const spawnOpts = { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };
  if (shouldUseWindowsShell(command)) {
    spawnOpts.shell = true;
  }
  const result = spawnSync(command, args, spawnOpts);
  if (result.error) {
    throw new Error(`Failed to ${label}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const stderr = String(result.stderr || '').trim();
    throw new Error(stderr ? `Failed to ${label}: ${stderr}` : `Failed to ${label}`);
  }
  return result;
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function ensureNodeRuntimeDir() {
  ensureDirectory(nodeRuntimeDir);
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

function readBuiltInConfig() {
  const raw = fs.readFileSync(builtInConfigPath, 'utf8');
  const parsed = JSON.parse(raw);
  const entries = Array.isArray(parsed?.plugin) ? parsed.plugin : [];
  return entries.map((value) => String(value || '').trim()).filter(Boolean);
}

function resolveLocalSource(spec) {
  if (!spec) return null;
  let candidate = spec;
  if (candidate.startsWith('~/')) {
    candidate = path.join(os.homedir(), candidate.slice(2));
  }
  const absolute = path.isAbsolute(candidate)
    ? candidate
    : path.resolve(clientDir, candidate);
  return fs.existsSync(absolute) && fs.statSync(absolute).isDirectory()
    ? absolute
    : null;
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

function ensureSourceDependencies(pluginDir) {
  const packageJsonPath = path.join(pluginDir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`Built-in plugin source is missing package.json: ${pluginDir}`);
  }

  if (nodeModulesFresh(pluginDir)) {
    return;
  }

  const hasPackageLock = fs.existsSync(path.join(pluginDir, 'package-lock.json'));
  const installArgs = hasPackageLock ? ['ci'] : ['install'];
  console.log(`Installing built-in source dependencies in ${pluginDir}...`);
  runCommand(npmExecutable, installArgs, pluginDir, `install dependencies for ${pluginDir}`);
}

function npmPack(sourceSpec, workdir) {
  const result = runCommand(npmExecutable, ['pack', '--json', sourceSpec], workdir, `pack ${sourceSpec}`);
  const stdout = String(result.stdout || '');
  const jsonStart = stdout.indexOf('[');
  const parsed = JSON.parse(jsonStart >= 0 ? stdout.slice(jsonStart) : '[]');
  const filename = String(parsed?.[parsed.length - 1]?.filename || '').trim();
  if (!filename) {
    throw new Error(`npm pack did not report an output file for ${sourceSpec}`);
  }
  return path.join(workdir, filename);
}

function extractTarball(archivePath, workdir) {
  runCommand('tar', ['-xzf', archivePath], workdir, `extract ${archivePath}`);
  const packageDir = path.join(workdir, 'package');
  if (!fs.existsSync(packageDir) || !fs.statSync(packageDir).isDirectory()) {
    throw new Error(`npm pack archive did not extract a package/ directory: ${archivePath}`);
  }
  return packageDir;
}

function packageHasRuntimeDependencies(pluginDir) {
  const packageJsonPath = path.join(pluginDir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return false;
  }
  const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const dependencies = parsed?.dependencies;
  const optionalDependencies = parsed?.optionalDependencies;
  return (dependencies && Object.keys(dependencies).length > 0)
    || (optionalDependencies && Object.keys(optionalDependencies).length > 0);
}

function installRuntimeDependencies(pluginDir) {
  if (!packageHasRuntimeDependencies(pluginDir)) {
    return;
  }

  runCommand(
    npmExecutable,
    ['install', '--omit=dev', '--ignore-scripts', '--no-package-lock', '--no-bin-links', '--no-audit', '--no-fund'],
    pluginDir,
    `install runtime dependencies for ${pluginDir}`,
  );
}

function readPluginManifest(pluginDir) {
  const manifestPath = path.join(pluginDir, 'package.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Prepared plugin is missing package.json: ${pluginDir}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).openvcs;
  const pluginId = String(manifest?.id || '').trim();
  if (!pluginId) {
    throw new Error(`Prepared plugin has an empty openvcs.id: ${pluginDir}`);
  }
  return { manifest, pluginId };
}

function writeSourceMetadata(pluginDir, sourceKind, spec) {
  const metadataPath = path.join(pluginDir, 'source.json');
  const payload = {
    managed_by: 'built-in',
    kind: sourceKind,
    spec,
  };
  fs.writeFileSync(metadataPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function stageBuiltInPlugin(spec) {
  const localSource = resolveLocalSource(spec);
  if (localSource) {
    ensureSourceDependencies(localSource);
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openvcs-built-in-'));
  const tarballPath = npmPack(localSource || spec, tempRoot);
  const packageDir = extractTarball(tarballPath, tempRoot);
  installRuntimeDependencies(packageDir);
  const { pluginId } = readPluginManifest(packageDir);
  writeSourceMetadata(packageDir, localSource ? 'path' : 'npm', spec);
  return { tempRoot, packageDir, pluginId };
}

function rebuildBuiltInPlugins() {
  ensureDirectory(builtInOutputDir);
  fs.rmSync(builtInOutputDir, { recursive: true, force: true });
  ensureDirectory(builtInOutputDir);

  const specs = readBuiltInConfig();
  console.log(`Syncing ${specs.length} built-in plugins from ${builtInConfigPath}`);

  for (const spec of specs) {
    const { tempRoot, packageDir, pluginId } = stageBuiltInPlugin(spec);
    try {
      const destDir = path.join(builtInOutputDir, pluginId);
      fs.cpSync(packageDir, destDir, { recursive: true, force: true });
      console.log(`Built-in plugin ${pluginId} -> ${destDir}`);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

ensureNodeRuntimeDir();
ensureBundledNodeRuntime();
rebuildBuiltInPlugins();

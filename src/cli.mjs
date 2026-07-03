#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { compileUserscriptProject } from './utils/converter.js';

const args = process.argv.slice(2);

if (args.includes('--version') || args.includes('-v')) {
  console.log('userscript-compiler 2.0');
  process.exit(0);
}

if (!args.length || args.includes('--help') || args.includes('-h')) {
  printHelp();
  process.exit(args.length ? 0 : 1);
}

const input = args[0] === 'compile' ? args[1] : args[0];
const flags = parseFlags(args[0] === 'compile' ? args.slice(2) : args.slice(1));

if (!input) {
  fail('No userscript file given.', 'Usage: userscript-compiler compile path/to/script.user.js [options]');
}
if (input.startsWith('--')) {
  fail(`Expected a userscript path, got the option "${input}".`, 'Put the .user.js path first: userscript-compiler compile ./script.user.js --out ./dist');
}

const scriptText = await readScriptInput(input);
const config = await loadConfig(flags.config, input);
const outDir = path.resolve(flags.out || config.out || 'compiled-userscript');
const targets = flags.target
  ? flags.target.split(',').map(value => value.trim()).filter(Boolean)
  : (config.targets || ['chrome', 'firefox', 'safari']);
const runtimeMode = flags.runtime || config.runtime || 'content-script';
const newTabDir = flags.newtabDir || config.newtabDir;
const newTabFiles = newTabDir ? await readAssetDir(newTabDir, 'newtab') : [];

const result = await compileUserscriptProject(scriptText, {
  runtimeMode,
  targets,
  includeNewTab: Boolean(flags.newtab || newTabDir || config.newtab),
  newTabPath: newTabDir ? 'newtab/index.html' : 'newtab.html',
  newTabFiles,
  includeContextMenus: flags.contextMenus !== false && config.contextMenus !== false,
  outputType: 'nodebuffer',
  firefoxId: flags.firefoxId || config.firefoxId,
  metadataOverrides: config.metadata || undefined,
  branding: config.branding || undefined,
});

await fs.mkdir(outDir, { recursive: true });

if (!flags.zipOnly) {
  await Promise.all(result.files.map(async file => {
    const target = path.join(outDir, file.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.content);
  }));
}

const zipPath = path.join(outDir, result.zipName);
await fs.writeFile(zipPath, result.zip);

await Promise.all(result.releaseArtifacts.map(artifact => writeReleaseArtifact(outDir, artifact)));

const errorCount = result.diagnostics.filter(item => item.severity === 'error').length;
const warningCount = result.diagnostics.filter(item => item.severity === 'warning').length;
const validationErrors = result.packageValidation.summary.errors;
const validationWarnings = result.packageValidation.summary.warnings;

console.log(`Compiled ${path.basename(input)} -> ${outDir}`);
console.log(`Project ZIP: ${zipPath}`);
for (const artifact of result.releaseArtifacts) {
  console.log(`Release ${artifact.kind}: ${path.join(outDir, artifact.path)}`);
}
console.log(`Targets: ${result.targetPlans.map(plan => `${plan.target}:${plan.runtimeMode}`).join(', ')}`);
console.log(`Diagnostics: ${errorCount} error(s), ${warningCount} warning(s)`);
console.log(`Package validation: ${validationErrors} error(s), ${validationWarnings} warning(s)`);
for (const diagnostic of result.diagnostics) {
  const prefix = diagnostic.severity.toUpperCase().padEnd(7);
  console.log(`${prefix} ${diagnostic.code}: ${diagnostic.message}`);
}
for (const target of result.packageValidation.targets) {
  for (const issue of target.issues) {
    const prefix = issue.severity.toUpperCase().padEnd(7);
    console.log(`${prefix} ${target.target} ${issue.code}: ${issue.message}`);
  }
}

if (errorCount || validationErrors) process.exitCode = 2;

function parseFlags(values) {
  const parsed = {};
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (!value.startsWith('--')) continue;
    const key = value.slice(2);
    if (key === 'newtab' || key === 'zip-only') {
      parsed[toCamel(key)] = true;
      continue;
    }
    if (key === 'no-context-menus') {
      parsed.contextMenus = false;
      continue;
    }
    if (key === 'no-options-page') {
      continue;
    }
    parsed[toCamel(key)] = values[i + 1];
    i += 1;
  }
  return parsed;
}

async function readAssetDir(inputDir, outputPrefix) {
  const root = path.resolve(inputDir);
  const files = [];
  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    await Promise.all(entries.map(async entry => {
      if (entry.name.startsWith('.')) return;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        return;
      }
      if (!entry.isFile()) return;
      const relative = path.relative(root, fullPath).split(path.sep).join('/');
      files.push({
        path: `${outputPrefix}/${relative}`,
        content: await fs.readFile(fullPath),
      });
    }));
  }
  await walk(root);
  if (!files.some(file => file.path === `${outputPrefix}/index.html`)) {
    throw new Error(`--newtab-dir must contain index.html: ${root}`);
  }
  return files;
}

async function writeReleaseArtifact(outDir, artifact) {
  if (artifact.kind === 'directory') {
    await Promise.all((artifact.files || []).map(async file => {
      const target = path.join(outDir, file.path);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, file.content);
    }));
    return;
  }
  const target = path.join(outDir, artifact.path);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, artifact.content);
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function fail(message, hint) {
  console.error(`error: ${message}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
}

async function readScriptInput(inputPath) {
  try {
    return await fs.readFile(inputPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      fail(`Cannot find userscript file: ${inputPath}`, 'Check the path, or run "npm run compile -- --help" for usage.');
    }
    if (error?.code === 'EISDIR') {
      fail(`Expected a .user.js file but got a directory: ${inputPath}`, 'Point at the userscript file itself, e.g. ./dist/script.user.js');
    }
    fail(`Could not read ${inputPath}: ${error?.message || error}`);
  }
}

// Load an optional JSON config file. Explicit --config wins; otherwise look for
// userscript-compiler.config.json next to the input script and in the cwd. The
// config can set defaults (out/targets/runtime/newtabDir/firefoxId), userscript
// metadata overrides, and popup branding — everything the CLI flags cannot.
async function loadConfig(explicitPath, inputPath) {
  const candidates = explicitPath
    ? [path.resolve(explicitPath)]
    : [
        path.join(path.dirname(path.resolve(inputPath)), 'userscript-compiler.config.json'),
        path.resolve('userscript-compiler.config.json'),
      ];
  for (const candidate of candidates) {
    let text;
    try {
      text = await fs.readFile(candidate, 'utf8');
    } catch (error) {
      if (explicitPath) fail(`Cannot read config file: ${candidate}`, error?.message || '');
      continue;
    }
    try {
      const config = JSON.parse(text);
      if (!explicitPath) console.log(`Using config: ${path.relative(process.cwd(), candidate) || candidate}`);
      return config;
    } catch (error) {
      fail(`Config file is not valid JSON: ${candidate}`, error?.message || '');
    }
  }
  return {};
}

function printHelp() {
  console.log(`UserScript Compiler 2.0
Compile one .user.js into userscript, Chrome/Firefox/Safari extension, and
standalone packages, plus a store submission guide.

Usage:
  userscript-compiler <script.user.js> [options]
  npm run compile -- <script.user.js> [options]

Examples:
  # Simplest: build all three browser targets into ./compiled-userscript
  npm run compile -- ./script.user.js

  # Chrome only, into a chosen folder
  npm run compile -- ./script.user.js --out ./dist --target chrome

  # Package a built new-tab app and brand the popup via a config file
  npm run compile -- ./script.user.js --newtab-dir ./dist/newtab --config ./usc.config.json

Options:
  --out <dir>          Output directory (default: compiled-userscript)
  --target <list>      Comma-separated targets from: chrome, firefox, safari
                       (default: chrome,firefox,safari)
  --runtime <mode>     content-script (default, store-friendly),
                       user-scripts (native userScripts API), or auto
  --newtab             Add a generated placeholder new-tab page
  --newtab-dir <dir>   Package a built new-tab app (must contain index.html)
  --firefox-id <id>    Firefox add-on id for browser_specific_settings
  --config <file>      JSON config with defaults + metadata + popup branding
                       (auto-detected as userscript-compiler.config.json)
  --zip-only           Only write the project ZIP + release artifacts
  --no-context-menus   Do not map GM_registerMenuCommand to native menus
  -h, --help           Show this help
  -v, --version        Show the compiler version

Config file (all fields optional):
  {
    "out": "./dist",
    "targets": ["chrome", "firefox"],
    "runtime": "content-script",
    "newtabDir": "./dist/newtab",
    "metadata": { "name": "My Tool", "homepage": "https://example.com" },
    "branding": {
      "tagline": "One-line popup subtitle",
      "homepageLabel": "Docs",
      "settingsEvent": "my-tool-open-settings",
      "settingsLabel": "Open settings",
      "pages": [{ "path": "newtab/index.html", "label": "Dashboard" }]
    }
  }

Exit codes: 0 ok, 1 usage/input error, 2 compile or validation errors.
`);
}

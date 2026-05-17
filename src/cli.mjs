#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { compileUserscriptProject } from './utils/converter.js';

const args = process.argv.slice(2);

if (!args.length || args.includes('--help') || args.includes('-h')) {
  printHelp();
  process.exit(args.length ? 0 : 1);
}

const input = args[0] === 'compile' ? args[1] : args[0];
const flags = parseFlags(args[0] === 'compile' ? args.slice(2) : args.slice(1));

if (!input) {
  printHelp();
  process.exit(1);
}

const scriptText = await fs.readFile(input, 'utf8');
const outDir = path.resolve(flags.out || 'compiled-userscript');
const targets = flags.target
  ? flags.target.split(',').map(value => value.trim()).filter(Boolean)
  : ['chrome', 'firefox', 'safari'];
const newTabFiles = flags.newtabDir ? await readAssetDir(flags.newtabDir, 'newtab') : [];

const result = await compileUserscriptProject(scriptText, {
  runtimeMode: flags.runtime || 'content-script',
  targets,
  includeNewTab: Boolean(flags.newtab || flags.newtabDir),
  newTabPath: flags.newtabDir ? 'newtab/index.html' : 'newtab.html',
  newTabFiles,
  includeContextMenus: flags.contextMenus !== false,
  includeOptionsPage: flags.optionsPage !== false,
  outputType: 'nodebuffer',
  firefoxId: flags.firefoxId,
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
      parsed.optionsPage = false;
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

function printHelp() {
  console.log(`UserScript Compiler 2.0

Usage:
  userscript-compiler compile path/to/script.user.js [options]
  npm run compile -- path/to/script.user.js [options]

Options:
  --out <dir>              Output directory (default: compiled-userscript)
  --target <list>          Comma-separated targets: chrome,firefox,safari
  --runtime <mode>         content-script, user-scripts, or auto
  --newtab                 Include a packaged new-tab override
  --newtab-dir <dir>       Copy a built new-tab directory into each extension
  --firefox-id <id>        Firefox extension id for browser_specific_settings
  --zip-only               Skip exploded project files; still writes project and release artifacts
  --no-context-menus       Disable generated context-menu support
  --no-options-page        Disable generated options page
`);
}

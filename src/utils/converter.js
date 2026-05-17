import JSZip from 'jszip';

const KNOWN_MULTI_KEYS = new Set([
  'match',
  'include',
  'exclude',
  'exclude-match',
  'grant',
  'connect',
  'require',
  'resource',
]);

const VALueless_KEYS = new Set(['noframes', 'unwrap']);

const METADATA_ALIASES = {
  homepageurl: 'homepage',
  homepage: 'homepage',
  website: 'homepage',
  source: 'homepage',
  supporturl: 'support',
  iconurl: 'icon',
  icon64url: 'icon64',
  'run-at': 'runAt',
  'inject-into': 'injectInto',
  'exclude-match': 'excludeMatches',
  downloadurl: 'downloadURL',
  updateurl: 'updateURL',
};

const TARGETS = ['chrome', 'firefox', 'safari'];

const DEFAULT_OPTIONS = {
  runtimeMode: 'content-script',
  targets: TARGETS,
  includeOptionsPage: true,
  includeContextMenus: true,
  includeNewTab: false,
  newTabPath: 'newtab.html',
  newTabFiles: [],
  openOptionsOnInstall: true,
  outputType: undefined,
  projectPackage: true,
};

export function parseMetadata(scriptText) {
  const meta = {
    name: '',
    namespace: '',
    description: '',
    version: '1.0.0',
    matches: [],
    includes: [],
    excludes: [],
    excludeMatches: [],
    grants: [],
    connect: [],
    requires: [],
    resources: [],
    runAt: 'document_idle',
    noFrames: false,
    unwrap: false,
    injectInto: '',
    sandbox: '',
    author: '',
    homepage: '',
    source: '',
    support: '',
    icon: '',
    icon64: '',
    downloadURL: '',
    updateURL: '',
    license: '',
    raw: {},
  };

  const lines = String(scriptText || '').split(/\r?\n/);
  let inBlock = false;
  for (let line of lines) {
    line = line.trim();
    if (line === '// ==UserScript==') {
      inBlock = true;
      continue;
    }
    if (!inBlock) continue;
    if (line === '// ==/UserScript==') break;
    if (!line.startsWith('//')) continue;

    const content = line.slice(2).trim();
    if (!content.startsWith('@')) continue;

    const match = content.match(/^@([^\s]+)(?:\s+(.*))?$/);
    if (!match) continue;
    const rawKey = match[1].trim();
    const key = rawKey.toLowerCase();
    const value = (match[2] || '').trim();
    if (!value && !VALueless_KEYS.has(key)) continue;

    if (!meta.raw[key]) meta.raw[key] = [];
    meta.raw[key].push(value);

    switch (key) {
      case 'name':
      case 'description':
      case 'version':
      case 'namespace':
      case 'author':
      case 'license':
      case 'sandbox':
        meta[key] = value;
        break;
      case 'match':
        meta.matches.push(value);
        break;
      case 'include':
        meta.includes.push(value);
        break;
      case 'exclude':
        meta.excludes.push(value);
        break;
      case 'exclude-match':
        meta.excludeMatches.push(value);
        break;
      case 'grant':
        if (value && value.toLowerCase() !== 'none') meta.grants.push(normalizeGrant(value));
        break;
      case 'connect':
        meta.connect.push(value);
        break;
      case 'require':
        meta.requires.push(value);
        break;
      case 'resource': {
        const parts = value.split(/\s+/);
        const name = parts.shift() || '';
        const url = parts.join(' ');
        if (name && url) meta.resources.push({ name, url });
        break;
      }
      case 'noframes':
        meta.noFrames = true;
        break;
      case 'unwrap':
        meta.unwrap = true;
        break;
      case 'icon':
      case 'iconurl':
        meta.icon = value;
        break;
      case 'icon64':
      case 'icon64url':
        meta.icon64 = value;
        break;
      case 'run-at':
        meta.runAt = normalizeRunAt(value);
        break;
      case 'inject-into':
        meta.injectInto = value;
        break;
      case 'homepage':
      case 'homepageurl':
      case 'website':
        meta.homepage = value;
        break;
      case 'source':
        meta.source = value;
        if (!meta.homepage) meta.homepage = value;
        break;
      case 'supporturl':
        meta.support = value;
        break;
      case 'downloadurl':
        meta.downloadURL = value;
        break;
      case 'updateurl':
        meta.updateURL = value;
        break;
      default: {
        const mapped = METADATA_ALIASES[key];
        if (mapped && !Array.isArray(meta[mapped])) meta[mapped] = value;
      }
    }
  }

  meta.grants = unique(meta.grants);
  return meta;
}

export function stripMetadata(scriptText) {
  return String(scriptText || '').replace(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\s*/, '').trim();
}

export function analyzeUserscript(scriptText, options = {}) {
  const compileOptions = normalizeOptions(options);
  const meta = applyMetadataOverrides(parseMetadata(scriptText), compileOptions.metadataOverrides);
  const diagnostics = [];

  if (!meta.name) diagnostics.push(errorDiagnostic('metadata.name', 'Missing @name. The extension will be named "Converted Userscript".'));
  if (!meta.matches.length && !meta.includes.length) {
    diagnostics.push(errorDiagnostic('metadata.match', 'Missing @match or @include. Browser extensions need explicit URL patterns.'));
  }
  if (meta.requires.length) {
    diagnostics.push(warnDiagnostic(
      'remote-code.require',
      '@require entries are not bundled automatically. Store policies require third-party code to be packaged and reviewable, not loaded remotely at runtime.',
    ));
  }
  if (meta.connect.includes('*')) {
    diagnostics.push(warnDiagnostic(
      'permissions.connect-all',
      '@connect * expands to broad network access. Expect extra Chrome/Mozilla review and consider a narrower host list.',
    ));
  }
  if (meta.matches.includes('*://*/*') || meta.matches.includes('<all_urls>')) {
    diagnostics.push(warnDiagnostic(
      'permissions.all-sites',
      'The script runs on all websites. Store reviewers expect a narrow single purpose and a clear explanation for all-site access.',
    ));
  }
  if (meta.matches.some(pattern => pattern.startsWith('file://'))) {
    diagnostics.push(infoDiagnostic(
      'permissions.file-urls',
      'file:// access requires a separate browser toggle in Chrome and may not be available on mobile browsers.',
    ));
  }
  if (compileOptions.runtimeMode === 'user-scripts') {
    diagnostics.push(warnDiagnostic(
      'runtime.userScripts',
      'Native userScripts mode is high-friction. Chrome requires the userScripts permission and a browser toggle; Mozilla policy limits userScripts API usage to script-manager extensions.',
    ));
  }
  if (/\binnerHTML\s*=/.test(scriptText)) {
    diagnostics.push(warnDiagnostic(
      'amo.innerHTML',
      'The script assigns to innerHTML. Mozilla lint may warn; document the sanitization/escaping path in reviewer notes.',
    ));
  }
  if (/\binsertAdjacentHTML\s*\(/.test(scriptText)) {
    diagnostics.push(warnDiagnostic(
      'amo.insertAdjacentHTML',
      'The script calls insertAdjacentHTML. Mozilla lint may warn; document why the inserted HTML is trusted or sanitized.',
    ));
  }
  if (/\bnew\s+Function\b|\bFunction\s*\(/.test(scriptText)) {
    diagnostics.push(warnDiagnostic(
      'amo.dynamic-code',
      'The script uses the Function constructor or dynamic code evaluation. Store review may require a detailed explanation or removal.',
    ));
  }

  const normalized = normalizeMetaForExtension(meta, diagnostics);
  const grants = analyzeGrants(normalized);
  const targetPlans = compileOptions.targets.map(target => {
    const runtimeMode = chooseRuntimeMode(normalized, compileOptions, target);
    return {
      target,
      runtimeMode,
      manifest: buildManifest(normalized, grants, compileOptions, target, runtimeMode, diagnostics),
    };
  });

  return {
    meta: normalized,
    grants,
    diagnostics,
    options: compileOptions,
    targetPlans,
    review: generateReviewBundle(normalized, grants, compileOptions, targetPlans, diagnostics),
  };
}

export async function compileUserscriptProject(scriptText, options = {}) {
  const analysis = analyzeUserscript(scriptText, options);
  const scriptBody = stripMetadata(scriptText);
  const files = [];
  const extensionFilesByTarget = new Map();
  const baseName = packageSlug(analysis.meta);

  addText(files, 'packages/userscript/script.user.js', scriptText.trim() + '\n');
  addText(files, 'packages/userscript/README.md', generateUserscriptReadme(analysis));

  for (const plan of analysis.targetPlans) {
    const prefix = `packages/extension/${plan.target}`;
    const extensionFiles = generateExtensionFiles(analysis, scriptBody, plan);
    extensionFilesByTarget.set(plan.target, extensionFiles);
    for (const file of extensionFiles) {
      addText(files, `${prefix}/${file.path}`, file.content);
    }
  }

  const packageValidation = validateStorePackages(analysis, extensionFilesByTarget);
  const releaseArtifacts = await generateReleaseArtifacts(analysis, extensionFilesByTarget, packageValidation, options.outputType);

  for (const file of generateStandaloneFiles(analysis, scriptBody)) {
    addText(files, `packages/standalone/${file.path}`, file.content);
  }

  addText(files, 'review/chrome-web-store.md', analysis.review.chrome);
  addText(files, 'review/mozilla-amo.md', analysis.review.mozilla);
  addText(files, 'review/safari-app-store.md', analysis.review.safari);
  addText(files, 'review/firefox-android.md', analysis.review.firefoxAndroid);
  addText(files, 'review/troubleshooting.md', analysis.review.troubleshooting);
  addText(files, 'review/package-validation.md', generatePackageValidationMarkdown(packageValidation));
  addText(files, 'review/release-artifacts.md', generateReleaseArtifactsMarkdown(analysis, releaseArtifacts));
  addText(files, 'audit/compiler-audit.json', JSON.stringify(toAuditJson(analysis, packageValidation, releaseArtifacts), null, 2) + '\n');
  addText(files, 'audit/package-validation.json', JSON.stringify(packageValidation, null, 2) + '\n');
  addText(files, 'README.md', generateProjectReadme(analysis));
  addText(files, 'package.json', generateGeneratedPackageJson(analysis));
  addText(files, 'tools/verify.mjs', generateVerifyScript());

  const zip = await zipFiles(files, options.outputType);
  const extensionZipName = `${baseName}-extension-project.zip`;
  return { ...analysis, files, zip, zipName: extensionZipName, packageValidation, releaseArtifacts };
}

export async function createProjectZip(scriptText, options = {}) {
  const result = await compileUserscriptProject(scriptText, options);
  return result.zip;
}

export async function createZipFiles(meta, scriptText, iconData, options = {}) {
  const result = await compileUserscriptProject(scriptText, {
    ...options,
    metadataOverrides: meta,
    iconData,
    targets: options.targets || ['chrome'],
    projectPackage: false,
  });

  const chromeRelease = result.releaseArtifacts.find(artifact => artifact.target === 'chrome' && artifact.kind === 'zip');
  if (chromeRelease) return chromeRelease.content;
  const chromePrefix = 'packages/extension/chrome/';
  return zipFiles(result.files
    .filter(file => file.path.startsWith(chromePrefix))
    .map(file => ({ ...file, path: file.path.slice(chromePrefix.length) })), options.outputType);
}

async function generateReleaseArtifacts(analysis, extensionFilesByTarget, packageValidation, outputType) {
  const baseName = packageSlug(analysis.meta);
  const artifacts = [];

  for (const plan of analysis.targetPlans) {
    const extensionFiles = storePackageFiles(extensionFilesByTarget.get(plan.target) || []);
    if (!extensionFiles.length) continue;

    if (plan.target === 'chrome') {
      artifacts.push({
        target: 'chrome',
        kind: 'zip',
        path: `release/chrome/${baseName}-chrome.zip`,
        content: await zipFiles(extensionFiles, outputType),
        files: extensionFiles.map(file => file.path),
        validation: validationStatusForTarget(packageValidation, 'chrome'),
      });
      continue;
    }

    if (plan.target === 'firefox') {
      artifacts.push({
        target: 'firefox',
        kind: 'xpi',
        path: `release/firefox/${baseName}-firefox.xpi`,
        content: await zipFiles(extensionFiles, outputType),
        files: extensionFiles.map(file => file.path),
        validation: validationStatusForTarget(packageValidation, 'firefox'),
      });
      artifacts.push({
        target: 'firefox-android',
        kind: 'notes',
        path: 'release/firefox-android/README.md',
        content: generateFirefoxAndroidReleaseReadme(analysis, packageValidation),
      });
      continue;
    }

    if (plan.target === 'safari') {
      const folder = `release/safari/${baseName}-safari-web-extension`;
      artifacts.push({
        target: 'safari',
        kind: 'directory',
        path: folder,
        files: extensionFiles.map(file => ({
          path: `${folder}/${file.path}`,
          sourcePath: file.path,
          content: file.content,
        })),
        validation: validationStatusForTarget(packageValidation, 'safari'),
      });
      artifacts.push({
        target: 'safari',
        kind: 'notes',
        path: 'release/safari/README.md',
        content: generateSafariReleaseReadme(analysis, folder),
      });
    }
  }

  return artifacts;
}

function validateStorePackages(analysis, extensionFilesByTarget) {
  const targets = analysis.targetPlans.map(plan => {
    const extensionFiles = storePackageFiles(extensionFilesByTarget.get(plan.target) || []);
    return validateStorePackage(plan, extensionFiles);
  });
  const summary = summarizeValidation(targets.flatMap(target => target.issues));
  return {
    schemaVersion: 1,
    summary,
    targets,
  };
}

function validateStorePackage(plan, files) {
  const issues = [];
  const fileMap = new Map(files.map(file => [normalizePackagePath(file.path), file]));
  const manifestFile = fileMap.get('manifest.json');
  let manifest;

  if (!manifestFile) {
    issues.push(packageIssue('error', 'package.manifest.missing', `${plan.target} package is missing manifest.json at archive root.`, 'manifest.json'));
  } else {
    try {
      manifest = JSON.parse(fileContentAsText(manifestFile));
    } catch (error) {
      issues.push(packageIssue('error', 'package.manifest.invalid-json', `manifest.json is not valid JSON: ${error.message}`, 'manifest.json'));
    }
  }

  if (manifest) validateManifestReferences(manifest, fileMap, issues);
  validateHtmlReferences(files, fileMap, issues);
  validateRemoteCode(files, issues);
  validateTargetSpecificPackage(plan, manifest, issues);

  return {
    target: plan.target,
    runtimeMode: plan.runtimeMode,
    status: validationStatus(issues),
    summary: summarizeValidation(issues),
    files: files.map(file => file.path).sort(),
    issues,
  };
}

function validateManifestReferences(manifest, fileMap, issues) {
  const addReference = (ref, owner, field) => validatePackageReference(ref, owner, field, fileMap, issues);
  const addIconReferences = (icons, owner) => {
    if (!icons) return;
    if (typeof icons === 'string') {
      addReference(icons, 'manifest.json', owner);
      return;
    }
    for (const value of Object.values(icons)) addReference(value, 'manifest.json', owner);
  };

  addIconReferences(manifest.icons, 'icons');
  addIconReferences(manifest.action?.default_icon, 'action.default_icon');
  addIconReferences(manifest.browser_action?.default_icon, 'browser_action.default_icon');
  addIconReferences(manifest.page_action?.default_icon, 'page_action.default_icon');
  addReference(manifest.action?.default_popup, 'manifest.json', 'action.default_popup');
  addReference(manifest.browser_action?.default_popup, 'manifest.json', 'browser_action.default_popup');
  addReference(manifest.page_action?.default_popup, 'manifest.json', 'page_action.default_popup');
  addReference(manifest.options_ui?.page, 'manifest.json', 'options_ui.page');
  addReference(manifest.options_page, 'manifest.json', 'options_page');
  addReference(manifest.devtools_page, 'manifest.json', 'devtools_page');
  addReference(manifest.side_panel?.default_path, 'manifest.json', 'side_panel.default_path');
  addReference(manifest.chrome_url_overrides?.newtab, 'manifest.json', 'chrome_url_overrides.newtab');
  addReference(manifest.background?.service_worker, 'manifest.json', 'background.service_worker');
  for (const script of manifest.background?.scripts || []) addReference(script, 'manifest.json', 'background.scripts');
  for (const contentScript of manifest.content_scripts || []) {
    for (const script of contentScript.js || []) addReference(script, 'manifest.json', 'content_scripts.js');
    for (const css of contentScript.css || []) addReference(css, 'manifest.json', 'content_scripts.css');
  }
  for (const resourceGroup of manifest.web_accessible_resources || []) {
    for (const resource of resourceGroup.resources || []) addReference(resource, 'manifest.json', 'web_accessible_resources.resources');
  }
}

function validateHtmlReferences(files, fileMap, issues) {
  for (const file of files) {
    if (!file.path.endsWith('.html')) continue;
    const html = fileContentAsText(file);
    const attrPattern = /\b(?:src|href|poster)\s*=\s*(['"])(.*?)\1/gi;
    for (const match of html.matchAll(attrPattern)) {
      validatePackageReference(match[2], file.path, 'html asset reference', fileMap, issues);
    }
    const srcsetPattern = /\bsrcset\s*=\s*(['"])(.*?)\1/gi;
    for (const match of html.matchAll(srcsetPattern)) {
      for (const candidate of parseSrcsetUrls(match[2])) {
        validatePackageReference(candidate, file.path, 'html srcset reference', fileMap, issues);
      }
    }
  }
}

function validateRemoteCode(files, issues) {
  const patterns = [
    {
      code: 'remote-code.dynamic-eval',
      message: 'Package code uses eval(), Function(), or new Function(). Store review may treat this as dynamic code execution.',
      test: text => /\beval\s*\(|\bFunction\s*\(|\bnew\s+Function\b/.test(text),
      extensions: ['.js', '.mjs', '.html'],
    },
    {
      code: 'remote-code.remote-script-tag',
      message: 'Package HTML loads a remote script. MV3 store packages must bundle executable code locally.',
      test: text => /<script\b[^>]*\bsrc\s*=\s*['"]https?:\/\//i.test(text),
      extensions: ['.html'],
    },
    {
      code: 'remote-code.remote-import',
      message: 'Package code imports executable code from a remote URL.',
      test: text => /\b(?:importScripts|import)\s*\(\s*['"]https?:\/\//i.test(text),
      extensions: ['.js', '.mjs', '.html'],
    },
    {
      code: 'remote-code.string-timer',
      message: 'Package code passes a string to setTimeout/setInterval, which is dynamic code execution.',
      test: text => /\bset(?:Timeout|Interval)\s*\(\s*['"`]/.test(text),
      extensions: ['.js', '.mjs', '.html'],
    },
    {
      code: 'remote-code.remote-css-import',
      message: 'Package CSS imports a remote stylesheet. Bundle reviewable assets locally.',
      test: text => /@import\s+(?:url\()?['"]?https?:\/\//i.test(text),
      extensions: ['.css', '.html'],
    },
  ];

  for (const file of files) {
    const lower = file.path.toLowerCase();
    const text = fileContentAsText(file);
    for (const pattern of patterns) {
      if (!pattern.extensions.some(ext => lower.endsWith(ext))) continue;
      if (!pattern.test(text)) continue;
      issues.push(packageIssue('warning', pattern.code, pattern.message, file.path));
    }
  }
}

function validateTargetSpecificPackage(plan, manifest, issues) {
  if (!manifest) return;
  if (plan.target === 'chrome' && manifest.background?.scripts) {
    issues.push(packageIssue('error', 'chrome.background.scripts', 'Chrome MV3 packages must use background.service_worker instead of background.scripts.', 'manifest.json'));
  }
  if (plan.target === 'firefox' && manifest.background?.service_worker) {
    issues.push(packageIssue('error', 'firefox.background.service-worker', 'Firefox MV3 packages should use background.scripts for this compiler profile.', 'manifest.json'));
  }
  if (plan.target === 'firefox') {
    const permissions = [...(manifest.permissions || []), ...(manifest.optional_permissions || [])];
    if (permissions.includes('userScripts')) {
      issues.push(packageIssue('warning', 'firefox.userScripts.policy', 'Mozilla generally limits the userScripts API to script-manager extensions. Prefer content-script mode for single-script packages.', 'manifest.json'));
    }
  }
  if (plan.target === 'safari') {
    if (manifest.optional_permissions?.includes('userScripts') || manifest.permissions?.includes('userScripts')) {
      issues.push(packageIssue('error', 'safari.userScripts.unsupported', 'Safari release output must not depend on Chrome/Firefox userScripts permissions.', 'manifest.json'));
    }
    if (manifest.chrome_url_overrides?.newtab) {
      issues.push(packageIssue('info', 'safari.newtab.review', 'Safari new-tab behavior must be tested through Apple Safari Web Extension packaging because platform support differs.', 'manifest.json'));
    }
  }
}

function validatePackageReference(ref, owner, field, fileMap, issues) {
  if (!isLocalPackageReference(ref)) return;
  const resolved = resolvePackageReference(owner, ref);
  if (resolved.outside) {
    issues.push(packageIssue('error', 'package.asset.outside-root', `${field} references ${ref}, which resolves outside the extension package.`, owner, ref));
    return;
  }
  if (!resolved.path || resolved.path.includes('*')) return;
  if (!fileMap.has(resolved.path)) {
    issues.push(packageIssue('error', 'package.asset.missing', `${field} references missing packaged asset ${ref}.`, owner, ref, resolved.path));
  }
}

function storePackageFiles(files) {
  return files
    .filter(file => normalizePackagePath(file.path) !== 'README.md')
    .map(file => ({ ...file, path: normalizePackagePath(file.path) }));
}

function validationStatusForTarget(packageValidation, target) {
  return packageValidation.targets.find(item => item.target === target)?.status || 'unknown';
}

function generateExtensionFiles(analysis, scriptBody, plan) {
  const { meta, grants, options } = analysis;
  const runtimeMode = plan.runtimeMode;
  const files = [];
  const manifest = plan.manifest;
  files.push({ path: 'manifest.json', content: JSON.stringify(manifest, omitUndefined, 2) + '\n' });
  files.push({ path: 'background.js', content: generateBackgroundScript(meta, grants, options, runtimeMode, plan.target) });
  files.push({ path: 'content.js', content: generateContentScript(meta, scriptBody, grants, runtimeMode) });
  files.push({ path: 'options.html', content: generateOptionsHtml(meta, analysis, plan) });
  files.push({ path: 'options.js', content: generateOptionsJs(runtimeMode, plan.target) });
  files.push({ path: 'options.css', content: generateOptionsCss() });
  if (options.includeNewTab && options.newTabFiles?.length) {
    for (const file of options.newTabFiles) files.push({ path: file.path, content: file.content });
  } else if (options.includeNewTab) {
    files.push({ path: 'newtab.html', content: generateNewTabHtml(meta) });
  }
  files.push({ path: 'README.md', content: generateExtensionReadme(analysis, plan) });
  return files;
}

function buildManifest(meta, grants, options, target, runtimeMode, diagnostics) {
  const name = trimManifestText(meta.name || 'Converted Userscript', 75);
  const description = trimManifestText(meta.description || `Browser extension package for ${name}.`, 132);
  const permissions = new Set();
  const optionalPermissions = new Set();
  const hostPermissions = new Set(deriveHostPermissions(meta, diagnostics));
  const icons = manifestIconsFromPackagedAssets(options);

  if (options.includeOptionsPage || grants.needsStorage) permissions.add('storage');
  if (options.includeContextMenus && grants.hasMenuCommands) permissions.add(target === 'firefox' ? 'menus' : 'contextMenus');
  if (grants.needsDownloads) permissions.add('downloads');
  if (grants.needsNotifications) permissions.add('notifications');
  if (grants.needsClipboard) permissions.add('clipboardWrite');

  if (runtimeMode === 'user-scripts') {
    if (target === 'firefox') optionalPermissions.add('userScripts');
    else permissions.add('userScripts');
  }

  const geckoSettings = target === 'firefox'
    ? {
        id: options.firefoxId || extensionIdFromNamespace(meta.namespace, name),
        data_collection_permissions: {
          required: inferFirefoxDataCollection(meta, grants),
        },
      }
    : undefined;

  const manifest = {
    manifest_version: 3,
    name,
    description,
    version: normalizeExtensionVersion(meta.version),
    author: meta.author || undefined,
    homepage_url: meta.homepage || undefined,
    icons,
    minimum_chrome_version: target === 'chrome' ? '121' : undefined,
    permissions: [...permissions].sort(),
    optional_permissions: [...optionalPermissions].sort(),
    host_permissions: [...hostPermissions].sort(),
    action: {
      default_title: name,
      default_icon: icons,
    },
    background: target === 'firefox'
      ? { scripts: ['background.js'] }
      : { service_worker: 'background.js' },
    options_ui: options.includeOptionsPage ? { page: 'options.html', open_in_tab: true } : undefined,
    content_scripts: runtimeMode === 'content-script' ? [{
      matches: meta.extensionMatches,
      exclude_matches: meta.extensionExcludeMatches.length ? meta.extensionExcludeMatches : undefined,
      include_globs: meta.includeGlobs.length ? meta.includeGlobs : undefined,
      exclude_globs: meta.excludeGlobs.length ? meta.excludeGlobs : undefined,
      js: ['content.js'],
      all_frames: !meta.noFrames,
      run_at: meta.runAt,
    }] : undefined,
    chrome_url_overrides: options.includeNewTab ? { newtab: options.newTabPath || 'newtab.html' } : undefined,
    browser_specific_settings: geckoSettings ? { gecko: geckoSettings } : undefined,
  };

  if (!manifest.permissions.length) delete manifest.permissions;
  if (!manifest.optional_permissions.length) delete manifest.optional_permissions;
  if (!manifest.host_permissions.length) delete manifest.host_permissions;
  return manifest;
}

function manifestIconsFromPackagedAssets(options) {
  const files = options.newTabFiles || [];
  const icons = {};
  for (const size of ['16', '32', '48', '128']) {
    const icon = files.find(file => isPackagedRasterIcon(file.path, size));
    if (icon) icons[size] = normalizePackagePath(icon.path);
  }
  return Object.keys(icons).length ? icons : undefined;
}

function isPackagedRasterIcon(filePath, size) {
  const lower = normalizePackagePath(filePath).toLowerCase();
  const basename = lower.split('/').pop() || '';
  if (!/\.(png|jpg|jpeg|gif|bmp|ico)$/.test(basename)) return false;
  return basename === `icon${size}.png`
    || basename === `icon-${size}.png`
    || basename === `${size}.png`
    || basename === `icon${size}.jpg`
    || basename === `icon-${size}.jpg`
    || basename === `icon${size}.jpeg`
    || basename === `icon-${size}.jpeg`;
}

function normalizeMetaForExtension(meta, diagnostics) {
  const extensionMatches = [];
  const extensionExcludeMatches = [];
  const includeGlobs = [];
  const excludeGlobs = [];

  for (const pattern of meta.matches) {
    const normalized = normalizeMatchPattern(pattern);
    if (normalized.valid) extensionMatches.push(normalized.pattern);
    else diagnostics.push(warnDiagnostic('metadata.match.invalid', `Could not convert @match ${pattern}. ${normalized.reason}`));
  }

  for (const pattern of meta.excludeMatches) {
    const normalized = normalizeMatchPattern(pattern);
    if (normalized.valid) extensionExcludeMatches.push(normalized.pattern);
    else diagnostics.push(warnDiagnostic('metadata.exclude-match.invalid', `Could not convert @exclude-match ${pattern}. ${normalized.reason}`));
  }

  for (const include of meta.includes) {
    if (isLikelyMatchPattern(include)) {
      const normalized = normalizeMatchPattern(include);
      if (normalized.valid) extensionMatches.push(normalized.pattern);
      else includeGlobs.push(include);
    } else {
      includeGlobs.push(include);
      const hostPattern = includeGlobToHostPattern(include);
      if (hostPattern) extensionMatches.push(hostPattern);
      diagnostics.push(infoDiagnostic('metadata.include.glob', `Preserved @include glob ${include} and added a coarse extension match pattern for browser injection.`));
    }
  }

  for (const exclude of meta.excludes) {
    if (isLikelyMatchPattern(exclude)) {
      const normalized = normalizeMatchPattern(exclude);
      if (normalized.valid) extensionExcludeMatches.push(normalized.pattern);
      else excludeGlobs.push(exclude);
    } else {
      excludeGlobs.push(exclude);
    }
  }

  if (!extensionMatches.length) extensionMatches.push('*://*/*');

  return {
    ...meta,
    extensionMatches: unique(extensionMatches),
    extensionExcludeMatches: unique(extensionExcludeMatches),
    includeGlobs: unique(includeGlobs),
    excludeGlobs: unique(excludeGlobs),
    runAt: normalizeRunAt(meta.runAt),
  };
}

function analyzeGrants(meta) {
  const grants = new Set(meta.grants.map(normalizeGrant));
  const hasAny = name => grants.has(name) || grants.has(name.replace('GM_', 'GM.'));
  const capability = {
    requested: [...grants].sort(),
    unsupported: [],
    needsStorage: ['GM_getValue', 'GM_setValue', 'GM_deleteValue', 'GM_listValues', 'GM_addValueChangeListener', 'GM_removeValueChangeListener', 'GM.getValue', 'GM.setValue', 'GM.deleteValue', 'GM.listValues'].some(hasAny),
    needsDownloads: ['GM_download', 'GM.download'].some(hasAny),
    needsNotifications: ['GM_notification', 'GM.notification'].some(hasAny),
    needsClipboard: ['GM_setClipboard', 'GM.setClipboard'].some(hasAny),
    hasMenuCommands: ['GM_registerMenuCommand', 'GM.registerMenuCommand'].some(hasAny),
    hasCrossOriginRequests: ['GM_xmlhttpRequest', 'GM.xmlHttpRequest', 'GM.xmlhttpRequest'].some(hasAny) || meta.connect.length > 0,
    hasResources: meta.resources.length > 0 || ['GM_getResourceText', 'GM_getResourceURL', 'GM.getResourceText', 'GM.getResourceUrl', 'GM.getResourceURL'].some(hasAny),
    hasUnsafeWindow: grants.has('unsafeWindow') || grants.has('unsafewindow'),
  };

  for (const grant of grants) {
    if (!supportedGrantNames().has(grant)) capability.unsupported.push(grant);
  }
  return capability;
}

function inferFirefoxDataCollection(meta, grants) {
  const readsPages = meta.extensionMatches.includes('*://*/*')
    || meta.extensionMatches.includes('<all_urls>')
    || meta.extensionMatches.length > 0;
  if (readsPages && grants.hasCrossOriginRequests) return ['websiteContent'];
  return ['none'];
}

function generateBackgroundScript(meta, grants, options, runtimeMode, target) {
  const prefix = `usc_${safeIdentifier(meta.namespace || meta.name || 'script')}_`;
  const scriptId = `usc_${safeIdentifier(meta.name || 'script')}`;
  const registerBlock = runtimeMode === 'user-scripts' ? `
  async function isUserScriptsAvailable() {
    try {
      if (!api.userScripts?.getScripts) return false;
      await api.userScripts.getScripts();
      return true;
    } catch {
      return false;
    }
  }

  async function registerUserScript() {
    if (!(await isUserScriptsAvailable())) return false;
    const spec = {
      id: ${JSON.stringify(scriptId)},
      matches: ${JSON.stringify(meta.extensionMatches)},
      excludeMatches: ${JSON.stringify(meta.extensionExcludeMatches)},
      includeGlobs: ${JSON.stringify(meta.includeGlobs)},
      excludeGlobs: ${JSON.stringify(meta.excludeGlobs)},
      allFrames: ${JSON.stringify(!meta.noFrames)},
      runAt: ${JSON.stringify(meta.runAt)},
      js: [{ file: 'content.js' }]
    };
    try {
      const existing = await api.userScripts.getScripts({ ids: [spec.id] });
      if (existing && existing.length && api.userScripts.update) await api.userScripts.update([spec]);
      else {
        if (existing && existing.length) await api.userScripts.unregister({ ids: [spec.id] });
        await api.userScripts.register([spec]);
      }
      return true;
    } catch (error) {
      console.warn('User script registration failed:', error);
      return false;
    }
  }
` : '';

  return `/* UserScript Compiler runtime background. Generated for ${target}; source script: ${escapeJs(meta.name || 'userscript')}. */
(() => {
  const api = globalThis.browser || globalThis.chrome;
  const storagePrefix = ${JSON.stringify(prefix)};
  const menuCallbacks = new Map();
  const pendingFetches = new Map();

  function promisify(fn, thisArg, ...args) {
    return new Promise((resolve, reject) => {
      try {
        const result = fn.apply(thisArg, [...args, value => {
          const err = api.runtime?.lastError;
          if (err) reject(new Error(err.message));
          else resolve(value);
        }]);
        if (result && typeof result.then === 'function') result.then(resolve, reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  const storage = {
    async get(key) {
      if (api.storage.local.get.length > 1) return promisify(api.storage.local.get, api.storage.local, key);
      return api.storage.local.get(key);
    },
    async set(value) {
      if (api.storage.local.set.length > 1) return promisify(api.storage.local.set, api.storage.local, value);
      return api.storage.local.set(value);
    },
    async remove(key) {
      if (api.storage.local.remove.length > 1) return promisify(api.storage.local.remove, api.storage.local, key);
      return api.storage.local.remove(key);
    }
  };

  async function queryTabs(queryInfo) {
    if (!api.tabs?.query) return [];
    if (api.tabs.query.length > 1) return promisify(api.tabs.query, api.tabs, queryInfo);
    return api.tabs.query(queryInfo);
  }

  async function broadcastValueChange(name, oldValue, newValue, sender) {
    const message = {
      channel: 'userscript-compiler',
      type: 'GM_valueChanged',
      payload: { name, oldValue, newValue }
    };
    const tabs = await queryTabs({});
    await Promise.all(tabs.map(tab => {
      if (!tab?.id || !api.tabs?.sendMessage) return Promise.resolve();
      return Promise.resolve(api.tabs.sendMessage(tab.id, message)).catch(() => {});
    }));
  }

  function b64ToBytes(base64) {
    const binary = atob(base64 || '');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function bytesToB64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  async function decodeBody(body) {
    if (!body || body.kind === 'none') return undefined;
    if (body.kind === 'text') return body.value;
    if (body.kind === 'bytes') return b64ToBytes(body.base64).buffer;
    if (body.kind === 'blob') return new Blob([b64ToBytes(body.base64)], { type: body.type || '' });
    if (body.kind === 'formData') {
      const data = new FormData();
      for (const entry of body.entries || []) {
        if (entry.kind === 'blob') {
          data.append(entry.name, new Blob([b64ToBytes(entry.base64)], { type: entry.type || '' }), entry.filename || 'blob');
        } else {
          data.append(entry.name, entry.value || '');
        }
      }
      return data;
    }
    return body.value;
  }

  async function encodeResponse(response, responseType) {
    const headers = {};
    for (const [key, value] of response.headers.entries()) headers[key] = value;
    let payload;
    let responseText = '';
    if (responseType === 'blob') {
      const blob = await response.blob();
      payload = { kind: 'blob', type: blob.type, base64: bytesToB64(new Uint8Array(await blob.arrayBuffer())) };
    } else if (responseType === 'arraybuffer') {
      payload = { kind: 'arraybuffer', base64: bytesToB64(new Uint8Array(await response.arrayBuffer())) };
    } else {
      responseText = await response.text();
      if (responseType === 'json') {
        try { payload = JSON.parse(responseText || 'null'); }
        catch { payload = responseText; }
      } else {
        payload = responseText;
      }
    }
    return {
      response: payload,
      responseText,
      status: response.status,
      statusText: response.statusText,
      finalUrl: response.url,
      responseHeaders: headers
    };
  }

  async function handleXmlHttpRequest(payload) {
    const controller = new AbortController();
    pendingFetches.set(payload.id, controller);
    let timer = 0;
    if (payload.timeout) {
      timer = setTimeout(() => controller.abort(new Error('timeout')), payload.timeout);
    }
    try {
      const response = await fetch(payload.url, {
        method: payload.method || 'GET',
        headers: payload.headers || undefined,
        body: await decodeBody(payload.body),
        credentials: payload.anonymous ? 'omit' : (payload.credentials || 'include'),
        redirect: payload.redirect || 'follow',
        signal: controller.signal
      });
      return { id: payload.id, success: true, result: await encodeResponse(response, payload.responseType || 'text') };
    } finally {
      pendingFetches.delete(payload.id);
      if (timer) clearTimeout(timer);
    }
  }

  async function registerMenuCommand(payload, sender) {
    if (!api.contextMenus && !api.menus) return { id: payload.id, supported: false };
    const menus = api.contextMenus || api.menus;
    const id = String(payload.id);
    menuCallbacks.set(id, { tabId: sender?.tab?.id, frameId: sender?.frameId });
    try { await promisify(menus.remove, menus, id); } catch {}
    const createOptions = {
      id,
      title: payload.title || 'Userscript command',
      contexts: ['page', 'selection', 'link', 'image', 'video', 'audio']
    };
    if (menus.create.length > 1) await promisify(menus.create, menus, createOptions);
    else menus.create(createOptions);
    return { id, supported: true };
  }

  async function handleMessage(message, sender) {
    if (!message || message.channel !== 'userscript-compiler') return undefined;
    const payload = message.payload || {};
    switch (message.type) {
      case 'GM_getAllValues': {
        const data = await storage.get(null);
        const values = {};
        for (const [key, value] of Object.entries(data || {})) {
          if (key.startsWith(storagePrefix)) values[key.slice(storagePrefix.length)] = value;
        }
        return { values };
      }
      case 'GM_getValue': {
        const key = storagePrefix + payload.name;
        const data = await storage.get(key);
        return Object.prototype.hasOwnProperty.call(data || {}, key)
          ? { value: data[key] }
          : { value: payload.defaultValue };
      }
      case 'GM_setValue':
        {
          const key = storagePrefix + payload.name;
          const oldData = await storage.get(key);
          const oldValue = oldData?.[key];
          await storage.set({ [key]: payload.value });
          await broadcastValueChange(payload.name, oldValue, payload.value, sender);
        }
        return {};
      case 'GM_deleteValue':
        {
          const key = storagePrefix + payload.name;
          const oldData = await storage.get(key);
          const oldValue = oldData?.[key];
          await storage.remove(key);
          await broadcastValueChange(payload.name, oldValue, undefined, sender);
        }
        return {};
      case 'GM_listValues': {
        const data = await storage.get(null);
        return { keys: Object.keys(data || {}).filter(key => key.startsWith(storagePrefix)).map(key => key.slice(storagePrefix.length)) };
      }
      case 'GM_xmlhttpRequest':
        return handleXmlHttpRequest(payload);
      case 'GM_abortRequest': {
        pendingFetches.get(payload.id)?.abort();
        pendingFetches.delete(payload.id);
        return {};
      }
      case 'GM_download': {
        if (!api.downloads?.download) throw new Error('downloads API is unavailable');
        const options = typeof payload.details === 'string'
          ? { url: payload.details, filename: payload.filename || undefined, saveAs: false }
          : { url: payload.details.url, filename: payload.details.name || payload.details.filename || undefined, saveAs: Boolean(payload.details.saveAs) };
        const id = api.downloads.download.length > 1
          ? await promisify(api.downloads.download, api.downloads, options)
          : await api.downloads.download(options);
        return { id };
      }
      case 'GM_openInTab': {
        const tab = api.tabs.create.length > 1
          ? await promisify(api.tabs.create, api.tabs, { url: payload.url, active: !payload.openInBackground })
          : await api.tabs.create({ url: payload.url, active: !payload.openInBackground });
        return { tabId: tab?.id };
      }
      case 'GM_notification': {
        if (!api.notifications?.create) return {};
        const notification = payload.details || {};
        await promisify(api.notifications.create, api.notifications, {
          type: 'basic',
          title: notification.title || ${JSON.stringify(meta.name || 'Userscript')},
          message: notification.text || notification.message || '',
          iconUrl: notification.image || ''
        });
        return {};
      }
      case 'GM_registerMenuCommand':
        return registerMenuCommand(payload, sender);
      case 'OPEN_OPTIONS':
        await api.runtime.openOptionsPage?.();
        return {};
      default:
        return {};
    }
  }

  function addMessageListener(eventName) {
    const event = api.runtime?.[eventName];
    if (!event?.addListener) return;
    event.addListener((message, sender, sendResponse) => {
      Promise.resolve(handleMessage(message, sender)).then(sendResponse, error => sendResponse({ error: error?.message || String(error) }));
      return true;
    });
  }

  addMessageListener('onMessage');
  addMessageListener('onUserScriptMessage');

  const menus = api.contextMenus || api.menus;
  if (menus?.onClicked) {
    menus.onClicked.addListener((info, tab) => {
      const callback = menuCallbacks.get(info.menuItemId);
      if (!callback || !tab?.id || !api.tabs?.sendMessage) return;
      api.tabs.sendMessage(tab.id, {
        channel: 'userscript-compiler',
        type: 'GM_menuCommand',
        payload: { id: info.menuItemId }
      }).catch?.(() => {});
    });
  }

${registerBlock}
  async function openOptionsOnInstall(details) {
    if (${JSON.stringify(Boolean(options.openOptionsOnInstall && options.includeOptionsPage))} && details?.reason === 'install') {
      try { await api.runtime.openOptionsPage?.(); } catch {}
    }
  }

  api.runtime?.onInstalled?.addListener(details => {
    openOptionsOnInstall(details);
    ${runtimeMode === 'user-scripts' ? 'registerUserScript();' : ''}
  });
  api.runtime?.onStartup?.addListener?.(() => {
    ${runtimeMode === 'user-scripts' ? 'registerUserScript();' : ''}
  });
  api.action?.onClicked?.addListener?.(() => api.runtime.openOptionsPage?.());
  ${runtimeMode === 'user-scripts' ? 'registerUserScript();' : ''}
})();`;
}

function generateContentScript(meta, scriptBody, grants, runtimeMode) {
  return `${generateUserScriptApi(meta, grants, runtimeMode)}

Promise.resolve(globalThis.__USC_READY).catch(() => {}).then(() => {
  try {
${indent(scriptBody || '// Empty userscript body.', 4)}
  } catch (error) {
    console.error('Userscript failed:', error);
  }
});
`;
}

function generateUserScriptApi(meta, grants, runtimeMode) {
  const gmInfo = {
    script: {
      name: meta.name || '',
      namespace: meta.namespace || '',
      description: meta.description || '',
      version: meta.version || '',
      resources: meta.resources,
    },
    scriptHandler: 'UserScript Compiler',
    version: '2.0',
    platform: { name: 'browser-extension', runtimeMode },
  };

  return `/* UserScript Compiler GM compatibility runtime. */
(() => {
  const api = globalThis.browser || globalThis.chrome;
  const channel = 'userscript-compiler';
  const values = Object.create(null);
  const listeners = new Map();
  const menuCallbacks = new Map();
  let valuesHydrated = false;
  let listenerSeq = 0;
  let menuSeq = 0;
  let requestSeq = 0;

  function gmMessage(type, payload) {
    if (!api?.runtime?.sendMessage) return Promise.reject(new Error('Extension messaging is unavailable.'));
    return api.runtime.sendMessage({ channel, type, payload }).then(response => {
      if (response && response.error) throw new Error(response.error);
      return response;
    });
  }

  function b64ToBytes(base64) {
    const binary = atob(base64 || '');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function bytesToB64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  async function serializeData(data) {
    if (data === undefined || data === null) return { kind: 'none' };
    if (typeof data === 'string') return { kind: 'text', value: data };
    if (data instanceof ArrayBuffer) return { kind: 'bytes', base64: bytesToB64(new Uint8Array(data)) };
    if (ArrayBuffer.isView(data)) return { kind: 'bytes', base64: bytesToB64(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)) };
    if (typeof Blob !== 'undefined' && data instanceof Blob) {
      return { kind: 'blob', type: data.type, base64: bytesToB64(new Uint8Array(await data.arrayBuffer())) };
    }
    if (typeof FormData !== 'undefined' && data instanceof FormData) {
      const entries = [];
      for (const [name, value] of data.entries()) {
        if (typeof Blob !== 'undefined' && value instanceof Blob) {
          entries.push({
            name,
            kind: 'blob',
            filename: value.name || 'blob',
            type: value.type,
            base64: bytesToB64(new Uint8Array(await value.arrayBuffer()))
          });
        } else {
          entries.push({ name, kind: 'text', value: String(value) });
        }
      }
      return { kind: 'formData', entries };
    }
    return { kind: 'text', value: String(data) };
  }

  function decodeResponsePayload(value) {
    if (!value || typeof value !== 'object') return value;
    if (value.kind === 'blob') return new Blob([b64ToBytes(value.base64)], { type: value.type || '' });
    if (value.kind === 'arraybuffer') return b64ToBytes(value.base64).buffer;
    return value;
  }

  function notifyValueListeners(name, oldValue, newValue, remote) {
    for (const listener of listeners.values()) {
      if (listener.name !== name) continue;
      try { listener.callback(name, oldValue, newValue, Boolean(remote)); } catch (error) { console.error(error); }
    }
  }

  function GM_getValue(name, defaultValue) {
    if (Object.prototype.hasOwnProperty.call(values, name)) return values[name];
    if (valuesHydrated) return defaultValue;
    return gmMessage('GM_getValue', { name, defaultValue }).then(response => {
      values[name] = response?.value;
      return response?.value;
    }, () => defaultValue);
  }

  function GM_setValue(name, value) {
    const oldValue = values[name];
    values[name] = value;
    notifyValueListeners(name, oldValue, value, false);
    return gmMessage('GM_setValue', { name, value });
  }

  function GM_deleteValue(name) {
    const oldValue = values[name];
    delete values[name];
    notifyValueListeners(name, oldValue, undefined, false);
    return gmMessage('GM_deleteValue', { name });
  }

  function GM_listValues() {
    if (valuesHydrated) return Object.keys(values);
    return gmMessage('GM_listValues', {}).then(response => response?.keys || Object.keys(values));
  }

  function GM_addValueChangeListener(name, callback) {
    const id = ++listenerSeq;
    listeners.set(id, { name, callback });
    return id;
  }

  function GM_removeValueChangeListener(id) {
    listeners.delete(id);
  }

  function GM_addStyle(css) {
    const style = document.createElement('style');
    style.textContent = String(css || '');
    (document.head || document.documentElement).appendChild(style);
    return style;
  }

  function GM_addElement(parentOrTag, tagOrAttrs, attrs) {
    let parent = document.documentElement;
    let tag = parentOrTag;
    let attributes = tagOrAttrs;
    if (parentOrTag && typeof parentOrTag !== 'string') {
      parent = parentOrTag;
      tag = tagOrAttrs;
      attributes = attrs;
    }
    const element = document.createElement(String(tag || 'div'));
    for (const [key, value] of Object.entries(attributes || {})) {
      if (key === 'textContent') element.textContent = value;
      else if (key === 'innerHTML') element.innerHTML = value;
      else element.setAttribute(key, String(value));
    }
    parent.appendChild(element);
    return element;
  }

  function GM_setClipboard(text) {
    return navigator.clipboard?.writeText
      ? navigator.clipboard.writeText(String(text ?? ''))
      : Promise.reject(new Error('Clipboard API is unavailable without a user gesture.'));
  }

  function normalizeXhrResponse(raw) {
    const result = raw?.result || raw;
    if (result && Object.prototype.hasOwnProperty.call(result, 'response')) {
      result.response = decodeResponsePayload(result.response);
    }
    return result;
  }

  function GM_xmlhttpRequest(details) {
    if (!details || !details.url) throw new Error('GM_xmlhttpRequest requires a url.');
    const id = 'xhr_' + (++requestSeq) + '_' + Date.now();
    let aborted = false;
    const promise = serializeData(details.data).then(body => gmMessage('GM_xmlhttpRequest', {
      id,
      url: details.url,
      method: details.method || 'GET',
      headers: details.headers || undefined,
      body,
      responseType: details.responseType || 'text',
      timeout: details.timeout || 0,
      anonymous: Boolean(details.anonymous),
      credentials: details.credentials,
      redirect: details.redirect
    })).then(response => {
      if (aborted) return undefined;
      if (!response?.success) throw new Error(response?.error || 'Request failed.');
      const xhr = normalizeXhrResponse(response);
      try { details.onload?.(xhr); } catch (error) { console.error(error); }
      try { details.onloadend?.(xhr); } catch (error) { console.error(error); }
      return xhr;
    }, error => {
      if (String(error?.message || error).toLowerCase().includes('abort')) {
        try { details.onabort?.(error); } catch {}
      } else if (String(error?.message || error).toLowerCase().includes('timeout')) {
        try { details.ontimeout?.(error); } catch {}
      } else {
        try { details.onerror?.(error); } catch {}
      }
      try { details.onloadend?.(error); } catch {}
      throw error;
    });
    try { details.onloadstart?.(); } catch {}
    return {
      abort() {
        aborted = true;
        gmMessage('GM_abortRequest', { id }).catch(() => {});
      },
      then: promise.then.bind(promise),
      catch: promise.catch.bind(promise),
      finally: promise.finally.bind(promise)
    };
  }

  function GM_download(details, filename) {
    const promise = gmMessage('GM_download', { details, filename });
    promise.then(result => {
      if (details && typeof details === 'object') details.onload?.(result);
    }, error => {
      if (details && typeof details === 'object') details.onerror?.(error);
    });
    return promise;
  }

  function GM_openInTab(url, options) {
    const openInBackground = typeof options === 'object' ? Boolean(options.active === false || options.insert === false) : Boolean(options);
    const promise = gmMessage('GM_openInTab', { url, openInBackground });
    return { close() {}, closed: false, then: promise.then.bind(promise) };
  }

  function GM_notification(textOrDetails, title) {
    const details = typeof textOrDetails === 'object' ? textOrDetails : { text: String(textOrDetails || ''), title: title || '' };
    return gmMessage('GM_notification', { details });
  }

  function GM_registerMenuCommand(title, callback) {
    const id = 'menu_' + (++menuSeq);
    menuCallbacks.set(id, callback);
    gmMessage('GM_registerMenuCommand', { id, title: String(title || 'Userscript command') }).catch(() => {});
    return id;
  }

  function GM_unregisterMenuCommand(id) {
    menuCallbacks.delete(id);
  }

  function GM_getResourceURL(name) {
    const resource = GM_info.script.resources.find(item => item.name === name);
    return resource?.url || '';
  }

  function GM_getResourceText(name) {
    const url = GM_getResourceURL(name);
    if (!url) return Promise.resolve('');
    return GM.xmlHttpRequest({ url, responseType: 'text' }).then(response => response.responseText || response.response || '');
  }

  const GM_info = ${JSON.stringify(gmInfo, null, 2)};
  const GM = {
    info: GM_info,
    getValue: GM_getValue,
    setValue: GM_setValue,
    deleteValue: GM_deleteValue,
    listValues: GM_listValues,
    addValueChangeListener: GM_addValueChangeListener,
    removeValueChangeListener: GM_removeValueChangeListener,
    addStyle: GM_addStyle,
    addElement: GM_addElement,
    setClipboard: GM_setClipboard,
    xmlHttpRequest: details => Promise.resolve(GM_xmlhttpRequest(details)),
    xmlhttpRequest: details => Promise.resolve(GM_xmlhttpRequest(details)),
    download: GM_download,
    openInTab: GM_openInTab,
    notification: GM_notification,
    registerMenuCommand: GM_registerMenuCommand,
    unregisterMenuCommand: GM_unregisterMenuCommand,
    getResourceText: GM_getResourceText,
    getResourceUrl: GM_getResourceURL,
    getResourceURL: GM_getResourceURL
  };

  Object.assign(globalThis, {
    GM,
    GM_info,
    GM_getValue,
    GM_setValue,
    GM_deleteValue,
    GM_listValues,
    GM_addValueChangeListener,
    GM_removeValueChangeListener,
    GM_addStyle,
    GM_addElement,
    GM_setClipboard,
    GM_xmlhttpRequest,
    GM_download,
    GM_openInTab,
    GM_notification,
    GM_registerMenuCommand,
    GM_unregisterMenuCommand,
    GM_getResourceText,
    GM_getResourceURL
  });

  try {
    if (!('unsafeWindow' in globalThis)) Object.defineProperty(globalThis, 'unsafeWindow', { value: window, configurable: true });
  } catch {
    globalThis.unsafeWindow = window;
  }

  api?.runtime?.onMessage?.addListener((message) => {
    if (message?.channel !== channel || message.type !== 'GM_menuCommand') return;
    const callback = menuCallbacks.get(message.payload?.id);
    if (callback) {
      try { callback(); } catch (error) { console.error(error); }
    }
  });

  api?.runtime?.onMessage?.addListener((message) => {
    if (message?.channel !== channel || message.type !== 'GM_valueChanged') return;
    const { name, oldValue, newValue } = message.payload || {};
    if (!name) return;
    if (newValue === undefined) delete values[name];
    else values[name] = newValue;
    notifyValueListeners(name, oldValue, newValue, true);
  });

  globalThis.__USC_READY = gmMessage('GM_getAllValues', {}).then(response => {
    Object.assign(values, response?.values || {});
    valuesHydrated = true;
  }, () => {
    valuesHydrated = true;
  });
})();`;
}

function generateOptionsHtml(meta, analysis, plan) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(meta.name || 'Userscript')} Settings</title>
  <link rel="stylesheet" href="options.css">
</head>
<body>
  <main class="shell">
    <header>
      <p class="eyebrow">${escapeHtml(plan.target)} package</p>
      <h1>${escapeHtml(meta.name || 'Userscript')}</h1>
      <p>${escapeHtml(meta.description || 'Converted userscript extension.')}</p>
    </header>

    <section>
      <h2>Status</h2>
      <dl>
        <div><dt>Runtime</dt><dd>${escapeHtml(plan.runtimeMode)}</dd></div>
        <div><dt>Run at</dt><dd>${escapeHtml(meta.runAt)}</dd></div>
        <div><dt>Frames</dt><dd>${meta.noFrames ? 'Top frame only' : 'All frames'}</dd></div>
      </dl>
      <button type="button" data-action="open-review">Open reviewer notes</button>
    </section>

    <section>
      <h2>Permissions</h2>
      <ul>
        ${plan.manifest.permissions?.map(permission => `<li><code>${escapeHtml(permission)}</code></li>`).join('') || '<li>No API permissions requested.</li>'}
      </ul>
      <details>
        <summary>Host access</summary>
        <ul>${(plan.manifest.host_permissions || []).map(host => `<li><code>${escapeHtml(host)}</code></li>`).join('')}</ul>
      </details>
    </section>

    <section>
      <h2>Maintenance</h2>
      <div class="actions">
        <button type="button" data-action="export-storage">Export storage</button>
        <button type="button" data-action="clear-storage">Clear storage</button>
      </div>
      <p class="status" data-status></p>
    </section>

    ${plan.runtimeMode === 'user-scripts' ? `<section class="warning">
      <h2>User scripts permission</h2>
      <p>Chrome requires the extension details-page toggle for user scripts. Firefox accepts this API as an optional permission and Mozilla policy allows it only for user-script managers.</p>
    </section>` : ''}
  </main>
  <script src="options.js"></script>
</body>
</html>`;
}

function generateOptionsJs(runtimeMode, target) {
  return `const api = globalThis.browser || globalThis.chrome;
const status = document.querySelector('[data-status]');

function setStatus(message) {
  if (status) status.textContent = message;
}

async function send(type, payload = {}) {
  return api.runtime.sendMessage({ channel: 'userscript-compiler', type, payload });
}

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  try {
    if (action === 'export-storage') {
      const data = await send('GM_getAllValues');
      const blob = new Blob([JSON.stringify(data?.values || {}, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'userscript-storage.json';
      link.click();
      URL.revokeObjectURL(url);
      setStatus('Storage exported.');
    }
    if (action === 'clear-storage') {
      const data = await send('GM_listValues');
      for (const key of data?.keys || []) await send('GM_deleteValue', { name: key });
      setStatus('Storage cleared.');
    }
    if (action === 'open-review') {
      window.open('README.md', '_blank', 'noopener');
    }
  } catch (error) {
    setStatus(error?.message || String(error));
  }
});

setStatus(${JSON.stringify(runtimeMode === 'user-scripts' && target === 'chrome'
    ? 'Enable Allow User Scripts on the extension details page if the script does not start.'
    : 'Ready.')});`;
}

function generateOptionsCss() {
  return `:root {
  color-scheme: light dark;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #f6f7f9;
  color: #19202a;
}

body {
  margin: 0;
}

.shell {
  max-width: 820px;
  margin: 0 auto;
  padding: 32px 20px 48px;
}

header, section {
  border-bottom: 1px solid #d8dee8;
  padding: 22px 0;
}

.eyebrow {
  margin: 0 0 8px;
  color: #546179;
  text-transform: uppercase;
  font-size: 12px;
  letter-spacing: .08em;
}

h1, h2 {
  margin: 0 0 12px;
}

p {
  line-height: 1.55;
}

dl div {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 12px;
  padding: 8px 0;
}

dt {
  font-weight: 700;
}

button {
  min-height: 36px;
  border: 1px solid #1e5bd7;
  background: #1e5bd7;
  color: white;
  border-radius: 6px;
  padding: 0 14px;
  font: inherit;
  cursor: pointer;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.warning {
  border-left: 4px solid #b45309;
  padding-left: 16px;
}

code {
  background: #e9edf5;
  border-radius: 4px;
  padding: 2px 4px;
}

@media (prefers-color-scheme: dark) {
  :root {
    background: #10141b;
    color: #edf2fb;
  }
  header, section {
    border-color: #293243;
  }
  .eyebrow {
    color: #9aa8bd;
  }
  code {
    background: #222b3a;
  }
}`;
}

function generateStandaloneFiles(analysis, scriptBody) {
  const meta = analysis.meta;
  return [
    {
      path: 'index.html',
      content: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(meta.name || 'Userscript')} standalone</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; background: #f7f8fb; color: #18202d; }
    main { max-width: 900px; margin: 0 auto; padding: 32px 20px; }
    .surface { border-top: 1px solid #d9e0eb; margin-top: 24px; padding-top: 24px; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(meta.name || 'Userscript')}</h1>
    <p>This standalone harness runs the same userscript bundle with a local GM compatibility layer. Cross-origin requests still depend on normal website CORS unless you use the browser extension package.</p>
    <div class="surface" data-userscript-standalone-root></div>
  </main>
  <script src="userscript-api.js"></script>
  <script src="script.user.js"></script>
</body>
</html>`,
    },
    {
      path: 'userscript-api.js',
      content: generateStandaloneApi(meta),
    },
    {
      path: 'script.user.js',
      content: scriptBody + '\n',
    },
  ];
}

function generateStandaloneApi(meta) {
  const gmInfo = {
    script: { name: meta.name, description: meta.description, version: meta.version },
    scriptHandler: 'UserScript Compiler standalone harness',
    version: '2.0',
  };
  return `(() => {
  const prefix = 'usc:${safeIdentifier(meta.name || 'script')}:';
  const listeners = new Map();
  let listenerSeq = 0;
  function read(name, fallback) {
    const raw = localStorage.getItem(prefix + name);
    if (raw === null) return fallback;
    try { return JSON.parse(raw); } catch { return raw; }
  }
  function write(name, value) {
    const oldValue = read(name);
    localStorage.setItem(prefix + name, JSON.stringify(value));
    for (const listener of listeners.values()) {
      if (listener.name === name) listener.callback(name, oldValue, value, false);
    }
  }
  function GM_xmlhttpRequest(details) {
    const controller = new AbortController();
    const promise = fetch(details.url, {
      method: details.method || 'GET',
      headers: details.headers,
      body: details.data,
      signal: controller.signal,
      credentials: details.anonymous ? 'omit' : 'include'
    }).then(async response => {
      const responseText = details.responseType === 'blob' || details.responseType === 'arraybuffer' ? '' : await response.clone().text();
      const body = details.responseType === 'blob' ? await response.blob()
        : details.responseType === 'arraybuffer' ? await response.arrayBuffer()
        : details.responseType === 'json' ? JSON.parse(responseText || 'null')
        : responseText;
      const xhr = { response: body, responseText, status: response.status, statusText: response.statusText, finalUrl: response.url };
      details.onload?.(xhr);
      return xhr;
    }).catch(error => {
      details.onerror?.(error);
      throw error;
    });
    return { abort: () => controller.abort(), then: promise.then.bind(promise), catch: promise.catch.bind(promise), finally: promise.finally.bind(promise) };
  }
  function GM_addStyle(css) {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    return style;
  }
  const GM_info = ${JSON.stringify(gmInfo)};
  const GM = {
    info: GM_info,
    getValue: (name, fallback) => Promise.resolve(read(name, fallback)),
    setValue: (name, value) => Promise.resolve(write(name, value)),
    deleteValue: name => Promise.resolve(localStorage.removeItem(prefix + name)),
    listValues: () => Promise.resolve(Object.keys(localStorage).filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length))),
    addValueChangeListener: (name, callback) => { const id = ++listenerSeq; listeners.set(id, { name, callback }); return id; },
    removeValueChangeListener: id => listeners.delete(id),
    addStyle: GM_addStyle,
    xmlHttpRequest: details => Promise.resolve(GM_xmlhttpRequest(details)),
    xmlhttpRequest: details => Promise.resolve(GM_xmlhttpRequest(details)),
    registerMenuCommand: () => undefined,
    setClipboard: text => navigator.clipboard.writeText(String(text || ''))
  };
  Object.assign(globalThis, {
    GM,
    GM_info,
    GM_getValue: read,
    GM_setValue: write,
    GM_deleteValue: name => localStorage.removeItem(prefix + name),
    GM_listValues: () => Object.keys(localStorage).filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length)),
    GM_addValueChangeListener: GM.addValueChangeListener,
    GM_removeValueChangeListener: GM.removeValueChangeListener,
    GM_addStyle,
    GM_xmlhttpRequest,
    GM_registerMenuCommand: () => undefined,
    unsafeWindow: window
  });
})();`;
}

function generateReviewBundle(meta, grants, options, targetPlans, diagnostics) {
  return {
    chrome: generateChromeReview(meta, grants, options, targetPlans.find(plan => plan.target === 'chrome'), diagnostics),
    mozilla: generateMozillaReview(meta, grants, targetPlans.find(plan => plan.target === 'firefox'), diagnostics),
    safari: generateSafariReview(meta, grants, targetPlans.find(plan => plan.target === 'safari'), diagnostics),
    firefoxAndroid: generateFirefoxAndroidNotes(meta, grants, targetPlans.find(plan => plan.target === 'firefox')),
    troubleshooting: generateTroubleshooting(meta, diagnostics),
  };
}

function generateChromeReview(meta, grants, options, plan, diagnostics) {
  const permissions = plan?.manifest.permissions || [];
  const hosts = plan?.manifest.host_permissions || [];
  const purpose = reviewPurpose(meta);
  return `# Chrome Web Store Review Template

Use this as truthful draft text. Remove anything that does not match your final package.

## Single Purpose

${meta.name || 'This extension'} packages one userscript for the websites declared in the manifest. Declared purpose: ${purpose}. Its browser features support that single purpose: page injection, saved settings, supported userscript menu commands when declared, and ${options.includeNewTab ? 'a packaged new-tab page' : 'an options page'}.

## Remote Code

Select: **No, I am not using remote code.**

Explanation: The submitted extension package contains the userscript runtime and all executable JavaScript used by the extension. It does not load or execute remote JavaScript files at runtime. Network requests are data/API requests made by the userscript features, not remotely hosted extension code.

${meta.requires.length ? `Warning: the source userscript declares @require entries:\n\n${meta.requires.map(url => `- ${url}`).join('\n')}\n\nVendor these files into the source package before submitting. Do not load them remotely in MV3.\n` : ''}
## Permission Justifications

${permissions.length ? permissions.map(permission => `### ${permission}\n\n${permissionJustification(permission, meta, grants)}`).join('\n\n') : 'No API permissions are requested.'}

## Host Permission Justification

${hosts.length ? hosts.map(host => `- \`${host}\`: ${hostJustification(host, meta)}`).join('\n') : 'No host permissions are requested.'}

## Data Usage Disclosure

The extension stores user settings locally in browser extension storage. It does not sell or transfer user data. It sends page text, selected text, media URLs, or API requests only when required by the packaged userscript feature and only to the service hosts listed in the userscript metadata or user-configured endpoints.

## Reviewer Test Instructions

1. Load the submitted package.
2. Open the options page and confirm the runtime/permission summary is visible.
3. Visit a matching test page from the host permission list.
4. Use the extension's declared workflow and any declared userscript menu commands.
5. Confirm settings persist after reloading the page.

## Diagnostics To Resolve Before Upload

${diagnostics.map(formatDiagnostic).join('\n') || '- None.'}

Sources to keep handy: Chrome privacy fields and permission justifications: https://developer.chrome.com/docs/webstore/cws-dashboard-privacy ; Chrome userScripts behavior: https://developer.chrome.com/docs/extensions/reference/api/userScripts ; single-purpose policy FAQ: https://developer.chrome.com/docs/webstore/program-policies/quality-guidelines-faq
`;
}

function generateMozillaReview(meta, grants, plan, diagnostics) {
  const permissions = plan?.manifest.permissions || [];
  const dataPermissions = plan?.manifest.browser_specific_settings?.gecko?.data_collection_permissions?.required || ['none'];
  return `# Mozilla Add-ons Review Template

## Listing Fields

Name: ${meta.name || 'Converted Userscript'}

Summary: ${trimManifestText(meta.description || 'Packaged userscript extension.', 250)}

Description:
${meta.description || 'This extension packages a userscript as a browser extension with a reviewable source bundle, local settings storage, and explicit host permissions.'}

## Source Code Submission

If the package is generated, bundled, minified, or otherwise machine-built, upload the source package and include the README with exact build commands. Keep the lockfile in the source submission.

Suggested build notes:

\`\`\`text
npm ci
npm run build
npm run test
npm run compile -- path/to/script.user.js --out generated
\`\`\`

## Permissions

${permissions.length ? permissions.map(permission => `- \`${permission}\`: ${permissionJustification(permission, meta, grants)}`).join('\n') : '- No API permissions are requested.'}

## Built-In Data Collection Consent

Manifest value: \`${dataPermissions.join(', ')}\`

Suggested explanation: ${dataPermissions.includes('none')
    ? 'The extension does not collect or transmit user data to the developer. Settings are stored locally.'
    : 'The extension processes website content for its declared reading/lookup features and may send selected text or page-derived content to the user-enabled service hosts listed in the manifest. Data is used for app functionality.'}

## userScripts API Warning

Mozilla policy says the \`userScripts\` API is allowed for user-script managers only. This compiler defaults to content-script packaging for Firefox to avoid that policy conflict. If you force userScripts mode, be prepared to show that the extension is genuinely a user-script manager where users explicitly install, view, and remove scripts.

## Functional Testing Information

1. Install the generated Firefox package temporarily or through AMO validation.
2. Grant the requested host permissions if Firefox prompts for site access.
3. Open a matching page and verify the packaged userscript behavior.
4. Open the options page and verify settings export/clear.

## Diagnostics

${diagnostics.map(formatDiagnostic).join('\n') || '- None.'}

Sources: Mozilla Add-on Policies: https://extensionworkshop.com/documentation/publish/add-on-policies/ ; source code submission: https://extensionworkshop.com/documentation/publish/source-code-submission/ ; AMO submission fields: https://extensionworkshop.com/documentation/publish/submitting-an-add-on/ ; MDN userScripts: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/userScripts
`;
}

function generateSafariReview(meta, grants, plan, diagnostics) {
  const purpose = reviewPurpose(meta);
  return `# Safari App Store / Safari Web Extension Notes

Safari Web Extensions are distributed inside an iOS, macOS, visionOS, or Catalyst app. Package the generated Safari extension folder with Apple's Safari Web Extension converter or App Store Connect packager, then submit the containing app.

## App Review Notes

${meta.name || 'This extension'} modifies matching webpages for this declared purpose: ${purpose}.

The extension requests the least practical website access for the userscript metadata. Users can manage website access in Safari settings and may grant access per site, for the day, or for all websites depending on platform/version.

## Safari-Specific Checks

- Avoid native \`userScripts\` mode; use the generated Safari content-script package.
- Keep all new-tab content packaged in the extension. Do not redirect the new tab to a remote page.
- Test on macOS Safari and iOS/iPadOS Safari because permissions and extension entry points differ.
- Provide app and extension icons in Apple's required sizes before App Store submission.
- Re-test file URLs, local network endpoints, background scripts, and downloads; these are stricter on iOS.

## Diagnostics

${diagnostics.map(formatDiagnostic).join('\n') || '- None.'}

Sources: Safari web extensions: https://developer.apple.com/documentation/SafariServices/safari-web-extensions ; managing permissions: https://developer.apple.com/documentation/safariservices/managing-safari-web-extension-permissions ; creating a Safari web extension: https://developer.apple.com/documentation/safariservices/creating-a-safari-web-extension ; packaging: https://developer.apple.com/documentation/safariservices/packaging-a-web-extension-for-safari
`;
}

function generateFirefoxAndroidNotes(meta, grants, plan) {
  const focusAreas = firefoxAndroidFocusAreas(meta, grants);
  return `# Firefox for Android Notes

Firefox for Android supports WebExtensions, but mobile API coverage, permissions UI, background behavior, file handling, downloads, and local-network access can differ from desktop Firefox.

Recommended package: \`packages/extension/firefox\`.

QA checklist:

- Install the Firefox package on Android through the supported AMO/developer flow.
- Confirm the extension appears as Android-compatible in AMO.
- Grant site access for a real matching page.
- Verify the core userscript journey without hover-only controls.
- Re-test settings, storage persistence, context-menu alternatives, media playback, OCR/image upload, downloads, and local endpoints.
- Avoid relying on desktop-only pages such as \`about:debugging\` for user instructions.

For ${meta.name || 'this userscript'}, pay special attention to ${focusAreas.join(', ')}.

Source: MDN WebExtensions and userScripts reference: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/userScripts
`;
}

function reviewPurpose(meta) {
  return stripTerminalPunctuation(meta.description || 'the packaged userscript behavior');
}

function stripTerminalPunctuation(value) {
  return String(value || '').trim().replace(/[.!?]+$/u, '') || 'the packaged userscript behavior';
}

function firefoxAndroidFocusAreas(meta, grants) {
  const areas = [];
  if (hasBroadHostAccess(meta)) areas.push('all-site host access');
  if ((meta.connect || []).some(host => ['localhost', '127.0.0.1', '::1'].includes(host) || /\.local$/i.test(host))) {
    areas.push('local endpoints');
  }
  if ((meta.extensionMatches || []).some(pattern => pattern.startsWith('file://'))) areas.push('file URLs');
  if (grants.hasCrossOriginRequests) areas.push('blob or arraybuffer GM_xmlhttpRequest usage');
  if (!areas.length) areas.push('site-access prompts and the core mobile workflow');
  return areas;
}

function hasBroadHostAccess(meta) {
  return (meta.extensionMatches || []).some(pattern => pattern === '<all_urls>' || pattern === '*://*/*')
    || (meta.connect || []).includes('*');
}

function generateTroubleshooting(meta, diagnostics) {
  return `# Review and Runtime Troubleshooting

## Chrome Review

- **Excessive permissions / broad host access:** narrow \`@match\` and \`@connect\` where possible. Explain all-site access only when the extension's single purpose genuinely works across arbitrary sites.
- **Remote code:** MV3 packages must not load remote JavaScript. Vendor \`@require\` dependencies into the source and package.
- **Single purpose:** describe one narrow purpose. Do not describe unrelated features as separate products.
- **Missing privacy disclosures:** disclose local storage and every external service the userscript contacts.
- **userScripts toggle:** Chrome 138+ uses an "Allow User Scripts" toggle on the extension details page. Earlier Chrome versions use the Developer Mode toggle.

## Mozilla Review

- **Source code required:** upload source and reproducible build instructions when generated/bundled/minified code is submitted.
- **Obfuscated code:** remove obfuscation; minification is allowed only when source is supplied and reviewable.
- **Remote new tab:** keep new-tab files inside the extension package.
- **userScripts API:** Mozilla policy limits this API to user-script managers. Use content-script mode for single-script extensions.

## Safari

- Package through Xcode or App Store Connect Safari Web Extension Packager.
- Test website access prompts on macOS and iOS.
- Expect stricter behavior for downloads, local files, local-network endpoints, and background execution.

## Current Diagnostics

${diagnostics.map(formatDiagnostic).join('\n') || '- None.'}
`;
}

function generatePackageValidationMarkdown(packageValidation) {
  return `# Package Validation

The compiler validates generated extension folders before creating store-ready release artifacts. Missing referenced files are treated as blocking errors. Dynamic code and remote executable-code patterns are warnings that need reviewer notes or source changes.

## Summary

- Errors: ${packageValidation.summary.errors}
- Warnings: ${packageValidation.summary.warnings}
- Info: ${packageValidation.summary.info}

${packageValidation.targets.map(target => `## ${target.target}

Status: \`${target.status}\`

${target.issues.length ? target.issues.map(formatPackageIssue).join('\n') : '- No package validation issues.'}`).join('\n\n')}
`;
}

function generateReleaseArtifactsMarkdown(analysis, artifacts) {
  const lines = artifacts.map(artifact => {
    if (artifact.kind === 'directory') {
      return `- \`${artifact.path}/\`: Safari Web Extension source folder with \`manifest.json\` at the folder root. Package this through Apple's Safari Web Extension tooling.`;
    }
    if (artifact.kind === 'notes') return `- \`${artifact.path}\`: review and platform notes.`;
    return `- \`${artifact.path}\`: ${artifact.target} upload package with \`manifest.json\` at archive root.`;
  });
  return `# Release Artifacts

The project ZIP is an audit/source bundle. Store upload artifacts are separate and live under \`release/\` when generated by the CLI.

${lines.join('\n') || '- No release artifacts were generated for the selected targets.'}

## Upload Guidance

- Chrome Web Store: upload the Chrome ZIP from \`release/chrome/\`.
- Mozilla Add-ons: upload the Firefox XPI from \`release/firefox/\`; upload a separate source package when AMO asks for generated or bundled source.
- Firefox for Android: use the Firefox package, then read \`release/firefox-android/README.md\` and \`review/firefox-android.md\`.
- Safari: use the generated Safari folder as the web-extension source for Apple's converter or Xcode workflow; the containing app is what goes to App Store review.

Generated for: ${analysis.meta.name || 'Converted Userscript'} ${analysis.meta.version || ''}
`;
}

function generateFirefoxAndroidReleaseReadme(analysis, packageValidation) {
  const firefox = packageValidation.targets.find(target => target.target === 'firefox');
  return `# Firefox for Android Release Notes

Use the Firefox desktop package as the base AMO artifact:

\`../firefox/${packageSlug(analysis.meta)}-firefox.xpi\`

Firefox for Android shares the WebExtension package, but review and QA need mobile-specific coverage:

- Confirm the AMO listing marks the add-on as Android-compatible.
- Verify core flows without hover-only controls.
- Re-test host permission prompts, local endpoints, file URLs, downloads, media, and background behavior on Android.
- Resolve package validation errors before submitting.

Current Firefox package status: \`${firefox?.status || 'not-generated'}\`
`;
}

function generateSafariReleaseReadme(analysis, folder) {
  return `# Safari Release Notes

Safari output is a WebExtension source folder, not an App Store-ready archive:

\`${folder}/\`

Package that folder through Apple's Safari Web Extension converter, Xcode, or App Store Connect workflow, then submit the containing macOS/iOS app. Keep all executable code and new-tab assets local to the extension folder.

Generated package: ${analysis.meta.name || 'Converted Userscript'} ${analysis.meta.version || ''}
`;
}

function generateProjectReadme(analysis) {
  const { meta } = analysis;
  return `# ${meta.name || 'Converted Userscript'} Extension Project

This project was generated from one userscript into three runnable packages:

- \`packages/userscript/script.user.js\` keeps the userscript artifact.
- \`packages/extension/chrome\`, \`packages/extension/firefox\`, and \`packages/extension/safari\` contain browser-extension packages.
- \`packages/standalone\` contains a standalone browser page for baseline testing.
- Store-ready CLI release artifacts live under \`release/\` and keep \`manifest.json\` at the upload archive/folder root.

## Quick Start

\`\`\`bash
npm run verify
\`\`\`

Load the Chrome extension from \`packages/extension/chrome\`. Load the Firefox extension from \`packages/extension/firefox\`. Package the Safari extension folder through Apple's Safari Web Extension tooling.

## Review

Paste-ready store-review drafts and package-validation reports are in \`review/\`. Read them before submitting; they are generated from metadata and still need a human check for accuracy.
`;
}

function generateExtensionReadme(analysis, plan) {
  return `# ${analysis.meta.name || 'Userscript'} ${plan.target} Extension

Runtime: \`${plan.runtimeMode}\`

Load this directory as the unpacked extension for ${plan.target}. The generated \`manifest.json\` is target-specific; do not submit another target's manifest to this store.

For store submission guidance, see the generated files in \`../../review/\` from the project package.
`;
}

function generateUserscriptReadme(analysis) {
  return `# Userscript Artifact

Install \`script.user.js\` in Tampermonkey, Violentmonkey, or another userscript manager.

The compiler does not alter this artifact. Extension and standalone packages live beside it in the generated project.
`;
}

function generateGeneratedPackageJson(analysis) {
  return JSON.stringify({
    name: packageSlug(analysis.meta),
    private: true,
    type: 'module',
    scripts: {
      verify: 'node tools/verify.mjs',
      'lint:firefox': 'npx --yes web-ext lint --source-dir packages/extension/firefox',
    },
  }, null, 2) + '\n';
}

function generateVerifyScript() {
  return `import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const required = [
  'packages/userscript/script.user.js',
  'packages/standalone/index.html',
  'review/chrome-web-store.md',
  'review/mozilla-amo.md',
  'review/package-validation.md',
  'review/release-artifacts.md',
];

for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) {
    console.error('Missing generated file:', file);
    process.exitCode = 1;
  }
}

const extensionRoot = path.join(root, 'packages', 'extension');
const targets = fs.existsSync(extensionRoot)
  ? fs.readdirSync(extensionRoot).filter(name => fs.existsSync(path.join(extensionRoot, name, 'manifest.json')))
  : [];
if (!targets.length) {
  console.error('No generated extension target manifests found.');
  process.exitCode = 1;
}

for (const target of targets) {
  const manifestPath = path.join(root, 'packages/extension', target, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.manifest_version !== 3) {
    console.error(target, 'manifest is not MV3');
    process.exitCode = 1;
  }
  if (manifest.background?.scripts && manifest.background?.service_worker) {
    console.error(target, 'manifest mixes background scripts and service_worker');
    process.exitCode = 1;
  }
}

const validationPath = path.join(root, 'audit', 'package-validation.json');
if (!fs.existsSync(validationPath)) {
  console.error('Missing generated file:', 'audit/package-validation.json');
  process.exitCode = 1;
} else {
  const validation = JSON.parse(fs.readFileSync(validationPath, 'utf8'));
  for (const target of validation.targets || []) {
    for (const issue of target.issues || []) {
      const prefix = issue.severity === 'error' ? 'Package validation error:' : 'Package validation warning:';
      const message = [prefix, target.target, issue.code, issue.file, issue.reference].filter(Boolean).join(' ');
      if (issue.severity === 'error') {
        console.error(message);
        process.exitCode = 1;
      } else {
        console.warn(message);
      }
    }
  }
}

const auditPath = path.join(root, 'audit', 'compiler-audit.json');
if (fs.existsSync(auditPath) && fs.existsSync(path.join(root, 'release'))) {
  const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
  for (const artifact of audit.releaseArtifacts || []) {
    if (artifact.kind === 'directory') {
      const manifestPath = path.join(root, artifact.path, 'manifest.json');
      if (!fs.existsSync(manifestPath)) {
        console.error('Missing Safari release folder manifest:', path.relative(root, manifestPath));
        process.exitCode = 1;
      }
    } else if (artifact.kind !== 'notes') {
      const artifactPath = path.join(root, artifact.path);
      if (!fs.existsSync(artifactPath)) {
        console.error('Missing release artifact:', artifact.path);
        process.exitCode = 1;
      } else {
        const signature = fs.readFileSync(artifactPath).subarray(0, 2).toString('utf8');
        if (signature !== 'PK') {
          console.error('Release artifact is not a ZIP container:', artifact.path);
          process.exitCode = 1;
        }
      }
    }
  }
}

if (!process.exitCode) console.log('Generated project verified.');
`;
}

function generateNewTabHtml(meta) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(meta.name || 'Userscript')} New Tab</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: system-ui, sans-serif; background: #102033; color: white; }
    main { width: min(760px, calc(100vw - 32px)); }
    a { color: #9bd3ff; }
  </style>
</head>
<body>
  <main data-userscript-newtab-root>
    <h1>${escapeHtml(meta.name || 'Userscript')}</h1>
    <p>This packaged new-tab page is local to the extension. Replace it with your app's native new-tab bundle when your userscript has a richer standalone page.</p>
  </main>
</body>
</html>`;
}

function toAuditJson(analysis, packageValidation, releaseArtifacts) {
  return {
    script: {
      name: analysis.meta.name,
      version: analysis.meta.version,
      matches: analysis.meta.extensionMatches,
      includeGlobs: analysis.meta.includeGlobs,
      grants: analysis.meta.grants,
      connect: analysis.meta.connect,
      requires: analysis.meta.requires,
      resources: analysis.meta.resources,
    },
    targets: analysis.targetPlans.map(plan => ({
      target: plan.target,
      runtimeMode: plan.runtimeMode,
      permissions: plan.manifest.permissions || [],
      optionalPermissions: plan.manifest.optional_permissions || [],
      hostPermissions: plan.manifest.host_permissions || [],
    })),
    grants: analysis.grants,
    diagnostics: analysis.diagnostics,
    packageValidation,
    releaseArtifacts: releaseArtifacts.map(artifact => ({
      target: artifact.target,
      kind: artifact.kind,
      path: artifact.path,
      validation: artifact.validation,
      files: artifact.files?.map(file => typeof file === 'string' ? file : file.sourcePath || file.path),
    })),
  };
}

function deriveHostPermissions(meta, diagnostics) {
  const hosts = new Set();
  for (const pattern of meta.extensionMatches) {
    if (pattern === '*://*/*') hosts.add('<all_urls>');
    else hosts.add(pattern === '<all_urls>' ? '<all_urls>' : pattern);
  }
  for (const connect of meta.connect) {
    for (const host of connectToHostPermissions(connect, meta.extensionMatches)) hosts.add(host);
  }
  for (const resource of meta.resources) {
    const host = urlToHostPermission(resource.url);
    if (host) hosts.add(host);
  }
  for (const requireUrl of meta.requires) {
    const host = urlToHostPermission(requireUrl);
    if (host) hosts.add(host);
  }
  const values = [...hosts];
  if (values.includes('<all_urls>')) {
    return unique(['<all_urls>', ...values.filter(value => value.startsWith('file://'))]);
  }
  return values;
}

function connectToHostPermissions(value, selfMatches) {
  const domain = String(value || '').trim();
  if (!domain) return [];
  if (domain === 'self') return selfMatches;
  if (domain === '*' || domain === '*.*') return ['<all_urls>'];
  if (/^https?:\/\//i.test(domain)) return [domain.endsWith('/') ? `${domain}*` : `${domain.replace(/\/?$/, '')}/*`];
  if (domain === 'localhost') return ['http://localhost/*', 'http://127.0.0.1/*'];
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(domain)) return [`http://${domain}/*`, `https://${domain}/*`];
  if (domain.startsWith('*.')) return [`*://${domain}/*`];
  return [`*://${domain}/*`, `*://*.${domain}/*`];
}

function urlToHostPermission(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return `${parsed.protocol}//${parsed.host}/*`;
  } catch {}
  return '';
}

function normalizeRunAt(value) {
  const runAt = String(value || '').toLowerCase().replace(/_/g, '-');
  if (runAt === 'document-start') return 'document_start';
  if (runAt === 'document-end' || runAt === 'document-body') return 'document_end';
  return 'document_idle';
}

function normalizeGrant(value) {
  const grant = String(value || '').trim();
  if (!grant) return '';
  const lower = grant.toLowerCase();
  const mapping = {
    'gm.xmlhttprequest': 'GM.xmlHttpRequest',
    'gm_xmlhttprequest': 'GM_xmlhttpRequest',
    'gm.xmlhttpRequest': 'GM.xmlHttpRequest',
  };
  if (mapping[lower]) return mapping[lower];
  if (grant.startsWith('GM.')) return 'GM.' + grant.slice(3, 4).toLowerCase() + grant.slice(4);
  return grant;
}

function supportedGrantNames() {
  return new Set([
    'GM_getValue', 'GM_setValue', 'GM_deleteValue', 'GM_listValues',
    'GM.getValue', 'GM.setValue', 'GM.deleteValue', 'GM.listValues',
    'GM_addValueChangeListener', 'GM_removeValueChangeListener',
    'GM.addValueChangeListener', 'GM.removeValueChangeListener',
    'GM_addStyle', 'GM.addStyle',
    'GM_addElement', 'GM.addElement',
    'GM_xmlhttpRequest', 'GM.xmlHttpRequest', 'GM.xmlhttpRequest',
    'GM_download', 'GM.download',
    'GM_openInTab', 'GM.openInTab',
    'GM_notification', 'GM.notification',
    'GM_setClipboard', 'GM.setClipboard',
    'GM_registerMenuCommand', 'GM_unregisterMenuCommand',
    'GM.registerMenuCommand', 'GM.unregisterMenuCommand',
    'GM_getResourceText', 'GM_getResourceURL',
    'GM.getResourceText', 'GM.getResourceUrl', 'GM.getResourceURL',
    'unsafeWindow', 'unsafewindow',
  ]);
}

function normalizeMatchPattern(pattern) {
  const value = String(pattern || '').trim();
  if (!value) return { valid: false, reason: 'Empty pattern.' };
  if (value === '<all_urls>') return { valid: true, pattern: '<all_urls>' };
  if (value.startsWith('file://')) return { valid: true, pattern: value.endsWith('*') ? value : `${value.replace(/\/?$/, '/')}*` };
  if (/^(\*|http|https):\/\/[^/]+\/.*$/i.test(value)) return { valid: true, pattern: value };
  if (/^[^:/*]+(\.[^/*]+)+(\/.*)?$/.test(value)) return { valid: true, pattern: `*://${value}${value.includes('/') ? '' : '/*'}` };
  return { valid: false, reason: 'Not a WebExtension match pattern.' };
}

function isLikelyMatchPattern(value) {
  return value === '<all_urls>' || /^(\*|https?|file):\/\//i.test(value);
}

function includeGlobToHostPattern(glob) {
  const value = String(glob || '').trim();
  if (!value || value.includes('^')) return '';
  if (value === '*') return '<all_urls>';
  const scheme = value.match(/^(https?|http\*|\*)\:\/\//i)?.[1];
  let rest = value.replace(/^(https?|http\*|\*)\:\/\//i, '');
  rest = rest.replace(/^\*+/, '*');
  const host = rest.split('/')[0];
  if (!host || host === '*') return '<all_urls>';
  const normalizedScheme = !scheme || scheme === 'http*' ? '*' : scheme;
  return `${normalizedScheme}://${host}/*`;
}

function normalizeExtensionVersion(version) {
  const parts = String(version || '1.0.0')
    .split(/[^\d]+/)
    .filter(Boolean)
    .slice(0, 4);
  while (parts.length < 3) parts.push('0');
  return parts.length ? parts.join('.') : '1.0.0';
}

function chooseRuntimeMode(meta, options, target) {
  if (target === 'safari') return 'content-script';
  if (options.runtimeMode === 'user-scripts') return 'user-scripts';
  if (options.runtimeMode === 'auto' && (meta.unwrap || meta.sandbox || meta.hasUnsafeWindow)) return 'user-scripts';
  return 'content-script';
}

function normalizeOptions(options) {
  const normalized = { ...DEFAULT_OPTIONS, ...options };
  normalized.targets = unique((normalized.targets || TARGETS).filter(target => TARGETS.includes(target)));
  if (!normalized.targets.length) normalized.targets = ['chrome'];
  return normalized;
}

function applyMetadataOverrides(meta, overrides = {}) {
  if (!overrides) return meta;
  return {
    ...meta,
    ...Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined && value !== '')),
    matches: overrides.matches || meta.matches,
    includes: overrides.includes || meta.includes,
    excludes: overrides.excludes || meta.excludes,
    excludeMatches: overrides.excludeMatches || meta.excludeMatches,
    grants: overrides.grants || meta.grants,
    connect: overrides.connect || meta.connect,
    requires: overrides.requires || meta.requires,
    resources: overrides.resources || meta.resources,
  };
}

async function zipFiles(files, outputType) {
  const zip = new JSZip();
  for (const file of files) zip.file(file.path, file.content);
  return zip.generateAsync({ type: outputType || defaultZipType() });
}

function defaultZipType() {
  return typeof Blob === 'undefined' ? 'uint8array' : 'blob';
}

function fileContentAsText(file) {
  const content = file?.content ?? '';
  if (typeof content === 'string') return content;
  if (content instanceof ArrayBuffer) return new TextDecoder().decode(content);
  if (ArrayBuffer.isView(content)) {
    return new TextDecoder().decode(content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength));
  }
  return String(content);
}

function isLocalPackageReference(ref) {
  const value = String(ref || '').trim();
  if (!value || value.startsWith('#')) return false;
  if (value.startsWith('//')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return false;
  return true;
}

function resolvePackageReference(owner, ref) {
  const cleaned = String(ref || '').split(/[?#]/)[0].trim();
  const baseParts = cleaned.startsWith('/') ? [] : normalizePackagePath(owner).split('/').slice(0, -1).filter(Boolean);
  const refParts = cleaned.replace(/^\/+/, '').split('/');
  const output = [];
  let outside = false;
  for (const part of [...baseParts, ...refParts]) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!output.length) {
        outside = true;
        continue;
      }
      output.pop();
      continue;
    }
    output.push(part);
  }
  return { path: output.join('/'), outside };
}

function normalizePackagePath(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .filter(part => part && part !== '.')
    .join('/');
}

function parseSrcsetUrls(srcset) {
  return String(srcset || '')
    .split(',')
    .map(candidate => candidate.trim().split(/\s+/)[0])
    .filter(Boolean);
}

function packageIssue(severity, code, message, file, reference, resolvedPath) {
  return {
    severity,
    code,
    message,
    file: file || undefined,
    reference: reference || undefined,
    resolvedPath: resolvedPath || undefined,
  };
}

function summarizeValidation(issues) {
  return {
    errors: issues.filter(issue => issue.severity === 'error').length,
    warnings: issues.filter(issue => issue.severity === 'warning').length,
    info: issues.filter(issue => issue.severity === 'info').length,
  };
}

function validationStatus(issues) {
  if (issues.some(issue => issue.severity === 'error')) return 'error';
  if (issues.some(issue => issue.severity === 'warning')) return 'warning';
  return 'ok';
}

function formatPackageIssue(issue) {
  const file = issue.file ? ` (${issue.file})` : '';
  const ref = issue.reference ? ` -> ${issue.reference}` : '';
  return `- [${issue.severity}] ${issue.code}${file}${ref}: ${issue.message}`;
}

function addText(files, path, content) {
  files.push({ path, content });
}

function unique(values) {
  return [...new Set(values.filter(value => value !== undefined && value !== null && value !== ''))];
}

function trimManifestText(value, max) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length <= max ? text : text.slice(0, max - 1).trim() + '.';
}

function safeIdentifier(value) {
  return String(value || 'script').replace(/[^a-z0-9_]+/gi, '_').replace(/^_+|_+$/g, '') || 'script';
}

function safeFilename(value) {
  return String(value || 'userscript').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'userscript';
}

function packageSlug(meta) {
  const direct = safeFilename(meta.name || '');
  if (direct !== 'userscript') return direct;
  for (const source of [meta.homepage, meta.namespace, meta.source, meta.support]) {
    if (!source) continue;
    try {
      const parsed = new URL(source);
      const segment = parsed.pathname.split('/').filter(Boolean).pop();
      const slug = safeFilename(segment || parsed.hostname);
      if (slug !== 'userscript') return slug;
    } catch {
      const parts = String(source).split(/[/:#?]+/).filter(Boolean);
      const slug = safeFilename(parts.at(-1));
      if (slug !== 'userscript') return slug;
    }
  }
  return 'userscript';
}

function extensionIdFromNamespace(namespace, name) {
  const source = namespace || name || 'userscript';
  const clean = safeFilename(source).replace(/\./g, '-');
  return `${clean}@userscript-compiler.local`;
}

function indent(value, spaces) {
  const prefix = ' '.repeat(spaces);
  return String(value).split('\n').map(line => prefix + line).join('\n');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeJs(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function omitUndefined(_key, value) {
  if (value === undefined) return undefined;
  if (Array.isArray(value) && value.length === 0) return undefined;
  return value;
}

function errorDiagnostic(code, message) {
  return { severity: 'error', code, message };
}

function warnDiagnostic(code, message) {
  return { severity: 'warning', code, message };
}

function infoDiagnostic(code, message) {
  return { severity: 'info', code, message };
}

function formatDiagnostic(diagnostic) {
  return `- [${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}`;
}

function permissionJustification(permission, meta, grants) {
  const name = meta.name || 'the packaged userscript';
  const map = {
    storage: `${name} stores user preferences and userscript data locally in extension storage so settings persist between browser sessions.`,
    downloads: `${name} exposes the userscript's download feature for files the user explicitly requests.`,
    notifications: `${name} shows browser notifications only for userscript events that are visible to the user.`,
    clipboardWrite: `${name} writes to the clipboard only after a userscript/user action asks to copy text.`,
    contextMenus: `${name} maps userscript menu commands to browser context-menu commands so users can open settings and script actions from native browser UI.`,
    menus: `${name} maps userscript menu commands to Firefox menu commands so users can access script actions from native browser UI.`,
    userScripts: `${name} uses the browser userScripts API only when advanced mode is selected, to run the packaged userscript in a user-script execution world.`,
  };
  return map[permission] || `${name} requires this permission for the userscript features declared by its metadata.`;
}

function hostJustification(host, meta) {
  if (host === '<all_urls>' || host === '*://*/*') {
    return `${meta.name || 'The userscript'} declares all-site matching or @connect * so it can run on arbitrary reading pages. Narrow this before submission if your extension only supports known sites.`;
  }
  return `Required by the userscript metadata for page injection, cross-origin data requests, or bundled resource access.`;
}

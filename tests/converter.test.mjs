import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { analyzeUserscript, compileUserscriptProject, parseMetadata } from '../src/utils/converter.js';

const fixture = `// ==UserScript==
// @name         QA Script
// @namespace    https://example.com/qa
// @version      1.2.3-beta
// @description  QA helper
// @match        https://example.com/*
// @include      https://reader.example.org/book/*
// @exclude-match https://example.com/private/*
// @noframes
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.xmlHttpRequest
// @grant        GM_registerMenuCommand
// @connect      api.example.com
// ==/UserScript==

console.log('loaded');`;

test('parseMetadata handles valueless tags and modern GM grants', () => {
  const meta = parseMetadata(fixture);
  assert.equal(meta.name, 'QA Script');
  assert.equal(meta.noFrames, true);
  assert.deepEqual(meta.grants, ['GM.getValue', 'GM.setValue', 'GM.xmlHttpRequest', 'GM_registerMenuCommand']);
  assert.deepEqual(meta.excludeMatches, ['https://example.com/private/*']);
});

test('default compiler avoids native userScripts permission', () => {
  const analysis = analyzeUserscript(fixture, { targets: ['chrome', 'firefox'], runtimeMode: 'content-script' });
  const chrome = analysis.targetPlans.find(plan => plan.target === 'chrome');
  const firefox = analysis.targetPlans.find(plan => plan.target === 'firefox');
  assert.equal(chrome.runtimeMode, 'content-script');
  assert.equal(firefox.runtimeMode, 'content-script');
  assert.ok(!chrome.manifest.permissions.includes('userScripts'));
  assert.ok(!firefox.manifest.optional_permissions?.includes('userScripts'));
  assert.equal(chrome.manifest.content_scripts[0].all_frames, false);
  assert.deepEqual(firefox.manifest.browser_specific_settings.gecko.data_collection_permissions.required, ['websiteContent']);
});

test('compiler warns when source userscript looks minified for Greasy Fork', async () => {
  const minifiedBody = `var a=1;${'a++;'.repeat(700)}`;
  const minifiedScript = fixture.replace("console.log('loaded');", minifiedBody);
  const analysis = analyzeUserscript(minifiedScript);
  assert.ok(analysis.diagnostics.some(diagnostic => diagnostic.code === 'greasyfork.source-readability'));

  const result = await compileUserscriptProject(minifiedScript, { outputType: 'uint8array' });
  const readme = result.files.find(file => file.path === 'packages/userscript/README.md')?.content || '';
  assert.match(readme, /Rebuild with minification disabled before submitting to Greasy Fork/i);
});

test('native userScripts mode emits target-specific permission placement', () => {
  const analysis = analyzeUserscript(fixture, { targets: ['chrome', 'firefox'], runtimeMode: 'user-scripts' });
  const chrome = analysis.targetPlans.find(plan => plan.target === 'chrome');
  const firefox = analysis.targetPlans.find(plan => plan.target === 'firefox');
  assert.ok(chrome.manifest.permissions.includes('userScripts'));
  assert.ok(firefox.manifest.optional_permissions.includes('userScripts'));
  assert.equal(chrome.manifest.content_scripts, undefined);
});

test('auto runtime chooses native userScripts when page-world access is requested', () => {
  const pageWorld = fixture.replace('// @grant        GM.xmlHttpRequest', '// @grant        GM.xmlHttpRequest\n// @grant        unsafeWindow\n// @inject-into page');
  const analysis = analyzeUserscript(pageWorld, { targets: ['chrome', 'firefox', 'safari'], runtimeMode: 'auto' });
  const chrome = analysis.targetPlans.find(plan => plan.target === 'chrome');
  const firefox = analysis.targetPlans.find(plan => plan.target === 'firefox');
  const safari = analysis.targetPlans.find(plan => plan.target === 'safari');
  assert.equal(chrome.runtimeMode, 'user-scripts');
  assert.equal(firefox.runtimeMode, 'user-scripts');
  assert.equal(safari.runtimeMode, 'content-script');
});

test('invalid compiler options are reported instead of silently compiling chrome defaults', () => {
  const analysis = analyzeUserscript(fixture, { targets: ['edge'], runtimeMode: 'wat' });
  assert.ok(analysis.diagnostics.some(diagnostic => diagnostic.code === 'options.target'));
  assert.ok(analysis.diagnostics.some(diagnostic => diagnostic.code === 'options.runtime'));
  assert.deepEqual(analysis.targetPlans.map(plan => plan.target), ['chrome']);
});

test('menu permissions are only requested for scripts with menu commands', () => {
  const withoutMenu = fixture.replace('// @grant        GM_registerMenuCommand\n', '');
  const analysis = analyzeUserscript(withoutMenu, { targets: ['chrome', 'firefox'], runtimeMode: 'content-script' });
  const chrome = analysis.targetPlans.find(plan => plan.target === 'chrome');
  const firefox = analysis.targetPlans.find(plan => plan.target === 'firefox');
  assert.ok(!chrome.manifest.permissions.includes('contextMenus'));
  assert.ok(!firefox.manifest.permissions.includes('menus'));
});

test('compileUserscriptProject emits three package families and one submission guide', async () => {
  const result = await compileUserscriptProject(fixture, { outputType: 'uint8array' });
  const paths = new Set(result.files.map(file => file.path));
  assert.ok(paths.has('packages/userscript/script.user.js'));
  assert.ok(paths.has('packages/extension/chrome/manifest.json'));
  assert.ok(paths.has('packages/extension/firefox/manifest.json'));
  assert.ok(paths.has('packages/extension/safari/manifest.json'));
  assert.ok(paths.has('packages/extension/chrome/popup.html'));
  assert.ok(paths.has('packages/extension/chrome/popup.js'));
  assert.ok(paths.has('packages/extension/chrome/popup.css'));
  assert.ok(!paths.has('packages/extension/chrome/options.html'));
  assert.ok(!paths.has('packages/extension/chrome/options.js'));
  assert.ok(!paths.has('packages/extension/chrome/options.css'));
  assert.ok(paths.has('packages/standalone/index.html'));
  assert.ok(paths.has('review/submission-guide.md'));
  assert.ok(!paths.has('review/chrome-web-store.md'));
  assert.ok(!paths.has('review/package-validation.md'));
  assert.ok(paths.has('audit/package-validation.json'));
  const chrome = result.targetPlans.find(plan => plan.target === 'chrome');
  assert.equal(chrome.manifest.action.default_popup, 'popup.html');
  assert.equal(chrome.manifest.options_ui, undefined);
  const background = result.files.find(file => file.path === 'packages/extension/chrome/background.js')?.content || '';
  const popupHtml = result.files.find(file => file.path === 'packages/extension/chrome/popup.html')?.content || '';
  const popup = result.files.find(file => file.path === 'packages/extension/chrome/popup.js')?.content || '';
  assert.match(background, /USC_listMenuCommands/);
  assert.match(background, /USC_runMenuCommand/);
  assert.match(background, /title: command\.title/);
  assert.match(popup, /USC_listMenuCommands/);
  assert.match(popup, /data-menu-id/);
  assert.match(popupHtml, /Page actions/);
  assert.doesNotMatch(popupHtml, /Toggle puck|Factory Reset|Open video player/);
  assert.doesNotMatch(popup, /yomu:|toggle-puck|factory-reset|USC_popupCommand/);
  // Popup pages must stay CSP-clean: no inline <script> (only external popup.js).
  assert.doesNotMatch(popupHtml, /<script(?![^>]*\bsrc=)[^>]*>/);
  // The real popup offers primary user actions, not the developer stub.
  assert.match(popup, /open-study/);
  assert.match(popup, /open-settings/);
  assert.match(popup, /scripting/);
  assert.doesNotMatch(popup, /Open packaged new tab|Clear saved values/);
  assert.ok(result.zip.byteLength > 0);
});

test('generated runtime tolerates locked unsafeWindow descriptors', async () => {
  const result = await compileUserscriptProject(fixture, { targets: ['firefox'], outputType: 'uint8array' });
  const content = result.files.find(file => file.path === 'packages/extension/firefox/content.js')?.content || '';
  assert.match(content, /Object\.defineProperty\(globalThis, 'unsafeWindow'/);
  assert.match(content, /try \{ globalThis\.unsafeWindow = window; \} catch \{\}/);
});

test('release artifacts are store-ready without markdown notes clutter', async () => {
  const result = await compileUserscriptProject(fixture, { outputType: 'uint8array' });
  const chrome = result.releaseArtifacts.find(artifact => artifact.target === 'chrome' && artifact.kind === 'zip');
  const firefox = result.releaseArtifacts.find(artifact => artifact.target === 'firefox' && artifact.kind === 'xpi');
  const safari = result.releaseArtifacts.find(artifact => artifact.target === 'safari' && artifact.kind === 'directory');

  assert.ok(chrome);
  assert.ok(firefox);
  assert.ok(safari);
  assert.equal(result.releaseArtifacts.some(artifact => artifact.kind === 'notes'), false);

  const chromeZip = await JSZip.loadAsync(chrome.content);
  assert.ok(chromeZip.file('manifest.json'));
  assert.ok(chromeZip.file('background.js'));
  assert.ok(chromeZip.file('popup.html'));
  assert.equal(chromeZip.file('options.html'), null);
  assert.equal(chromeZip.file('packages/extension/chrome/manifest.json'), null);

  const projectZip = await JSZip.loadAsync(result.zip);
  assert.ok(projectZip.file('packages/extension/chrome/manifest.json'));
  assert.equal(projectZip.file(chrome.path), null);

  const safariPaths = new Set(safari.files.map(file => file.path));
  assert.ok(safariPaths.has('release/safari/qa-script-safari-web-extension/manifest.json'));
});

test('packaged raster icons are declared in extension manifests', async () => {
  const result = await compileUserscriptProject(fixture, {
    targets: ['chrome'],
    includeNewTab: true,
    newTabPath: 'newtab/index.html',
    newTabFiles: [
      { path: 'newtab/index.html', content: '<!doctype html><title>New tab</title>' },
      { path: 'newtab/icons/yomu-icon-16.png', content: 'icon16' },
      { path: 'newtab/icons/yomu_icon_32.png', content: 'icon32' },
      { path: 'newtab/icons/icon48.png', content: 'icon48' },
      { path: 'newtab/icons/yomu-icon-128.png', content: 'icon128' },
    ],
    outputType: 'uint8array',
  });
  const chrome = result.targetPlans.find(plan => plan.target === 'chrome');
  assert.deepEqual(chrome.manifest.icons, {
    16: 'newtab/icons/yomu-icon-16.png',
    32: 'newtab/icons/yomu_icon_32.png',
    48: 'newtab/icons/icon48.png',
    128: 'newtab/icons/yomu-icon-128.png',
  });
  assert.deepEqual(chrome.manifest.action.default_icon, chrome.manifest.icons);
  assert.equal(result.packageValidation.targets[0].status, 'ok');
});

test('review copy avoids misleading broad-access and punctuation text', async () => {
  const result = await compileUserscriptProject(fixture, { outputType: 'uint8array' });
  assert.match(result.review.chrome, /Declared purpose: QA helper\./);
  assert.doesNotMatch(result.review.chrome, /QA helper\. on/);
  assert.match(result.review.safari, /declared purpose: QA helper\./);
  assert.doesNotMatch(result.review.safari, /QA helper\.\./);
  assert.doesNotMatch(result.review.firefoxAndroid, /all-site host access/);
  assert.match(result.review.firefoxAndroid, /blob or arraybuffer GM_xmlhttpRequest usage/);
});

test('package validation catches missing referenced extension assets', async () => {
  const result = await compileUserscriptProject(fixture, {
    targets: ['chrome'],
    includeNewTab: true,
    newTabPath: 'newtab/index.html',
    newTabFiles: [
      { path: 'newtab/index.html', content: '<!doctype html><script src="./missing.js"></script>' },
    ],
    outputType: 'uint8array',
  });

  const chrome = result.packageValidation.targets.find(target => target.target === 'chrome');
  assert.equal(chrome.status, 'error');
  assert.ok(chrome.issues.some(issue => issue.code === 'package.asset.missing' && issue.reference === './missing.js'));
});

test('package validation warns on dynamic code in generated package output', async () => {
  const result = await compileUserscriptProject(`${fixture}\nFunction('return 1')();`, {
    targets: ['chrome'],
    outputType: 'uint8array',
  });

  const chrome = result.packageValidation.targets.find(target => target.target === 'chrome');
  assert.equal(chrome.status, 'warning');
  assert.ok(chrome.issues.some(issue => issue.code === 'remote-code.dynamic-eval'));
});

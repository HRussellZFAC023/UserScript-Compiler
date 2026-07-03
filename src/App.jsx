import React, { useMemo, useState } from 'react';
import { analyzeUserscript, compileUserscriptProject } from './utils/converter.js';

const SAMPLE = `// ==UserScript==
// @name         Example Reader Tool
// @namespace    https://example.com/userscripts
// @version      1.0.0
// @description  Example userscript converted by the compiler.
// @match        https://example.com/*
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.xmlHttpRequest
// @connect      api.example.com
// ==/UserScript==

(async () => {
  const count = await GM.getValue('count', 0);
  await GM.setValue('count', count + 1);
  console.log('Example userscript loaded', count + 1);
})();`;

const TABS = [
  ['compile', 'Build'],
  ['audit', 'Check'],
  ['review', 'Store Text'],
  ['cli', 'CLI'],
];

const OUTPUTS = [
  ['Userscript', 'A readable .user.js for Tampermonkey, Violentmonkey, Greasemonkey, and Safari userscript apps.'],
  ['Extensions', 'Store-ready Chrome ZIP, Firefox XPI, and Safari Web Extension source folders.'],
  ['Standalone', 'A simple web harness for checking the same script outside browser-extension packaging.'],
];

export default function App() {
  const [scriptText, setScriptText] = useState('');
  const [runtimeMode, setRuntimeMode] = useState('content-script');
  const [targets, setTargets] = useState(['chrome', 'firefox', 'safari']);
  const [includeNewTab, setIncludeNewTab] = useState(false);
  const [activeTab, setActiveTab] = useState('compile');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [isCompiling, setIsCompiling] = useState(false);

  const analysis = useMemo(() => {
    if (!scriptText.trim()) return null;
    try {
      return analyzeUserscript(scriptText, { runtimeMode, targets, includeNewTab });
    } catch {
      return null;
    }
  }, [scriptText, runtimeMode, targets, includeNewTab]);

  const handleFileUpload = event => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setScriptText(String(reader.result || ''));
    reader.onerror = () => setError('Failed to read file.');
    reader.readAsText(file);
  };

  const handleCompile = async () => {
    setError('');
    setResult(null);
    if (!scriptText.trim()) {
      setError('Paste or upload a userscript first.');
      return;
    }
    setIsCompiling(true);
    try {
      const compiled = await compileUserscriptProject(scriptText, {
        runtimeMode,
        targets,
        includeNewTab,
      });
      const href = URL.createObjectURL(compiled.zip);
      const releaseDownloads = compiled.releaseArtifacts
        .filter(artifact => artifact.kind !== 'directory' && artifact.content)
        .map(artifact => ({
          target: artifact.target,
          kind: artifact.kind,
          name: artifact.path.split('/').pop(),
          href: URL.createObjectURL(artifact.content instanceof Blob ? artifact.content : new Blob([artifact.content])),
      }));
      const safariRelease = compiled.releaseArtifacts.find(artifact => artifact.target === 'safari' && artifact.kind === 'directory');
      setResult({ ...compiled, href, releaseDownloads, safariReleasePath: safariRelease?.path || '' });
    } catch (compileError) {
      setError(compileError?.message || 'Compilation failed.');
    } finally {
      setIsCompiling(false);
    }
  };

  const toggleTarget = target => {
    setTargets(current => current.includes(target)
      ? current.filter(item => item !== target)
      : [...current, target]);
  };

  const diagnostics = analysis?.diagnostics || [];
  const warnings = diagnostics.filter(item => item.severity === 'warning').length;
  const errors = diagnostics.filter(item => item.severity === 'error').length;

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-5">
        <header className="border-b border-slate-200 pb-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">UserScript Compiler</p>
          <div className="mt-2 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-3xl font-semibold">Turn one userscript into a release project</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                Paste a `.user.js`, choose the browsers you want, and build the same feature set as a userscript, browser extension, and standalone page. The compiler keeps the output readable and writes the review notes you need for store submission.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <span className="rounded border border-slate-300 bg-white px-3 py-2 font-semibold">{errors} errors</span>
              <span className="rounded border border-slate-300 bg-white px-3 py-2 font-semibold">{warnings} warnings</span>
            </div>
          </div>
          <div className="mt-4 grid gap-2 text-sm md:grid-cols-3">
            <div className="rounded border border-slate-200 bg-white p-3"><strong>1. Add your script</strong><br /><span className="text-slate-600">Upload or paste the file you already publish.</span></div>
            <div className="rounded border border-slate-200 bg-white p-3"><strong>2. Pick outputs</strong><br /><span className="text-slate-600">Use the default runtime unless you truly need native `userScripts`.</span></div>
            <div className="rounded border border-slate-200 bg-white p-3"><strong>3. Submit with notes</strong><br /><span className="text-slate-600">Use the generated guide to explain permissions and reviewer checks.</span></div>
          </div>
        </header>

        <nav className="flex flex-wrap gap-2" aria-label="Compiler sections">
          {TABS.map(([tab, label]) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`rounded border px-3 py-2 text-sm font-semibold ${activeTab === tab ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-300 bg-white text-slate-800'}`}
            >
              {label}
            </button>
          ))}
        </nav>

        {activeTab === 'compile' && (
          <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="flex min-h-[540px] flex-col">
              <div className="mb-3 grid gap-2 text-sm md:grid-cols-3">
                {OUTPUTS.map(([title, text]) => (
                  <div key={title} className="rounded border border-slate-200 bg-white p-3">
                    <strong>{title}</strong>
                    <p className="mt-1 text-slate-600">{text}</p>
                  </div>
                ))}
              </div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <label className="inline-flex cursor-pointer items-center rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold">
                  Upload .user.js
                  <input className="sr-only" type="file" accept=".user.js,.js" onChange={handleFileUpload} />
                </label>
                <button type="button" className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold" onClick={() => setScriptText(SAMPLE)}>
                  Load sample
                </button>
              </div>
              <textarea
                className="min-h-[520px] flex-1 resize-y rounded border border-slate-300 bg-white p-3 font-mono text-sm leading-6 outline-none focus:border-blue-700"
                placeholder="Paste your userscript here..."
                value={scriptText}
                onChange={event => setScriptText(event.target.value)}
              />
            </div>

            <aside className="flex flex-col gap-4">
              <section className="rounded border border-slate-300 bg-white p-4">
                <h2 className="text-base font-semibold">Build Options</h2>
                <p className="mt-1 text-sm leading-5 text-slate-600">The defaults are chosen for store review: static content scripts, native menus only when the script declares menu commands, and one consolidated submission guide.</p>

                <h3 className="mt-4 text-xs font-semibold uppercase text-slate-500">Browsers</h3>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {['chrome', 'firefox', 'safari'].map(target => (
                    <label key={target} className="flex items-center gap-2 text-sm capitalize">
                      <input type="checkbox" checked={targets.includes(target)} onChange={() => toggleTarget(target)} />
                      {target}
                    </label>
                  ))}
                </div>

                <h3 className="mt-5 text-xs font-semibold uppercase text-slate-500">Native Extension Features</h3>
                <label className="mt-2 flex items-start gap-2 text-sm">
                  <input className="mt-1" type="checkbox" checked={includeNewTab} onChange={event => setIncludeNewTab(event.target.checked)} />
                  <span><strong>Package a new-tab page</strong><br /><span className="text-slate-600">Use `--newtab-dir` in the CLI for a real built app instead of a placeholder.</span></span>
                </label>

                <details className="mt-5 rounded border border-slate-200 p-3">
                  <summary className="cursor-pointer text-sm font-semibold">Advanced runtime</summary>
                  <p className="mt-2 text-sm leading-5 text-slate-600">Choose native `userScripts` only for script-manager-style products. It adds review friction and browser setup steps.</p>
                <div className="mt-2 grid gap-2">
                  {[
                    ['content-script', 'Recommended: avoids native userScripts review friction.'],
                    ['user-scripts', 'Advanced: uses the browser userScripts API.'],
                    ['auto', 'Let the compiler choose per target.'],
                  ].map(([value, label]) => (
                    <label key={value} className="flex gap-2 text-sm">
                      <input type="radio" name="runtime" checked={runtimeMode === value} onChange={() => setRuntimeMode(value)} />
                      <span><strong>{value}</strong><br />{label}</span>
                    </label>
                  ))}
                </div>
                </details>
              </section>

              <button
                type="button"
                className="rounded bg-blue-700 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
                disabled={isCompiling || !targets.length}
                onClick={handleCompile}
              >
                {isCompiling ? 'Compiling...' : 'Compile project ZIP'}
              </button>

              {error && <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
              {result && (
                <section className="rounded border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-950">
                  <h2 className="font-semibold">Project ready</h2>
                  <p className="mt-1">The project ZIP includes source packages, audit JSON, and one submission guide. Store uploads should use the release files below.</p>
                  <a className="mt-3 block rounded border border-emerald-700 bg-emerald-700 px-4 py-3 text-center font-semibold text-white" href={result.href} download={result.zipName}>
                    Download project ZIP
                  </a>
                  {result.releaseDownloads?.length ? (
                    <div className="mt-3 grid gap-2">
                      {result.releaseDownloads.map(download => (
                        <a key={`${download.target}-${download.kind}`} className="rounded border border-emerald-600 bg-white px-3 py-2 text-center font-semibold text-emerald-900" href={download.href} download={download.name}>
                          Download {download.target} {download.kind.toUpperCase()}
                        </a>
                      ))}
                    </div>
                  ) : null}
                  {result.safariReleasePath && (
                    <p className="mt-3 leading-5">Safari source folder: <code>{result.safariReleasePath}</code> inside the project ZIP.</p>
                  )}
                </section>
              )}
            </aside>
          </section>
        )}

        {activeTab === 'audit' && (
          <AuditView analysis={analysis || result} />
        )}

        {activeTab === 'review' && (
          <ReviewView analysis={analysis || result} />
        )}

        {activeTab === 'cli' && (
          <CliView runtimeMode={runtimeMode} targets={targets} includeNewTab={includeNewTab} />
        )}
      </div>
    </main>
  );
}

function AuditView({ analysis }) {
  if (!analysis) return <EmptyState text="Paste a userscript to see the compiler audit." />;
  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <div className="rounded border border-slate-300 bg-white p-4">
        <h2 className="text-lg font-semibold">Diagnostics</h2>
        <div className="mt-3 grid gap-2">
          {analysis.diagnostics.length ? analysis.diagnostics.map(item => (
            <div key={`${item.code}-${item.message}`} className="rounded border border-slate-200 bg-slate-50 p-3 text-sm">
              <strong className="uppercase">{item.severity}</strong> <code>{item.code}</code>
              <p className="mt-1 text-slate-700">{item.message}</p>
            </div>
          )) : <p className="text-sm text-slate-600">No diagnostics yet.</p>}
        </div>
      </div>
      <div className="rounded border border-slate-300 bg-white p-4">
        <h2 className="text-lg font-semibold">Target Plans</h2>
        <div className="mt-3 grid gap-3">
          {analysis.targetPlans.map(plan => (
            <div key={plan.target} className="rounded border border-slate-200 p-3 text-sm">
              <div className="flex items-center justify-between">
                <strong>{plan.target}</strong>
                <span>{plan.runtimeMode}</span>
              </div>
              <p className="mt-2 text-slate-600">Permissions: {(plan.manifest.permissions || []).join(', ') || 'none'}</p>
              <p className="mt-1 text-slate-600">Host permissions: {(plan.manifest.host_permissions || []).length}</p>
            </div>
          ))}
        </div>
      </div>
      <pre className="overflow-auto rounded border border-slate-300 bg-slate-950 p-4 text-xs leading-5 text-slate-100 lg:col-span-2">
        {JSON.stringify({
          script: analysis.meta,
          grants: analysis.grants,
          targets: analysis.targetPlans.map(plan => ({
            target: plan.target,
            runtimeMode: plan.runtimeMode,
            permissions: plan.manifest.permissions,
            host_permissions: plan.manifest.host_permissions,
          })),
        }, null, 2)}
      </pre>
    </section>
  );
}

function ReviewView({ analysis }) {
  if (!analysis) return <EmptyState text="Paste a userscript to generate the submission guide." />;
  const review = analysis.review;
  const generatedGuide = analysis.files?.find(file => file.path === 'review/submission-guide.md')?.content;
  const fallbackGuide = [
    '# Submission and Review Guide',
    review.chrome,
    review.mozilla,
    review.safari,
    review.firefoxAndroid,
    review.troubleshooting,
  ].join('\n\n');
  return (
    <section className="rounded border border-slate-300 bg-white p-4">
      <h2 className="text-lg font-semibold">Submission Guide</h2>
      <textarea className="mt-3 h-[640px] w-full rounded border border-slate-300 p-3 font-mono text-xs leading-5" readOnly value={generatedGuide || fallbackGuide} />
    </section>
  );
}

function CliView({ runtimeMode, targets, includeNewTab }) {
  const command = `npm run compile -- ./script.user.js --out ./compiled --target ${targets.join(',')} --runtime ${runtimeMode}${includeNewTab ? ' --newtab-dir ./dist/newtab' : ''}`;
  return (
    <section className="rounded border border-slate-300 bg-white p-5">
      <h2 className="text-lg font-semibold">CLI Automation</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-700">
        The web app and CLI use the same compiler core. Use the CLI in CI after your app build, then upload the target-specific release files instead of the full project bundle.
      </p>
      <pre className="mt-4 overflow-auto rounded bg-slate-950 p-4 text-sm text-slate-100">{command}</pre>
      <div className="mt-5 grid gap-3 text-sm md:grid-cols-3">
        <div className="rounded border border-slate-200 p-3"><strong>1. Build</strong><br />Run your userscript build first.</div>
        <div className="rounded border border-slate-200 p-3"><strong>2. Compile</strong><br />Generate the userscript, extension, standalone, audit, and review outputs.</div>
        <div className="rounded border border-slate-200 p-3"><strong>3. Verify</strong><br />Run `tools/verify.mjs`, then load the built extension in each browser you plan to submit.</div>
      </div>
    </section>
  );
}

function EmptyState({ text }) {
  return (
    <section className="rounded border border-slate-300 bg-white p-8 text-center text-slate-600">
      {text}
    </section>
  );
}

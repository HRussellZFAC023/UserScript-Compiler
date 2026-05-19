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
      setResult({ ...compiled, href });
      setActiveTab('audit');
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
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">UserScript Compiler 2.0</p>
          <div className="mt-2 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-3xl font-semibold">Compile one script into three packages</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                Generate a userscript artifact, browser-extension packages, a standalone test harness, and one review-ready submission guide from the same source.
              </p>
            </div>
            <div className="flex gap-2 text-sm">
              <span className="rounded border border-slate-300 bg-white px-3 py-2">{errors} errors</span>
              <span className="rounded border border-slate-300 bg-white px-3 py-2">{warnings} warnings</span>
            </div>
          </div>
        </header>

        <nav className="flex flex-wrap gap-2" aria-label="Compiler sections">
          {[
            ['compile', 'Compile'],
            ['audit', 'Audit'],
            ['review', 'Submission Guide'],
            ['cli', 'CLI'],
          ].map(([tab, label]) => (
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
                <h2 className="text-base font-semibold">Package Settings</h2>
                <h3 className="mt-4 text-xs font-semibold uppercase text-slate-500">Runtime</h3>
                <div className="mt-2 grid gap-2">
                  {[
                    ['content-script', 'Default: avoids native userScripts review friction.'],
                    ['user-scripts', 'Advanced: uses browser userScripts API.'],
                    ['auto', 'Let the compiler choose per target.'],
                  ].map(([value, label]) => (
                    <label key={value} className="flex gap-2 text-sm">
                      <input type="radio" name="runtime" checked={runtimeMode === value} onChange={() => setRuntimeMode(value)} />
                      <span><strong>{value}</strong><br />{label}</span>
                    </label>
                  ))}
                </div>

                <h3 className="mt-5 text-xs font-semibold uppercase text-slate-500">Targets</h3>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {['chrome', 'firefox', 'safari'].map(target => (
                    <label key={target} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={targets.includes(target)} onChange={() => toggleTarget(target)} />
                      {target}
                    </label>
                  ))}
                </div>

                <h3 className="mt-5 text-xs font-semibold uppercase text-slate-500">Native Features</h3>
                <label className="mt-2 flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={includeNewTab} onChange={event => setIncludeNewTab(event.target.checked)} />
                  Package a local new-tab override
                </label>
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
                <a className="rounded border border-emerald-700 bg-emerald-700 px-4 py-3 text-center text-sm font-semibold text-white" href={result.href} download={result.zipName}>
                  Download {result.zipName}
                </a>
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
  const command = `npm run compile -- ./dist/yomu.user.js --out ./compiled-yomu --target ${targets.join(',')} --runtime ${runtimeMode}${includeNewTab ? ' --newtab' : ''}`;
  return (
    <section className="rounded border border-slate-300 bg-white p-5">
      <h2 className="text-lg font-semibold">CLI Automation</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-700">
        The web app and CLI use the same compiler core. Use the CLI in CI to generate extension packages, a submission guide, and audit JSON from a built userscript.
      </p>
      <pre className="mt-4 overflow-auto rounded bg-slate-950 p-4 text-sm text-slate-100">{command}</pre>
      <div className="mt-5 grid gap-3 text-sm md:grid-cols-3">
        <div className="rounded border border-slate-200 p-3"><strong>1. Build</strong><br />Run your userscript build first.</div>
        <div className="rounded border border-slate-200 p-3"><strong>2. Compile</strong><br />Generate extension, standalone, and submission packages.</div>
        <div className="rounded border border-slate-200 p-3"><strong>3. Verify</strong><br />Run the generated project verifier and browser QA.</div>
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

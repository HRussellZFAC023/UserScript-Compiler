import React, { useState, useEffect } from 'react';
import { parseMetadata, createZipFiles } from './utils/converter.js';

export default function App() {
  const [scriptText, setScriptText] = useState('');
  const [error, setError] = useState('');
  const [zipBlob, setZipBlob] = useState(null);
  const [zipName, setZipName] = useState('userscript-extension.zip');
  const [author, setAuthor] = useState('');
  const [homepage, setHomepage] = useState('');
  const [support, setSupport] = useState('');
  const [descriptionOverride, setDescriptionOverride] = useState('');
  const [iconData, setIconData] = useState(null);

  useEffect(() => {
    if (!scriptText) {
      setAuthor('');
      setHomepage('');
      setSupport('');
      setDescriptionOverride('');
      return;
    }
    try {
      const meta = parseMetadata(scriptText);
      setDescriptionOverride(meta.description || '');
      setAuthor(meta.author || '');
      setHomepage(meta.homepage || '');
      setSupport(meta.support || '');
    } catch {
      /* ignore parse errors */
    }
  }, [scriptText]);


  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setScriptText(reader.result);
    reader.onerror = () => setError('Failed to read file.');
    reader.readAsText(file);
  };

  const handleIconUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const arrayBuffer = reader.result;
      const ext = file.name.split('.').pop().toLowerCase();
      setIconData({ data: new Uint8Array(arrayBuffer), ext });
    };
    reader.onerror = () => setError('Failed to read icon file.');
    reader.readAsArrayBuffer(file);
  };

  const handleConvert = async () => {
    setError('');
    setZipBlob(null);
    try {
      const meta = parseMetadata(scriptText);
      if ((meta.matches.length === 0 && meta.includes.length === 0) || !meta.name) {
        throw new Error('Script metadata must include at least one @match or @include pattern, and a @name.');
      }
      setZipName(`${meta.name}-extension.zip`);
      if (descriptionOverride) meta.description = descriptionOverride;
      if (author) meta.author = author;
      if (homepage) meta.homepage = homepage;
      if (support) meta.support = support;
      const zipFile = await createZipFiles(meta, scriptText, iconData);
      setZipBlob(zipFile);
    } catch (e) {
      console.error('Conversion error:', e);
      setError(e.message || 'An unknown error occurred during conversion.');
    }
  };

  return (
    <div className="p-4 max-w-xl mx-auto">
      <h1 className="text-2xl font-bold mb-4 text-center">
        ✨ Userscript → Browser Extension Converter
      </h1>
      <p className="mb-4 text-gray-800">
        Convert a Tampermonkey/Greasemonkey userscript into a Firefox or Chrome add-on (Manifest V3).
        Paste the script text below or upload the <code className="bg-gray-200 px-1 py-0.5 rounded">.user.js</code> file, then click "Convert".
      </p>

      <textarea
        className="w-full border border-gray-300 rounded p-2 mb-2 h-40"
        placeholder="Paste your userscript code here..."
        value={scriptText}
        onChange={(e) => setScriptText(e.target.value)}
      />

      <label className="block mb-2">
        <span className="sr-only">Upload userscript file</span>
        <input
          type="file"
          accept=".user.js,.js"
          onChange={handleFileUpload}
          className="file:mr-2 file:py-1 file:px-3 file:border-0 file:text-sm file:bg-gray-200 file:cursor-pointer"
        />
        <span className="ml-2 text-sm text-gray-600">Choose a <code>.user.js</code> file</span>
      </label>
      <label className="block mb-2">
        <span className="sr-only">Extension description</span>
        <input
          type="text"
          value={descriptionOverride}
          onChange={(e) => setDescriptionOverride(e.target.value)}
          className="w-full border border-gray-300 rounded p-2 mb-2"
          placeholder="Extension Description (optional)"
        />
      </label>
      <label className="block mb-2">
        <span className="sr-only">Author name/email</span>
        <input
          type="text"
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          className="w-full border border-gray-300 rounded p-2 mb-2"
          placeholder="Author name/email"
        />
      </label>
      <label className="block mb-2">
        <span className="sr-only">Homepage URL</span>
        <input
          type="url"
          value={homepage}
          onChange={(e) => setHomepage(e.target.value)}
          className="w-full border border-gray-300 rounded p-2 mb-2"
          placeholder="Homepage URL (optional)"
        />
      </label>
      <label className="block mb-2">
        <span className="sr-only">Support URL</span>
        <input
          type="url"
          value={support}
          onChange={(e) => setSupport(e.target.value)}
          className="w-full border border-gray-300 rounded p-2 mb-2"
          placeholder="Support URL (optional)"
        />
      </label>
      <label className="block mb-2">
        <span className="sr-only">Upload extension icon</span>
        <input
          type="file"
          accept=".png,.ico,image/png,image/x-icon"
          onChange={handleIconUpload}
          className="file:mr-2 file:py-1 file:px-3 file:border-0 file:text-sm file:bg-gray-200 file:cursor-pointer"
        />
        <span className="ml-2 text-sm text-gray-600">Choose extension icon (PNG or ICO)</span>
      </label>

      <button
        onClick={handleConvert}
        className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2 rounded"
      >
        Convert
      </button>

      {error && <div className="text-red-600 mt-3">Error: {error}</div>}

      {zipBlob && (
        <div className="mt-6 bg-green-50 border border-green-200 p-3 rounded">
          <a
            href={URL.createObjectURL(zipBlob)}
            download={zipName}
            className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded inline-block"
          >
            Download Extension ZIP
          </a>
          <ul className="list-disc pl-6 mt-4 text-gray-700 text-sm">
            <li>
              <b>Chrome:</b> <code>chrome://extensions</code> → enable <b>Developer mode</b> → <b>Load unpacked</b> → pick the unzipped folder. Open the extension’s <b>Details</b> and switch on <b>Allow User Scripts</b> (or enable the <code>#enable-extension-content-script-user-script</code> flag on older versions). The popup will open.
            </li>
            <li><b>Tip:</b> If the userscript still doesn't activate, try restarting your browser to refresh permissions.</li>
            <li>
              <b>Firefox:</b> <code>about:debugging</code> → <b>This Firefox</b> → <b>Load Temporary Add-on</b> → select <code>manifest.json</code>. Click <b>Grant permission</b> when asked.
            </li>
          </ul>
          <div className="mt-4 bg-yellow-50 border-l-4 border-yellow-300 p-3 rounded flex items-start">
            <span className="mr-2 text-yellow-600 text-lg" aria-hidden="true">⚠️</span>
            <div>
              <b>Note:</b> After loading the extension, <b>click the extension’s toolbar icon once</b> to grant <code>userScripts</code> permission and register the userscript.
              <div className="text-gray-700 mt-1">This step is required for the userscript to activate.</div>
            </div>
          </div>
        </div>
      )}

      <p className="mt-8 text-center text-sm text-gray-600">
        Feedback, suggestions, or issues? Visit the{' '}
        <a
          href="https://github.com/HRussellZFAC023/UserScript-Compiler"
          className="text-blue-600 hover:underline"
        >
          GitHub repository
        </a>
        .
      </p>
    </div>
  );
}

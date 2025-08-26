import React, { useState } from 'react';
import { parseMetadata, createZipFiles } from './utils/converter.js';

export default function App() {
  const [scriptText, setScriptText] = useState('');
  const [error, setError] = useState('');
  const [zipBlob, setZipBlob] = useState(null);
  const [zipName, setZipName] = useState('userscript-extension.zip');

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setScriptText(reader.result);
    reader.onerror = () => setError('Failed to read file.');
    reader.readAsText(file);
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
      const zipFile = await createZipFiles(meta, scriptText);
      setZipBlob(zipFile);
    } catch (e) {
      console.error('Conversion error:', e);
      setError(e.message || 'An unknown error occurred during conversion.');
    }
  };

  return (
    <div className="p-4 max-w-xl mx-auto">
      <h1 className="text-2xl font-bold mb-4 text-center">
        Userscript → Firefox Extension Converter
      </h1>
      <p className="mb-4 text-gray-800">
        Convert a Tampermonkey/Greasemonkey userscript into a Firefox add-on (Manifest V3, including GM_ methods and eval)
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
          <p className="text-sm text-gray-700 mt-2">
            After downloading, load the ZIP as a temporary add-on in Firefox.
            Click the extension’s toolbar icon once to grant <code>userScripts</code> permission and register the userscript.
          </p>
        </div>
      )}
    </div>
  );
}

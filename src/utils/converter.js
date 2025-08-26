import JSZip from 'jszip';

export function parseMetadata(scriptText) {
  const meta = {
    name: '',
    description: '',
    version: '1.0.0',
    matches: [],
    includes: [],
    excludes: [],
    grants: [],
    connect: [],
    runAt: '',
    noFrames: false,
  };
  const lines = scriptText.split(/\r?\n/);
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
    const spaceIdx = content.indexOf(' ');
    if (spaceIdx < 0) continue;
    const key = content.substring(1, spaceIdx).trim().toLowerCase();
    const value = content.substring(spaceIdx + 1).trim();
    switch (key) {
      case 'name':
        meta.name = value;
        break;
      case 'description':
        meta.description = value;
        break;
      case 'version':
        meta.version = value;
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
      case 'grant':
        if (value !== 'none') meta.grants.push(value);
        break;
      case 'connect':
        meta.connect.push(value);
        break;
      case 'run-at':
        meta.runAt = value;
        break;
      case 'noframes':
        meta.noFrames = true;
        break;
      default:
        break;
    }
  }
  const ra = (meta.runAt || '').toLowerCase();
  if (ra === 'document-start') meta.runAt = 'document_start';
  else if (ra === 'document-end' || ra === 'document-body') meta.runAt = 'document_end';
  else meta.runAt = 'document_idle';
  return meta;
}

function buildManifest(meta) {
  const permissions = [];
  let hostPerms = [];

  meta.matches.forEach((p) => {
    if (p.startsWith('http://') || p.startsWith('https://') || p.startsWith('*://')) {
      hostPerms.push(p);
    } else {
      hostPerms.push('*://' + p);
    }
  });

  meta.includes.forEach((glob) => {
    let pat = glob.replace(/^http\*: /, '*:');
    if (!pat.includes('://')) pat = '*://' + pat;
    if (!pat.endsWith('*')) {
      if (!pat.endsWith('/')) pat += '/';
      pat += '*';
    }
    hostPerms.push(pat);
  });

  meta.connect.forEach((domain) => {
    if (!domain) return;
    if (domain === '*' || domain === '*.*') {
      hostPerms.push('*://*/*');
    } else if (domain === 'self') {
      meta.matches.forEach((p) => hostPerms.push(p));
      meta.includes.forEach((p) => hostPerms.push(p));
    } else {
      hostPerms.push('*://' + domain + '/*');
      if (!domain.startsWith('*.')) {
        hostPerms.push('*://*.' + domain + '/*');
      }
    }
  });

  hostPerms = Array.from(new Set(hostPerms));

  meta.grants.forEach((grant) => {
    switch (grant) {
      case 'GM_setValue':
      case 'GM_getValue':
      case 'GM_deleteValue':
      case 'GM_listValues':
      case 'GM_getResourceText':
      case 'GM_getResourceURL':
        if (!permissions.includes('storage')) permissions.push('storage');
        break;
      case 'GM_download':
        if (!permissions.includes('downloads')) permissions.push('downloads');
        break;
      case 'GM_notification':
        if (!permissions.includes('notifications')) permissions.push('notifications');
        break;
      case 'GM_setClipboard':
        if (!permissions.includes('clipboardWrite')) permissions.push('clipboardWrite');
        break;
      default:
        break;
    }
  });

  return {
    manifest_version: 3,
    name: meta.name || 'Converted Userscript',
    description: meta.description || '',
    version: meta.version || '1.0.0',
    action: { default_title: 'Enable Userscript' },
    background: { scripts: ['background.js'] },
    host_permissions: hostPerms,
    permissions,
    optional_permissions: ['userScripts'],
    browser_specific_settings: {
      gecko: { id: 'converted-userscript@example.com' }
    }
  };
}

function generateBackgroundScriptCode(meta) {
  const sanitizedName = meta.name ? meta.name.replace(/\W+/g, '_') : 'script';
  const prefix = `userscript_${sanitizedName}_`;
  const scriptId = `us_${sanitizedName || 'script'}`;

  return `(() => {
  let registered = false;
  async function registerIfPossible() {
    if (!browser.userScripts) return;
    try {
      await browser.userScripts.configureWorld({
        messaging: true,
        csp: "script-src 'self' 'unsafe-eval'"
      });
    } catch (e) {
      console.warn('configureWorld failed:', e);
    }
    if (registered) return;
    await browser.userScripts.register([{
      id: ${JSON.stringify(scriptId)},
      matches: ${JSON.stringify(meta.matches)},
      excludeMatches: ${JSON.stringify(meta.excludes)},
      allFrames: ${!meta.noFrames},
      runAt: ${JSON.stringify(meta.runAt || 'document_idle')},
      js: [{ file: 'userscript_api.js' }, { file: 'script.user.js' }]
    }]);
    registered = true;
    if (browser.runtime?.onUserScriptMessage?.addListener) {
      browser.runtime.onUserScriptMessage.addListener(async (message) => {
        switch (message?.type) {
          case 'GM_setValue': {
            const { name, value } = message.payload;
            await browser.storage.local.set({ ['${prefix}' + name]: value });
            return {};
          }
          case 'GM_getValue': {
            const { name, defaultValue } = message.payload;
            const key = '${prefix}' + name;
            const data = await browser.storage.local.get(key);
            return Object.prototype.hasOwnProperty.call(data, key)
              ? { value: data[key] }
              : { value: defaultValue };
          }
          case 'GM_deleteValue': {
            const { name } = message.payload;
            await browser.storage.local.remove('${prefix}' + name);
            return {};
          }
          case 'GM_listValues': {
            const all = await browser.storage.local.get(null);
            const PFX = '${prefix}';
            return { keys: Object.keys(all).filter(k => k.startsWith(PFX)).map(k => k.slice(PFX.length)) };
          }
          case 'GM_xmlhttpRequest': {
            const d = message.payload;
            try {
              const resp = await fetch(d.url, {
                method: d.method || 'GET',
                headers: d.headers || undefined,
                body: d.data !== undefined ? d.data : undefined,
                credentials: d.anonymous ? 'omit' : 'include'
              });
              let body;
              const ct = resp.headers.get('content-type') || '';
              if (d.responseType === 'blob') body = await resp.blob();
              else if (d.responseType === 'arraybuffer') body = await resp.arrayBuffer();
              else if (d.responseType === 'json' || ct.includes('application/json')) body = await resp.json();
              else body = await resp.text();
              const headers = {};
              for (const [h, v] of resp.headers) headers[h] = v;
              return {
                id: d.id,
                success: true,
                result: { response: body, status: resp.status, statusText: resp.statusText, responseHeaders: headers }
              };
            } catch (err) {
              return { id: d.id, success: false, error: err.message };
            }
          }
          case 'GM_download': {
            const { url, name } = message.payload;
            try {
              await browser.downloads.download({ url, filename: name, saveAs: false });
              return { success: true };
            } catch (e) {
              return { success: false, error: e.message };
            }
          }
          case 'GM_openInTab': {
            const { url, open_in_background } = message.payload;
            await browser.tabs.create({ url, active: !open_in_background });
            return {};
          }
          case 'GM_notification': {
            const { text, title } = message.payload;
            try {
              await browser.notifications.create({
                type: 'basic',
                iconUrl: '/icon-48.png',
                title: title || 'Notice',
                message: text
              });
            } catch {}
            return {};
          }
          default:
            return {};
        }
      });
    }
  }
  (async () => {
    try {
      const has = await browser.permissions.contains({ permissions: ['userScripts'] });
      if (has) await registerIfPossible();
    } catch {}
  })();
  if (browser.action?.onClicked) {
    browser.action.onClicked.addListener(async () => {
      try {
        const granted = await browser.permissions.request({ permissions: ['userScripts'] });
        if (granted) await registerIfPossible();
      } catch (e) {
        console.error('Permission request error:', e);
      }
    });
  }
})();`;
}

function generateUserScriptAPICode(meta) {
  const gmInfo = {
    script: {
      name: meta.name || '',
      description: meta.description || '',
      version: meta.version || ''
    },
    scriptHandler: 'Converted by UserScript Converter',
    version: '1.0'
  };

  return `/* Greasemonkey API Polyfill for User Script context */
(function() {
  try {
    const uw = (typeof window !== 'undefined' && 'wrappedJSObject' in window)
                ? window.wrappedJSObject : window;
    if (!('unsafeWindow' in window)) {
      try { Object.defineProperty(window, 'unsafeWindow', { value: uw }); }
      catch { window.unsafeWindow = uw; }
    }
  } catch {}
})();
const GM_VALUES = {};
const __GM_XHR_CB = new Map();
let __GM_XHR_SEQ = 0;
function GM_getValue(key, def) { return GM_VALUES.hasOwnProperty(key) ? GM_VALUES[key] : def; }
function GM_setValue(key, val) { GM_VALUES[key] = val; gmCall('GM_setValue', { name: key, value: val }).catch(()=>{}); }
function GM_deleteValue(key) { delete GM_VALUES[key]; gmCall('GM_deleteValue', { name: key }).catch(()=>{}); }
function GM_listValues() { return Object.keys(GM_VALUES); }
async function gmSendMessage(message) {
  let lastErr;
  for (let i = 0; i < 8; i++) {
    try { return await browser.runtime.sendMessage(message); }
    catch(e) {
      lastErr = e;
      if ((e + '').includes('Receiving end does not exist')) {
        await new Promise(r => setTimeout(r, 150 * (i + 1)));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}
function gmCall(type, payload) { return gmSendMessage({ type, payload }); }
function __gm_sanitize(d) {
  const out = {};
  if (!d || typeof d !== 'object') return out;
  for (const k of ['url','method','headers','data','responseType','anonymous','timeout']) {
    if (k in d && typeof d[k] !== 'function') out[k] = d[k];
  }
  return out;
}
function GM_xmlhttpRequest(details) {
  if (!details || !details.url) throw new Error('GM_xmlhttpRequest: URL is required');
  const id = (++__GM_XHR_SEQ) + '_' + Date.now();
  const cb = {
    onloadstart: typeof details.onloadstart === 'function' ? details.onloadstart : null,
    onload:      typeof details.onload === 'function' ? details.onload : null,
    onerror:     typeof details.onerror === 'function' ? details.onerror : null,
    onloadend:   typeof details.onloadend === 'function' ? details.onloadend : null
  };
  __GM_XHR_CB.set(id, cb);
  if (cb.onloadstart) { try { cb.onloadstart(); } catch {} }
  const payload = __gm_sanitize(details);
  payload.id = id;
  gmCall('GM_xmlhttpRequest', payload).then(resp => {
    const cbs = __GM_XHR_CB.get(id);
    if (!cbs) return;
    if (resp && resp.success) {
      const r = resp.result;
      const xhr = {
        response: r.response,
        readyState: 4,
        status: r.status,
        statusText: r.statusText,
        responseHeaders: r.responseHeaders
      };
      if (cbs.onload) { try { cbs.onload(xhr); } catch {} }
    } else {
      if (cbs.onerror) { try { cbs.onerror(new Error(resp ? resp.error : 'Unknown error')); } catch {} }
    }
    if (cbs.onloadend) { try { cbs.onloadend(); } catch {} }
    __GM_XHR_CB.delete(id);
  }).catch(err => {
    const cbs = __GM_XHR_CB.get(id);
    if (cbs?.onerror) { try { cbs.onerror(err); } catch {} }
    if (cbs?.onloadend) { try { cbs.onloadend(); } catch {} }
    __GM_XHR_CB.delete(id);
  });
  return { abort() { /* not implemented in this polyfill */ } };
}
function GM_addStyle(css) {
  try {
    const s = document.createElement('style');
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
    return s;
  } catch (e) {
    return null;
  }
}
function GM_openInTab(url, openInBackground) {
  gmCall('GM_openInTab', { url, open_in_background: !!openInBackground }).catch(() => {});
  return { close(){} };
}
function GM_download(details, filename) {
  let url, name;
  if (typeof details === 'string') {
    url = details;
    name = filename || '';
  } else {
    url = details.url;
    name = details.name || details.filename || '';
  }
  gmCall('GM_download', { url, name }).then(res => {
    if (res && !res.success && details && typeof details.onerror === 'function') {
      try { details.onerror(new Error(res.error)); } catch {}
    } else if (details && typeof details.onload === 'function') {
      try { details.onload(); } catch {}
    }
  }).catch(() => {});
}
function GM_notification(textOrDetails, title) {
  let text = '', t = '';
  if (typeof textOrDetails === 'string') {
    text = textOrDetails;
    t = title || '';
  } else if (textOrDetails && typeof textOrDetails === 'object') {
    text = textOrDetails.text || '';
    t = textOrDetails.title || '';
  }
  gmCall('GM_notification', { text, title: t }).catch(() => {});
}
const GM_info = ${JSON.stringify(gmInfo)};
`;
}

export async function createZipFiles(meta, scriptText) {
  const zip = new JSZip();
  const manifest = buildManifest(meta);
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  const bgScript = generateBackgroundScriptCode(meta);
  zip.file('background.js', bgScript);
  const apiScript = generateUserScriptAPICode(meta);
  zip.file('userscript_api.js', apiScript);
  const userScriptCode = scriptText.replace(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/, '').trim();
  zip.file('script.user.js', userScriptCode);
  const emptyPng = new Uint8Array([
    137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,
    0,0,0,1,0,0,0,1,8,6,0,0,0,31,21,196,137,
    0,0,0,10,73,68,65,84,120,156,99,248,15,0,1,
    5,1,2,85,152,216,58,0,0,0,0,73,69,78,68,
    174,66,96,130
  ]);
  zip.file('icon-48.png', emptyPng);
  const content = await zip.generateAsync({ type: 'blob' });
  return content;
}

type OpenDroneFileWindowArgs = {
  droneId: string;
  path: string;
  name: string;
  line?: number | null;
  column?: number | null;
  onSaved?: (path: string) => void;
};

export const DRONE_FILE_WINDOW_SAVED_EVENT = 'drone-hub:file-window-saved';

function escapeHtml(raw: string): string {
  return String(raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function positiveIntOrNull(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  return i > 0 ? i : null;
}

function scriptJson(raw: unknown): string {
  const json = JSON.stringify(raw) ?? 'null';
  return json.replace(/[<>&\u2028\u2029]/g, (ch) => {
    switch (ch) {
      case '<':
        return '\\u003c';
      case '>':
        return '\\u003e';
      case '&':
        return '\\u0026';
      case '\u2028':
        return '\\u2028';
      case '\u2029':
        return '\\u2029';
      default:
        return ch;
    }
  });
}

export function openDroneFileWindow({
  droneId: droneIdRaw,
  path: pathRaw,
  name: nameRaw,
  line,
  column,
  onSaved,
}: OpenDroneFileWindowArgs): boolean {
  if (typeof window === 'undefined') return false;
  const droneId = String(droneIdRaw ?? '').trim();
  const filePath = String(pathRaw ?? '').trim();
  if (!droneId || !filePath) return false;
  const fileName = String(nameRaw ?? '').trim() || filePath.split('/').filter(Boolean).pop() || filePath;
  const targetLine = positiveIntOrNull(line);
  const targetColumn = positiveIntOrNull(column);
  let popup: Window | null = null;
  try {
    popup = window.open('about:blank', '_blank', 'width=1180,height=820');
  } catch {
    popup = null;
  }
  if (!popup) return false;
  try {
    popup.opener = null;
  } catch {
    // Some browsers disallow setting opener after window creation.
  }

  const saveChannelName = `drone-hub-file-window-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const saveStorageKey = `${saveChannelName}:saved`;
  let saveChannel: BroadcastChannel | null = null;
  let closePoll: number | null = null;
  const handleSaved = (savedPathRaw?: unknown) => {
    const savedPath = String(savedPathRaw ?? '').trim() || filePath;
    onSaved?.(savedPath);
  };
  const onStorageSaved = (event: StorageEvent) => {
    if (event.key !== saveStorageKey) return;
    try {
      const data = event.newValue ? JSON.parse(event.newValue) : null;
      handleSaved(data?.path);
    } catch {
      handleSaved();
    }
  };
  const cleanupSaveListener = () => {
    if (saveChannel) {
      saveChannel.close();
      saveChannel = null;
    }
    window.removeEventListener('storage', onStorageSaved);
    if (closePoll != null) {
      window.clearInterval(closePoll);
      closePoll = null;
    }
  };
  if (onSaved) {
    if (typeof BroadcastChannel !== 'undefined') {
      saveChannel = new BroadcastChannel(saveChannelName);
      saveChannel.onmessage = (event) => {
        if ((event.data as any)?.type === 'saved') handleSaved((event.data as any)?.path);
      };
    }
    window.addEventListener('storage', onStorageSaved);
    closePoll = window.setInterval(() => {
      if (!popup.closed) return;
      cleanupSaveListener();
    }, 5000);
  }

  const title = `${fileName} - DroneHub`;
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0d1117;
      --panel: #111827;
      --panel-alt: #0f1624;
      --border: rgba(148, 163, 184, 0.22);
      --fg: #e5edf7;
      --muted: #94a3b8;
      --muted-dim: #64748b;
      --accent: #60a5fa;
      --accent-bg: rgba(96, 165, 250, 0.14);
      --danger: #f87171;
      --danger-bg: rgba(248, 113, 113, 0.12);
    }
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; }
    body {
      background: var(--bg);
      color: var(--fg);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      overflow: hidden;
    }
    button {
      height: 30px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--panel);
      color: var(--fg);
      font: inherit;
      font-size: 12px;
      font-weight: 650;
      padding: 0 10px;
      cursor: pointer;
    }
    button:hover:not(:disabled) { background: rgba(255, 255, 255, 0.06); }
    button:disabled { cursor: not-allowed; opacity: 0.48; }
    #app { height: 100%; display: flex; flex-direction: column; min-height: 0; }
    .header {
      flex: 0 0 auto;
      min-width: 0;
      border-bottom: 1px solid var(--border);
      background: var(--panel-alt);
      padding: 10px 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .title { min-width: 0; }
    .name {
      font-size: 13px;
      font-weight: 700;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .path {
      margin-top: 3px;
      color: var(--muted-dim);
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .actions { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; }
    .status {
      color: var(--muted);
      font-size: 12px;
      white-space: nowrap;
    }
    .content {
      flex: 1 1 auto;
      min-height: 0;
      background: var(--bg);
      position: relative;
    }
    textarea {
      width: 100%;
      height: 100%;
      resize: none;
      border: 0;
      outline: none;
      background: var(--bg);
      color: var(--fg);
      padding: 14px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 13px;
      line-height: 1.5;
      tab-size: 2;
      white-space: pre;
    }
    .center {
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      color: var(--muted);
      text-align: center;
    }
    .message {
      max-width: 560px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel);
      padding: 18px;
      font-size: 13px;
      line-height: 1.5;
    }
    .error { color: var(--danger); background: var(--danger-bg); border-color: rgba(248, 113, 113, 0.28); }
    img, video {
      max-width: 100%;
      max-height: 100%;
      display: block;
    }
    .media {
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      overflow: auto;
    }
    .download-link {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: 30px;
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--fg);
      text-decoration: none;
      padding: 0 10px;
      font-size: 12px;
      font-weight: 650;
      background: var(--panel);
      margin-top: 12px;
    }
  </style>
</head>
<body>
  <div id="app">
    <div class="header">
      <div class="title">
        <div class="name">${escapeHtml(fileName)}</div>
        <div class="path">${escapeHtml(filePath)}</div>
      </div>
      <div class="actions">
        <span class="status" id="status">Loading...</span>
        <button type="button" id="refreshButton">Refresh</button>
        <button type="button" id="saveButton" disabled>Save</button>
      </div>
    </div>
    <div class="content" id="content">
      <div class="center"><div class="message">Loading file...</div></div>
    </div>
  </div>
  <script>
    const droneId = ${scriptJson(droneId)};
    let filePath = ${scriptJson(filePath)};
    let fileName = ${scriptJson(fileName)};
    const targetLine = ${scriptJson(targetLine)};
    const targetColumn = ${scriptJson(targetColumn)};
    const saveChannelName = ${scriptJson(onSaved ? saveChannelName : '')};
    const saveStorageKey = ${scriptJson(onSaved ? saveStorageKey : '')};
    const statusEl = document.getElementById('status');
    const contentEl = document.getElementById('content');
    const saveButton = document.getElementById('saveButton');
    const refreshButton = document.getElementById('refreshButton');
    let currentKind = 'text';
    let originalText = '';
    let textArea = null;
    let loading = false;
    let saving = false;

    function setStatus(text) {
      statusEl.textContent = text;
    }

    function htmlEscape(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function updateSaveButton() {
      const dirty = Boolean(textArea) && textArea.value !== originalText;
      saveButton.disabled = loading || saving || currentKind !== 'text' || !dirty;
      if (saving) setStatus('Saving...');
      else if (dirty) setStatus('Unsaved changes');
      else if (currentKind === 'error') setStatus('Error');
      else if (!loading) setStatus(currentKind === 'text' ? 'Saved' : 'Preview');
    }

    async function fetchJson(url, init) {
      const response = await fetch(url, init);
      const text = await response.text();
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          throw new Error(text.slice(0, 300) || 'Request failed');
        }
      }
      if (!response.ok || !data || data.ok !== true) {
        throw new Error((data && data.error) || response.statusText || 'Request failed');
      }
      return data;
    }

    function notifySaved() {
      if (!saveChannelName) return;
      let notified = false;
      try {
        if (typeof BroadcastChannel !== 'undefined') {
          const channel = new BroadcastChannel(saveChannelName);
          channel.postMessage({ type: 'saved', path: filePath, at: Date.now() });
          channel.close();
          notified = true;
        }
      } catch {
        // Fall back to localStorage below.
      }
      if (notified) return;
      try {
        localStorage.setItem(saveStorageKey, JSON.stringify({ path: filePath, at: Date.now() }));
      } catch {
        // Save notification is best-effort.
      }
    }

    function renderMessage(message, error) {
      contentEl.innerHTML = '<div class="center"><div class="message ' + (error ? 'error' : '') + '">' + htmlEscape(message) + '</div></div>';
    }

    function focusLine() {
      if (!textArea || !targetLine) return;
      const lines = textArea.value.split('\\n');
      const lineIndex = Math.min(Math.max(targetLine, 1), lines.length) - 1;
      let offset = 0;
      for (let i = 0; i < lineIndex; i += 1) offset += lines[i].length + 1;
      offset += Math.max(0, (targetColumn || 1) - 1);
      textArea.focus();
      textArea.setSelectionRange(offset, offset);
      const lineHeight = Number.parseFloat(getComputedStyle(textArea).lineHeight) || 19;
      textArea.scrollTop = Math.max(0, lineIndex * lineHeight - textArea.clientHeight / 3);
    }

    function renderText(data) {
      currentKind = 'text';
      originalText = typeof data.content === 'string' ? data.content : '';
      contentEl.innerHTML = '';
      textArea = document.createElement('textarea');
      textArea.value = originalText;
      textArea.spellcheck = false;
      textArea.addEventListener('input', updateSaveButton);
      contentEl.appendChild(textArea);
      updateSaveButton();
      setTimeout(focusLine, 0);
    }

    function renderMedia(data) {
      currentKind = data.kind === 'video' ? 'video' : 'image';
      originalText = '';
      textArea = null;
      const mediaUrl = '/api/drones/' + encodeURIComponent(droneId) + '/fs/media?path=' + encodeURIComponent(filePath);
      contentEl.innerHTML = '<div class="media"></div>';
      const holder = contentEl.firstElementChild;
      if (currentKind === 'video') {
        const video = document.createElement('video');
        video.controls = true;
        video.src = mediaUrl;
        holder.appendChild(video);
      } else {
        const image = document.createElement('img');
        image.src = mediaUrl;
        image.alt = fileName;
        holder.appendChild(image);
      }
      updateSaveButton();
    }

    function renderBinary(data) {
      currentKind = 'binary';
      originalText = '';
      textArea = null;
      const downloadUrl = '/api/drones/' + encodeURIComponent(droneId) + '/fs/download?path=' + encodeURIComponent(filePath);
      const size = Number.isFinite(Number(data.size)) ? Number(data.size).toLocaleString() + ' bytes' : 'unknown size';
      contentEl.innerHTML =
        '<div class="center"><div class="message">This file is binary and cannot be edited here.<br />' +
        htmlEscape(size) +
        '<br /><a class="download-link" href="' + htmlEscape(downloadUrl) + '">Download</a></div></div>';
      updateSaveButton();
    }

    async function loadFile() {
      if (loading || saving) return;
      loading = true;
      textArea = null;
      saveButton.disabled = true;
      setStatus('Loading...');
      renderMessage('Loading file...', false);
      try {
        const data = await fetchJson('/api/drones/' + encodeURIComponent(droneId) + '/fs/file?path=' + encodeURIComponent(filePath));
        if (typeof data.path === 'string' && data.path.trim()) filePath = data.path;
        document.querySelector('.path').textContent = filePath;
        if (data.kind === 'image' || data.kind === 'video') renderMedia(data);
        else if (data.kind === 'text' || typeof data.content === 'string') renderText(data);
        else renderBinary(data);
      } catch (err) {
        currentKind = 'error';
        originalText = '';
        textArea = null;
        setStatus('Error');
        renderMessage(err && err.message ? err.message : String(err), true);
      } finally {
        loading = false;
        updateSaveButton();
      }
    }

    async function saveFile() {
      if (!textArea || loading || saving || textArea.value === originalText) return;
      saving = true;
      updateSaveButton();
      try {
        await fetchJson('/api/drones/' + encodeURIComponent(droneId) + '/fs/file', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path: filePath, content: textArea.value }),
        });
        originalText = textArea.value;
        notifySaved();
      } catch (err) {
        alert(err && err.message ? err.message : String(err));
      } finally {
        saving = false;
        updateSaveButton();
      }
    }

    saveButton.addEventListener('click', saveFile);
    refreshButton.addEventListener('click', loadFile);
    window.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveFile();
      }
    });
    window.addEventListener('beforeunload', (event) => {
      if (textArea && textArea.value !== originalText) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
    loadFile();
  </script>
</body>
</html>`;

  try {
    popup.document.open();
    popup.document.write(html);
    popup.document.close();
    popup.focus();
  } catch {
    cleanupSaveListener();
    try {
      popup.close();
    } catch {
      // Ignore close failures after a blocked popup write.
    }
    return false;
  }
  return true;
}

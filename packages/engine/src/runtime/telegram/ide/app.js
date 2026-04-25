/**
 * Pyrfor IDE — app.js
 * Vanilla JS, ES module. No build step.
 */

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  cwd: '',
  tree: { '': null },        // path -> entries cache (null = not yet loaded)
  expanded: new Set(),       // expanded folder paths
  openTabs: [],              // [{path, content, dirty, model, language}]
  activeTab: null,           // path
  chatMessages: [],          // [{role:'user'|'assistant', text, ts}]
  chatBusy: false,
  auth: localStorage.getItem('pyrfor-token') || '',
  // pending retry after 401
  _pendingRetry: null,
  // command runner history
  cmdHistory: JSON.parse(localStorage.getItem('pyrfor-cmd-history') || '[]'),
  cmdHistoryIdx: -1,
};

// ─── DOM refs ────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

const els = {
  topbar:           $('topbar'),
  workspaceLabel:   $('workspace-label'),
  modelIndicator:   $('model-indicator'),
  btnSave:          $('btn-save'),
  btnRefresh:       $('btn-refresh'),
  btnLogout:        $('btn-logout'),
  btnHelp:          $('btn-help'),
  btnHamburger:     $('btn-hamburger'),
  panelTree:        $('panel-tree'),
  panelChat:        $('panel-chat'),
  treeSearchToggle: $('btn-tree-search-toggle'),
  treeSearchBar:    $('tree-search-bar'),
  treeSearchInput:  $('tree-search-input'),
  fileTree:         $('file-tree'),
  tabsList:         $('tabs-list'),
  monacoContainer:  $('monaco-container'),
  editorPlaceholder:$('editor-placeholder'),
  chatMessages:     $('chat-messages'),
  typingIndicator:  $('typing-indicator'),
  chatInput:        $('chat-input'),
  btnChatSend:      $('btn-chat-send'),
  btnChatClear:     $('btn-chat-clear'),
  runnerPanel:      $('runner-panel'),
  runnerHeader:     $('runner-header'),
  btnRunnerToggle:  $('btn-runner-toggle'),
  btnRunnerClear:   $('btn-runner-clear'),
  runnerInput:      $('runner-input'),
  btnRunnerRun:     $('btn-runner-run'),
  runnerOutput:     $('runner-output'),
  // modals
  modalAuth:        $('modal-auth'),
  authTokenInput:   $('auth-token-input'),
  btnAuthCancel:    $('btn-auth-cancel'),
  btnAuthSave:      $('btn-auth-save'),
  modalHelp:        $('modal-help'),
  btnHelpClose:     $('btn-help-close'),
  toastContainer:   $('toast-container'),
};

// ─── Monaco ──────────────────────────────────────────────────────────────────

let monacoEditor = null;

function initMonaco() {
  return new Promise((resolve) => {
    const setup = () => {
      monacoEditor = window.monaco.editor.create(els.monacoContainer, {
        value: '',
        language: 'plaintext',
        theme: 'vs-dark',
        wordWrap: 'on',
        minimap: { enabled: false },
        fontSize: 13,
        lineNumbers: 'on',
        automaticLayout: true,
        scrollBeyondLastLine: false,
        renderLineHighlight: 'line',
        smoothScrolling: true,
      });

      monacoEditor.onDidChangeModelContent(() => {
        const tab = state.openTabs.find(t => t.path === state.activeTab);
        if (tab && !tab.dirty) {
          tab.dirty = true;
          renderTabs();
          updateTitle();
        }
      });

      monacoEditor.addCommand(window.monaco.KeyMod.CtrlCmd | window.monaco.KeyCode.KeyS, () => {
        saveActiveTab();
      });

      resolve(monacoEditor);
    };

    if (window.__monacoReady) {
      setup();
    } else {
      document.addEventListener('monaco-ready', setup, { once: true });
    }
  });
}

// ─── Language map ────────────────────────────────────────────────────────────

const LANG_MAP = {
  ts:   'typescript',
  tsx:  'typescript',
  js:   'javascript',
  jsx:  'javascript',
  mjs:  'javascript',
  cjs:  'javascript',
  py:   'python',
  rb:   'ruby',
  go:   'go',
  rs:   'rust',
  json: 'json',
  md:   'markdown',
  html: 'html',
  htm:  'html',
  css:  'css',
  scss: 'scss',
  sh:   'shell',
  bash: 'shell',
  yaml: 'yaml',
  yml:  'yaml',
  toml: 'ini',
  sql:  'sql',
  xml:  'xml',
  txt:  'plaintext',
};

function detectLanguage(filePath) {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return LANG_MAP[ext] || 'plaintext';
}

// ─── API helper ──────────────────────────────────────────────────────────────

class ApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function api(method, path, { query, body } = {}) {
  let url = path;
  if (query) {
    const params = new URLSearchParams(query);
    url = `${path}?${params}`;
  }

  const headers = {};
  if (state.auth) {
    headers['Authorization'] = `Bearer ${state.auth}`;
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    // Show auth modal and retry
    return new Promise((resolve, reject) => {
      state._pendingRetry = async () => {
        try {
          resolve(await api(method, path, { query, body }));
        } catch (e) {
          reject(e);
        }
      };
      showModal(els.modalAuth);
    });
  }

  let data;
  try {
    data = await res.json();
  } catch {
    data = {};
  }

  if (!res.ok) {
    throw new ApiError(
      data.error || `HTTP ${res.status}`,
      data.code || String(res.status),
      res.status
    );
  }

  return data;
}

// ─── Toasts ──────────────────────────────────────────────────────────────────

function showToast(message, type = 'info', durationMs = 5000) {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  els.toastContainer.appendChild(toast);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add('show'));
  });

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 250);
  }, durationMs);
}

// ─── Modals ──────────────────────────────────────────────────────────────────

function showModal(el) {
  el.classList.remove('hidden');
  requestAnimationFrame(() => el.classList.add('visible'));
}

function hideModal(el) {
  el.classList.remove('visible');
  setTimeout(() => el.classList.add('hidden'), 150);
}

// ─── Title ───────────────────────────────────────────────────────────────────

function updateTitle() {
  const tab = state.openTabs.find(t => t.path === state.activeTab);
  if (tab) {
    const name = tab.path.split('/').pop();
    document.title = `${tab.dirty ? '• ' : ''}${name} — Pyrfor IDE`;
  } else {
    document.title = 'Pyrfor IDE';
  }
}

// ─── File Tree ───────────────────────────────────────────────────────────────

function getFileName(p) {
  return p.split('/').filter(Boolean).pop() || p;
}

async function loadDir(dirPath) {
  try {
    const data = await api('GET', '/api/fs/list', { query: { path: dirPath } });
    state.tree[dirPath] = data.entries || [];
    return state.tree[dirPath];
  } catch (err) {
    showToast(`Failed to load directory: ${err.message}`, 'error');
    return [];
  }
}

function buildTreeNode(entry, depth) {
  const isDir = entry.type === 'directory';
  const name = entry.name || getFileName(entry.path);
  const entryPath = entry.path;

  const node = document.createElement('div');
  node.className = 'tree-node';
  node.dataset.path = entryPath;
  node.dataset.type = entry.type;
  node.setAttribute('role', 'treeitem');

  // Apply search filter
  const query = els.treeSearchInput.value.trim().toLowerCase();
  if (query && !entryPath.toLowerCase().includes(query) && !name.toLowerCase().includes(query)) {
    if (!isDir) {
      node.classList.add('hidden');
    }
  }

  const indent = document.createElement('span');
  indent.className = 'tree-indent';
  indent.style.width = `${depth * 14 + 4}px`;

  const toggle = document.createElement('span');
  toggle.className = 'tree-toggle';
  toggle.textContent = isDir ? (state.expanded.has(entryPath) ? '▾' : '▸') : '';

  const icon = document.createElement('span');
  icon.className = 'tree-icon';
  icon.textContent = isDir ? '📁' : '📄';

  const nameEl = document.createElement('span');
  nameEl.className = 'tree-name';
  nameEl.textContent = name;

  node.appendChild(indent);
  node.appendChild(toggle);
  node.appendChild(icon);
  node.appendChild(nameEl);

  if (entryPath === state.activeTab) {
    node.classList.add('active');
  }

  node.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isDir) {
      toggleFolder(entryPath, node);
    } else {
      openFile(entryPath);
    }
  });

  return node;
}

async function toggleFolder(dirPath, nodeEl) {
  if (state.expanded.has(dirPath)) {
    state.expanded.delete(dirPath);
    // Remove children container
    const childrenEl = nodeEl.nextElementSibling;
    if (childrenEl?.dataset?.parentPath === dirPath) {
      childrenEl.remove();
    }
    const toggle = nodeEl.querySelector('.tree-toggle');
    if (toggle) toggle.textContent = '▸';
    const icon = nodeEl.querySelector('.tree-icon');
    if (icon) icon.textContent = '📁';
  } else {
    state.expanded.add(dirPath);
    const toggle = nodeEl.querySelector('.tree-toggle');
    if (toggle) toggle.textContent = '▾';
    const icon = nodeEl.querySelector('.tree-icon');
    if (icon) icon.textContent = '📂';

    // Lazy-load if not cached
    nodeEl.classList.add('loading');
    const entries = state.tree[dirPath] !== undefined
      ? state.tree[dirPath]
      : await loadDir(dirPath);
    nodeEl.classList.remove('loading');

    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'tree-children';
    childrenContainer.dataset.parentPath = dirPath;

    const depth = parseInt(nodeEl.dataset.depth || '0') + 1;

    if (entries && entries.length > 0) {
      // Sort: dirs first, then files, alphabetically
      const sorted = [...entries].sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      for (const entry of sorted) {
        const child = buildTreeNode(entry, depth);
        child.dataset.depth = depth;
        childrenContainer.appendChild(child);
      }
    } else {
      const empty = document.createElement('div');
      empty.className = 'tree-node';
      empty.style.paddingLeft = `${(depth + 1) * 14 + 4}px`;
      empty.style.color = 'var(--fg-2)';
      empty.style.fontStyle = 'italic';
      empty.style.fontSize = '12px';
      empty.textContent = 'empty';
      childrenContainer.appendChild(empty);
    }

    nodeEl.insertAdjacentElement('afterend', childrenContainer);
  }
}

async function renderTree(rootPath = '') {
  els.fileTree.innerHTML = '<div style="color:var(--fg-2);padding:8px 12px;font-style:italic;font-size:12px;">Loading…</div>';

  const entries = await loadDir(rootPath);
  els.fileTree.innerHTML = '';

  if (!entries || entries.length === 0) {
    els.fileTree.innerHTML = '<div style="color:var(--fg-2);padding:8px 12px;font-size:12px;">No files found</div>';
    return;
  }

  const sorted = [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of sorted) {
    const node = buildTreeNode(entry, 0);
    node.dataset.depth = '0';
    els.fileTree.appendChild(node);
  }
}

async function refreshTree() {
  // Clear cache for all expanded dirs and re-render
  state.tree = { '': null };
  const previousExpanded = new Set(state.expanded);
  state.expanded.clear();
  await renderTree(state.cwd);

  // Re-expand previously expanded folders (best effort)
  for (const p of previousExpanded) {
    const node = els.fileTree.querySelector(`[data-path="${CSS.escape(p)}"]`);
    if (node) {
      await toggleFolder(p, node);
    }
  }
}

function applyTreeSearchFilter(query) {
  const nodes = els.fileTree.querySelectorAll('.tree-node');
  if (!query) {
    nodes.forEach(n => n.classList.remove('hidden'));
    return;
  }
  const q = query.toLowerCase();
  nodes.forEach(node => {
    const path = node.dataset.path || '';
    const isDir = node.dataset.type === 'directory';
    if (isDir) {
      // Show dirs always (they contain matching files)
      node.classList.remove('hidden');
    } else {
      const matches = path.toLowerCase().includes(q);
      node.classList.toggle('hidden', !matches);
    }
  });
}

// ─── Tabs & Editor ───────────────────────────────────────────────────────────

function renderTabs() {
  els.tabsList.innerHTML = '';
  for (const tab of state.openTabs) {
    const name = tab.path.split('/').filter(Boolean).pop() || tab.path;
    const tabEl = document.createElement('div');
    tabEl.className = `tab${tab.path === state.activeTab ? ' active' : ''}`;
    tabEl.title = tab.path;

    if (tab.dirty) {
      const dot = document.createElement('span');
      dot.className = 'tab-dirty';
      dot.textContent = '•';
      tabEl.appendChild(dot);
    }

    const nameEl = document.createElement('span');
    nameEl.className = 'tab-name';
    nameEl.textContent = name;
    tabEl.appendChild(nameEl);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'tab-close';
    closeBtn.textContent = '×';
    closeBtn.title = 'Close tab';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(tab.path);
    });
    tabEl.appendChild(closeBtn);

    tabEl.addEventListener('click', () => switchTab(tab.path));
    els.tabsList.appendChild(tabEl);
  }
}

function switchTab(filePath) {
  state.activeTab = filePath;
  const tab = state.openTabs.find(t => t.path === filePath);
  if (!tab) return;

  if (monacoEditor && tab.model) {
    monacoEditor.setModel(tab.model);
    els.monacoContainer.classList.add('visible');
    els.editorPlaceholder.classList.add('hidden');
  }

  renderTabs();
  highlightTreeNode(filePath);
  updateTitle();
}

function highlightTreeNode(filePath) {
  els.fileTree.querySelectorAll('.tree-node.active').forEach(n => n.classList.remove('active'));
  const node = els.fileTree.querySelector(`[data-path="${CSS.escape(filePath)}"]`);
  if (node) node.classList.add('active');
}

async function openFile(filePath) {
  // If already open, just switch
  const existing = state.openTabs.find(t => t.path === filePath);
  if (existing) {
    switchTab(filePath);
    return;
  }

  try {
    const data = await api('GET', '/api/fs/read', { query: { path: filePath } });
    const lang = detectLanguage(filePath);
    const model = monacoEditor
      ? window.monaco.editor.createModel(data.content || '', lang)
      : null;

    const tab = {
      path: filePath,
      content: data.content || '',
      dirty: false,
      model,
      language: lang,
    };

    state.openTabs.push(tab);
    switchTab(filePath);
  } catch (err) {
    showToast(`Cannot open file: ${err.message}`, 'error');
  }
}

async function saveActiveTab() {
  const tab = state.openTabs.find(t => t.path === state.activeTab);
  if (!tab) return;

  const content = monacoEditor && tab.model
    ? tab.model.getValue()
    : tab.content;

  try {
    await api('PUT', '/api/fs/write', { body: { path: tab.path, content } });
    tab.content = content;
    tab.dirty = false;
    renderTabs();
    updateTitle();
    showToast('Saved', 'success', 2000);
  } catch (err) {
    showToast(`Save failed: ${err.message}`, 'error');
  }
}

function closeTab(filePath) {
  const tab = state.openTabs.find(t => t.path === filePath);
  if (!tab) return;

  if (tab.dirty && !confirm('Discard unsaved changes?')) return;

  if (tab.model) tab.model.dispose();

  const idx = state.openTabs.findIndex(t => t.path === filePath);
  state.openTabs.splice(idx, 1);

  if (state.activeTab === filePath) {
    // Switch to adjacent tab
    const next = state.openTabs[idx] || state.openTabs[idx - 1] || null;
    if (next) {
      switchTab(next.path);
    } else {
      state.activeTab = null;
      if (monacoEditor) {
        monacoEditor.setModel(window.monaco.editor.createModel('', 'plaintext'));
      }
      els.monacoContainer.classList.remove('visible');
      els.editorPlaceholder.classList.remove('hidden');
      updateTitle();
    }
  }

  renderTabs();
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderMessageText(text) {
  // Split by fenced code blocks
  const parts = [];
  const fenceRe = /```(\w*)\n?([\s\S]*?)```/g;
  let last = 0;
  let match;
  let codeBlocks = 0;
  let lastCodeContent = null;

  while ((match = fenceRe.exec(text)) !== null) {
    if (match.index > last) {
      parts.push({ type: 'text', content: text.slice(last, match.index) });
    }
    parts.push({ type: 'code', lang: match[1] || '', content: match[2] });
    codeBlocks++;
    lastCodeContent = match[2];
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    parts.push({ type: 'text', content: text.slice(last) });
  }

  let html = '';
  for (const part of parts) {
    if (part.type === 'text') {
      html += `<span style="white-space:pre-wrap">${escapeHtml(part.content)}</span>`;
    } else {
      html += `<pre><code class="lang-${escapeHtml(part.lang)}">${escapeHtml(part.content)}</code></pre>`;
    }
  }

  return { html, codeBlocks, lastCodeContent };
}

function appendChatMessage(role, text, ts) {
  const msg = { role, text, ts: ts || Date.now() };
  state.chatMessages.push(msg);

  const msgEl = document.createElement('div');
  msgEl.className = `chat-msg ${role}`;

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';

  const { html, codeBlocks, lastCodeContent } = renderMessageText(text);
  bubble.innerHTML = html;

  const timeEl = document.createElement('div');
  timeEl.className = 'chat-msg-time';
  timeEl.textContent = new Date(msg.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  msgEl.appendChild(bubble);
  msgEl.appendChild(timeEl);

  // "Apply to active file" button for assistant messages with exactly one code block
  if (role === 'assistant' && codeBlocks === 1 && lastCodeContent !== null) {
    const applyBtn = document.createElement('button');
    applyBtn.className = 'btn btn-secondary btn-sm chat-apply-btn';
    applyBtn.textContent = 'Apply to active file';
    applyBtn.addEventListener('click', () => {
      const tab = state.openTabs.find(t => t.path === state.activeTab);
      if (!tab) { showToast('No active file open', 'error'); return; }
      if (monacoEditor && tab.model) {
        const op = {
          range: tab.model.getFullModelRange(),
          text: lastCodeContent,
        };
        monacoEditor.executeEdits('apply-chat', [op]);
      } else {
        tab.content = lastCodeContent;
      }
      tab.dirty = true;
      renderTabs();
      updateTitle();
      showToast('Code applied to active file', 'success', 2000);
    });
    msgEl.appendChild(applyBtn);
  }

  els.chatMessages.appendChild(msgEl);
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
}

async function sendChat() {
  const text = els.chatInput.value.trim();
  if (!text || state.chatBusy) return;

  state.chatBusy = true;
  els.chatInput.value = '';
  els.chatInput.disabled = true;
  els.btnChatSend.disabled = true;

  appendChatMessage('user', text);

  els.typingIndicator.classList.remove('hidden');
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;

  try {
    const data = await api('POST', '/api/chat', { body: { text } });
    els.typingIndicator.classList.add('hidden');
    appendChatMessage('assistant', data.reply || '(empty response)');
  } catch (err) {
    els.typingIndicator.classList.add('hidden');
    showToast(`Chat error: ${err.message}`, 'error');
    appendChatMessage('assistant', `Error: ${err.message}`);
  } finally {
    state.chatBusy = false;
    els.chatInput.disabled = false;
    els.btnChatSend.disabled = false;
    els.chatInput.focus();
  }
}

// ─── Command Runner ───────────────────────────────────────────────────────────

async function runCommand() {
  const command = els.runnerInput.value.trim();
  if (!command) return;

  // Save to history
  state.cmdHistory = [command, ...state.cmdHistory.filter(c => c !== command)].slice(0, 20);
  state.cmdHistoryIdx = -1;
  localStorage.setItem('pyrfor-cmd-history', JSON.stringify(state.cmdHistory));

  els.runnerOutput.innerHTML = '<span class="out-meta">Running…</span>';
  els.btnRunnerRun.disabled = true;

  try {
    const payload = { command };
    if (state.cwd) payload.cwd = state.cwd;

    const data = await api('POST', '/api/exec', { body: payload });

    let html = '';
    if (data.stdout) {
      html += `<span class="out-stdout">${escapeHtml(data.stdout)}</span>`;
    }
    if (data.stderr) {
      html += `<span class="out-stderr">${escapeHtml(data.stderr)}</span>`;
    }
    const exitColor = data.exitCode === 0 ? 'var(--success)' : 'var(--error)';
    html += `\n<span class="out-meta" style="color:${exitColor}">exit code ${data.exitCode} · ${data.durationMs}ms</span>`;
    els.runnerOutput.innerHTML = html || '<span class="out-meta">No output</span>';
  } catch (err) {
    els.runnerOutput.innerHTML = `<span class="out-stderr">${escapeHtml(err.message)}</span>`;
    showToast(`Exec error: ${err.message}`, 'error');
  } finally {
    els.btnRunnerRun.disabled = false;
  }
}

function toggleRunner() {
  els.runnerPanel.classList.toggle('collapsed');
  const collapsed = els.runnerPanel.classList.contains('collapsed');
  els.btnRunnerToggle.textContent = collapsed ? '▲' : '▼';
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

function saveAuth() {
  const token = els.authTokenInput.value.trim();
  state.auth = token;
  if (token) {
    localStorage.setItem('pyrfor-token', token);
  } else {
    localStorage.removeItem('pyrfor-token');
  }
  hideModal(els.modalAuth);
  els.authTokenInput.value = '';

  if (state._pendingRetry) {
    const retry = state._pendingRetry;
    state._pendingRetry = null;
    retry();
  }
}

function logout() {
  state.auth = '';
  localStorage.removeItem('pyrfor-token');
  showToast('Token cleared', 'info', 2000);
}

// ─── Mobile panel toggles ─────────────────────────────────────────────────────

function toggleMobilePanel(panel) {
  panel.classList.toggle('open');
}

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────

function isModifier(e) {
  return e.ctrlKey || e.metaKey;
}

document.addEventListener('keydown', (e) => {
  // Esc — close any open modal
  if (e.key === 'Escape') {
    if (!els.modalAuth.classList.contains('hidden')) { hideModal(els.modalAuth); return; }
    if (!els.modalHelp.classList.contains('hidden')) { hideModal(els.modalHelp); return; }
  }

  // ? — help (only when not in an input)
  if (e.key === '?' && !['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)) {
    showModal(els.modalHelp);
    return;
  }

  if (!isModifier(e)) return;

  switch (e.key.toLowerCase()) {
    case 's':
      e.preventDefault();
      saveActiveTab();
      break;
    case 'p':
      e.preventDefault();
      els.treeSearchBar.classList.remove('hidden');
      els.treeSearchInput.focus();
      break;
    case 'e':
      e.preventDefault();
      els.chatInput.focus();
      break;
    case '`':
      e.preventDefault();
      toggleRunner();
      break;
  }
});

// ─── Bootstrap ───────────────────────────────────────────────────────────────

async function init() {
  // Init Monaco
  await initMonaco();

  // Load file tree
  await renderTree(state.cwd);

  // Try to get model info from the gateway
  try {
    const data = await api('GET', '/api/dashboard');
    if (data.model) {
      els.modelIndicator.textContent = data.model;
    }
    if (data.workspaceRoot || data.cwd) {
      const ws = data.workspaceRoot || data.cwd;
      state.cwd = ws;
      els.workspaceLabel.textContent = ws;
      els.workspaceLabel.title = ws;
    }
  } catch {
    // Not critical — ignore
  }
}

// ─── Event wiring ─────────────────────────────────────────────────────────────

els.btnSave.addEventListener('click', saveActiveTab);
els.btnRefresh.addEventListener('click', refreshTree);
els.btnLogout.addEventListener('click', logout);
els.btnHelp.addEventListener('click', () => showModal(els.modalHelp));
els.btnHelpClose.addEventListener('click', () => hideModal(els.modalHelp));
els.btnAuthSave.addEventListener('click', saveAuth);
els.btnAuthCancel.addEventListener('click', () => hideModal(els.modalAuth));

els.btnChatSend.addEventListener('click', sendChat);
els.btnChatClear.addEventListener('click', () => {
  state.chatMessages = [];
  els.chatMessages.innerHTML = '';
});

els.chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
});

els.btnRunnerRun.addEventListener('click', runCommand);
els.btnRunnerToggle.addEventListener('click', (e) => { e.stopPropagation(); toggleRunner(); });
els.runnerHeader.addEventListener('click', toggleRunner);
els.btnRunnerClear.addEventListener('click', (e) => {
  e.stopPropagation();
  els.runnerOutput.innerHTML = '';
});

els.runnerInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    runCommand();
    return;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (state.cmdHistoryIdx < state.cmdHistory.length - 1) {
      state.cmdHistoryIdx++;
      els.runnerInput.value = state.cmdHistory[state.cmdHistoryIdx] || '';
    }
    return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (state.cmdHistoryIdx > 0) {
      state.cmdHistoryIdx--;
      els.runnerInput.value = state.cmdHistory[state.cmdHistoryIdx] || '';
    } else {
      state.cmdHistoryIdx = -1;
      els.runnerInput.value = '';
    }
  }
});

els.treeSearchToggle.addEventListener('click', () => {
  els.treeSearchBar.classList.toggle('hidden');
  if (!els.treeSearchBar.classList.contains('hidden')) {
    els.treeSearchInput.focus();
  }
});

els.treeSearchInput.addEventListener('input', () => {
  applyTreeSearchFilter(els.treeSearchInput.value.trim());
});

els.treeSearchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    els.treeSearchBar.classList.add('hidden');
    els.treeSearchInput.value = '';
    applyTreeSearchFilter('');
  }
});

// Auth modal — Enter to save
els.authTokenInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveAuth();
});

// Hamburger (mobile)
els.btnHamburger.addEventListener('click', () => {
  // Simple toggle: open tree if neither is open, else toggle each
  const treeOpen = els.panelTree.classList.contains('open');
  if (!treeOpen) {
    els.panelTree.classList.add('open');
    els.panelChat.classList.remove('open');
  } else {
    els.panelTree.classList.remove('open');
    els.panelChat.classList.add('open');
  }
});

// Close mobile panels on outside click
document.addEventListener('click', (e) => {
  if (window.innerWidth >= 768) return;
  if (!els.panelTree.contains(e.target) && e.target !== els.btnHamburger) {
    els.panelTree.classList.remove('open');
  }
  if (!els.panelChat.contains(e.target) && e.target !== els.btnHamburger) {
    els.panelChat.classList.remove('open');
  }
});

// Start
init().catch((err) => {
  showToast(`Init error: ${err.message}`, 'error');
});

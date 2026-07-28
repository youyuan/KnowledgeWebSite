/* global marked, hljs, DOMPurify */
const state = { repos: [], current: null, selected: null };
// selected: { path, type: 'file'|'dir' }，新建/上传/删除操作的目标；选中资料库时重置为根目录

const $ = sel => document.querySelector(sel);

async function api(path, options) {
  const res = await fetch(path, options && {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: options.body && JSON.stringify(options.body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
  return data;
}

function button(text, onclick) {
  const b = document.createElement('button');
  b.textContent = text;
  b.onclick = e => { e.stopPropagation(); onclick(); };
  return b;
}

async function loadRepos() {
  state.repos = await api('/api/repos');
  renderRepos();
}

function renderRepos() {
  const ul = $('#repo-list');
  ul.innerHTML = '';
  for (const repo of state.repos) {
    const li = document.createElement('li');
    li.className = 'repo' + (state.current === repo.id ? ' active' : '');
    const label = document.createElement('span');
    label.textContent = repo.id;
    label.onclick = () => selectRepo(repo.id);
    li.append(label);
    ul.append(li);
  }
}

async function selectRepo(id) {
  state.current = id;
  state.selected = { path: '', type: 'dir' };
  $('#search-input').disabled = false;
  $('#tree-toolbar').hidden = false;
  renderRepos();
  try {
    await refreshTree();
  } catch (err) {
    alert(err.message);
  }
  $('#main').innerHTML = '<p class="placeholder">选择左侧文件开始浏览</p>';
}

async function refreshTree() {
  const tree = await api(`/api/repos/${state.current}/tree`);
  renderTree(tree, $('#tree'));
}

function renderTree(node, container) {
  container.innerHTML = '';
  const ul = document.createElement('ul');
  for (const child of node.children || []) {
    const li = document.createElement('li');
    if (child.type === 'dir') {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = child.name;
      summary.onclick = () => { state.selected = { path: child.path, type: 'dir' }; };
      details.append(summary);
      renderTree(child, details);
      li.append(details);
    } else {
      const supported = ['.md', '.markdown', '.html', '.htm'].includes(child.ext);
      const a = document.createElement('a');
      a.textContent = child.name;
      a.className = supported ? 'file' : 'file unsupported';
      a.onclick = () => {
        state.selected = { path: child.path, type: 'file' };
        if (supported) openFile(child.path);
      };
      if (!supported) a.title = '不支持预览，可选中后删除';
      li.append(a);
    }
    ul.append(li);
  }
  container.append(ul);
}

// 新建/上传的目标目录：选中目录则用它，选中文件则用其父目录
function targetDir() {
  const sel = state.selected;
  if (!sel || sel.type === 'dir') return (sel && sel.path) || '';
  return sel.path.split('/').slice(0, -1).join('/');
}

async function openFile(relPath) {
  const ext = relPath.split('.').pop().toLowerCase();
  try {
    if (ext === 'html' || ext === 'htm') return renderHtmlPreview(relPath);
    const { content } = await api(`/api/repos/${state.current}/file?path=${encodeURIComponent(relPath)}`);
    renderMarkdown(content, relPath);
  } catch (err) {
    alert(err.message);
  }
}

function toolbar(relPath, buttons) {
  const bar = document.createElement('div');
  bar.className = 'toolbar';
  const label = document.createElement('span');
  label.textContent = `${state.current} / ${relPath}`;
  bar.append(label, ...buttons);
  return bar;
}

function renderMarkdown(content, relPath) {
  const main = $('#main');
  main.innerHTML = '';
  main.append(toolbar(relPath, [button('编辑', () => renderEditor(content, relPath))]));
  const article = document.createElement('article');
  article.className = 'markdown-body';
  article.innerHTML = DOMPurify.sanitize(marked.parse(content));
  article.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block));
  main.append(article);
}

function renderHtmlPreview(relPath) {
  const main = $('#main');
  main.innerHTML = '';
  main.append(toolbar(relPath, [button('源码', () => openHtmlSource(relPath))]));
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-same-origin');
  iframe.src = `/api/repos/${state.current}/raw?path=${encodeURIComponent(relPath)}`;
  main.append(iframe);
}

async function openHtmlSource(relPath) {
  const { content } = await api(`/api/repos/${state.current}/file?path=${encodeURIComponent(relPath)}`);
  renderEditor(content, relPath);
}

function renderEditor(content, relPath) {
  const main = $('#main');
  main.innerHTML = '';
  const ta = document.createElement('textarea');
  ta.className = 'editor';
  ta.value = content;
  const saveBtn = button('保存', () => {
    api(`/api/repos/${state.current}/file?path=${encodeURIComponent(relPath)}`, {
      method: 'PUT', body: { content: ta.value },
    })
      .then(() => openFile(relPath))
      .catch(err => alert(err.message));
  });
  main.append(toolbar(relPath, [saveBtn, button('取消', () => openFile(relPath))]));
  main.append(ta);
}

async function doSearch(q) {
  const { results } = await api(`/api/repos/${state.current}/search?q=${encodeURIComponent(q)}`);
  const main = $('#main');
  main.innerHTML = '';
  const list = document.createElement('ul');
  list.className = 'search-results';
  if (!results.length) list.innerHTML = '<li>无匹配结果</li>';
  for (const r of results) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.textContent = `${r.path}:${r.line}`;
    a.onclick = () => openFile(r.path);
    const snippet = document.createElement('code');
    snippet.textContent = r.text;
    li.append(a, document.createTextNode(' '), snippet);
    list.append(li);
  }
  main.append(list);
}

// 资料库与文件管理
$('#btn-new-repo').onclick = async () => {
  const name = prompt('资料库名称（字母、数字、-、_、.）：');
  if (!name || !name.trim()) return;
  try {
    await api('/api/repos', { method: 'POST', body: { name: name.trim() } });
    await loadRepos();
  } catch (err) {
    alert(err.message);
  }
};

$('#btn-new-file').onclick = async () => {
  const name = prompt('新建文件路径（相对当前目录）：');
  if (!name || !name.trim()) return;
  const rel = [targetDir(), name.trim()].filter(Boolean).join('/');
  try {
    await api(`/api/repos/${state.current}/file?path=${encodeURIComponent(rel)}`, { method: 'POST' });
    await refreshTree();
  } catch (err) {
    alert(err.message);
  }
};

$('#btn-new-dir').onclick = async () => {
  const name = prompt('新建文件夹路径（相对当前目录）：');
  if (!name || !name.trim()) return;
  const rel = [targetDir(), name.trim()].filter(Boolean).join('/');
  try {
    await api(`/api/repos/${state.current}/mkdir?path=${encodeURIComponent(rel)}`, { method: 'POST' });
    await refreshTree();
  } catch (err) {
    alert(err.message);
  }
};

$('#btn-upload').onclick = () => $('#upload-input').click();

$('#upload-input').onchange = async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const rel = [targetDir(), file.name].filter(Boolean).join('/');
  try {
    const res = await fetch(`/api/repos/${state.current}/upload?path=${encodeURIComponent(rel)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `上传失败 (${res.status})`);
    await refreshTree();
  } catch (err) {
    alert(err.message);
  }
};

$('#btn-delete').onclick = async () => {
  const sel = state.selected;
  if (!sel || !sel.path) {
    alert('请先在目录树中选择要删除的文件或文件夹');
    return;
  }
  if (!confirm(`删除 ${sel.path}？此操作不可恢复。`)) return;
  try {
    await api(`/api/repos/${state.current}/file?path=${encodeURIComponent(sel.path)}`, { method: 'DELETE' });
    state.selected = { path: '', type: 'dir' };
    $('#main').innerHTML = '<p class="placeholder">选择左侧文件开始浏览</p>';
    await refreshTree();
  } catch (err) {
    alert(err.message);
  }
};

let searchTimer;
$('#search-input').oninput = e => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (!q) return;
  searchTimer = setTimeout(() => doSearch(q).catch(err => alert(err.message)), 300);
};

loadRepos();

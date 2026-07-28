/* global marked, hljs, DOMPurify */
const state = { repos: [], current: null, currentPath: null };

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
    if (repo.status === 'cloning') label.textContent += '（克隆中…）';
    if (repo.status === 'error') label.textContent += '（失败）';
    label.title = repo.error || repo.url;
    label.onclick = () => repo.status === 'ready' && selectRepo(repo.id);
    const pullBtn = button('更新', async () => {
      try {
        await api(`/api/repos/${repo.id}/pull`, { method: 'POST' });
        await selectRepo(repo.id);
      } catch (err) {
        if (confirm(`更新失败：${err.message}\n\n是否强制重置为远端版本？（本地修改将丢失）`)) {
          await api(`/api/repos/${repo.id}/reset`, { method: 'POST' });
          await selectRepo(repo.id);
        }
      }
    });
    const delBtn = button('删除', async () => {
      if (confirm(`删除仓库 ${repo.id}？本地目录将被移除。`)) {
        await api(`/api/repos/${repo.id}`, { method: 'DELETE' });
        if (state.current === repo.id) {
          state.current = null;
          $('#tree').innerHTML = '';
          $('#search-input').disabled = true;
        }
        await loadRepos();
      }
    });
    li.append(label, pullBtn, delBtn);
    ul.append(li);
  }
}

async function selectRepo(id) {
  state.current = id;
  state.currentPath = null;
  $('#search-input').disabled = false;
  renderRepos();
  const tree = await api(`/api/repos/${id}/tree`);
  renderTree(tree, $('#tree'));
  $('#main').innerHTML = '<p class="placeholder">选择左侧文件开始浏览</p>';
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
      details.append(summary);
      renderTree(child, details);
      li.append(details);
    } else {
      const supported = ['.md', '.markdown', '.html', '.htm'].includes(child.ext);
      const a = document.createElement('a');
      a.textContent = child.name;
      a.className = supported ? 'file' : 'file unsupported';
      if (supported) a.onclick = () => openFile(child.path);
      else a.title = '不支持预览的文件类型';
      li.append(a);
    }
    ul.append(li);
  }
  container.append(ul);
}

async function openFile(relPath) {
  state.currentPath = relPath;
  const ext = relPath.split('.').pop().toLowerCase();
  if (ext === 'html' || ext === 'htm') return renderHtmlPreview(relPath);
  const { content } = await api(`/api/repos/${state.current}/file?path=${encodeURIComponent(relPath)}`);
  renderMarkdown(content, relPath);
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

$('#add-form').onsubmit = async e => {
  e.preventDefault();
  try {
    await api('/api/repos', {
      method: 'POST',
      body: {
        url: $('#repo-url').value.trim(),
        token: $('#repo-token').value.trim() || undefined,
      },
    });
    $('#repo-url').value = '';
    $('#repo-token').value = '';
    await loadRepos();
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
setInterval(() => {
  if (state.repos.some(r => r.status === 'cloning')) loadRepos();
}, 2000);

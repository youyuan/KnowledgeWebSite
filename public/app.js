/* global marked, hljs, DOMPurify */
const state = { repos: [], current: null };

const $ = sel => document.querySelector(sel);

async function api(path, options) {
  const res = await fetch(path, options && {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: options.body && JSON.stringify(options.body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
    throw new Error('未登录');
  }
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
  $('#search-input').disabled = false;
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
  const nav = $('#tree');
  nav.innerHTML = '';
  renderTree(tree, nav);
}

function renderTree(node, container) {
  // 注意：不要在这里清空 container——递归调用会传入 details 元素，
  // 清空会抹掉刚 append 的 summary，导致浏览器显示默认文本"详细信息"
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

function rawUrl(relPath) {
  return `/api/repos/${state.current}/raw?path=${encodeURIComponent(relPath)}`;
}

// 保留 GFM 任务列表的复选框（DOMPurify 默认会剥掉 input）
const SANITIZE_OPTIONS = { ADD_TAGS: ['input'], ADD_ATTR: ['type', 'checked', 'disabled'] };

// 把渲染结果中相对路径的图片/链接改写到 raw 接口（以 md 文件所在目录为基准），与 GitHub 行为一致
function resolveMedia(container, relPath) {
  const baseDir = relPath.split('/').slice(0, -1).join('/');
  const resolveRel = url => {
    if (!url || /^(https?:)?\/\//.test(url) || url.startsWith('data:') || url.startsWith('#') || url.startsWith('/')) return null;
    const out = [];
    for (const p of (baseDir ? `${baseDir}/${url}` : url).split('/')) {
      if (p === '' || p === '.') continue;
      else if (p === '..') out.pop();
      else out.push(p);
    }
    return out.join('/');
  };
  container.querySelectorAll('img').forEach(img => {
    const resolved = resolveRel(img.getAttribute('src'));
    if (resolved) img.src = rawUrl(resolved);
  });
  container.querySelectorAll('a').forEach(a => {
    const resolved = resolveRel(a.getAttribute('href'));
    if (resolved) {
      a.href = rawUrl(resolved);
      a.target = '_blank';
    }
  });
}

// 分享弹层 DOM 结构：
// <div class="share-overlay">                        遮罩层，点击卡片以外的区域关闭
//   <div class="share-card">                         居中卡片
//     <h3>分享文档</h3>
//     <div class="share-options">                    有效期单选（7 天默认选中 / 30 天 / 永久 / 自定义）
//       <label><input type="radio" name="share-days" value="7" checked> 7 天</label>
//       <label><input type="radio" name="share-days" value="30"> 30 天</label>
//       <label><input type="radio" name="share-days" value=""> 永久</label>
//       <label><input type="radio" name="share-days" value="custom"> 自定义
//         <input type="number" class="share-custom-days" min="1" max="365"> 天</label>
//     </div>
//     <div class="share-result" hidden>              生成成功后显示
//       <input class="share-url" readonly>           完整链接；复制失败时选中文本供手动复制
//       <p class="share-expires">…</p>               过期时间文字（永久显示「永久有效」）
//     </div>
//     <div class="share-actions">
//       <button class="share-generate">生成链接</button>
//       <button class="share-copy" hidden>复制</button>
//       <button class="share-close">关闭</button>
//     </div>
//   </div>
// </div>
// 分享弹层：选择时间即自动生成链接，用户只需复制
// DOM 结构：
// <div class="share-overlay">                    遮罩，点击卡片外关闭
//   <div class="share-card">
//     <h3>分享文档</h3>
//     <div class="share-options">                有效期单选（7 天默认 / 30 天 / 永久 / 自定义+天数输入）</div>
//     <div class="share-result">
//       <div class="share-link-row">
//         <input class="share-url" readonly>     完整链接
//         <button class="share-copy">复制</button>
//       </div>
//       <p class="share-expires">…</p>           过期时间（永久显示「永久有效」）
//     </div>
//   </div>
// </div>
function openShareDialog(relPath) {
  const overlay = document.createElement('div');
  overlay.className = 'share-overlay';
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

  const card = document.createElement('div');
  card.className = 'share-card';

  const title = document.createElement('h3');
  title.textContent = '分享文档';

  // 有效期选项
  const options = document.createElement('div');
  options.className = 'share-options';
  const customInput = document.createElement('input');
  customInput.type = 'number';
  customInput.className = 'share-custom-days';
  customInput.min = 1;
  customInput.max = 365;
  customInput.placeholder = '天数';
  for (const [value, text] of [['7', '7 天'], ['30', '30 天'], ['', '永久'], ['custom', '自定义']]) {
    const label = document.createElement('label');
    label.className = 'share-option';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'share-days';
    radio.value = value;
    if (value === '7') radio.checked = true;
    label.append(radio, document.createTextNode(text));
    if (value === 'custom') label.append(customInput);
    options.append(label);
  }
  customInput.onfocus = () => { card.querySelector('input[value="custom"]').checked = true; };

  // 链接结果区
  const result = document.createElement('div');
  result.className = 'share-result';
  const linkRow = document.createElement('div');
  linkRow.className = 'share-link-row';
  const urlInput = document.createElement('input');
  urlInput.className = 'share-url';
  urlInput.readOnly = true;
  urlInput.placeholder = '生成中…';
  const copyBtn = document.createElement('button');
  copyBtn.className = 'share-copy';
  copyBtn.textContent = '复制';
  copyBtn.onclick = async () => {
    if (!urlInput.value) return;
    try {
      await navigator.clipboard.writeText(urlInput.value);
      copyBtn.textContent = '已复制 ✓';
    } catch {
      // clipboard API 不可用（如非安全上下文）时降级：选中链接让用户手动复制
      urlInput.focus();
      urlInput.select();
      copyBtn.textContent = '已选中，请手动复制';
    }
  };
  linkRow.append(urlInput, copyBtn);
  const expires = document.createElement('p');
  expires.className = 'share-expires';
  result.append(linkRow, expires);

  // 生成/重新生成链接
  let generating = 0;
  async function generate() {
    const selected = card.querySelector('input[name="share-days"]:checked').value;
    let days = null;
    if (selected === 'custom') {
      days = Number(customInput.value);
      if (!Number.isInteger(days) || days < 1 || days > 365) return; // 输入不完整时静默等待
    } else if (selected !== '') {
      days = Number(selected);
    }
    const seq = ++generating;
    urlInput.value = '';
    urlInput.placeholder = '生成中…';
    copyBtn.textContent = '复制';
    try {
      const { url, expiresAt } = await api(`/api/repos/${state.current}/share`, {
        method: 'POST', body: { path: relPath, days },
      });
      if (seq !== generating) return; // 已有更新的请求，丢弃过期响应
      urlInput.value = location.origin + url;
      expires.textContent = expiresAt ? `有效期至 ${new Date(expiresAt).toLocaleString()}` : '永久有效';
    } catch (err) {
      if (seq === generating) {
        urlInput.placeholder = '';
        expires.textContent = `生成失败：${err.message}`;
      }
    }
  }

  options.onchange = generate;
  let customTimer;
  customInput.oninput = () => {
    clearTimeout(customTimer);
    customTimer = setTimeout(generate, 500);
  };

  card.append(title, options, result);
  overlay.append(card);
  document.body.append(overlay);
  generate(); // 打开即按默认 7 天生成
}

function renderMarkdown(content, relPath) {
  const main = $('#main');
  main.innerHTML = '';
  main.append(toolbar(relPath, [
    button('编辑', () => renderEditor(content, relPath)),
    button('分享', () => openShareDialog(relPath)),
    button('新标签页打开', () => window.open(`/view.html?id=${encodeURIComponent(state.current)}&path=${encodeURIComponent(relPath)}`, '_blank')),
  ]));
  const article = document.createElement('article');
  article.className = 'markdown-body';
  article.innerHTML = DOMPurify.sanitize(marked.parse(content), SANITIZE_OPTIONS);
  article.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block));
  resolveMedia(article, relPath);
  main.append(article);
}

function renderHtmlPreview(relPath) {
  const main = $('#main');
  main.innerHTML = '';
  main.append(toolbar(relPath, [
    button('源码', () => openHtmlSource(relPath)),
    button('分享', () => openShareDialog(relPath)),
    button('新标签页打开', () => window.open(rawUrl(relPath), '_blank')),
  ]));
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts');
  iframe.src = rawUrl(relPath);
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

let searchTimer;
$('#search-input').oninput = e => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (!q) return;
  searchTimer = setTimeout(() => doSearch(q).catch(err => alert(err.message)), 300);
};

async function loadUser() {
  try {
    const { username } = await api('/api/me');
    $('#user-info').textContent = username;
  } catch { /* 未登录时 api() 已跳转 */ }
}

$('#btn-logout').onclick = async () => {
  await fetch('/api/logout', { method: 'POST' });
  location.href = '/login.html';
};

loadUser();

loadRepos();

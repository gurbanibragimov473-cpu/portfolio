(() => {
  const $ = id => document.getElementById(id);
  const api = 'https://api.github.com';
  const KEY = 'portfolioAdmin';
  let cfg = null, branch = 'main', sha = null, list = [], editId = null, photo = null;

  const readSaved = () => {
    try { return JSON.parse(localStorage.getItem(KEY) || sessionStorage.getItem(KEY) || 'null'); }
    catch (e) { return null; }
  };
  const wipe = () => { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY); };
  const keep = (c, remember) => { wipe(); (remember ? localStorage : sessionStorage).setItem(KEY, JSON.stringify(c)); };
  const say = (id, text, bad) => { const n = $(id); n.textContent = text || ''; n.className = 'note' + (text ? (bad ? ' bad' : ' good') : ''); };
  const enc = s => btoa(unescape(encodeURIComponent(s)));
  const dec = b => decodeURIComponent(escape(atob(b.replace(/\n/g, ''))));

  async function gh(path, opt = {}) {
    const res = await fetch(api + path, {
      ...opt,
      headers: {
        Authorization: 'Bearer ' + cfg.token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opt.headers || {})
      }
    });
    if (!res.ok) {
      let msg = '';
      try { msg = (await res.json()).message; } catch (e) {}
      const err = new Error(msg || 'Ошибка ' + res.status);
      err.status = res.status;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }

  const explain = e => {
    if (e.status === 401) return 'Токен не подошёл. Проверьте, что он скопирован целиком.';
    if (e.status === 404) return 'Репозиторий не найден или у токена нет к нему доступа.';
    if (e.status === 403) return 'Нет прав на запись или слишком много запросов. Подождите немного.';
    if (e.status === 409 || e.status === 422) return 'Данные изменились. Обновите страницу и повторите.';
    return e.message || 'Что-то пошло не так.';
  };

  const repoPath = p => `/repos/${cfg.owner}/${cfg.repo}/contents/${p}`;

  async function loadList() {
    try {
      const f = await gh(repoPath('data/projects.json') + '?ref=' + branch);
      sha = f.sha;
      list = JSON.parse(dec(f.content));
      if (!Array.isArray(list)) list = [];
    } catch (e) {
      if (e.status === 404) { sha = null; list = []; } else throw e;
    }
    draw();
  }

  async function saveList(message) {
    const body = { message, content: enc(JSON.stringify(list, null, 2) + '\n'), branch };
    if (sha) body.sha = sha;
    const r = await gh(repoPath('data/projects.json'), { method: 'PUT', body: JSON.stringify(body) });
    sha = r.content.sha;
  }

  async function putFile(path, b64, message) {
    let old;
    try { old = (await gh(repoPath(path) + '?ref=' + branch)).sha; }
    catch (e) { if (e.status !== 404) throw e; }
    const body = { message, content: b64, branch };
    if (old) body.sha = old;
    await gh(repoPath(path), { method: 'PUT', body: JSON.stringify(body) });
  }

  async function dropFile(path) {
    try {
      const f = await gh(repoPath(path) + '?ref=' + branch);
      await gh(repoPath(path), { method: 'DELETE', body: JSON.stringify({ message: 'Удаление файла', sha: f.sha, branch }) });
    } catch (e) {}
  }

  function packImage(file) {
    return new Promise((ok, no) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1600 / img.width);
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        const x = c.getContext('2d');
        x.fillStyle = '#0d1110';
        x.fillRect(0, 0, c.width, c.height);
        x.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        const data = c.toDataURL('image/jpeg', 0.86);
        ok({ b64: data.split(',')[1], preview: data });
      };
      img.onerror = () => no(new Error('Не удалось прочитать картинку.'));
      img.src = url;
    });
  }

  function show(inside) {
    $('login').hidden = inside;
    $('panel').hidden = !inside;
    if (inside) $('who').textContent = cfg.owner + ' / ' + cfg.repo;
  }

  async function enter(c, remember) {
    cfg = c;
    const repo = await gh(`/repos/${c.owner}/${c.repo}`);
    if (!repo.permissions || !repo.permissions.push) throw new Error('У токена нет права записи. Нужен доступ Contents: Read and write.');
    branch = repo.default_branch;
    keep(c, remember);
    await loadList();
    show(true);
  }

  function draw() {
    const box = $('list');
    box.textContent = '';
    if (!list.length) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = 'Пока ничего не добавлено. Заполните форму справа.';
      box.append(p);
      return;
    }
    list.forEach((item, i) => {
      const row = document.createElement('div');
      row.className = 'item';
      const img = document.createElement('img');
      img.src = item.image;
      img.alt = '';
      const info = document.createElement('div');
      const h = document.createElement('h3');
      h.textContent = item.title;
      const s = document.createElement('small');
      s.textContent = item.url;
      const acts = document.createElement('div');
      acts.className = 'actions';
      const mk = (label, cls, fn) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn small ' + cls;
        b.textContent = label;
        b.addEventListener('click', fn);
        return b;
      };
      if (i > 0) acts.append(mk('↑', '', () => move(i, -1)));
      if (i < list.length - 1) acts.append(mk('↓', '', () => move(i, 1)));
      acts.append(mk('Изменить', '', () => edit(item)));
      acts.append(mk('Удалить', 'danger', () => remove(item)));
      info.append(h, s, acts);
      row.append(img, info);
      box.append(row);
    });
  }

  async function move(i, d) {
    const j = i + d;
    [list[i], list[j]] = [list[j], list[i]];
    draw();
    say('listNote', 'Сохраняю порядок...');
    try { await saveList('Изменён порядок проектов'); say('listNote', 'Порядок сохранён.'); }
    catch (e) { say('listNote', explain(e), true); await loadList().catch(() => {}); }
  }

  async function remove(item) {
    if (!confirm('Удалить проект «' + item.title + '»?')) return;
    say('listNote', 'Удаляю...');
    try {
      list = list.filter(x => x.id !== item.id);
      await saveList('Удалён проект: ' + item.title);
      if (item.image) await dropFile(item.image);
      draw();
      say('listNote', 'Проект удалён. Сайт обновится через минуту-две.');
    } catch (e) { say('listNote', explain(e), true); await loadList().catch(() => {}); }
  }

  function resetForm() {
    $('form').reset();
    editId = null; photo = null;
    $('formTitle').textContent = 'Новый проект';
    $('submit').textContent = 'Опубликовать';
    $('cancel').hidden = true;
    $('preview').hidden = true;
  }

  function edit(item) {
    editId = item.id; photo = null;
    $('formTitle').textContent = 'Изменить проект';
    $('submit').textContent = 'Сохранить';
    $('cancel').hidden = false;
    $('fTitle').value = item.title || '';
    $('fKindRu').value = item.kindRu || '';
    $('fKindEn').value = item.kindEn || '';
    $('fTextRu').value = item.textRu || '';
    $('fTextEn').value = item.textEn || '';
    $('fUrl').value = item.url || '';
    $('fPhoto').value = '';
    $('preview').src = item.image;
    $('preview').hidden = false;
    $('form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  $('fPhoto').addEventListener('change', async () => {
    const f = $('fPhoto').files[0];
    if (!f) { photo = null; return; }
    try {
      photo = await packImage(f);
      $('preview').src = photo.preview;
      $('preview').hidden = false;
      say('formNote', '');
    } catch (e) { photo = null; say('formNote', e.message, true); }
  });

  $('cancel').addEventListener('click', () => { resetForm(); say('formNote', ''); });

  $('form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const url = $('fUrl').value.trim();
    if (!/^https?:\/\//i.test(url)) return say('formNote', 'Ссылка должна начинаться с https://', true);
    const old = editId ? list.find(x => x.id === editId) : null;
    if (!old && !photo) return say('formNote', 'Добавьте картинку проекта.', true);
    const btn = $('submit');
    btn.disabled = true;
    say('formNote', 'Публикую, это займёт несколько секунд...');
    try {
      const id = old ? old.id : 'p' + Date.now().toString(36);
      let image = old ? old.image : '';
      let oldImage = '';
      if (photo) {
        const path = 'img/projects/' + id + Date.now().toString(36) + '.jpg';
        await putFile(path, photo.b64, 'Картинка проекта: ' + $('fTitle').value.trim());
        oldImage = image;
        image = path;
      }
      const item = {
        id,
        title: $('fTitle').value.trim(),
        kindRu: $('fKindRu').value.trim(),
        kindEn: $('fKindEn').value.trim(),
        textRu: $('fTextRu').value.trim(),
        textEn: $('fTextEn').value.trim(),
        url,
        image
      };
      if (old) list = list.map(x => x.id === id ? item : x); else list.push(item);
      await saveList((old ? 'Изменён проект: ' : 'Добавлен проект: ') + item.title);
      if (oldImage) await dropFile(oldImage);
      resetForm();
      draw();
      say('formNote', 'Готово. На сайте проект появится через минуту-две.');
    } catch (e) {
      say('formNote', explain(e), true);
      await loadList().catch(() => {});
    }
    btn.disabled = false;
  });

  $('loginForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    const c = { owner: $('owner').value.trim(), repo: $('repo').value.trim(), token: $('token').value.trim() };
    say('loginNote', 'Проверяю...');
    try { await enter(c, $('remember').checked); say('loginNote', ''); $('token').value = ''; }
    catch (e) { cfg = null; say('loginNote', explain(e), true); }
  });

  $('logout').addEventListener('click', () => { wipe(); cfg = null; list = []; show(false); });

  const host = location.hostname;
  if (host.endsWith('.github.io')) {
    $('owner').value = host.split('.')[0];
    const first = location.pathname.split('/')[1];
    if (first && !first.endsWith('.html')) $('repo').value = first;
  }
  const saved = readSaved();
  if (saved && saved.token) {
    $('owner').value = saved.owner; $('repo').value = saved.repo;
    enter(saved, !!localStorage.getItem(KEY)).catch(e => { say('loginNote', explain(e), true); });
  }
})();

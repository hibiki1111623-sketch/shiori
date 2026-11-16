import { DEFAULT, appearance, applyAppearance, isbn13, normalize } from './theme.mjs';
import { ndlUrl, parseEditions } from './paper.mjs';

const $ = (query, node = document) => node.querySelector(query);
const onPages = Boolean($('meta[name="shiori-pages"]'));
const asset = path => new URL(path, import.meta.url);
const storageKey = key => onPages ? asset('.').pathname + key : key;
const main = $('#main');
const modal = $('#dialog');
const STATUS = ['読みたい', '読書中', '読了'];
const palette = ['#354f40', '#783c2e', '#334b65', '#685138', '#62496b', '#305e61'];
let config = stored('shiori-theme', { theme: DEFAULT, version: 0, loansEnabled: false });
let shelf = stored('shiori-shelf', []);
let nearby = null;
let tab = '';
let mode = 'digital';
let filter = -1;
let keyword = '';
let submitted = false;
let activeReader = null;
let renderId = 0;
let catalogPromise;
let toastToken;

function stored(key, fallback) {
  try { return JSON.parse(localStorage.getItem(storageKey(key)) ?? 'null') ?? fallback; }
  catch { return fallback; }
}
function remember(key, value) {
  try { localStorage.setItem(storageKey(key), JSON.stringify(value)); return true; }
  catch { return false; }
}
function el(tag, text, cls) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}
function button(text, action, cls = 'outline') {
  const b = el('button', text, 'button ' + cls);
  b.type = 'button';
  b.onclick = action;
  return b;
}
function link(text, href, cls = '') {
  const a = el('a', text, cls);
  a.href = href;
  if (href.startsWith('https:')) { a.target = '_blank'; a.rel = 'noopener'; }
  return a;
}
function toast(message) {
  const area = $('#toast');
  area.textContent = message;
  area.hidden = false;
  clearTimeout(toastToken);
  toastToken = setTimeout(() => { area.hidden = true; }, 3500);
}
function state(host, title, description = '') {
  host.replaceChildren();
  const card = el('div', undefined, 'empty');
  card.append(el('strong', title));
  if (description) card.append(el('p', description, 'muted'));
  host.append(card);
}
function api(path, params = {}) {
  return fetch(path + '?' + new URLSearchParams(params), { cache: 'no-cache' }).then(response => {
    if (!response.ok) throw new Error('Request failed');
    return response.json();
  });
}
async function searchPaper(query, author = '') {
  if (!onPages) return api('/api/paper', { q: query, author });
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(ndlUrl(query, author), { signal: controller.signal, credentials: 'omit' });
    if (!response.ok) throw new Error('NDL search failed');
    return parseEditions(await response.text(), query);
  } finally {
    clearTimeout(deadline);
  }
}
function catalog() {
  catalogPromise ??= fetch(asset('./aozora.tsv')).then(response => {
    if (!response.ok) throw new Error('Catalog unavailable');
    return response.text();
  }).then(text => text.trimEnd().split('\n').map(row => {
    const [id, title, author, subtitle, card, text, reading, style] = row.replace(/\r$/, '').split('\t');
    return { id, title, author, subtitle, card, text, style, key: normalize([title, author, subtitle, reading].join(' ')) };
  })).catch(error => { catalogPromise = undefined; throw error; });
  return catalogPromise;
}
function heading(title, description) {
  const head = el('div', undefined, 'page-head');
  const words = el('div');
  words.append(el('h1', title));
  if (description) words.append(el('p', description));
  head.append(words);
  main.append(head);
  return head;
}
function controls(labels, active, change) {
  const group = el('div', undefined, 'segment');
  labels.forEach((label, index) => {
    const b = button(label, () => change(index), '');
    b.setAttribute('aria-pressed', String(index === active));
    group.append(b);
  });
  return group;
}
function recordFor(book) { return shelf.find(row => row.book.id === book.id); }

function showBook(host, book, note, action) {
  const card = el('button', undefined, 'result');
  card.type = 'button';
  card.onclick = action || (() => detail(book));
  const cover = el('span', book.title.slice(0, 15), 'cover');
  cover.setAttribute('aria-hidden', 'true');
  const hash = [...book.title].reduce((sum, character) => sum + character.codePointAt(0), 0);
  cover.style.backgroundColor = palette[hash % palette.length];
  const content = el('span');
  content.append(el('strong', book.title));
  const metadata = [book.author, book.publisher, book.year].filter(Boolean).join('  ·  ');
  if (metadata) content.append(el('small', metadata));
  if (note) content.append(el('small', note, 'record'));
  card.append(cover, content);
  host.append(card);
}

function cleanBook(book) {
  const str = (field, n) => typeof book[field] === 'string' ? book[field].slice(0, n) : '';
  const digital = /^\d{6}$/.test(str('id', 100));
  const fieldLink = (field, prefix) => str(field, 500).startsWith(prefix) ? str(field, 500) : '';
  return {
    id: str('id', 100), title: str('title', 180), author: str('author', 120), subtitle: str('subtitle', 180),
    style: str('style', 40), publisher: str('publisher', 120), year: str('year', 16),
    isbn: isbn13(str('isbn', 24)), card: fieldLink('card', digital ? 'https://www.aozora.gr.jp/cards/' : 'https://ndlsearch.ndl.go.jp/books/'),
    text: digital ? fieldLink('text', 'https://www.aozora.gr.jp/cards/') : ''
  };
}
function updateShelf(records) {
  if (!remember('shiori-shelf', records)) { toast('保存領域を確認してください。'); return false; }
  shelf = records;
  return true;
}
function closeModal() { if (modal.open) modal.close(); }
function showModal(title) {
  modal.replaceChildren();
  const top = el('div', undefined, 'dialog-top');
  const text = el('h2', title);
  text.id = 'dialog-title';
  top.append(text, button('閉じる', closeModal));
  modal.append(top);
  if (!modal.open) modal.showModal();
}
function detail(book) {
  showModal(book.title);
  for (const text of [book.author, book.publisher, book.year, book.subtitle, book.style, book.isbn && 'ISBN ' + book.isbn]) {
    if (text) modal.append(el('p', text, 'muted'));
  }
  const record = recordFor(book);
  if (record) modal.append(el('p', [STATUS[record.status], record.progress].filter(Boolean).join('  ·  '), 'notice'));
  const actions = el('div', undefined, 'dialog-actions');
  if (book.text) actions.append(button('青空文庫で読む', () => {
    closeModal();
    go('read:' + book.id);
  }, 'primary'));
  if (book.card) actions.append(link('原本情報 ↗', book.card, 'button outline'));
  actions.append(button(record ? '読書記録を編集' : '本棚に登録', () => edit(book), book.text ? 'outline' : 'primary'));
  actions.append(button('この本を近くで探す', () => { nearby = book; closeModal(); go('nearby'); }));
  if (record) actions.append(button('本棚から削除', () => {
    if (confirm('本棚から「' + book.title + '」を削除しますか？') && updateShelf(shelf.filter(row => row.book.id !== book.id))) {
      closeModal();
      if (tab === 'shelf') showShelf();
      toast('本棚から削除しました。');
    }
  }));
  modal.append(actions);
}
function field(label, input) {
  const group = el('label', label, 'field');
  group.append(input);
  return group;
}
function input(value, max, placeholder) {
  const field = el('input');
  field.value = value;
  field.maxLength = max;
  field.placeholder = placeholder;
  return field;
}
function edit(book) {
  const record = book && recordFor(book);
  const manual = !book || book.id.startsWith('manual:');
  showModal(book ? '読書記録を編集' : '本を手入力で登録');
  const form = el('form');
  const title = input(book?.title || '', 150, '例　こころ');
  title.required = true;
  const author = input(book?.author || '', 100, '例　夏目漱石');
  const isbn = input(book?.isbn || '', 24, 'ISBN-10 または ISBN-13');
  if (manual) form.append(field('作品名', title), field('著者名', author), field('ISBN（任意）', isbn));
  else form.append(el('p', book.title, 'muted'));
  const status = el('select');
  STATUS.forEach((label, index) => {
    const option = el('option', label);
    option.value = index;
    status.append(option);
  });
  status.value = record?.status ?? 1;
  const progress = input(record?.progress ?? '', 120, '例　120ページ、第3章');
  form.append(field('状態', status), field('どこまで読んだか', progress));
  const actions = el('div', undefined, 'dialog-actions');
  const save = el('button', '保存', 'button primary');
  save.type = 'submit';
  actions.append(button('キャンセル', closeModal), save);
  form.append(actions);
  title.oninput = () => title.setCustomValidity('');
  isbn.oninput = () => isbn.setCustomValidity('');
  form.onsubmit = event => {
    event.preventDefault();
    const normalized = isbn13(isbn.value);
    if (manual && isbn.value.trim() && !normalized) {
      isbn.setCustomValidity('ISBNを確認してください。');
      isbn.reportValidity();
      return;
    }
    if (manual && !title.value.trim()) {
      title.setCustomValidity('作品名を入力してください。');
      title.reportValidity();
      return;
    }
    const id = book?.id ?? 'manual:' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    const updated = cleanBook(manual ? { id, title: title.value.trim(), author: author.value.trim(), isbn: normalized } : book);
    const row = { book: updated, status: Number(status.value), progress: progress.value.trim(), updated: Date.now() };
    if (!updateShelf([row, ...shelf.filter(item => item.book.id !== id)])) return;
    closeModal();
    if (tab === 'shelf') { filter = -1; showShelf(); }
    toast('読書記録を保存しました。');
  };
  modal.append(form);
}
function downloadShelf() {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'shiori-shelf-1', records: shelf }, null, 2)], { type:'application/json' }));
  const a = el('a');
  a.href = url;
  a.download = 'shiori-bookshelf.json';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function importShelf() {
  showModal('本棚を読み込む');
  modal.append(el('p', '同じ本の記録がある場合は、更新日時の新しい方を使います。'));
  const picker = el('input');
  picker.type = 'file';
  picker.accept = 'application/json,.json';
  modal.append(field('しおりの本棚ファイル', picker));
  picker.onchange = async () => {
    try {
      const file = picker.files[0];
      if (!file || file.size > 3_000_000) throw new Error('File too large');
      const imported = JSON.parse(await file.text());
      if (imported.format !== 'shiori-shelf-1' || !Array.isArray(imported.records)) throw new Error('Invalid format');
      const merged = new Map(shelf.map(row => [row.book.id, row]));
      for (const incoming of imported.records) {
        const book = cleanBook(incoming.book);
        const status = incoming.status;
        if (!book.title || !/^(\d{6}|isbn:97[89]\d{10}|manual:[a-z0-9-]+)$/.test(book.id)
          || !Number.isInteger(status) || status < 0 || status > 2) continue;
        const updated = Number.isFinite(incoming.updated) ? incoming.updated : 0;
        if (!merged.has(book.id) || merged.get(book.id).updated < updated) {
          merged.set(book.id, { book, status, updated, progress: typeof incoming.progress === 'string' ? incoming.progress.slice(0, 120) : '' });
        }
      }
      if (!updateShelf([...merged.values()].sort((a,b) => b.updated - a.updated))) return;
      closeModal();
      showShelf();
      toast('本棚を読み込みました。');
    } catch { toast('しおりから書き出したJSONを選んでください。'); }
  };
}
function showShelf() {
  main.replaceChildren();
  const head = heading('本棚', '読んだ本と、これから読む本。');
  head.append(button('＋ 手入力で登録', () => edit(null), 'primary'));
  const stats = el('div', undefined, 'stats');
  [shelf.length, shelf.filter(row => row.status === 1).length, shelf.filter(row => row.status === 2).length]
    .forEach((count, index) => {
      const item = el('div', undefined, 'panel stat');
      item.append(el('strong', count), el('span', ['登録', '読書中', '読了'][index]));
      stats.append(item);
    });
  main.append(stats, controls(['すべて', ...STATUS], filter + 1, value => { filter = value - 1; showShelf(); }));
  const grid = el('div', undefined, 'grid');
  const records = shelf.filter(row => filter < 0 || row.status === filter);
  records.forEach(({ book, status, progress }) => showBook(grid, book, [STATUS[status], progress].filter(Boolean).join('  ·  ')));
  if (records.length) main.append(grid);
  else {
    const empty = el('div');
    state(empty, shelf.length ? 'この状態の本はありません' : '本棚は空です', '検索結果や手入力から登録できます。');
    main.append(empty);
  }
  const actions = el('div', undefined, 'button-row site-source');
  actions.append(button('本棚を書き出す', downloadShelf), button('本棚を読み込む', importShelf));
  main.append(actions);
}

function drawHero() {
  const slot = $('#hero-slot');
  if (!slot) return;
  slot.replaceChildren();
  const theme = config.theme;
  const mast = el('div', undefined, 'mast');
  mast.append(el('span', theme.name, 'mast-title'), link('本棚を見る →', '#shelf', 'muted'));
  slot.append(mast);
  const hero = el('section', undefined, 'hero' + (theme.hero ? '' : ' no-photo'));
  const words = el('div', undefined, 'hero-text');
  if (theme.subtitle) words.append(el('h1', theme.subtitle));
  words.append(el('p', '青空文庫と紙の本を探して、読んだ続きを残す。'));
  hero.append(words);
  if (theme.hero) {
    const image = el('img', undefined, 'hero-photo');
    image.src = asset('./hero.jpg');
    image.alt = '';
    image.fetchPriority = 'high';
    hero.append(image);
  }
  slot.append(hero);
  if (theme.note) slot.append(el('p', theme.note, 'notice'));
}
function showSearch() {
  main.replaceChildren();
  const hero = el('div');
  hero.id = 'hero-slot';
  main.append(hero);
  drawHero();
  const panel = el('section', undefined, 'panel search-panel');
  const selector = controls(['青空文庫', '紙の本'], Number(mode === 'paper'), index => {
    keyword = text.value;
    mode = index ? 'paper' : 'digital';
    submitted = false;
    showSearch();
  });
  const form = el('form', undefined, 'search-form');
  const label = mode === 'paper' ? '作品名またはISBN' : '作品名・著者名';
  const text = input(keyword, 150, label);
  text.type = 'search';
  text.setAttribute('aria-label', label);
  const search = el('button', '検索', 'button primary');
  form.append(text, search);
  form.onsubmit = event => {
    event.preventDefault();
    keyword = text.value.trim();
    submitted = Boolean(keyword);
    showSearchResults();
  };
  panel.append(selector, form);
  const results = el('div');
  results.id = 'search-output';
  results.setAttribute('aria-live', 'polite');
  main.append(panel, results);
  showSearchResults();
}
async function showSearchResults() {
  const host = $('#search-output');
  if (!host) return;
  const id = ++renderId;
  const currentMode = mode;
  const term = submitted ? keyword : '';
  const valid = () => host.isConnected && id === renderId;
  if (!term && currentMode === 'paper') {
    state(host, '紙の本を探す', 'ISBNや出版社で版を見分けられます。');
    return;
  }
  if (!host.childNodes.length || term) state(host, '検索しています…');
  try {
    const library = currentMode === 'digital' ? await catalog() : [];
    let list;
    if (!term) {
      const byId = new Map(library.map(book => [book.id, book]));
      list = config.theme.picks.map(id => byId.get(id)).filter(Boolean);
    } else if (currentMode === 'digital') {
      const parts = term.normalize('NFKC').split(/\s+/).map(normalize);
      const rank = book => normalize(book.title) === normalize(term) ? 0 : normalize(book.title).startsWith(normalize(term)) ? 1 : 2;
      list = library.filter(book => parts.every(part => book.key.includes(part))).sort((a,b) => rank(a) - rank(b)).slice(0, 60);
    } else {
      list = await searchPaper(term);
    }
    if (!valid()) return;
    host.replaceChildren();
    const section = el('div', undefined, 'section-head');
    section.append(el('h2', term ? '検索結果' : '青空文庫から選ぶ'),
      el('small', term ? list.length.toLocaleString('ja-JP') + '件' : library.length.toLocaleString('ja-JP') + '作品を収録'));
    host.append(section);
    if (!list.length) {
      const empty = el('div');
      state(empty, term ? '該当する作品が見つかりませんでした' : 'おすすめ作品はありません', term ? '検索語を短くしてお試しください。' : '');
      host.append(empty);
    } else {
      const grid = el('div', undefined, 'grid');
      for (const book of list) showBook(grid, book, book.isbn ? 'ISBN ' + book.isbn : term ? book.style : '');
      host.append(grid);
    }
    if (currentMode === 'paper') host.append(link('出典　国立国会図書館サーチ ↗', 'https://ndlsearch.ndl.go.jp/', 'site-source'));
  } catch {
    if (valid()) {
      state(host, '検索結果を取得できませんでした', '通信状況を確認して、もう一度お試しください。');
      if (currentMode === 'paper') {
        const alternate = el('div', undefined, 'button-row');
        alternate.append(link('国立国会図書館サーチで検索 ↗',
          'https://ndlsearch.ndl.go.jp/search?keyword=' + encodeURIComponent(term), 'button outline'));
        const isbn = isbn13(term);
        if (isbn) alternate.append(button('このISBNで在庫・貸出を探す', () => {
          nearby = { id: 'isbn:' + isbn, isbn, title: 'ISBN ' + isbn };
          go('nearby');
        }));
        host.append(alternate);
      }
    }
  }
}

const mapLink = query => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(query);
const calilLink = book => 'https://api.calil.jp/openurl?' + new URLSearchParams(book.isbn
  ? { 'rft.isbn': book.isbn } : { 'rft.btitle': book.title, 'rft.au': book.author || '' });
function showNearby() {
  main.replaceChildren();
  heading('近くで探す', '書店の在庫と図書館の貸出を調べる。');
  if (!nearby) {
    const box = el('div');
    state(box, '探したい本を選んでください', '作品の詳細にある「この本を近くで探す」から選べます。');
    main.append(box, link('作品を探す', '#search', 'button primary'), ' ', link('本棚を開く', '#shelf', 'button outline'));
    return;
  }
  const book = nearby;
  showBook(main, book, book.isbn ? 'ISBN ' + book.isbn : '');
  const columns = el('div', undefined, 'nearby-sections');
  const editionList = el('div');
  if (!book.isbn) {
    const choose = button('紙の本の版を選ぶ', async () => {
      choose.disabled = true;
      state(editionList, '紙の本を検索しています…');
      try {
        const author = (book.author || '').split('、')[0];
        let choices = await searchPaper(book.title, author);
        if (!choices.length && author) choices = await searchPaper(book.title);
        editionList.replaceChildren();
        if (!choices.length) state(editionList, '該当する版が見つかりませんでした', '紙の本の検索で、収録されている文庫名やISBNを試してください。');
        else {
          const grid = el('div', undefined, 'grid');
          for (const edition of choices) showBook(grid, edition, 'ISBN ' + edition.isbn, () => { nearby = edition; showNearby(); });
          editionList.append(grid);
        }
      } catch { state(editionList, '紙の本を取得できませんでした'); }
      finally { choose.disabled = false; }
    });
    choose.style.margin = '12px 0';
    main.append(choose, editionList);
  }
  const location = stored('shiori-area', { pref: '', city: '' });
  const area = el('div', undefined, 'panel');
  const pref = input(location.pref, 24, '例　東京都');
  const city = input(location.city, 36, '例　新宿区');
  const fields = el('div', undefined, 'fields-two');
  fields.append(field('都道府県', pref), field('市区町村', city));
  area.style.marginTop = '14px';
  area.append(el('h2', '検索エリア'), fields);
  for (const value of [pref, city]) value.onchange = () => remember('shiori-area', { pref: pref.value, city: city.value });
  main.append(area);
  const store = el('section', undefined, 'panel');
  const library = el('section', undefined, 'panel');
  store.append(el('h2', '書店'), el('p', '紀伊國屋書店の公式ページで、店舗の在庫や取り置きを確認できます。'));
  library.append(el('h2', '図書館'), el('p', 'カーリルで所蔵と貸出を確認できます。'));
  const makeMap = label => {
    const a = link('地図で探す ↗', mapLink('近くの' + label), 'button outline');
    a.onclick = () => { a.href = mapLink((pref.value.trim() + city.value.trim() || '近くの') + ' ' + label); };
    return a;
  };
  const storeActions = el('div', undefined, 'button-row');
  storeActions.append(makeMap('書店'), link('紀伊國屋の在庫を確認 ↗', book.isbn
    ? 'https://www.kinokuniya.co.jp/f/dsg-01-' + book.isbn : 'https://store.kinokuniya.co.jp/user-guide/stock/', 'button outline'));
  const libActions = el('div', undefined, 'button-row');
  libActions.append(makeMap('図書館'), link('カーリルで確認 ↗', calilLink(book), 'button outline'));
  store.append(storeActions);
  library.append(libActions);
  const loanArea = el('div');
  const check = el('div', undefined, 'button-row');
  check.dataset.loans = '';
  check.hidden = !config.loansEnabled || !book.isbn;
  const byName = button('入力エリアの貸出状況', () => {
    if (!pref.value.trim()) { pref.focus(); toast('都道府県を入力してください。'); return; }
    checkLoans(loanArea, { isbn: book.isbn, pref: pref.value.trim(), city: city.value.trim() });
  }, 'primary');
  check.append(byName);
  if (isSecureContext && navigator.geolocation) check.append(button('現在地から確認', () => {
    if (!confirm('概略位置をカーリルの貸出検索に使いますか？')) return;
    state(loanArea, '現在地を取得しています…');
    navigator.geolocation.getCurrentPosition(({ coords }) => checkLoans(loanArea, {
      isbn: book.isbn, lat: coords.latitude.toFixed(3), lon: coords.longitude.toFixed(3)
    }), () => state(loanArea, '現在地を取得できませんでした', '検索エリアを入力して確認できます。'), { timeout: 11000 });
  }));
  library.append(check, loanArea);
  columns.append(store, library);
  main.append(columns);
}
async function checkLoans(host, options) {
  const token = String(Math.random());
  host.dataset.request = token;
  state(host, '貸出状況を取得しています…');
  try {
    const results = await api('/api/loans', options);
    if (host.dataset.request !== token) return;
    host.replaceChildren();
    if (!results.length) state(host, '対象の図書館が見つかりませんでした');
    for (const branch of results) {
      const line = el('div', undefined, 'fallback');
      line.append(link(branch.name, branch.link), el('p', [branch.status, branch.distance != null ? branch.distance + ' km' : ''].filter(Boolean).join('  ·  ')));
      if (branch.address) line.append(el('small', branch.address));
      host.append(line);
    }
  } catch {
    if (host.dataset.request === token) state(host, '貸出状況を取得できませんでした', '通信や管理画面のAPIキー設定を確認してください。');
  }
}

function trustedReading(node) {
  const fragment = document.createDocumentFragment();
  const safe = new Set(['BR', 'P', 'DIV', 'H2', 'H3', 'H4', 'RUBY', 'RB', 'RT', 'RP', 'EM', 'STRONG', 'I', 'B', 'SUB', 'SUP']);
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) fragment.append(document.createTextNode(child.textContent));
    else if (child.nodeType === Node.ELEMENT_NODE) {
      if (['SCRIPT', 'STYLE', 'META', 'LINK', 'IFRAME', 'OBJECT'].includes(child.tagName)) continue;
      if (child.tagName === 'IMG' && child.getAttribute('alt')) {
        fragment.append(document.createTextNode(child.getAttribute('alt')));
        continue;
      }
      const content = trustedReading(child);
      if (safe.has(child.tagName)) {
        const tag = el(child.tagName.toLowerCase());
        tag.append(content);
        fragment.append(tag);
      } else fragment.append(content);
    }
  }
  return fragment;
}
function saveReading() {
  if (activeReader?.ready) remember('shiori-reader:' + activeReader.id, window.scrollY);
}
async function showReader(id) {
  const stateId = ++renderId;
  main.classList.add('reader');
  state(main, '本文を読み込んでいます…');
  try {
    const book = (await catalog()).find(book => book.id === id);
    if (!book?.text) throw new Error('Missing title');
    if (stateId !== renderId) return;
    main.replaceChildren();
    const header = heading(book.title, book.author);
    header.prepend(button('‹ 戻る', () => go(lastTab)));
    header.append(button('読書記録', () => edit(book), 'primary'));
    if (onPages) {
      const frame = el('iframe', undefined, 'reading-frame');
      frame.title = book.title + 'の本文（青空文庫）';
      frame.setAttribute('sandbox', '');
      frame.referrerPolicy = 'no-referrer';
      frame.src = book.text;
      main.append(link('青空文庫の公式ページを開く ↗', book.text, 'button outline'), frame);
      return;
    }
    const panel = el('article', undefined, 'panel read-body');
    state(panel, '本文を読み込んでいます…');
    main.append(panel, link('青空文庫で開く ↗', book.text, 'button outline'));
    try {
      const result = await api('/api/read', { id });
      if (stateId !== renderId || !panel.isConnected) return;
      const documentText = new DOMParser().parseFromString(result.html, 'text/html');
      const reading = documentText.querySelector('.main_text');
      if (!reading) throw new Error('Missing body');
      panel.replaceChildren(trustedReading(reading));
      const restore = stored('shiori-reader:' + id, 0);
      activeReader = { id, ready: true };
      requestAnimationFrame(() => { if (stateId === renderId) window.scrollTo(0, restore); });
    } catch { if (panel.isConnected) state(panel, '本文を取得できませんでした', '「青空文庫で開く」から公式ページを確認できます。'); }
  } catch {
    if (stateId === renderId) state(main, '作品を読み込めませんでした');
  }
}
let lastTab = 'search';
function go(to) {
  if (location.hash === '#' + to) render();
  else location.hash = to;
}
function render() {
  saveReading();
  activeReader = null;
  closeModal();
  renderId++;
  main.classList.remove('reader');
  const hash = location.hash.slice(1);
  if (/^read:\d{6}$/.test(hash)) tab = 'read';
  else {
    tab = ['search','shelf','nearby'].includes(hash) ? hash : 'search';
    lastTab = tab;
  }
  for (const nav of document.querySelectorAll('[data-tab]')) {
    if (nav.dataset.tab === tab) nav.setAttribute('aria-current', 'page');
    else nav.removeAttribute('aria-current');
  }
  window.scrollTo(0,0);
  if (tab === 'shelf') showShelf();
  else if (tab === 'nearby') showNearby();
  else if (tab === 'read') showReader(hash.slice(5));
  else showSearch();
}
function setTheme() {
  applyAppearance(document.documentElement, config.theme);
  $('#brand').textContent = config.theme.name;
  $('meta[name="theme-color"]').content = config.theme.accent;
  document.title = config.theme.name;
  if (tab === 'search') {
    drawHero();
    if (!submitted && mode === 'digital') showSearchResults();
  }
  const loans = $('[data-loans]');
  if (loans) loans.hidden = !config.loansEnabled || !nearby?.isbn;
}
async function refreshTheme() {
  try {
    const current = onPages
      ? await fetch(asset('./pages-theme.json'), { cache: 'no-cache' }).then(response => {
        if (!response.ok) throw new Error('Theme unavailable');
        return response.json();
      })
      : await api('/api/theme');
    if (current.version === config.version && JSON.stringify(current.theme) === JSON.stringify(config.theme)
        && current.loansEnabled === config.loansEnabled) return;
    config = { ...current, theme: appearance(current.theme) };
    remember('shiori-theme', config);
    setTheme();
  } catch {}
}
window.addEventListener('hashchange', render);
window.addEventListener('pagehide', saveReading);
$('.skip').onclick = event => { event.preventDefault(); main.focus(); };
document.addEventListener('visibilitychange', () => {
  if (document.hidden) saveReading();
  else refreshTheme();
});
setTheme();
render();
refreshTheme();
setInterval(() => { if (!document.hidden) refreshTheme(); }, 15000);
if (isSecureContext && 'serviceWorker' in navigator) navigator.serviceWorker.register(asset('./sw.js')).catch(() => {});

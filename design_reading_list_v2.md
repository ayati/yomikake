# 読みかけリスト v2 詳細設計書（実装用）

対象: `yomikake.html` のみ（`yomikake_ios.html` は本体安定後に移植判断）
機能: グリッド表示（案A改）・ソート・検索・絞り込みチップ・読了表示トグル

## 0. 確定済みの設計判断

- グリッドカードは**案A改**（縦型・表紙上・タイトル4行クランプ・著者1行・バー+%・日付）
- **デフォルト view は 'list'**（メディアクエリによる初期値分岐はしない。グリッドは明示的に選ぶ機能）
- ソート既定は「最近開いた順」。タイトル/著者ソートは記号プレフィックス読み飛ばし正規化キーを使用
- 章数表記（第n章/全m章）はグリッドでは非表示、ツールチップに退避
- カード DOM はリスト/グリッドで**単一テンプレート**。コンテナの `view-grid` クラスと CSS だけで組み替える
- 読了本は収集段階で除外せず `finished` フラグ付与 → フィルタ段階で `showFinished` に従い除外
- 検索クエリは永続化しない。view/sort/チップ2種は `epub_rl_prefs` に永続化

## 1. 状態管理

### 1-1. モジュール変数（`_editMode` 宣言の近く、~L2638 付近に追加）

```js
let _rlPrefs = _rlLoadPrefs();   // {view, sort, filterReady, showFinished}
let _rlQuery = '';               // 検索文字列（非永続）
let _rlSearchTimer = null;       // デバウンス用
```

### 1-2. 永続化（localStorage キー `epub_rl_prefs`）

```js
const _RL_SORTS = ['recent', 'title', 'author', 'progressHigh', 'progressLow'];

function _rlLoadPrefs() {
  const def = { view: 'list', sort: 'recent', filterReady: false, showFinished: false };
  try {
    const p = JSON.parse(localStorage.getItem('epub_rl_prefs'));
    if (!p) return def;
    return {
      view: p.view === 'grid' ? 'grid' : 'list',
      sort: _RL_SORTS.includes(p.sort) ? p.sort : 'recent',
      filterReady: !!p.filterReady,
      showFinished: !!p.showFinished,
    };
  } catch (e) { return def; }
}

function _rlSavePrefs() {
  try { localStorage.setItem('epub_rl_prefs', JSON.stringify(_rlPrefs)); } catch (e) {}
}
```

不正値はすべて既定値へフォールバック（ホワイトリスト方式）。

## 2. DOM 変更

### 2-1. HTML（`#reading-list-header` の直後、L706 `</div>` と L707 `#reading-list-items` の間に挿入）

```html
<div id="reading-list-tools">
  <input id="rl-search" type="search" autocomplete="off"
         data-i18n-placeholder="readingList.searchPlaceholder"
         placeholder="タイトル・著者で絞り込み">
  <div id="rl-tools-row">
    <div id="rl-sort-wrap">
      <button id="rl-sort-btn" onclick="toggleRlSortMenu(event)"></button>
      <div id="rl-sort-menu">
        <button data-sort="recent"       onclick="setRlSort('recent')"></button>
        <button data-sort="title"        onclick="setRlSort('title')"></button>
        <button data-sort="author"       onclick="setRlSort('author')"></button>
        <button data-sort="progressHigh" onclick="setRlSort('progressHigh')"></button>
        <button data-sort="progressLow"  onclick="setRlSort('progressLow')"></button>
      </div>
    </div>
    <button id="rl-chip-ready"    class="rl-chip" onclick="toggleRlFilter('filterReady')"
            data-i18n="readingList.filterReady">⚡ すぐ開ける</button>
    <button id="rl-chip-finished" class="rl-chip" onclick="toggleRlFilter('showFinished')"
            data-i18n="readingList.showFinished">✓ 読了も表示</button>
    <div id="rl-view-toggle">
      <button id="rl-view-list" onclick="setRlView('list')" data-i18n-title="readingList.viewList">≡</button>
      <button id="rl-view-grid" onclick="setRlView('grid')" data-i18n-title="readingList.viewGrid">⊞</button>
    </div>
  </div>
</div>
```

- ソートメニューの項目ラベルは `_rlSyncToolsUI()` が `t('readingList.sort.' + data-sort)` で流し込む
  （`data-i18n` だと `applyI18n()` 側へのキー登録が要るため JS 側で設定する方が局所的）。
- ツール行は `#reading-list` 内なので、所蔵 0 件で `#reading-list` 非表示のときは自動的に隠れる。

### 2-2. カードテンプレート変更（`_rlRender` 内、現行 L4579-4598 ベース）

現行テンプレートとの差分：

1. `.rl-card` に以下を追加：
   - `title="${esc(tooltip)}"` … `tooltip = title + '\n' + creator + '\n' + 第n章/全m章`
     （`\n` は `&#10;` として esc 後に連結。ブラウザ標準ツールチップで改行表示される）
   - `onclick="rlCardActivate(this)"` / `data-key` / `role="button"` / `tabindex="0"` /
     `onkeydown="if(event.key==='Enter')rlCardActivate(this)"`
     ※ list 表示時はカード click を CSS の `pointer-events` ではなく **JS ガード**で無効化
       （`rlCardActivate` 冒頭で `if (_rlPrefs.view !== 'grid' || _editMode) return;`）
2. `.rl-thumb` 内にバッジ2種を追加（グリッド時のみ CSS で表示）：
   ```html
   <div class="rl-thumb">${thumbHtml}
     ${isCached ? '<span class="rl-thumb-offline">✈</span>' : ''}
     ${isDirect ? '<span class="rl-thumb-direct">▶</span>' : ''}
   </div>
   ```
   `isCached = _cachedKeys.has(key)`、`isDirect = _handleKeys.has(key) || isCached`
3. 読了カード（`item.finished`）：
   - `.rl-card` に `rl-finished` クラス追加
   - `.rl-pct` の代わりに `<span class="rl-finished-badge">${t('readingList.finishedBadge')}</span>`
   - バーは `width:100%`

```js
function rlCardActivate(el) {
  if (_rlPrefs.view !== 'grid' || _editMode) return;
  openFilePickerForBook(el.dataset.key);
}
```

## 3. CSS（読みかけリストブロック L183-220 の直後に追記）

```css
/* ── 読みかけリスト v2: ツール行 ── */
#reading-list-tools { display:flex; flex-direction:column; gap:8px; margin-bottom:14px; }
#rl-search { width:100%; font-size:13px; padding:8px 12px; border:1px solid var(--ui-border);
             border-radius:10px; background:var(--ui-bg); color:var(--ui-text); outline:none; }
#rl-search:focus { border-color:var(--accent); }
#rl-tools-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
#rl-sort-wrap { position:relative; }
#rl-sort-btn, .rl-chip { font-size:12px; font-weight:600; padding:5px 10px; border-radius:8px;
  border:1px solid var(--ui-border); background:var(--ui-bg); color:var(--ui-text);
  cursor:pointer; transition:all .15s; white-space:nowrap; }
#rl-sort-btn:hover, .rl-chip:hover { border-color:var(--accent); color:var(--accent); }
.rl-chip.active { background:var(--accent); border-color:var(--accent); color:#fff; }
#rl-sort-menu { display:none; position:absolute; top:calc(100% + 4px); left:0; z-index:60;
  min-width:160px; background:var(--backdrop); backdrop-filter:blur(16px);
  -webkit-backdrop-filter:blur(16px); border:1px solid var(--glass-border);
  border-radius:12px; box-shadow:0 8px 24px var(--shadow); padding:6px; flex-direction:column; }
#rl-sort-menu.show { display:flex; }
#rl-sort-menu button { font-size:13px; text-align:left; padding:8px 12px; border:none;
  background:transparent; color:var(--ui-text); border-radius:8px; cursor:pointer; }
#rl-sort-menu button:hover { background:var(--hover-bg); }
#rl-sort-menu button.checked::before { content:'✓ '; color:var(--accent); font-weight:700; }
#rl-view-toggle { margin-left:auto; display:flex; border:1px solid var(--ui-border);
  border-radius:8px; overflow:hidden; }
#rl-view-toggle button { font-size:14px; padding:4px 11px; border:none; background:transparent;
  color:var(--ui-text); opacity:.55; cursor:pointer; }
#rl-view-toggle button.active { background:var(--accent); color:#fff; opacity:1; }

/* ── 読みかけリスト v2: グリッド表示（案A改）── */
#reading-list.view-grid { max-width:1080px; }
#reading-list-items.view-grid { display:grid;
  grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); gap:16px 14px; }
.view-grid .rl-card { flex-direction:column; gap:8px; padding:10px; min-height:0; cursor:pointer; }
.view-grid .rl-thumb { width:100%; height:auto; aspect-ratio:5/7; align-self:stretch; position:relative; }
.view-grid .rl-title { font-size:12.5px; -webkit-line-clamp:4; line-height:1.45; }
.view-grid .rl-creator { font-size:11px; }
.view-grid .rl-chapter, .view-grid .rl-open-btn, .view-grid .rl-offline { display:none; }
.view-grid .rl-meta { margin-top:0; }
.view-grid .rl-card.rl-last::before { content:none; }
.view-grid .rl-card.rl-last { border-color:var(--accent); box-shadow:0 0 0 1px var(--accent); }
/* 表紙バッジ（グリッド時のみ表示） */
.rl-thumb-offline, .rl-thumb-direct { display:none; }
.view-grid .rl-thumb-offline { display:flex; position:absolute; top:5px; left:5px;
  font-size:10px; padding:2px 6px; border-radius:8px; background:rgba(0,0,0,.55); color:#fff; }
.view-grid .rl-thumb-direct { display:flex; position:absolute; bottom:5px; right:5px;
  width:24px; height:24px; border-radius:50%; background:var(--accent); color:#fff;
  font-size:11px; align-items:center; justify-content:center; box-shadow:0 1px 4px var(--shadow); }
/* 読了カード */
.rl-card.rl-finished .rl-thumb { opacity:.75; }
.rl-finished-badge { font-size:12px; font-weight:700; color:var(--accent); white-space:nowrap; }
/* 0件メッセージ */
#rl-no-match { text-align:center; padding:32px 0 8px; font-size:13px; opacity:.65;
  display:flex; flex-direction:column; gap:14px; align-items:center; }
#rl-no-match button { font-size:13px; font-weight:600; color:var(--accent); background:transparent;
  border:1.5px solid var(--accent); border-radius:9px; padding:6px 14px; cursor:pointer; }
```

メモ:
- 列数は `auto-fill + minmax(150px,1fr)` 任せ。PC(1080px)≈6列、スマホ縦(375px)=2列、横=3〜4列
- `aspect-ratio:5/7` + 既存 `.rl-thumb img { object-fit:cover }` で表紙比率を統一
- 既存 `#reading-list.edit-mode .rl-open-btn` のグレーアウトはリスト用にそのまま残す

## 4. JS 設計

### 4-1. 関数一覧（読みかけリストセクション L4497〜 に追加・改修）

| 関数 | 種別 | 役割 |
|---|---|---|
| `_rlLoadPrefs()` / `_rlSavePrefs()` | 新規 | §1-2 |
| `_rlCollect()` | 新規（分割） | localStorage 走査 → items[]。読了も含め `finished` フラグ付与 |
| `_rlSortKey(title)` | 新規 | 記号プレフィックス読み飛ばし正規化 |
| `_rlNorm(s)` | 新規 | 検索用正規化（NFKC・小文字・カナ→かな） |
| `_rlFilterSort(items)` | 新規（分割） | 検索 → チップ → ソート適用。`{shown, total}` を返す |
| `_rlRender(shown, total, universeCount)` | 新規（分割） | innerHTML 生成・件数表示・0件表示 |
| `_rlSyncToolsUI()` | 新規 | ソートボタンラベル・メニュー✓・チップ active・viewトグル active を同期 |
| `buildReadingList()` | 改修 | オーケストレータ（collect→filter→render→syncUI） |
| `setRlView(v)` / `setRlSort(s)` / `toggleRlFilter(name)` | 新規 | prefs 更新 → 保存 → 再レンダー |
| `toggleRlSortMenu(ev)` | 新規 | メニュー開閉。document click で外側クリック時閉じる |
| `rlCardActivate(el)` | 新規 | グリッド時のカード起動（§2-2） |
| `markAsFinished()` ほか | 無変更 | — |

### 4-2. `_rlCollect()` — 現行 L4514-4535 の走査部を移設

変更点は1つだけ：読了除外 `continue`（L4527）を削除し、

```js
const finished = (val.spineIdx >= spineCount - 1 && (val.ratio || 0) > 0.9);
items.push({ key, title, spineCount, finished, ... });  // 他フィールドは現行どおり
```

### 4-3. ソートキー正規化

```js
function _rlSortKey(title) {
  let s = String(title).replace(/^[﻿\s_]+/, '');
  let prev;
  do {
    prev = s;
    // 中身20文字以内の閉じ括弧ペアを除去（【書籍化】[著者名]（web版）等）。
    // 20文字制限は、タイトル自体が括弧で始まる作品を括弧ごと削らないための保険
    s = s.replace(/^[【\[（(][^】\]）)]{0,20}[】\]）)]\s*/, '');
    s = s.replace(/^[﻿\s_]+/, '');
  } while (s !== prev && s.length > 0);
  s = s.replace(/^[「『]/, '');     // かぎ括弧は開きだけ除去（中身はタイトル本体）
  return s || String(title);        // 全部削れたら原文（安全弁）
}

const _rlCollator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' });
```

### 4-4. 検索正規化

```js
function _rlNorm(s) {
  return String(s).normalize('NFKC').toLowerCase()
    .replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}
```

- マッチ対象: `_rlNorm(item.title + ' ' + item.creator)`
- クエリは `_rlNorm` 後に空白（半角/全角）で分割し **AND 部分一致**

### 4-5. `_rlFilterSort(items)`

適用順とソート仕様：

```js
function _rlFilterSort(items) {
  let arr = _rlPrefs.showFinished ? items : items.filter(it => !it.finished);
  const total = arr.length;                               // 件数表示の分母
  if (_rlPrefs.filterReady)
    arr = arr.filter(it => _handleKeys.has(it.key) || _cachedKeys.has(it.key));
  const terms = _rlNorm(_rlQuery).split(/[\s　]+/).filter(Boolean);
  if (terms.length)
    arr = arr.filter(it => { const hay = _rlNorm(it.title + ' ' + it.creator);
                             return terms.every(t => hay.includes(t)); });
  const pct = it => (it.spineIdx + it.ratio) / it.spineCount;
  const byRecent = (a, b) => {            // 現行ロジック（null 末尾）
    if (!a.lastOpenedAt && !b.lastOpenedAt) return 0;
    if (!a.lastOpenedAt) return 1;
    if (!b.lastOpenedAt) return -1;
    return new Date(b.lastOpenedAt) - new Date(a.lastOpenedAt);
  };
  const cmp = {
    recent: byRecent,
    title:  (a, b) => _rlCollator.compare(_rlSortKey(a.title), _rlSortKey(b.title)),
    author: (a, b) => {
      if (!a.creator && !b.creator) return _rlCollator.compare(_rlSortKey(a.title), _rlSortKey(b.title));
      if (!a.creator) return 1;            // 著者なしは末尾
      if (!b.creator) return -1;
      return _rlCollator.compare(a.creator, b.creator)
          || _rlCollator.compare(_rlSortKey(a.title), _rlSortKey(b.title));
    },
    progressHigh: (a, b) => pct(b) - pct(a) || byRecent(a, b),
    progressLow:  (a, b) => pct(a) - pct(b) || byRecent(a, b),
  }[_rlPrefs.sort] || byRecent;
  arr.sort(cmp);
  return { shown: arr, total };
}
```

### 4-6. `buildReadingList()`（オーケストレータ）

```js
function buildReadingList() {
  const items = _rlCollect();
  const listEl = document.getElementById('reading-list');
  const dropEl = document.getElementById('drop-zone');
  const welcomeEl = document.getElementById('welcome');
  if (!items.length) {                     // 所蔵ゼロ（読了含め何もない）→ 現行どおりドロップゾーン
    _editMode = false;
    listEl.style.display = 'none'; listEl.classList.remove('edit-mode');
    dropEl.style.display = ''; welcomeEl.classList.remove('has-list');
    return;
  }
  listEl.style.display = 'flex';
  listEl.classList.toggle('edit-mode', _editMode);
  listEl.classList.toggle('view-grid', _rlPrefs.view === 'grid');
  document.getElementById('reading-list-items')
          .classList.toggle('view-grid', _rlPrefs.view === 'grid');
  dropEl.style.display = 'none';
  welcomeEl.classList.add('has-list');
  const { shown, total } = _rlFilterSort(items);
  _rlRender(shown, total);
  _rlSyncToolsUI();
  // 編集/完了ボタンのラベル更新は現行コードを _rlSyncToolsUI に集約
}
```

**挙動変更（意図的）**: 全冊読了で未読了 0 件の場合、現行はドロップゾーンに戻るが、
v2 では所蔵がある限りリスト UI を出し「該当する本がありません」を表示する
（「✓読了も表示」チップで読了本に到達できるようにするため）。

### 4-7. `_rlRender(shown, total)`

- 現行 L4571-4599 のテンプレート生成を §2-2 の差分込みで移設
- 件数表示：`shown.length === total` なら現行 `readingList.count`、
  異なれば `readingList.countFiltered`（`{total}冊中 {n}冊`）
- `shown` が 0 件のとき：
  ```html
  <div id="rl-no-match">
    <span>該当する本がありません</span>
    <button onclick="clearRlFilters()">絞り込みを解除</button>
  </div>
  ```
  ```js
  function clearRlFilters() {
    _rlQuery = ''; document.getElementById('rl-search').value = '';
    _rlPrefs.filterReady = false;
    // 検索・チップ解除後もまだ0件（=全冊読了）なら読了表示を自動でON
    const stillEmpty = !_rlFilterSort(_rlCollect()).shown.length;
    if (stillEmpty) _rlPrefs.showFinished = true;
    _rlSavePrefs(); buildReadingList();
  }
  ```

### 4-8. `_rlSyncToolsUI()`

```js
function _rlSyncToolsUI() {
  document.getElementById('rl-sort-btn').textContent =
    t('readingList.sortLabel', { mode: t('readingList.sort.' + _rlPrefs.sort) }) + ' ▾';
  document.querySelectorAll('#rl-sort-menu button').forEach(b => {
    b.textContent = t('readingList.sort.' + b.dataset.sort);
    b.classList.toggle('checked', b.dataset.sort === _rlPrefs.sort);
  });
  document.getElementById('rl-chip-ready').classList.toggle('active', _rlPrefs.filterReady);
  document.getElementById('rl-chip-finished').classList.toggle('active', _rlPrefs.showFinished);
  document.getElementById('rl-view-list').classList.toggle('active', _rlPrefs.view === 'list');
  document.getElementById('rl-view-grid').classList.toggle('active', _rlPrefs.view === 'grid');
  // 編集・完了ボタン（現行 L4565-4568 から移設）
}
```

### 4-9. イベント結線（初期化部、`#search-input` の listener 結線 L5509 付近に追加）

```js
document.getElementById('rl-search').addEventListener('input', e => {
  clearTimeout(_rlSearchTimer);
  _rlSearchTimer = setTimeout(() => { _rlQuery = e.target.value; buildReadingList(); }, 120);
});
// ソートメニューの外側クリックで閉じる
document.addEventListener('click', e => {
  const menu = document.getElementById('rl-sort-menu');
  if (menu && menu.classList.contains('show') && !e.target.closest('#rl-sort-wrap'))
    menu.classList.remove('show');
});
```

- 検索 input はグローバル keydown ガード（L3622 `tagName === 'INPUT'` で return）済みのため追加対応不要
- `buildReadingList()` はツール行を再生成しない（items の innerHTML だけ差し替え）ので、
  **検索ボックスのフォーカス・IME 状態は再レンダーで失われない**

### 4-10. setter 群

```js
function setRlView(v)  { _rlPrefs.view = v; _rlSavePrefs(); buildReadingList(); }
function setRlSort(s)  { _rlPrefs.sort = s; _rlSavePrefs();
                         document.getElementById('rl-sort-menu').classList.remove('show');
                         buildReadingList(); }
function toggleRlFilter(name) { _rlPrefs[name] = !_rlPrefs[name]; _rlSavePrefs(); buildReadingList(); }
function toggleRlSortMenu(ev) { ev.stopPropagation();
                                document.getElementById('rl-sort-menu').classList.toggle('show'); }
```

## 5. i18n 追加キー（4ブロック全部に追加）

| キー | ja (L984付近) | en (L1153付近) | zh-TW (L1322付近) | zh-CN (L1351ブロック内) |
|---|---|---|---|---|
| `readingList.searchPlaceholder` | タイトル・著者で絞り込み | Filter by title or author | 依書名或作者篩選 | 按书名或作者筛选 |
| `readingList.sortLabel` | 並べ替え: {mode} | Sort: {mode} | 排序：{mode} | 排序：{mode} |
| `readingList.sort.recent` | 最近開いた順 | Recently opened | 最近開啟 | 最近打开 |
| `readingList.sort.title` | タイトル順 | Title | 書名 | 书名 |
| `readingList.sort.author` | 著者順 | Author | 作者 | 作者 |
| `readingList.sort.progressHigh` | 進捗率が高い順 | Most progress | 進度高至低 | 进度高至低 |
| `readingList.sort.progressLow` | 進捗率が低い順 | Least progress | 進度低至高 | 进度低至高 |
| `readingList.filterReady` | ⚡ すぐ開ける | ⚡ Ready to open | ⚡ 可立即開啟 | ⚡ 可立即打开 |
| `readingList.showFinished` | ✓ 読了も表示 | ✓ Show finished | ✓ 顯示已讀完 | ✓ 显示已读完 |
| `readingList.finishedBadge` | ✓ 読了 | ✓ Finished | ✓ 讀完 | ✓ 读完 |
| `readingList.countFiltered` | {total}冊中 {n}冊 | {n} of {total} | {total}本中{n}本 | {total}本中{n}本 |
| `readingList.noMatch` | 該当する本がありません | No matching books | 沒有符合的書 | 没有符合的书 |
| `readingList.clearFilter` | 絞り込みを解除 | Clear filters | 清除篩選 | 清除筛选 |
| `readingList.viewList` | リスト表示 | List view | 清單檢視 | 列表视图 |
| `readingList.viewGrid` | グリッド表示 | Grid view | 網格檢視 | 网格视图 |

placeholder は既存の `data-i18n-placeholder` 機構、viewList/viewGrid は `data-i18n-title` 機構を使用。

## 6. 実装フェーズと各フェーズの確認

| Phase | 内容 | 確認方法 |
|---|---|---|
| 1 | `buildReadingList` 3分割＋`_rlPrefs` 導入（UI 追加なし・挙動不変） | リスト表示・編集削除・読了除外・rl-last 帯が現状と同一 |
| 2 | ツール行 HTML/CSS＋ソート＋検索（list 表示のまま） | 5ソート切替、`【連載中】VTuber…` と `VTuber…` が隣接、`web` で `ｗｅｂ版` ヒット、IME入力中にフォーカス維持 |
| 3 | グリッド CSS＋view 切替＋カードタップ＋バッジ＋ツールチップ | PC≈6列/スマホ2列、タイトル4行、編集モードで×表示・タップ無効、リロード後 view 維持 |
| 4 | チップ2種＋読了カード表現＋0件表示＋countFiltered | 読了トグルで100%カード出現・再オープン可、全フィルタ0件→解除ボタン動作 |

各 Phase 完了時に必ず：ブラウザで `yomikake.html` を開き 8 テーマ × list/grid を目視、
DevTools で `localStorage.epub_rl_prefs` の保存値確認。

## 7. 最終テストチェックリスト

- [ ] 所蔵0件 → ドロップゾーン表示（現行同等）
- [ ] 全冊読了＋showFinished=off → noMatch＋解除ボタン → 自動で読了表示ON
- [ ] 検索：AND（「結界師 筧」）、カナ/かな同一視、全角英数同一視、クリア(×)で全件復帰
- [ ] ソート：タイトル順でプレフィックス付き作品が本体名の位置に並ぶ／著者なしが末尾／`numeric:true` で巻数順
- [ ] グリッド：カードタップで開く（直接 or ファイル選択）、Enter キーでも開く、rl-last が accent 枠
- [ ] 編集モード：list/grid 両方で × 削除可、grid でカードタップ無効
- [ ] オフラインバッジ：list=テキスト「✈ オフラインOK」、grid=表紙左上ピル
- [ ] 言語切替（ja/en/zh-TW/zh-CN）でツール行・バッジ・0件表示が追従
- [ ] スマホ実機（縦/横）でグリッド列数・チップ折り返し確認
- [ ] 読書 → 本を閉じる → リスト復帰時に view/sort/チップ状態が維持されている

---

## v2.1 仕様変更（2026-06-12 テストフィードバック反映・実装済み）

1. **2列保証**: グリッドの最小列幅を `minmax(min(150px, calc(50% - 7px)), 1fr)` に変更。
   実効ビューポートが狭い端末（表示拡大設定等）でも必ず2列以上になる
   （280〜412px で2列、PC 6列を Playwright で確認）。
2. **表紙解像度**: 保存サムネイルを 48×68 q0.65 → **160×224 q0.72** に変更
   （`imageSmoothingQuality='high'`）。28000文字（≒21KB）超過時は q0.55 → q0.4 と
   段階的に再エンコードする適応方式。novel_downloader 表紙の実測 約4.5KB。
   既存の低解像度表紙は、その本を次に開いたとき自動的に置き換わる。
3. **quota 安全弁**: `saveBookMeta` / `savePos` が QuotaExceeded 時に表紙を捨てて
   読書位置・メタデータの保存を優先するフォールバックを追加
   （localStorage 満杯状態で ratio 保存成功を Playwright で確認）。

## iOS 版への移植（2026-06-12 実装済み）

`yomikake_ios.html` に v2 + v2.1 を全件移植。iOS 固有の差分：

- File System Access API 非対応のため `_handleKeys` が存在しない。
  「すぐ開ける」判定・▶バッジは `_cachedKeys`（IDB キャッシュ）のみで判定
- 開くボタンのラベル/クラスは iOS 既存の `readingList.openCached` / `rl-cached` を維持
- `.rl-meta` は iOS 既存構造（`.rl-meta-left` ラッパーなし・`.rl-offline` テキストバッジなし）を維持。
  グリッドの ✈/▶ バッジはキャッシュ済み時に両方表示（本体でキャッシュ済みの場合と同じ見え方）
- 改行コードは LF（本体は CRLF）。CRLF 正規化は不要
- `imageSmoothingQuality='high'` は Safari では無視されるが無害（既定の縮小品質で動作）

## レビュー後修正（2026-06-12・両ファイル適用済み）

- 削除ボタンの inline onclick 文字列組み立て（`confirmDeleteBook('${esc(key)}','${esc(title)}')`）を廃止。
  `confirmDeleteBook(this.closest('.rl-card').dataset.key)` でキーのみ渡し、タイトルは `parseBookKey` で復元、
  モーダル→`doDeleteBook()` 間は `_rlPendingDeleteKey` モジュール変数で受け渡す方式に変更。
  `esc()` が `'` を escape しないため「'」入りタイトルで削除が壊れる機能バグと、
  タイトル経由の JS 文字列脱出（XSS）パターンを同時に解消。
  「Don't Stop "Me" Now」での削除・キャンセルフローを両ファイルで Playwright 検証済み。

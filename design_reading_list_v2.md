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

---

# v3 設計: 読了タイトルの完全削除（2段階削除モデル）

対象: yomikake.html / yomikake_ios.html 両方。バージョン: v1.11.0 予定。

## 0. 仕様サマリ

| 対象カード | × ボタンの動作 | ダイアログ | データ |
|---|---|---|---|
| 未読了（通常リスト） | 論理削除＝読了扱い（現行通り） | 現行の削除確認 | 保持・「✓読了も表示」で復活可 |
| 読了（✓読了も表示 ON 時） | **物理削除（purge）** | **完全削除の強い確認** | `removeItem`・復活不可 |

現行の「読了カードの × が実質 no-op」問題もこれで解消される。

## 1. 状態とモード判定

### 1-1. モジュール変数（`_rlPendingDeleteKey` の隣に追加・両ファイル）

```js
let _rlPendingDeleteMode = null;  // 'hide'（論理削除）| 'purge'（完全削除）
```

### 1-2. 読了判定は confirmDeleteBook 内でエントリから再計算

カード DOM やレンダリング結果に依存せず、`_rlCollect()` と同一条件で判定する
（編集モード中に他タブでデータが変わっても安全）：

```js
const parsed = parseBookKey(bookKey);
let finished = false;
try {
  const val = JSON.parse(localStorage.getItem(bookKey)) || {};
  const spineCount = (typeof val.spineCount === 'number' && val.spineCount > 0)
    ? val.spineCount : (parsed ? parsed.spineCount : null);
  if (spineCount > 0)
    finished = (val.spineIdx || 0) >= spineCount - 1 && (val.ratio || 0) > 0.9;
} catch (e) {}
```

注意: 「✓読了も表示」OFF のとき読了カードはそもそも描画されないため、
「未読了カードなのに purge ダイアログが出る」逆転は起こらない。判定が
finished=true になるのは読了カード経由のクリックだけ。

## 2. confirmDeleteBook の変更（両ファイル同一）

```js
function confirmDeleteBook(bookKey) {
  // …§1-2 の finished 判定…
  const title = parsed ? parsed.title : bookKey;
  _rlPendingDeleteKey = bookKey;
  _rlPendingDeleteMode = finished ? 'purge' : 'hide';
  const isPurge = finished;
  document.getElementById('modal-title').textContent =
    t(isPurge ? 'readingList.purgeTitle' : 'readingList.deleteTitle');
  document.getElementById('modal-close').style.display = 'none';
  document.getElementById('modal-body').innerHTML = isPurge
    ? `<p>${t('readingList.purgeMsg', {title: esc(title)})}</p>
       <p>${t('readingList.purgeDetail')}</p>
       <p style="font-size:12px;opacity:.65;">${t('readingList.purgeNote')}</p>
       <div style="（現行と同じ flex 行）">
         <button onclick="closeModal(true)" style="（現行キャンセルと同一）">${t('readingList.deleteCancel')}</button>
         <button onclick="doDeleteBook()" style="（現行赤ボタンと同一）">${t('readingList.purgeOk')}</button>
       </div>`
    : `（現行の deleteMsg ブロックをそのまま）`;
  document.getElementById('modal-overlay').classList.add('show');
}
```

- キャンセルボタンは現行と同じく左側・既定スタイル。purge 実行ボタンのみ
  ラベルを「完全に削除する」に変える（赤 #e53e3e は現行流用）。
- キャンセル時に `_rlPendingDeleteMode` が残るが、`doDeleteBook` 冒頭で
  必ず両方クリアするため実害なし（次回 confirmDeleteBook で上書きされる）。

## 3. doDeleteBook の変更（両ファイル同一）

```js
function doDeleteBook() {
  const bookKey = _rlPendingDeleteKey;
  const mode = _rlPendingDeleteMode;
  _rlPendingDeleteKey = null;
  _rlPendingDeleteMode = null;
  closeModal(true);
  if (!bookKey) return;
  if (mode === 'purge') _rlPurgeBook(bookKey);
  else markAsFinished(bookKey);
  // IDB の ePub キャッシュ破棄は両モード共通（現行コードのまま）
  if (_cachedKeys.has(bookKey)) {
    _idbDelete(bookKey).catch(() => {});
    _cachedKeys.delete(bookKey);
    updateCacheGroupUI();
  }
  buildReadingList();
}
```

## 4. _rlPurgeBook（新規）

### yomikake.html（PC: FSA ハンドルも破棄）

```js
// 読書記録の完全削除。localStorage エントリ・FSAハンドル・epub_last_book を消す。
// IDB ePub キャッシュは呼び出し元 doDeleteBook の共通処理で破棄される。
function _rlPurgeBook(bookKey) {
  try { localStorage.removeItem(bookKey); } catch (e) {}
  fshDelete(bookKey).then(() => _handleKeys.delete(bookKey)).catch(() => {});
  try {
    const lb = JSON.parse(localStorage.getItem('epub_last_book'));
    if (lb && lb.bookKey === bookKey) localStorage.removeItem('epub_last_book');
  } catch (e) {}
}
```

### yomikake_ios.html（FSA 非対応なので fshDelete 行なし）

```js
function _rlPurgeBook(bookKey) {
  try { localStorage.removeItem(bookKey); } catch (e) {}
  try {
    const lb = JSON.parse(localStorage.getItem('epub_last_book'));
    if (lb && lb.bookKey === bookKey) localStorage.removeItem('epub_last_book');
  } catch (e) {}
}
```

`epub_last_book` も消す理由: タイトル文字列を含む（プライバシー）、かつ起動時の
レジュームバナー（showResumeBanner）が削除済みの本を指し続けるのを防ぐ。
ランタイム参照は起動時のみなので実行中の削除は安全（確認済み）。

## 5. i18n 追加キー（4言語 × 両ファイル）

| キー | ja | en | zh-TW | zh-CN |
|---|---|---|---|---|
| `readingList.purgeTitle` | 読書記録の完全削除 | Permanently delete record | 完全刪除閱讀記錄 | 完全删除阅读记录 |
| `readingList.purgeMsg` | 「{title}」の読書記録を完全に削除しますか？ | Permanently delete the reading record for "{title}"? | 要完全刪除「{title}」的閱讀記錄嗎？ | 要完全删除「{title}」的阅读记录吗？ |
| `readingList.purgeDetail` | 読書位置・表紙・読了の記録がこの端末から消去されます。元に戻すことはできず、再度 ePub ファイルを開くまでリストに復活しません。 | Reading position, cover, and finished status will be erased from this device. This cannot be undone; the book will not reappear until you open its ePub file again. | 閱讀位置、封面與讀完記錄將從此裝置刪除，無法復原；重新開啟 ePub 檔案前不會再出現在清單中。 | 阅读位置、封面与读完记录将从此设备删除，无法恢复；重新打开 ePub 文件前不会再出现在列表中。 |
| `readingList.purgeNote` | ※ エクスポート済みのしおりファイルや Google Drive 上のコピーには削除は及びません。完全に消すには削除後に Drive へ上書き保存してください。 | Note: exported bookmark files and copies on Google Drive are not affected. To erase those too, re-save to Drive after deleting. | ※ 已匯出的書籤檔與 Google Drive 上的副本不受影響。如需一併清除，請在刪除後重新儲存到 Drive。 | ※ 已导出的书签文件与 Google Drive 上的副本不受影响。如需一并清除，请在删除后重新保存到 Drive。 |
| `readingList.purgeOk` | 完全に削除する | Delete permanently | 完全刪除 | 完全删除 |

挿入位置: 各言語ブロックの `readingList.viewGrid` の直後（v2 キー群の末尾）。
iOS にも Drive しおり同期があるため purgeNote の文言は両ファイル共通で良い。

## 6. ドキュメント更新

- **README.md「リストから削除」節**: 2段階削除の説明に書き換え。
  「未読了の本の × → リストから外れる（読了扱い・復活可）」
  「✓読了も表示 ON で読了の本の × → 完全削除（強い確認ダイアログ・復活不可）」
  ＋ エクスポート/Drive コピーに削除が及ばない注意。
- **CLAUDE.md v2 セクション**: 完読済み判定段落の「既知挙動」記述を更新
  （『削除』した本も読了表示に現れる → そこから完全削除できる、に変わる）。
  `_rlPurgeBook` / `_rlPendingDeleteMode` をインラインハンドラ規約の段落に追記。

## 7. エッジケース

1. **全カード purge で所蔵ゼロ** → `buildReadingList` の既存分岐でドロップゾーンへ
   （編集モードフラグも既存コードがリセット）
2. **purge 後に古いしおり JSON をインポート / Drive ダウンロード** → 記録復活
   （仕様。purgeNote で開示済み）
3. **レガシー旧形式キー**（`epub_pos_title_N`）→ `parseBookKey` が spineCount を
   返すので判定・削除とも動作
4. **エントリが壊れて JSON.parse 失敗** → finished=false → hide 側にフォールバック
   （安全側: 完全削除はしない）
5. **consolidateBookmarks との干渉なし**（フラグ起動時のみ・キー消滅は単に対象外）
6. **編集モード中のチップ切替**: 編集モードのまま「✓読了も表示」を ON/OFF しても
   `buildReadingList` が edit-mode クラスを維持するため一貫動作（現行と同じ）

## 8. テスト計画（Playwright・両ファイル）

1. 未読了カード ×: 従来文言・confirm 後に finished 化（**回帰: 挙動不変**）
2. ✓読了も表示 ON → 読了カード ×: purge 文言（タイトル・詳細・注記・赤ボタン
   「完全に削除する」）を textContent で検証
3. confirm → `localStorage.getItem(key) === null`・カード消滅・
   `epub_last_book` も該当時は消滅
4. キャンセル → キー残存・`_rlPendingDeleteMode` クリア（次の未読了×が hide で動く）
5. 読了1冊だけを purge → 残り未読了のみ表示継続／全冊 purge → ドロップゾーン
6. 「'」入りタイトルの読了本で purge フロー（v2 修正の回帰）
7. ページエラーゼロ

## 9. 実装手順

1. 両ファイル: モジュール変数追加 → `confirmDeleteBook` 差し替え →
   `doDeleteBook` 差し替え → `_rlPurgeBook` 追加（iOS は fshDelete 行なし）
2. i18n 5キー × 4言語 × 2ファイル
3. 構文チェック（node --check）・CRLF 正規化（yomikake.html のみ）
4. Playwright テスト（§8）
5. README / CLAUDE.md 更新 → コミット「読了タイトルの完全削除（2段階削除）を追加 (v1.11.0)」

---

# v3.1 設計: 削除墓標（tombstone）— 完全削除の端末間伝播（実装済み）

問題: Drive 読込/インポートは和集合マージのため、他端末の localStorage に残った
完全削除済みエントリが次のアップロードで Drive に再混入し、削除が「復活」して見える。

解決: 完全削除時に「キーのハッシュ＋削除時刻」だけの墓標を `epub_purged` に記録し、
エクスポート/Drive 保存の `purged` フィールドに同梱。読込/インポート側で適用する。

## データ・定数

- `epub_purged` = `[{h: "16進16桁", t: ISO8601}]`
- `h` = `_rlHashKey(bookKey)`（FNV-1a 32bit × seed違い2本。**タイトルを残さない**）
- 上限 `_PURGED_MAX=200` 件・保持 `_PURGED_TTL=365日`（`_rlSavePurged` が剪定）

## 関数（Bookmark Export/Import セクション冒頭・両ファイル）

- `_rlHashKey` / `_rlLoadPurged` / `_rlSavePurged` / `_rlAddTombstone`
- `_rlPurgeLocalData(key)` — しおり・FSAハンドル(PC版のみ)・IDBキャッシュ・
  epub_last_book を消す（墓標は触らない）。`_rlPurgeBook` = 墓標記録＋これ
- `_rlApplyTombstones(importedPurged)` — ローカル墓標と受信墓標を h ごとに新しい t で
  マージ → **墓標 > lastOpenedAt のローカルしおりを完全削除** → 剪定保存 →
  Map(h→ms) を返す
- `_rlCleanupLastBook()` — epub_last_book が実在しないキーを指していたら除去

## 組み込み箇所

| 場所 | 処理 |
|---|---|
| `collectBookmarks()` | `purged` を同梱（exportBookmarks は collectBookmarks を使う形に統一） |
| インポートリスナー / `driveDownload` | 検証直後に `_rlApplyTombstones(json.purged)` → 各しおり取込時に「墓標 t >= lastOpenedAt なら skip」→ consolidate 後に `_rlCleanupLastBook()` |
| `saveBookMeta()` | 冒頭で該当墓標を除去（**開き直し＝意図的な復活**。purge ダイアログの「再度 ePub を開くまで復活しません」と整合） |
| `readingList.purgeNote` | 「Drive 保存すると他端末にも削除が反映される」文言へ更新（4言語） |

## 不変条件・エッジ

- 取込 skip は `>=`（同時刻は削除優先）、ローカル削除は `>`（開いた事実と同時刻なら温存）
- `lastOpenedAt` 欠落エントリは epoch 扱い → 墓標が勝つ（安全側）
- 旧ビルドは `purged` を無視して動作（後方互換、削除が伝播しないだけ）
- 1年超の古いバックアップ JSON 手動インポートでは復活し得る（仕様・許容）
- 検証: 2コンテキストで端末1 purge → export → 端末2（残存+epub_last_book）へ
  実ファイル経由インポート → 残存削除・last_book掃除・再アップロードに墓標同梱・
  開き直し復活・saveBookMeta 墓標解除、を両ファイルで Playwright 確認済み

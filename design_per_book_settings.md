# 本ごとの表示設定 概要設計書（v2.16.0・B-7）

対象: `yomikake.html`・`yomikake_ios.html` **両ファイル**（行番号は `yomikake.html` 基準・v2.14.0 時点）

前提: `design_display_settings.md`（第1弾/第2弾）・`design_display_settings_v3.md`（第3弾 v2.15.0）の続き。
本項目だけ**新しい永続データ構造**を持つので独立させた。

## 1. 解きたい問題

蔵書は種類が混ざる。

| 本の種類 | 欲しい設定 |
|----------|-----------|
| 縦書きの小説 | 組方向=縦書き・明朝・文字大きめ |
| 横書きの技術書／実用書 | 組方向=横書き（または ePub 指定）・ゴシック |
| 自炊マンガ（FXL） | 見開き=自動・ズームモード=ストーリーまんが |
| 紙本スキャン（FXL） | ズームモード=縦合わせ・横スクロール |

現在これらはすべて**グローバル 1 組**なので、本を行き来するたびに設定を直すことになる。
特に FXL の「ズームモード」は本の作りに直結していて、**本ごとに決まる性質の設定**が
グローバルに置かれているのが構造的なねじれになっている。

## 2. スコープ（何を本ごとに覚えるか）

**覚える**（本の性質で決まるもの）:

| キー | 理由 |
|------|------|
| `writingMode` | 縦書き小説と横書き技術書で必ず変わる |
| `fontMode` | 小説は明朝、技術書はゴシック、が自然 |
| `fontSize` | 判型・字詰めで最適値が変わる |
| `spreadMode` | FXL の見開き可否は本ごと |
| `fxlRegionOrder` | ストーリーまんが／4コマ／縦合わせ／横合わせは**本の作りそのもの** |

**覚えない**（読者の目や環境で決まるもの・本によらない）:

`theme` `themeAuto` `themeLight` `themeDark` `brightness` `warmth` `lineHeight` `letterSpacing`
`margin` `fwdBtnSize` `tapZone` `fontBold` `fontStrokeLevel` `toolbarHidden` `fsHud` `setGroupsOpen`
`fxlZoomLevel` `fxlLtrAutoFlip` `orientationLock` `autoOpenLast` `ttsRate` `ttsVoice` `driveAutoSave`

**判断基準**: 「同じ本を別の日に開いたとき、前と同じ値であってほしいか」ではなく
**「本が変われば変わるべきか」**で線を引く。テーマや明るさは本が変わっても変わってほしくない
（むしろ変わると鬱陶しい）ので対象外。

> ⚠ この線引きは実装前に一度実機の使用感で見直す余地がある。特に `margin`（判型による）と
> `lineHeight` は「本ごと」寄りの意見もありうる。**キーを増やすのは容易だが減らすのは
> 保存済みデータの掃除が要る**ので、**最小の 5 個で始める**。

## 3. データ構造

### 3-1. 新規 localStorage キー `epub_book_prefs`

```jsonc
{
  "v": 1,
  "books": {
    "epub_pos_薬屋のひとりごと__日向夏": {
      "writingMode": "vertical",
      "fontMode": "shippori-mincho",
      "fontSize": 110,
      "t": 1769472000000          // 最終更新（剪定用）
    }
  }
}
```

- **キーは `state.bookKey`（`makeBookKey(title, creator)` = `epub_pos_{title}__{creator}`）をそのまま使う。**
  しおりと同じキーなので、削除・墓標・移行の既存ロジックと素直に対応が取れる。
- **値は「明示的に設定された項目だけ」持つ**（全項目を常に書かない）。理由は §4-3。
- `epub_pos_*` の**値の中には入れない**。しおりは Drive 同期・JSON 書き出し・墓標マージの
  対象で、そこに端末固有の表示設定を混ぜると B-8（表示設定は端末ローカルに閉じる）の判断と矛盾する。
  **別キーにすることが、同期に載せないことの構造的な保証**になる。

### 3-2. 容量と剪定

- 1 冊あたり約 100 バイト。300 冊で 30KB 程度（`localStorage` 5MB に対して無視できる）。
- それでも上限は設ける: **300 冊 / 最終更新から 730 日**で剪定（`_bpPrune()`）。
  `epub_purged`（墓標）が 200 件 / 365 日で剪定しているのと同じ考え方。
- `localStorage` 書き込みは既存同様 try/catch し、失敗したら `notifyStorageError()`。
  **本ごと設定の保存に失敗しても読書は続けられる**ので、致命扱いにしない。

### 3-3. 同期・書き出しに載せない

- `collectBookmarks()` に**含めない**。
- 表示設定のリセット（B-3）との関係は §5。
- 本の完全削除（`_rlPurgeBook()`）では該当エントリも消す（`epub_pos_*` / FSA ハンドル /
  IDB キャッシュを消しているのと同じ場所に 1 行足す）。論理削除（`markAsFinished`）では消さない
  — 読了本を開き直したときに設定が残っていてほしいため。

## 4. 動作

### 4-1. ON/OFF トグル

```js
bookPrefsEnabled: true,   // 「本ごとに表示設定を覚える」（epub_settings に永続化・既定 ON）
```

既定 ON。OFF にすると読み込みも書き込みもしなくなる（保存済みデータは消さない。
再度 ON にすれば復活する）。設定「レイアウト」グループの末尾に 1 行。

### 4-2. 読み込み（適用）タイミング

`loadEpub()` 内、**`state.bookKey` が確定した直後（`yomikake.html:3228`）から、最初の描画
（`:3273` / `:3277` の `renderPage()`）より前**に適用する。この位置なら:

- `state.renderMode`（`:3135` で確定済み）が分かっているので FXL 用キーの要否を判断できる
- 最初の描画が最初から正しい設定で走る（**開いてから設定が切り替わってチラつくのを避けられる**）

```js
state.bookKey = makeBookKey(titleText, state.bookCreator);
migrateLegacyBookmark(...);
applyBookPrefs(state.bookKey);     // ★ ここ
```

```js
function applyBookPrefs(bookKey) {
  if (!state.bookPrefsEnabled || !bookKey) return;
  const p = _bpGet(bookKey);
  if (!p) return;
  // 値域はグローバル設定と同じ検証を通す（壊れた値で描画に入らない）
  if (p.writingMode && ['vertical','horizontal','publisher'].includes(p.writingMode))
    state.writingMode = p.writingMode;
  if (typeof p.fontSize === 'number' && p.fontSize >= 60 && p.fontSize <= 400)
    state.fontSize = p.fontSize;
  if (typeof p.fontMode === 'string' && (FONTS[p.fontMode] !== undefined ||
      p.fontMode.indexOf('custom:') === 0))
    state.fontMode = p.fontMode;
  if (p.spreadMode && ['auto','single','spread'].includes(p.spreadMode))
    state.spreadMode = p.spreadMode;
  if (p.fxlRegionOrder && FXL_REGION_ORDER_KEYS.includes(p.fxlRegionOrder))
    state.fxlRegionOrder = p.fxlRegionOrder;
  syncAllSettingsUI();   // 設定パネルの表示も本の設定に合わせる
}
```

- **`fontMode` の検証は `custom:` プレフィックスも通すこと**（ローカルフォント）。
  ただしそのフォントが**別端末には無い**ので、`cfLoadMeta()` 済みの `state.customFonts` に
  実体が無ければ**採用しない**（無い書体を指定して既定にフォールバックするより、
  グローバル設定のままのほうが混乱が少ない）。
- `syncAllSettingsUI()` は第1弾で作った既存関数をそのまま使う。

### 4-3. 書き込み

**対象 5 設定の `change*()` から、グローバルと本ごとの両方に書く**（本が開いているときのみ）。

```js
function changeWritingMode(v) {
  state.writingMode = v;
  saveSettings();                        // グローバル（＝次に開く新しい本の既定）
  _bpSet('writingMode', v);              // ★ 本ごと
  rerenderKeepPos();
}
```

```js
function _bpSet(key, value) {
  if (!state.bookPrefsEnabled || !state.bookKey) return;   // 本を開いていなければ何もしない
  const all = _bpLoad();
  const e = all.books[state.bookKey] || (all.books[state.bookKey] = {});
  e[key] = value; e.t = Date.now();
  _bpSave(all);
}
```

**なぜ両方に書くのか（重要な設計判断）**

| 案 | 挙動 | 判断 |
|----|------|------|
| 本ごとにだけ書く | グローバルが初期値のまま固定され、**新しい本を開くたびに毎回設定し直す**羽目になる | ✕ |
| **両方に書く** | その本は覚える。**同時に「最後に使った設定」が新しい本の既定**になる | **○ 採用** |
| 閉じるときにスナップショット | 実装は楽だが、クラッシュ／タブ破棄で失われる | ✕ |

「値だけ持つ」のではなく **`_bpSet` が呼ばれた項目だけ記録する**のもここに効く。
一度も触っていない設定は本ごとの記録に載らないので、**グローバルの変更がそのまま効く**。
（全項目スナップショットにすると、一度開いただけの本が古い設定を丸ごと抱え込み、
グローバルを変えても反映されない「なぜか この本だけ古い」状態になる。）

### 4-4. 本を閉じたとき

`closeBook()` では**何もしない**（書き込みは都度済んでいる）。
グローバル設定は「最後に使った値」のままにする — 次に別の本を開いたときの既定として自然。

## 5. 表示設定リセット（B-3）との関係

**リセットは `epub_book_prefs` を全消しする。**

理由: 本ごとの記録が残っていると、リセット直後に本を開き直した瞬間に古い設定が復活し、
**「リセットしたのに戻らない」**という最悪の体験になる。リセットは迷子からの脱出口なので、
ここは徹底する。

- 確認ダイアログの文面（`settings.resetConfirm`）に **「本ごとに覚えた設定も消えます」**を追記する。
- しおり・キャッシュ・言語・読み上げ設定は従来どおり触らない。

## 6. UI

```html
<div class="set-row">
  <span class="set-label" data-i18n="settings.bookPrefs">本ごとに表示設定を覚える</span>
  <button id="book-prefs-toggle" onclick="toggleBookPrefs()" ...>ON</button>
</div>
<span class="set-hint" data-i18n="settings.bookPrefsHelp">
  組方向・フォント・文字サイズ・見開き・ズームモードを本ごとに記録します
</span>
```

- 場所は「レイアウト」グループの末尾。
- **どの設定が対象かをヒントに明記する**。「本ごとに覚える」とだけ書くと
  テーマや明るさまで本ごとになると誤解される（実際には対象外）。
- 読書中に本ごとの設定が効いていることを示すインジケータは**作らない**。
  第2弾の ⚙ 目印の議論と同じで、「本を開くたびに設定が変わる」ことは体験として自明であり、
  常時表示の印を足すと画面の情報量だけ増える。

## 7. エッジケース

| 状況 | 挙動 |
|------|------|
| 同じ本を別端末で開く | `epub_book_prefs` は端末ローカルなので引き継がれない（意図どおり・B-8 の方針） |
| タイトル・著者が同じ別の本 | `bookKey` が衝突する。しおりと同じ既知の制約で、**新たな問題は増やさない** |
| リフロー本に FXL 用キーが入っている | 適用しても `state.renderMode === 'reflow'` なら参照されないので無害 |
| ローカルフォント指定の本を別端末で | §4-2 のとおり、実体が無ければ採用しない |
| 本ごと設定 OFF → ON | 保存済みデータが残っているので、次に開いた本から復活する |
| `epub_book_prefs` が壊れた JSON | `_bpLoad()` が try/catch で `{v:1,books:{}}` を返す（黙って初期化） |
| 本の完全削除（purge） | 該当エントリも削除（§3-3） |

## 8. 実装順

1. `_bpLoad` / `_bpSave` / `_bpGet` / `_bpSet` / `_bpPrune`（永続層だけ・UI なし）
2. `applyBookPrefs()` と `loadEpub()` への差し込み
3. 対象 5 つの `change*()` に `_bpSet` を追加
4. トグル UI ＋ i18n
5. リセットでの全消し ＋ 確認文面の更新
6. purge との連動

## 9. テスト（`tests/cases/book-prefs.js`）

- `_bpSet` / `_bpGet` の往復、部分的な記録（触っていないキーが載らないこと）
- **合成 fixture を 2 冊使い、A で縦書き・B で横書きにして往復し、それぞれ復元されること**
  （`make-fixtures.py` に 2 冊目のリフロー本 `reflow2.epub`（タイトル・著者違い）を追加する）
- グローバルにも書かれること（＝新しい 3 冊目を開いたときに最後の値が既定になる）
- 壊れた値・値域外を弾くこと
- OFF のときは読み書きしないこと
- **リセットで `epub_book_prefs` が消えること**
- 剪定（301 冊目で最古が落ちる／730 日超が落ちる）
- `epub_bookmarks.json` の書き出しに**含まれない**こと（`collectBookmarks()` の出力を検査）

## 10. 実機で確認すること

- 縦書き小説 → 横書き技術書 → マンガ → 縦書き小説 の往復で、**開いた瞬間から**正しい設定で
  描画されること（開いてから切り替わるチラつきが無いこと）
- FXL のズームモードが本ごとに復元されること（自炊マンガと紙本スキャンの往復）
- 蔵書が多い端末での `localStorage` 使用量（設定 → 📂 ePub キャッシュの表示で確認できる）

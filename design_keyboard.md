# キーボード操作 概要設計書（v2.20.0 想定）

対象: `yomikake.html`・`yomikake_ios.html` **両ファイル**（行番号は `yomikake.html` 基準・v2.19.0 時点）

目的: PC・キーボード接続スマホ／タブレットで「一般的なリーダーなら効くはず」のキーが効くようにする。
出典は Calibre viewer / Kindle Cloud Reader / Sumatra / vim 系リーダーの共通項。

| Phase | 内容 | 規模 |
|-------|------|------|
| **K-1** | 既存キーハンドラの不具合修正 ＋ iframe からのキー転送 | 中（**土台。ここが無いと以降が「たまに効かない」**） |
| **K-2** | 読書中のキー拡充（ページ／章／パネル／文字サイズ／読み上げ） | 中 |
| **K-3** | 読みかけリストのフォーカス設計と `q` 往復 | 中〜大（**`q` の成立条件**） |
| **K-4** | ヘルプにショートカット一覧（4 言語） | 小 |

推奨実装順: **K-1 → K-3 → K-2 → K-4**
K-3 を K-2 より先に置くのは、`q`（読書中 → リスト）だけ実装してリスト側が未整備だと
**「戻れるが戻った先が使えない」という、現状より悪い状態**を一時的に作るため。

---

## K-0. 現状

`yomikake.html:5566` / `yomikake_ios.html:5851` の `document.addEventListener('keydown', …)` 1 本のみ。

```
Space / Shift+Space   ページ送り／戻り
↓ PageDown            ページ送り
↑ PageUp              ページ戻り
← →                   次章／前章（固定割り当て）
Home / End            本の先頭／末尾
f                     全画面
Escape                フォントピッカー > 設定 > サイドバー > 全画面（1 打 1 つ）
z 0 1-6 Escape        FXL ズーム（yomikake.html のみ。iOS 版は未実装）
```

未実装: `n` `p` `b` `j` `k` `q` `t` `/` `?` `s` `d` `o` `r` `[` `]` `+` `-` `Backspace` `F1` `F11`。

---

## K-1. 不具合修正と土台

### K-1-1. 修飾キーガード（**優先度最高・単独でも価値あり**）

現状 `case 'f':` は修飾キーを見ずに `preventDefault()` するため、**`Ctrl+F` / `Cmd+F` がブラウザ検索を開かず全画面トグルに化ける**。
FXL の `case 'z'` も同様に `Ctrl+Z` を食う。

`switch` の直前に置く:

```js
// 修飾キー付きはアプリのショートカットを発火させない。
// 例外は下で明示的に処理する Ctrl/Cmd+F（読書中のみ）と F11 / F1（修飾キー無し）。
if (e.altKey || ((e.ctrlKey || e.metaKey) && !_isFindKey(e))) return;
if (e.isComposing || e.keyCode === 229) return;   // 日本語入力中の誤爆防止
```

`e.isComposing` は IME 変換中の Space（確定）・矢印（候補選択）を奪わないために必須。
`keyCode === 229` は `isComposing` が立たない古い WebKit 向けの保険。

### K-1-2. Ctrl/Cmd+F を読書中だけ奪う

```js
function _isFindKey(e) { return (e.key === 'f' || e.key === 'F') && (e.ctrlKey || e.metaKey) && !e.altKey; }
```

- `state.epub` があるとき → `preventDefault()` して全文検索を開く（後述 `openSearchPane()`）
- 本を開いていないとき（読みかけリスト）→ **奪わない**。ブラウザ検索に任せる

理由: アプリの全文検索は spine 全体を舐めるのに対し、ブラウザ検索は iframe 内の**現在の章しか**当たらない。
読書中はアプリ側が明確に上位互換なので奪う価値がある。リストは普通の HTML なのでブラウザ検索のほうが素直。

### K-1-3. `←→` を書字方向に連動させる

現状は `renderMode !== 'fxl'` のとき**常に `←`＝次章**。縦書き（左＝進み側）では正しいが、**横書き本では逆**になる。
タップ帯（`tapZoneAction`）は既に `isVerticalAxis()` で反転しているのに、キーだけ固定という不整合。

```js
case 'ArrowLeft':
  if (state.renderMode !== 'fxl') { (isVerticalAxis() ? nextChapter : prevChapter)(); e.preventDefault(); }
  break;
case 'ArrowRight':
  if (state.renderMode !== 'fxl') { (isVerticalAxis() ? prevChapter : nextChapter)(); e.preventDefault(); }
  break;
```

⚠ `isVerticalAxis()` は publisher モードで `state.publisherAxis`（`EPUB_AXIS` 由来）に依存する。
軸未確定（`null`）の間は縦書き扱いにフォールバックされる既存挙動をそのまま使う — タップ帯と同じ判断なので、
**両者が同時に間違う／同時に正しい**ことが保証され、ユーザーから見た一貫性は崩れない。

方向非依存の絶対指定として **`]`＝次章 / `[`＝前章** も併せて入れる（矢印の向きに迷わない逃げ道）。

### K-1-4. `Escape` でモーダルを閉じる

`#modal-overlay` が Escape 優先度チェーンに入っていない。ヘルプ・受け渡し・削除確認は ✕ か背景クリックでしか閉じられない。

**チェーンに足すのではなく、読書データ画面と同じ「先行ガード」にする**（実装時に変更）:
モーダル表示中は Escape 以外のキーを一切通さない。チェーンの 1 段にすると、
ヘルプを開いたまま Space で裏のページが送られる既存の妙な挙動が残ってしまう。

```js
const _modalEl = document.getElementById('modal-overlay');
if (_modalEl && _modalEl.classList.contains('show')) {
  if (raw === 'Escape') { closeModal(); e.preventDefault(); }
  return;
}
```

⚠ **`preventDefault()` せずに `return` する**こと。そうすればモーダル内の Tab によるフォーカス移動と
ボタン上の Enter はブラウザ既定のまま生きる。

残る Escape チェーンは:

```
フォントピッカー > 設定 > サイドバー > 全画面 > （K-3 で）本を閉じる
```

⚠ **削除確認ダイアログでは `Enter` を効かせない**。`#modal-box` に主ボタン既定フォーカスを与えると、
`confirmDeleteBook` → 完全削除（`_rlPurgeBook`・墓標記録つき）が Enter 連打で走る。Escape で閉じられれば十分。

### K-1-5. iframe からのキー転送（**構造的な穴**）

CLAUDE.md 既知の制限:「読書エリアをクリックするとフォーカスが iframe へ移り親の keydown が届かなくなる」。
キーを増やしても**本文を一度クリックした瞬間に全部死ぬ**ので、K-1 の中で最も効果が大きい。

`buildScrollScript()` の `CLICK_HANDLER` と同じ層に、iframe 内 `keydown` を親へ中継する処理を足す:

```js
document.addEventListener('keydown', function(ev){
  if (ev.isComposing) return;
  var tg = ev.target;
  if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.isContentEditable)) return;
  window.parent.postMessage({ type:'EPUB_KEY', key:ev.key, shiftKey:!!ev.shiftKey,
    ctrlKey:!!ev.ctrlKey, metaKey:!!ev.metaKey, altKey:!!ev.altKey, repeat:!!ev.repeat }, '*');
  ev.preventDefault();   // Space による iframe 自前スクロールを止める
}, true);
```

親側は既存の `message` ハンドラに `EPUB_KEY` を追加し、**`e.source === iframe.contentWindow` 検証を通した後**、
`keydown` 本体を切り出した `handleKey(desc)` に渡す。

```
document.addEventListener('keydown', e => handleKey(e));   // ← 既存の中身を handleKey に移すだけ
// message ハンドラ内:
case 'EPUB_KEY': handleKey(Object.assign({ preventDefault(){}, target:{} }, msg)); break;
```

`handleKey` が受けるのは「`key` / `shiftKey` / … / `preventDefault()` を持つオブジェクト」という緩い契約にする。
`e.target` 判定は iframe 側で済ませているので、転送経由では空オブジェクトで通す。

⚠ **`preventDefault()` を iframe 側で無条件に呼ぶ**のは、親が処理しないキー（`Tab` など）まで殺すおそれがある。
初版は **転送対象キーをホワイトリストで絞る**（K-2 の表にあるキー ＋ 矢印 ＋ Space ＋ Page/Home/End ＋ Escape）。
リストに無いキーは転送も `preventDefault()` もしない。これで iframe 内のフォーカス移動や
ブラウザ既定（Ctrl+C など）を巻き込まない。ホワイトリストは iframe 側にインラインで焼き込む
（`var _KEYS = "| |arrowup|…|.|"` のパイプ区切り文字列を `indexOf` で引く）。

⚠ 両ファイルに入れること。`yomikake_ios.html` は iframe 内スワイプ（`touchend`）と同じ層なので構造は同じ。
`yomikake.html` は `SHARED_TAIL` に直接足せるが、iOS 版は `CLICK_HANDLER` と並ぶ
**`KEY_HANDLER` テンプレート変数**を新設し、3 つの IIFE すべてで `${CLICK_HANDLER}${KEY_HANDLER}` と展開する。

### K-1-5b. 親へのフォーカス引き取り（`reclaimKeyFocus()`）

転送だけだと **ユーザージェスチャが失われる**。`postMessage` のハンドラは user activation を
引き継がないので、`f`（`requestFullscreen()`）や `r`（iOS の初回 `speechSynthesis.speak`）が
転送経路では通らない。

そこで `EPUB_KEY` を受けた親は、`handleKey()` を呼ぶ**前に**フォーカスを自分へ引き取る:

```js
function reclaimKeyFocus() {
  const pc = document.getElementById('page-container');
  if (!pc) return;
  pc.setAttribute('tabindex', '-1');
  try { pc.focus({ preventScroll: true }); } catch(e) { pc.focus(); }
}
```

これで **転送されるのは本文クリック直後の 1 打だけ**になり、2 打目以降は親の `keydown` に
直接届く（＝ user activation 込み）。`showTapMenu()` / `showTapGuide()` が使っているのと同じ手。

⚠ **残る制限**: 本文クリック直後の 1 打に限り、`f` は Layer1（CSS の UI 退避）だけが効いて
Layer2（ブラウザ全画面 API）が無視される／iOS で `r` の初回再生が始まらないことがある。
2 打目からは正常。`requestFullscreen()` は元から `.catch(() => {})` で握り潰しているので例外は出ない。

⚠ `#page-container` に `outline:none` を当てること（programmatic focus で枠線が出ないように）。

### K-1-5c. ブラウザ／OS のダイアログ明けにもフォーカスが戻らない（実機で発覚）

**Android Chrome + File System Access** で、読みかけリストから本を開き直すと
「このサイトに ○○.epub の表示とコピーを許可しますか？」が出る（`handle.getFile()` の権限プロンプト）。
**「許可する」を押して読書画面になった直後、どのキーも効かない** — フォーカスがブラウザ UI 側に
残ったままで、ページの `keydown` が 1 つも発火しない。画面のどこかをタップすると復帰する。

`EPUB_KEY` 転送（K-1-5）では直せない。**キーが iframe にも届いていない**ので中継のしようがない。

**⚠ フォーカスの引き取りでは直らない（実機で確定・2026-08-06）。** 要素 `focus()` も `window.focus()` も
**ドキュメント内**のフォーカスしか動かせず、ブラウザ UI が持っている OS レベルのフォーカスは JS から奪えない。
`document.hasFocus()` で検知はできるが、回復手段が無い。**この方向はもう試さなくてよい。**

### 本当の対策 — プロンプトを出さない（`openFilePickerForBook()` の順序を逆にする）

`yomikake.html` の再オープン経路を **IDB Blob キャッシュ → FSA ハンドル → ピッカー**の順に変えた
（v2.19.0 までは ハンドル → キャッシュ → ピッカー）。キャッシュ経路は許可を必要としないので
**プロンプトが出ず、フォーカスも失われない**。

- `loadEpub()` は open のたびにハンドルと Blob の**両方**を保存しているので、キャッシュはほぼ常に存在する
- キャッシュ読み出しは `{noPicker:true}` で呼び、失敗時のフォールバック（ハンドル → ピッカー）は
  `openFilePickerForBook()` 側が決める。そうしないと `loadEpubFromCache()` が
  勝手にピッカーを開いてハンドル経路に落ちられない
- **代償**: ディスク上のファイルが更新されていても自動では拾わなくなる。
  新しい実体を読むときは「別の ePub を開く」で選び直す（開き直せばキャッシュも更新される）
- `yomikake_ios.html` は元から FSA が無くキャッシュのみなので変更不要。**これは正当なファイル差分**

**実機確認済み（2026-08-06）**: Android Chrome で**許可ダイアログ自体が出なくなり**、再オープン直後から
キーが効くことを確認。フォーカス回復（`reclaimKeyFocusPersistent()`）は最後まで効かなかったが、
プロンプトが消えたことで問題ごと解決した。

### 残す延命策（`loadEpub()` 末尾のフォーカス引き取り）

キャッシュが無い本ではプロンプトが依然出るし、OS のファイルピッカー明け・共有シート明けにも
フォーカスが戻らないことがある。効かない場合もあるが害は無いので残す:

`reclaimKeyFocusPersistent()` が `document.hasFocus()` を見ながら 250ms 間隔で最大 8 回粘る。

- **タップ操作ガイド／メニューが開いているときは触らない** — あちらは自前で focus を持つ
- **ユーザーが自分で何かを触ったら即やめる**（`activeElement` が body でも `#page-container` でもない）。
  この条件を外すと、粘っている間に触ったツールバーのボタンからフォーカスを奪う
- OS のファイルピッカー明け・共有シート明けにも効く（経路が `loadEpub()` に集約されているため）

### K-1-6. 入力欄判定の穴

`if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;` に
**`TEXTAREA` と `isContentEditable`** を追加。将来テキストエリアを足したときに黙って壊れるのを防ぐ。

### K-1-7. `e.repeat` の扱い

ページ送り系（Space / 矢印 / Page / `n` `p` `b` `j` `k`）は `repeat` を許可。
それ以外（`t` `s` `q` `f` `d` `r` `?` `o`）は `if (e.repeat) return;`。
長押しでサイドバーが高速トグルして点滅する事故を防ぐ。

---

## K-2. 読書中のキー拡充

### K-2-1. ページ・章移動

| 操作 | キー | 備考 |
|------|------|------|
| 次ページ | `Space` `PageDown` `↓` **`n`** **`j`** | 既存 ＋ 3 つ |
| 前ページ | `Shift+Space` `PageUp` `↑` **`p`** **`b`** **`k`** **`Backspace`** | 既存 ＋ 4 つ |
| 次章 | 進み側矢印（K-1-3）**`]`** | |
| 前章 | 戻り側矢印（K-1-3）**`[`** | |
| 本の先頭／末尾 | `Home` / `End` | 既存 |
| リストへ戻る | **`q`** / `Escape`（チェーン最後） | K-3 |

- 大文字小文字を問わない（`e.key.toLowerCase()` で正規化）。CapsLock 状態で死なないため
- **`Backspace` は `preventDefault()` 必須**。古いブラウザでは履歴 back に化ける
- **FXL でも `n` / `p` / `b` / `j` / `k` を効かせる**。現状 Space は効くのに文字キーだけ無いのは説明できない。
  `scrollPage(±1)` は FXL ズーム中に `advanceFxlZoomStep` へ分岐する既存経路なので、そこに委譲すれば自動的に整合する

### K-2-2. パネル・画面

| 操作 | キー | 実装 |
|------|------|------|
| 目次サイドバー | **`t`** | `switchSidebarTab('toc')` ＋ 開いてなければ `toggleSidebar()` |
| 全文検索 | **`/`** `Ctrl/Cmd+F` | `openSearchPane()`（後述） |
| 設定 | **`s`** | `toggleSettings()` |
| ヘルプ | **`?`** `F1` | `showHelp()` |
| 全画面 | `f` **`F11`** | 既存 ＋ F11 |
| 読書データ | **`d`** | `openReadingData()` |
| ePub を開く | **`o`** | `openFilePicker()` |
| 操作ガイド（目玉） | **`e`** | `showNavHint()` |

**`openSearchPane()`（新設・両ファイル）**

```js
function openSearchPane() {
  if (!state.epub) return;
  if (!state.sidebarOpen) toggleSidebar();
  switchSidebarTab('search');
  const inp = document.getElementById('search-input');
  if (inp) { inp.focus(); inp.select(); }
}
```

`/` は Firefox のクイック検索を潰すが、これは意図どおり（`preventDefault()`）。
**フォーカスを検索欄に移すのが要点** — 移さないと `/` の直後に打った文字が本文ページ送りに化ける。

⚠ **`?` は `Shift+/`**。K-1-1 の修飾キーガードは `shiftKey` を見ていないので通る（`altKey` / `ctrlKey` / `metaKey` のみ弾く）。
JIS 配列でも `e.key === '?'` は同じ。

### K-2-3. 文字サイズ

| 操作 | キー |
|------|------|
| 拡大 | **`+`** **`=`** |
| 縮小 | **`-`** |

`changeFontSize(±1)` に委譲。`=` を拾うのは US 配列で `+` が `Shift+=` のため（`Shift` 無しでも打てる逃げ道）。
JIS 配列の `Shift+;` は `e.key === '+'` を返すので追加対応不要。
テンキーの `+` `-` も `e.key` は同じ文字列。**`Ctrl+±`（ブラウザズーム）は K-1-1 のガードで自動的に素通し**。

FXL でも有効にするか: **無効にする**。FXL は画像なので `state.fontSize` は効果ゼロ。
押しても何も起きないキーは「壊れている」と読まれるため、`state.renderMode === 'fxl'` ならトーストも出さず無視する。

### K-2-4. 読み上げ（TTS）

`_tts.active` のときだけ有効。非アクティブ時は `r` のみ受け付ける。

| 操作 | キー | 実装 |
|------|------|------|
| 再生／一時停止 | **`r`** | 非アクティブ→`ttsPlay()` / 再生中→`ttsPause()` / 一時停止中→`ttsResume()` |
| 停止 | **`Shift+R`** | `ttsStop()` |
| 前の文／次の文 | **`,`** / **`.`** | `ttsPrevSent()` / `ttsNextSent()` |

⚠ **`,` `.` は `_tts.active` のときだけ処理する**。非アクティブ時に握ると、将来 `,` を設定に割り当てたくなったとき詰む。
⚠ `_ttsSupported` が false の環境では `r` も無視（🔊 ボタン自体を隠している環境と挙動を揃える）。
⚠ `ttsPrevSent` / `ttsNextSent` は一時停止中に `_ttsUnpauseForSeek()` を通す既存経路にそのまま乗る（v2.18.0）。

### K-2-5. テーマ順送り `c`

**入れない。** テーマは 8 種あり、順送りは「今どこにいるか」が分からないまま画面色が飛ぶ。
明るさ・暖色フィルタとの合わせ技もあるので、設定パネル（`s` で 1 打）で選ぶほうが速い。

---

## K-3. 読みかけリストのフォーカス設計と `q` 往復

### K-3-1. 問題

現状 `q` を実装しただけでは**体験が悪化する**:

1. `closeBook()` はフォーカスを外さない。読書中に `#open-btn`（「リストへ」）を押して戻ると、
   ボタンは「開く」に変わったまま**フォーカスを保持**する。ここで Enter を押すと `openFilePickerForBook` ではなく
   **`openFilePicker()`（OS のファイルピッカー）が開く** — 最も避けたい誤爆
2. リストビューの `.rl-card` は `tabindex` を持たない（グリッドビューのみ `role="button" tabindex="0"`・`yomikake.html:7875`）。
   Tab で拾えるのはカード内の「開く」ボタンで、カード数 × ボタン数だけ Tab を押す必要がある

**`q` の成立条件は「戻った直後に Enter か `q` で同じ本が開くこと」**。よって K-3 は `q` とセットで実装する。

### K-3-2. ローミング tabindex によるカード選択

ARIA の標準パターン（listbox/grid）に合わせる。

- `#reading-list-items` のカードは**常にちょうど 1 枚だけ `tabindex="0"`**、残りは `tabindex="-1"`
- `role="button"` は全カードに付与（リストビューにも）
- 選択キーは `_rlSelKey`（モジュール変数・**bookKey で保持**）

```js
let _rlSelKey = '';   // 選択中カードの bookKey。'' なら未選択

function _rlSyncSelection(focus) {
  const items = [...document.querySelectorAll('#reading-list-items .rl-card')];
  if (!items.length) { _rlSelKey = ''; return; }
  let el = items.find(c => c.dataset.key === _rlSelKey);
  if (!el) el = items.find(c => c.classList.contains('rl-last')) || items[0];
  _rlSelKey = el.dataset.key;
  items.forEach(c => { c.tabIndex = (c === el) ? 0 : -1; c.classList.toggle('rl-sel', c === el); });
  if (focus) el.focus({ preventScroll:false });
}
```

⚠ **`_rlRender()` は検索 1 文字ごとに `innerHTML` を作り直す**（`design_reading_list_v2.md`）。
DOM 要素の参照を持つと即座に迷子になるので、**選択は必ず bookKey で保持**し、レンダー末尾で `_rlSyncSelection(false)` を呼ぶ。
絞り込みで選択中の本が消えたら `.rl-last` → 先頭カードへフォールバックする（上の `find` チェーン）。

⚠ 再レンダー時に `focus` を渡してはいけない。検索欄に入力中にフォーカスを奪うと IME が飛ぶ。

### K-3-3. トレードオフ: Tab の挙動が変わる

ローミング tabindex を入れると **Tab はカード群を 1 枚だけ通過して次のコントロールへ抜ける**ようになる
（今日はカードごとの「開く」ボタンを全部通過する）。

- 得: 100 冊あっても Tab 3 回でツール行に届く。矢印で選ぶほうが本来の操作
- 損: 「Tab 連打で目的の本まで進む」現在の操作は使えなくなる

**推奨は導入。** ただしカード内の「開く」「×」ボタンは `tabindex="-1"` にせず**そのまま残す**ので、
カードにフォーカスがある状態から Tab を押せばカード内ボタンには入れる（＝機能欠落は無い）。

### K-3-4. リストのキー割り当て

| 操作 | キー |
|------|------|
| 選択を次へ | `↓` **`n`** **`j`** |
| 選択を前へ | `↑` **`p`** **`b`** **`k`** |
| 選択を開く | `Enter` **`q`** |
| 先頭／末尾の本 | `Home` / `End` |
| 絞り込み検索へ | `/` |
| 別の ePub を開く | `o` |
| 読書データ／設定／ヘルプ | `d` / `s` / `?` |
| 絞り込み解除 → 編集モード解除 | `Escape` |

- **グリッドビューでも `↑↓` は「1 つ前／次の本」**（行移動ではない）。列数が可変（`auto-fill`）なので
  行移動にすると幅次第で挙動が変わる。`←→` も同じ動作に割り当てて、どちらを押しても迷わないようにする
- **`q` で開く**のは「読書中 `q` → リスト、リスト `q` → 同じ本」という**往復の対称性**のため。ご要望の中心
- `n` `p` などは `#rl-search` にフォーカスがあるときは既存の INPUT ガードで素通しされる（＝普通に文字入力できる）
- **`↓` を検索欄から押したらリストへ入る**（`#rl-search` の `keydown` に個別リスナ）。逆に
  リスト先頭で `↑` を押したら検索欄へ戻す。これが無いと検索して絞り込んだ後キーボードだけで開けない

### K-3-5. `closeBook()` からの復帰

```js
// closeBook() 末尾（buildReadingList() の後）
if (document.activeElement) document.activeElement.blur();
_rlSelKey = state_bookKey_before_close;   // 閉じた本のキー
_rlSyncSelection(true);                   // ← フォーカスを載せる
```

- `_rlSelKey` に**閉じた本の bookKey** を入れてから同期するので、選択は必ずその本のカードに載る
- その本が絞り込みで非表示なら `.rl-last`（＝同じ本のはず）→ 先頭 の順にフォールバック
- **`#open-btn` から明示的に `blur()` する**のが K-3-1 の 1 番の修正。フォーカスをカードへ移すこと自体が
  「Enter でピッカーが開く」事故を消す

⚠ `closeBook()` は `finalizeCurrentBook()` の後で `state.bookKey` を `''` にクリアするので、
**キーの退避は `state.bookKey = ''` より前**で行うこと。

⚠ **フォーカスを動かすのは `closeBook()` 経由のときだけ**。初回読み込み時（`autoOpenLastBook()` が
発動しなかったとき）に勝手にカードへフォーカスが載ると、スクロール位置が飛んだように見える。
`buildReadingList()` の中ではなく `closeBook()` の側から呼ぶ。

### K-3-6. `Escape` で本を閉じるか

Escape チェーンの**最後**（全画面解除の後）に「本を閉じる」を足す。

- 根拠: ユーザーの当初の期待が「ESC でも戻れるはず」。読書位置は自動保存され、`q`/Enter で即復帰できるので誤爆コストが低い
- ただし**チェーン最後尾を守る**こと。モーダル・ピッカー・設定・サイドバー・全画面のどれかが開いていれば
  そちらが先に閉じる。「何も開いていない読書画面で Escape」＝閉じる、という 1 段だけ

### K-3-7. 見た目（`.rl-sel`）

選択中カードには**可視のフォーカスリング**が要る。キーボードで動かしているのに何も光らなければ操作不能と同じ。

```css
.rl-card.rl-sel { outline:2px solid var(--accent); outline-offset:2px; }
.rl-card:focus  { outline:2px solid var(--accent); outline-offset:2px; }
.rl-card:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
```

⚠ `.rl-card.rl-last::before`（左端 4px のアクセントバー）と**意味が違う**ので、リングとバーは併存させる。
バー＝「前回読んでいた本」、リング＝「いま選んでいる本」。起動直後は両方が同じカードに乗る。

⚠ `.rl-card` は `overflow:hidden`（`yomikake.html:248`）。`outline` は overflow の影響を受けないので問題ないが、
`box-shadow` で代用すると**クリップされて見えなくなる**。outline を使うこと。

---

## K-4. ヘルプにショートカット一覧

`updateHelpContent()` の末尾に `_helpKeysHtml()` を足す。i18n キー `help.keys.*`（26 個）を
**4 言語（ja / en / zh-TW / zh-CN）**分。

- **タッチ専用環境では出さない** — 判定は `_kbSeen || matchMedia('(hover:hover)').matches`。
  スマホしか使わない人のヘルプが 2 画面ぶん伸びるのを避ける。
  `_kbSeen` は `keydown` 初回で立てるフラグで `localStorage` に持たない（セッション内で十分）
- FXL 専用キー（`z` `0` `1-6`）は `state.renderMode === 'fxl'` のときだけ表示。
  **`yomikake_ios.html` では行ごと持たない**（iOS は FXL キーボードショートカット未実装）
- TTS 行は `_ttsSupported` のときだけ表示
- キー表記そのもの（`Space` `Shift+Space` `↑ ↓` …）は翻訳対象外。
  i18n に持たせるのは**動作の説明だけ**にして、4 言語ぶんの重複を抑える
- 末尾に「読書中は Ctrl/Cmd+F が本文検索になる」注記（`help.keys.noteFind`）を置く。
  ブラウザ既定を奪う唯一の箇所なので、驚かせないために明示する

`#modal-body` は `max-height:calc(80vh - 120px); overflow-y:auto` なので、行数が増えても破綻はしない。

---

## 影響範囲まとめ

| 対象 | K-1 | K-2 | K-3 | K-4 |
|------|-----|-----|-----|-----|
| `keydown` ハンドラ → `handleKey()` 抽出 | ● | ● | ● | |
| `buildScrollScript()`（iframe 側キー転送） | ● | | | |
| `message` ハンドラ（`EPUB_KEY`） | ● | | | |
| `closeBook()` | | | ● | |
| `_rlRender()` / カード markup / CSS | | | ● | |
| `#rl-search` の keydown | | | ● | |
| `openSearchPane()`（新設） | | ● | | |
| `I18N`（`help.keys.*`） | | | | ● |
| `updateHelpContent()` | | | | ● |

**両ファイルに入れる。** ただし以下は差分:

- FXL キーボードショートカット（`z` `0` `1-6`）は現状 `yomikake.html` のみ。
  **今回は揃えない**（FXL ズームの Escape 分岐など周辺の同期が必要で、キーボード改善の本筋から外れる）。
  代わりに `n` `p` `b` `j` `k` の FXL ページ送り（K-2-1）は両ファイルに入れる
- iframe キー転送は両ファイル必須。iOS 版は `CLICK_HANDLER` と同じテンプレート変数の層に置く

---

## 実装で判明したこと

- **初回オープンではタップ操作ガイドが自動で出る**（`epub_tap_guide_v1`）。ガイド表示中は
  「任意キーで閉じる」が全ショートカットより優先されるので、**本を開いた直後の 1 打はガイドを閉じるだけ**に
  なる。仕様どおりだが、キー操作を試すときに「効かない」と誤解しやすいのでヘルプ・テストの両方で明示した
- `closeModal()` は `showNavHint()` を呼ぶので、**Escape でヘルプを閉じると続けてタップ操作ガイドが出る**。
  これは ✕ ボタンで閉じたときと同じ既存挙動で、変更していない
- `Escape` でモーダルを閉じる経路は**読みかけリスト側でも要る**（削除確認ダイアログ）。
  `handleKey()` の `!state.epub` 分岐より**前**にモーダルガードを置くこと。
  後ろに置くと、リストで出るダイアログが Escape で閉じられない
- リストの Escape で `clearRlFilters()` を呼ぶ条件は、**その関数が実際に消すものだけ**に合わせる
  （`_rlQuery` / `filterReady` / `genre`。`filterHasMore` は対象外）。
  揃えないと「Escape を押したのに何も起きない」ように見える

## テスト（`tests/cases/keyboard.js`・両ファイル各 76 assertion）

自動で担保する:

- 修飾キーガード: `Ctrl+F` で全画面にならない／`state.epub` があるとき検索ペインが開く
- `←→` が `isVerticalAxis()` に連動して章送り方向を変える
- `Escape` チェーンの順序（モーダル → … → 本を閉じる）が 1 打 1 つであること
- `n` `p` `b` `j` `k` `Backspace` が `scrollPage(±1)` を呼ぶこと（スパイ）
- `_rlSyncSelection()`: 再レンダー後も選択が bookKey で維持される／絞り込みで消えたらフォールバックする
- `closeBook()` 後に `document.activeElement` が `.rl-card.rl-sel` であること（**#2 の回帰検知の本体**）
- ローミング tabindex: カード群に `tabindex="0"` がちょうど 1 つ

**担保できない**（実機確認が必要）:

- **`EPUB_KEY` 転送の実効性** — headless では本文クリックによるフォーカス移動を再現しにくく、
  テストは「転送コードが iframe に焼き込まれているか」しか見ていない。
  **「本文をクリックしてから `n` を押す」を実機で必ず確認する**（今回いちばん効果の大きい修正）
- **転送された 1 打目の user activation** — `reclaimKeyFocus()` で 2 打目からは回復するが、
  1 打目の `f`（Layer2 全画面）・`r`（iOS の初回読み上げ）は通らない可能性がある
- IME 変換中の Space / 矢印（`isComposing` は疑似イベントで検査済みだが実 IME は別）
- JIS 配列の `+` `?`、テンキー、Bluetooth キーボード（iPad / Android）
- `F11` / `Ctrl+F` のブラウザ既定との競合（ブラウザごとに差がある）
- `.rl-sel` リングの見え方（テーマ 8 種 × リスト/グリッド）

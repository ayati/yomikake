# 設計書: タップ操作UX改善（design_tap_ux.md）

作成日: 2026-07-20
最終更新: 2026-07-20（実装完了・Playwright 検証済み）
対象: `yomikake.html` / `yomikake_ios.html`（両ファイル共通実装）
ステータス: **実装済み（v2.8.0・両ファイル＋sw.js VERSION→v2.8.0 バンプ済み。未コミット）**

> **実装時の追加変更（本文は設計時のまま）:**
> 1. **画面上ナビボタンとの競合を発見し対処（v2.8.2 で全ボタンへ拡大）** — `.chapter-btn`（`#btn-prev`/`#btn-next`）は左右端の中央高さ
>    （実測：モバイル 390px 幅で x4–14% / y46–54%、PC 900px で x2–9% / y40–60%）を占め、**端タップ帯と重なる**。
>    動作は「1章送り」なのでページ送りと食い違い、端をタップしたつもりが章ごと飛ぶ実害があった
>    （タッチ端末では PC版で不可視・iOS版で opacity .3 のため気づけない）。対策として
>    `body.tapzones-on`（`state.tapZone !== 'center'` で付与）で **`.chapter-btn` を `display:none`**。
>    （v2.8.2 で `.scroll-btn` も対象にし、`@media (hover:none)` の限定も外して全環境に統一した — 下記 2.）
>    章移動は目次サイドバー・ジャンプスライダーから可能。`updateTapZoneBodyClass()` が同期点
>    （init / `changeTapZone` から呼ぶ）。
> 2. **`#btn-scroll-fwd` / `#btn-scroll-back` も隠す（v2.8.2 で方針変更）** — 当初は「動作が帯と同一なので無害」と
>    判断したが、**`lr` 設定ではガイド上「無反応」の上下中央でページ送りが起きる**（`#btn-scroll-fwd` は
>    モバイルで x2–98% / y83–98% を占める）。「機能がない場所を持ったらページが動く」というユーザー体験上の
>    実害があるため、`.chapter-btn` と併せて `body.tapzones-on` で `display:none` にした。
>    **プラットフォーム分岐もやめた**（タッチ限定だと PC でだけガイドが嘘をつくため）。
>    例外は `body.fxl-zoomed` のみ（`#btn-scroll-fwd` が ZoomStep 送りの操作子）。
> 3. **ガイドのラベルはピル状の下地付きに変更** — 本文の上に重なるため、無地の白文字＋影では
>    狭幅端末で判読しづらかった（実機スクショで確認）。あわせて `guide.next` の文言を
>    「タップで次のページ」→「次のページ」に短縮（30% 幅の帯で折り返さないように）。
> 4. **座標系の一致を実測確認** — `#fxl-container` は `#page-container` と完全一致（モバイル/PC 両方で
>    x/y/w/h 同値）だったため、ガイド描画先（`#page-container`）と FXL タップ判定基準は矛盾しない。
> 5. **中央判定の境界は浮動小数の影響を受ける** — `yr=0.70` は `|0.70-0.5| = 0.19999999999999996 < 0.2` が
>    真になり中央（メニュー）と判定される。ただし端帯側の条件も同時に真で、**判定順（中央が先）で決まるだけ**。
>    51×51 グリッド全点で `null`（死角）が 0 であることを検証済みなので実害はない。
>
> 6. **「操作を見せる」導線を設定連動に統一（設計の想定漏れ・ユーザー指摘で修正）** — 初版はツールバーの
>    目玉ボタン（`btn.flash`）とモーダルを閉じたときの `flashNavButtons()` をそのまま残していたため、
>    **タップゾーンを設定していても旧来のナビボタンが点滅する**不整合が残っていた。共通エントリ
>    **`showNavHint()`** を新設し、目玉ボタン・`closeModal(skipFlash=false)`・初回オープン・
>    `changeTapZone()` をすべてここへ集約。`state.epub && tapZone !== 'center'` なら帯ガイド、
>    **「なし（中央のみ）」設定と本未オープン時は従来どおり `flashNavButtons()`**（＝その設定に
>    合った操作方法だけを見せる）。読みかけリストの削除確認は `closeModal(true)` なので発火しない。
>
> 7. **v2.8.1（ユーザー指摘による3点の是正）**
>    - **4番目の選択肢を「ボタン（上下＋章送り）」に改称**（旧「なし（中央のみ）」）。実態は「端タップを使わず
>      従来の画面上ボタンで操作するモード」であり、"なし" では機能が無いかのように読めた。内部値 `'center'` は据え置き。
>    - **中央エリアのタップを操作メニューに変更** — 従来はナビボタンを点滅させるだけ（`revealControls()`）だったが、
>      ユーザーは「中央にメニューが出る」ことを期待していた。`showTapMenu()` を新設し、上＝前ページ／下＝次ページ／
>      左＝次の章／右＝前の章の十字ボタン＋✕、下段に「リストへ戻る」（全画面中は「全画面を解除」も）を表示する。
>      左右は画面上の `#btn-next`(左)/`#btn-prev`(右) およびキーボード ←/→ と同じ割り当て。FXL は章がないので 1 列。
>      `revealControls()` は廃止（`showFsExitBtn()` は `#fs-exit-zone` から引き続き使う）。
>    - **ガイドを 3×3 セル描画に変更** — 帯を重ねる実装では交差部が二重に着色され「9 分割」に見えていた。
>      各セル中心の `tapZoneAction()` の戻り値で塗る方式にしたので、**判定と表示が構造的に一致**し、
>      四隅は隣接する辺と同色・同濃度になる（L字が L字に見える）。ラベルは十字の 5 枚のみ。
>    - **開くときフォーカスを引き取る** — 中央タップで開いた直後は focus が iframe 内にあり、Escape や任意キーで
>      メニューを閉じられず、Space はブラウザ既定の iframe スクロールで裏のページを動かしてしまっていた（実測）。
>      `showTapMenu()` / `showTapGuide()` の末尾で `tabindex=-1` ＋ `focus({preventScroll:true})` して解消。
>
> 8. **v2.8.2b: 設定切替時のオーバーレイ掃除** — ゾーン設定でガイドが出ている状態から「ボタン」へ切り替えると、
>    `showNavHint()` の else 分岐が `flashNavButtons()` するだけでガイドを消しておらず、**ガイドとボタンが同時に
>    見える**状態になっていた（ユーザー指摘）。else 分岐で `hideTapGuide()` / `hideTapMenu()` してから点滅させる。
>    併せて `loadEpub()`（本の切り替え）冒頭でも両オーバーレイを掃除する。
>
> **検証済み（Playwright・3構成すべて ALL PASS / ページエラー 0）:**
> yomikake.html（PC・マウス・900×800）／ yomikake.html（タッチ・390×844）／
> yomikake_ios.html（タッチ・390×844）。リフロー本（検証用に生成した縦書き ePub3）と
> FXL 本（ひだまりスケッチ２）の両方で、ゾーン判定16項目・実タップのページ送り・章ボタン退避・
> ガイド3経路・キーボードガード・設定永続化・自動オープン（キャッシュ有/無/OFF/読了本スキップ）を確認。
> `showNavHint()` の分岐（ゾーン設定→帯ガイド／center→ボタン点滅／本未オープン→フォールバック）は
> 目玉ボタン・ヘルプ閉じ・ヘルプ内ボタン・設定変更の4経路 × 両ファイルで個別に検証済み。
>
> **既知の制限（変更前からの既存挙動・本件では未対応）:** 読書エリアをクリックするとフォーカスが
> iframe に入り、親のキーボードショートカットが届かなくなる（Space はブラウザ既定の iframe スクロールになる）。
> 変更前のファイルでも同一であることを実測で確認済み。ガイドが出る実フロー（初回オープン／設定変更／
> ヘルプ）は親フォーカスなのでキーボードガードは正しく効く。

## 決定事項（設計前提）

- タップゾーンのデフォルトは **L字パターン（`lshape`）**
- 起動時の前回本自動オープンは **デフォルト ON**

## 現行コード照合で判明した設計変更（初版からの修正）

実装前に現行コードを検証した結果、初版設計の以下を修正した。理由とともに記録する。

| # | 初版 | 修正後 | 理由 |
|---|------|--------|------|
| 1 | ガイドを `#main` に配置 | **`#page-container` に配置** | `#main` はサイドバーを含むため座標系が `EPUB_TAP` の xr/yr（iframe ビューポート基準）とズレる。`#page-container` は既に `position:relative`（yomikake.html:312）で iframe とピクセル一致 |
| 2 | ヘルプからガイドを随時表示 | **本オープン中のみヘルプにボタンを出す** | `#page-container` は `.visible` が付くまで `display:none`。本未オープンだとガイドが不可視になる。ヘルプの書籍情報カードが `state.epub` 条件付きなのと同じ前例に従う |
| 3 | Escape 優先度チェーンの先頭に追加 | **`reading-data-overlay` と同型の早期ガードに変更** | チェーン内 Escape は FXL ズーム分岐（yomikake.html:4375）より後ろで、ズーム中は Escape が奪われる。早期ガードならガイド表示中は Space/矢印も止まり、裏でページが送られる事故も防げる |
| 4 | 自動オープンに `loadEpubFromCache()` を使う | **`loadEpubFromCache(bookKey, {noPicker:true})` に拡張** | 現行の同関数はピッカーへのフォールバックが **3 箇所**あり（下記§機能3）、ジェスチャ無しでは失敗する。関数複製ではなくオプション引数で対応 |
| 5 | 共有フローの判定に `?shared=1` を参照 | **`_sharedFlowActive` フラグ必須（URL 参照は不可）** | `handleSharedFile()` は同期部で `history.replaceState` によりクエリを除去する（yomikake.html:7852）。IDB の `.then` が走る時点で `location.search` は既に空。フラグは replaceState より前に立てる |
| 6 | FXL タップ座標は `window.innerWidth/Height` 比 | **`#fxl-container` の rect 基準** | 現行 `handleFxlTap`（yomikake.html:4125）は window 比のためツールバー/ステータスバー分だけ yr がズレている。リフローの xr/yr は iframe ビューポート基準なので、揃えると両モードで同一の座標系になる |

## 背景

現状のタップ操作は「中央 40%×40% の矩形タップ → コントロール一時表示（`revealControls()`）」のみで、
画面の端をタップしても何も起きない。

- リフロー: iframe 側の click ハンドラ（PC は `SHARED_TAIL` 内 yomikake.html:2844、iOS は `CLICK_HANDLER`
  yomikake_ios.html:3135）が `EPUB_TAP {xr, yr}` を postMessage。親の受信ハンドラ
  （yomikake.html:4251-4255 / yomikake_ios.html:4534-4538）が中央判定して `revealControls()`
- FXL: `handleFxlTap()` の 320ms シングルタップ確定タイマー内で同じ中央判定
  （yomikake.html:4104-4128 / yomikake_ios.html:4380-4404）
- iframe 側送信はリンククリックと**テキスト選択中（`sel.type === 'Range'`）を除外済み**

Kindle・Kobo・BOOK☆WALKER 等では「端タップ＝ページ送り」が事実上の標準操作で、初見ユーザーはまずこれを試す。
一方、片手持ちでは「下端タップ」が最も届きやすい。両立策として **4 パターンから選択可能**にし、
デフォルトは両者を包含する **L字**とする。端タップは現状「無反応」なので割り当ては純増でデグレしない。

## スコープ

| # | 機能 | 規模感 |
|---|------|--------|
| 1 | タップゾーン 4 パターン＋設定選択（`state.tapZone`） | 中 |
| 2 | タップ操作ガイドオーバーレイ | 中 |
| 3 | 起動時に前回の本を自動オープン（`state.autoOpenLast`） | 小 |
| 対象外 | FXL ズーム中の端タップ→`advanceFxlZoomStep`（将来）、スワイプ挙動の変更、長押し操作 | — |

3 機能は v2.8.0 として同時リリース（デフォルト L字化はガイドとセットで出す）。

---

## 機能1: タップゾーン 4 パターン

### state / 永続化

`state` オブジェクト（yomikake.html:2070-2098 / yomikake_ios.html 同等位置）の `fwdBtnSize` 付近に追加:

```js
tapZone:'lshape',       // 'center' | 'lr' | 'tb' | 'lshape'（epub_settings に永続化）
autoOpenLast:true,      // 機能3（epub_settings に永続化）
```

- `saveSettings()`（yomikake.html:4430 / ios:4696）の JSON に 2 キー追加
- `loadSettings()`（yomikake.html:4453 / ios:4719）にホワイトリスト検証付きで復元:

```js
if (s.tapZone === 'center' || s.tapZone === 'lr' || s.tapZone === 'tb' || s.tapZone === 'lshape') {
  state.tapZone = s.tapZone;
  const el = document.getElementById('tap-zone-select'); if (el) el.value = s.tapZone;
}
if (typeof s.autoOpenLast === 'boolean') { state.autoOpenLast = s.autoOpenLast; updateAutoOpenToggleUI(); }
```

既存ユーザーの `epub_settings` に `tapZone` は無い → デフォルト `'lshape'` が適用される（意図どおり。
機能2 の初回ガイドで挙動変更を告知）。

### ゾーン定義

`CENTER_TAP_RATIO`（yomikake.html:4258 / ios:4541）の直後に定数追加:

```js
const TAP_EDGE_RATIO = 0.3;   // 端帯 30%
```

中央矩形は `0.3 < xr < 0.7 && 0.3 < yr < 0.7`（既存 strict `<` 判定）、端帯は `<= 0.3` / `>= 0.7`。
**境界 0.3 / 0.7 でちょうどタイルする**（隙間・重複なし）。

**全パターン共通で中央 40%×40% ＝ メニュー**（既存ユーザーの学習を無駄にしない）。

進行方向は既存 `isVerticalAxis()`（yomikake.html:4305 / ios:4588 — FXL は `fxlPpd === 'rtl'`、
リフローは `writingMode === 'vertical'` または publisher axis `'h'`）で判定:

- 縦書き軸（RTL）: 進み側＝左 ／ 横書き軸（LTR）: 進み側＝右

| パターン | 次ページ | 前ページ |
|----------|----------|----------|
| `center` | なし | なし（既存挙動） |
| `lr` | 進み側の端帯（幅30%・全高） | 戻り側の端帯 |
| `tb` | 下端帯（高さ30%・全幅） | 上端帯。**書字方向に依らず下＝次で固定** |
| `lshape` | 進み側の端帯 ∪ 下端帯 | 戻り側の端帯 ∪ 上端帯 |

**L字のコーナー競合は「次を優先」**（次L字を先に判定）。結果として「進み側×上端」「戻り側×下端」の
2 コーナーは次ページになる。前は低頻度操作なのでこれで十分。

### 判定関数（両ファイル共通・`revealControls()` の直後に配置）

```js
// タップ位置(読書領域基準の比率)を現在のゾーン設定に照らしてアクション名へ変換
function tapZoneAction(xr, yr) {
  if (Math.abs(xr - 0.5) < CENTER_TAP_RATIO &&
      Math.abs(yr - 0.5) < CENTER_TAP_RATIO) return 'menu';
  const z = state.tapZone;
  if (z === 'center') return null;
  const fwdLeft  = isVerticalAxis();          // 縦書き軸: 左が進み側
  const inFwd    = fwdLeft ? xr <= TAP_EDGE_RATIO : xr >= 1 - TAP_EDGE_RATIO;
  const inBack   = fwdLeft ? xr >= 1 - TAP_EDGE_RATIO : xr <= TAP_EDGE_RATIO;
  const inTop    = yr <= TAP_EDGE_RATIO;
  const inBottom = yr >= 1 - TAP_EDGE_RATIO;
  if (z === 'lr') return inFwd ? 'next' : inBack ? 'prev' : null;
  if (z === 'tb') return inBottom ? 'next' : inTop ? 'prev' : null;
  /* lshape */
  if (inFwd || inBottom) return 'next';       // 次L字を先に判定＝コーナーは次優先
  if (inBack || inTop)   return 'prev';
  return null;
}

function runTapAction(a) {
  if (a === 'menu')      revealControls();
  else if (a === 'next') scrollPage(1);
  else if (a === 'prev') scrollPage(-1);
}
```

`scrollPage(±1)`（yomikake.html:4184 / ios:4470）が方向抽象を持つ（リフローは `EPUB_SCROLL` postMessage、
FXL は `advanceFxlPage` / ズーム中 `advanceFxlZoomStep` に分岐）ため、判定結果を渡すだけでよい。
章末→次章遷移・最終ページ→`showFinishedBanner()`・`_isRendering` 中の連打キュー
（`_pendingScrollAfterRender`）もすべて既存経路のまま動く。

### 呼び出し箇所の変更

**(1) リフロー** — `EPUB_TAP` 受信ハンドラ（yomikake.html:4251-4255 / ios:4534-4538）を置換:

```js
if (e.data.type === 'EPUB_TAP') {
  runTapAction(tapZoneAction(e.data.xr, e.data.yr));
}
```

**(2) FXL** — `handleFxlTap()` のシングルタップ確定タイマー内（yomikake.html:4125-4126 / ios:4401-4402）
を置換。座標基準を `#fxl-container` の rect に変更する:

```js
_fxlSingleTapTimer = setTimeout(() => {
  _fxlSingleTapTimer = null;
  if (state.fxlZoomEnabled) return;          // ズーム中は既存どおり無効（PAN/ダブルタップに委譲）
  const cont = document.getElementById('fxl-container');
  if (!cont) return;
  const r = cont.getBoundingClientRect();
  if (!r.width || !r.height) return;
  runTapAction(tapZoneAction((clientX - r.left) / r.width, (clientY - r.top) / r.height));
}, 320);
```

**(3) 変更しないもの** — iframe 側の `EPUB_TAP` 送信、スワイプ判定、キーボード、`#btn-scroll-fwd`、
FXL ダブルタップ（ズーム切替）、`revealControls()` 本体。

### iOS スワイプとの共存（検証済み）

iOS の iframe 内スワイプは書字モードごとに別実装だが、いずれも **閾値 50px**:

| モード | 実装位置 | 判定 |
|--------|----------|------|
| vertical | yomikake_ios.html:3260-3266 | `|dy| > 50` で `doScroll(dy<0 ? 1 : -1)` |
| horizontal | yomikake_ios.html:3413-3425 | `detectAxis()` が 'h' なら dx、'v' なら dy で `> 50` |
| publisher | yomikake_ios.html:3507-3513 | `|dx| > 50` |

FXL コンテナ側のスワイプ（yomikake_ios.html:4262-4287）は `SWIPE_THRESHOLD = 50` /
`TAP_MOVE_LIMIT = 10` / 500ms でタップとスワイプを分離し、タップなら `handleFxlTap()` を呼ぶ。

**タップ（移動 < 10px）はスワイプ閾値に達しないため二重発火しない。** また 50px 超のドラッグでは
iOS Safari が click を発火しないため、スワイプが `EPUB_TAP` を誘発することもない。共存に問題なし。

### エッジケース・既知の挙動

- **FXL のタップページ送りは 320ms 遅延する**（ダブルタップ＝ズーム切替との弁別のため既存タイマーを共用）。
  リフローは click 即時。仕様として許容
- **publisher モードで `state.publisherAxis` が null の瞬間**（`EPUB_AXIS` 到着前）は `isVerticalAxis()`
  が false を返すため、縦書き ePub でも一瞬だけ左右が逆になりうる。`EPUB_AXIS` は `applyInit()` で
  即座に届くため実害なし（初回描画完了前にタップは発生しない）
- **PC のマウスクリックでもゾーンは有効**（Kindle デスクトップ版等と同じ挙動）。無効化したいユーザーには
  `center` を用意しているため、`(hover:none)` によるタッチ端末限定にはしない
- リンク・テキスト選択タップは iframe 側で除外済み（`EPUB_TAP` が飛ばない）
- 端タップのページ送りに専用の視覚フィードバックは付けない（スクロール自体がフィードバック）

### 設定 UI

「レイアウト」group（yomikake.html:706-733）の「次へボタン」行の**下**に追加。
`fxl-hide-row` は付けない（FXL でも有効なため常時表示）:

```html
<div class="set-row">
  <span class="set-label" data-i18n="settings.tapZone">タップページ送り</span>
  <select class="modern-select" id="tap-zone-select" onchange="changeTapZone(this.value)">
    <option value="lshape" data-i18n="tapZone.lshape">L字（端＋下）</option>
    <option value="lr"     data-i18n="tapZone.lr">左右の端</option>
    <option value="tb"     data-i18n="tapZone.tb">上下の端</option>
    <option value="center" data-i18n="tapZone.center">なし（中央メニューのみ）</option>
  </select>
</div>
```

`changeTapZone()` は `changeFwdBtnSize()`（yomikake.html:4400 付近）と同型:

```js
function changeTapZone(v) {
  if (['center','lr','tb','lshape'].indexOf(v) < 0) return;
  state.tapZone = v;
  saveSettings();
  if (state.epub) showTapGuide();   // 変更結果をその場で確認できる
}
```

---

## 機能2: タップ操作ガイドオーバーレイ

### DOM 配置（修正2・修正1 を反映）

`#page-container`（yomikake.html:903 / ios 同等）の子として、`#fxl-region-pill` の後に追加:

```html
<div id="tap-guide-overlay" onclick="hideTapGuide()" aria-hidden="true"></div>
```

- CSS: `position:absolute; inset:0; z-index:60; display:none;`
  （コンテナ内 z-index は page-overlay 10 / nav ボタン 20 / mobile-progress 25 / region-pill 28 /
  finished-banner 50 なので 60 で最前面。`#loading-overlay` 250 / `#toast` 300 より下）
- `#page-container` が `.visible`（本オープン中）のときのみ表示されるため、
  **本未オープン時は呼び出さない**（ヘルプのボタンも `state.epub` 条件付きで出す）
- ゾーン矩形は子 div を JS で生成。`%` 指定で `TAP_EDGE_RATIO`(30%) / `CENTER_TAP_RATIO`(±20%) と一致させる
- 配色: 次＝`var(--accent)` の半透明（≒0.22）、前＝グレー半透明、中央＝枠線のみ（本文が透けて見える）。
  8 テーマいずれでも視認可
- **モバイル（`max-width:640px`）ではサイドバーが `position:absolute` のオーバーレイ**（yomikake.html:562）
  になり `#page-container` の幅は変わらない。PC ではサイドバーが flex で幅を削るが、iframe も同じ幅に
  なるため**どちらでも座標系は一致する**

### 関数

```js
let _tapGuideOpen = false;

function showTapGuide() {
  if (!state.epub) return;                    // コンテナ非表示時は出さない
  const ov = document.getElementById('tap-guide-overlay');
  ov.innerHTML = '';                          // 呼び出し時点の tapZone / isVerticalAxis() で組み立て
  // …ゾーン div 群 + ラベル(t('guide.next') 等) + t('guide.tapToClose') を append…
  ov.style.display = 'block';
  ov.setAttribute('aria-hidden', 'false');
  _tapGuideOpen = true;
}

function hideTapGuide() {
  const ov = document.getElementById('tap-guide-overlay');
  ov.style.display = 'none';
  ov.setAttribute('aria-hidden', 'true');
  _tapGuideOpen = false;
}
```

- **描画は呼び出し時点で `state.tapZone` と `isVerticalAxis()` を評価**（縦書き/横書き/FXL rtl/ltr で
  次・前の左右が正しく反転する）
- 自動タイムアウトはしない（読んで理解する時間は人による）。オーバーレイ自身の click で閉じる
- L字はゾーンごとに複数 div で描画し、ラベルは各ゾーン最大面積の div にのみ置く

### Escape / キーボード（修正3）

`keydown` ハンドラ（yomikake.html:4361 / ios:4643）の `reading-data-overlay` 早期ガードの**直後**に追加:

```js
// タップガイド表示中はショートカットを止め、Escape / その他キーで閉じる
if (_tapGuideOpen) {
  hideTapGuide();
  e.preventDefault();
  return;
}
```

これにより Escape の優先度チェーン（フォントピッカー > 設定 > サイドバー > フルスクリーン）や
FXL ズームの Escape 分岐に一切触れずに済み、ガイド表示中に Space/矢印で裏のページが送られる事故も防げる。

### 表示トリガー（3 経路）

| # | トリガー | 実装位置 |
|---|----------|----------|
| 1 | **初回本オープン時に 1 回** | `loadEpub()` の初回 `renderPage` 完了直後（yomikake.html:2454-2460 の `flashNavButtons()` の後、`setTimeout(_rdComputeBookChars)` の前）。`localStorage.getItem('epub_tap_guide_v1')` が無ければ `showTapGuide()` → `setItem('epub_tap_guide_v1','1')` |
| 2 | **設定でパターン変更した直後** | `changeTapZone()` から（本オープン中のみ） |
| 3 | **ヘルプから（本オープン中のみ）** | `updateHelpContent()`（yomikake.html:7672）の `bookInfo` ブロック内に `<button onclick="closeModal(true); showTapGuide();" data-i18n="help.showTapGuide">` を追加。`closeModal(true)` で `flashNavButtons()` を抑止 |

トリガー1 は機能3 の自動オープンと連鎖する（自動オープン → 本表示 → ガイド）。意図した動作。

---

## 機能3: 起動時に前回の本を自動オープン

### 発動条件（すべて満たすとき）

1. `state.autoOpenLast === true`
2. `_sharedFlowActive === false`（Web Share Target フローが走っていない・PC のみ。**修正5**）
3. `!state.epub`（まだ何も開いていない）
4. `epub_last_book` が存在し `bookKey` が取れる
5. `_cachedKeys.has(bookKey)` — **IDB ePub キャッシュにヒットする場合のみ**
6. その本が**読了済みでない** — `epub_pos_*` の値から `spineIdx >= spineCount-1 && ratio > 0.9`
   （`_rlCollect()` yomikake.html:5590 付近と同一式）を再計算して除外

```js
async function autoOpenLastBook() {
  if (!state.autoOpenLast || _sharedFlowActive || state.epub) return;
  let key = '';
  try { key = (JSON.parse(localStorage.getItem('epub_last_book')) || {}).bookKey || ''; } catch (e) { return; }
  if (!key || !_cachedKeys.has(key)) return;
  try {                                     // 読了済みならスキップ
    const val = JSON.parse(localStorage.getItem(key));
    if (val) {
      const parsed = parseBookKey(key);
      const sc = (typeof val.spineCount === 'number' && val.spineCount > 0)
        ? val.spineCount : (parsed ? parsed.spineCount : 0);
      if (sc && (val.spineIdx || 0) >= sc - 1 && (val.ratio || 0) > 0.9) return;
    }
  } catch (e) {}
  await loadEpubFromCache(key, { noPicker: true });
}
```

### ピッカー禁止の実装（修正4）

`loadEpubFromCache()` には **`openFilePicker()` が 3 箇所**ある（yomikake.html / ios 同構造）:

1. 冒頭ガード `if (!_idbAvailable || !_cachedKeys.has(bookKey)) { openFilePicker(); return; }`
2. キャッシュ実体なし `if (!cached || !data) { … openFilePicker(); return; }`
3. catch 節 `if (!state.epub) openFilePicker();`

ユーザージェスチャ無しの自動実行では `showOpenFilePicker()` が例外になり、`<input>` の `click()` も
無視されるため、**シグネチャを `loadEpubFromCache(bookKey, opts)` に拡張し、3 箇所すべてを
`if (!opts || !opts.noPicker) openFilePicker();` でガードする**（関数複製はしない）。
既存の呼び出し（`openFilePickerForBook()` / `resumeBook()` / 読みかけリストのカード）は
第2引数省略で従来どおり動く。

失敗時は静かにウェルカム画面（読みかけリスト）へ留まる — これが自然なフォールバック UI。

### 実装位置と実行順序（検証済み）

`_cachedKeys` は init の `_idbGetAllKeys().then(...)`（yomikake.html:5140 / ios:2317）で確定するため、
**その `.then` 内の末尾**（`updateCacheGroupUI()` の後）から `autoOpenLastBook()` を呼ぶ:

```js
_idbGetAllKeys().then(keys => {
  _cachedKeys = new Set(keys);
  _cacheIdxReconcile(keys);
  if (!state.epub && document.getElementById('reading-list')) buildReadingList();
  updateCacheGroupUI();
  autoOpenLastBook();          // ← 追加
}).catch(() => {});
```

**順序の保証**: `_idbGetAllKeys()` の呼び出し（PC 5140 行）は Init ブロック（7769 行）より前にあるが、
IDB のコールバックはタスクキュー経由なので **スクリプト全体の同期実行が終わってから**発火する。
したがって `.then` の時点で `loadSettings()`（`state.autoOpenLast` 復元）も
`handleSharedFile()` の同期部（`_sharedFlowActive` セット）も完了している。

### `_sharedFlowActive` の実装（PC のみ・修正5）

`handleSharedFile()`（yomikake.html:7847）の**同期部で、`history.replaceState` より前に**フラグを立てる:

```js
let _sharedFlowActive = false;   // モジュール変数（宣言部に追加）

(async function handleSharedFile() {
  let shared;
  try { shared = new URLSearchParams(location.search).get('shared'); } catch (e) { return; }
  if (!shared) return;
  _sharedFlowActive = true;                                    // ← replaceState より前に立てる
  try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {}
  …
})();
```

**`location.search` を後から見る方式は不可**（replaceState でクエリが消えるため、IDB の `.then` の
時点では常に空に見え、共有オープンと自動オープンが競合する）。

`yomikake_ios.html` には **Web Share Target 受信が存在しない**（SW 登録のみ・ios:7573。iOS Safari は
Web Share Target 非対応）。iOS 版は `let _sharedFlowActive = false;` を宣言だけして常に false のまま
とし、`autoOpenLastBook()` のコードを両ファイルで同一に保つ。

### 設定 UI

「📂 ePub キャッシュ」group（yomikake.html:785-794）の `cache-summary` 行の**上**に追加。
`#drive-auto-toggle`（yomikake.html:772-773）と同型のボタントグル:

```html
<div class="set-row">
  <span class="set-label" data-i18n="settings.autoOpenLast">起動時に前回の本を開く</span>
  <button id="auto-open-toggle" onclick="toggleAutoOpenLast()"
          style="border:1px solid var(--ui-border);border-radius:8px;padding:6px 16px;min-width:60px;font-size:13px;font-weight:600;cursor:pointer;transition:all .15s;">ON</button>
</div>
```

`toggleAutoOpenLast()` / `updateAutoOpenToggleUI()` は `toggleDriveAutoSave()` /
`updateAutoSaveToggleUI()` と同じ実装パターン（`saveSettings()` を呼び、ラベルと active スタイルを同期）。
init の `updateFxlLtrAutoFlipUI()` 群の並びに `updateAutoOpenToggleUI()` を追加。

### 共存・エッジケース

- **本棚へは既存の左上「リストへ」ボタン**（`openBtnClick()` → `closeBook()`）で即戻れる — ON デフォルトの逃げ道
- **Drive 自動保存 ON 時の `driveSyncPull({force:true})`**（yomikake.html:7813）との競合: pull 完了前に
  自動オープンが走りうるが、既存の Drive 取り込みは「開いている本の位置が進んでいれば `renderPage()` で
  自動ジャンプ」する仕組みを持つため、順序に関わらず最終位置は正しい。**追加対応不要**
- 物理削除（purge）済みの本は `_rlCleanupLastBook()` が `epub_last_book` を掃除するので条件4 で不発
- `doDeleteBook()` は削除対象が `epub_last_book` なら削除する（yomikake.html:6862）ので同様に不発
- プライベートブラウジング等で `_idbAvailable === false` の場合、`_idbGetAllKeys()` は空 → 条件5 で不発
- PWA standalone 限定にはしない（ブラウザタブでも同挙動。シンプルさ優先）

---

## i18n キー（4 言語）

`I18N` の各言語ブロック（PC: ja ~1098 / en ~1339 / zh-TW ~1580 / zh-CN ~1821 行付近の
`fwdSize.*` 近傍）に追加。iOS も同じキー構成。

| キー | ja | en |
|------|----|----|
| `settings.tapZone` | タップページ送り | Tap to turn page |
| `tapZone.lshape` | L字（端＋下） | L-shape (edge + bottom) |
| `tapZone.lr` | 左右の端 | Left / right edges |
| `tapZone.tb` | 上下の端 | Top / bottom edges |
| `tapZone.center` | なし（中央メニューのみ） | Off (center menu only) |
| `guide.next` | タップで次のページ | Tap: next page |
| `guide.prev` | 前のページ | Previous page |
| `guide.menu` | メニュー表示 | Show controls |
| `guide.tapToClose` | どこかをタップで閉じる | Tap anywhere to close |
| `help.showTapGuide` | 🖐 タップ操作ガイドを表示 | 🖐 Show tap guide |
| `settings.autoOpenLast` | 起動時に前回の本を開く | Auto-open last book |

## localStorage / 設定への追加まとめ

| 保存先 | キー | 内容 |
|--------|------|------|
| `epub_settings` | `tapZone` | `'center' \| 'lr' \| 'tb' \| 'lshape'`（デフォルト `lshape`） |
| `epub_settings` | `autoOpenLast` | boolean（デフォルト `true`） |
| 独立キー | `epub_tap_guide_v1` | ガイド初回表示済みフラグ（`'1'`） |

Drive 同期・しおりエクスポートには**含めない**（表示設定は端末ローカルという既存方針どおり）。

---

## 実装チェックリスト（ファイル別）

`yomikake.html` は **CRLF**、`yomikake_ios.html` は **LF**。編集時は改行コードを保つこと。

### 共通（両ファイル・同一内容）

1. CSS: `#tap-guide-overlay` とゾーン子要素のスタイル（`#fxl-region-pill` の CSS 近傍に追加）
2. HTML: `#page-container` 内に `#tap-guide-overlay`、設定 2 行（レイアウト group / キャッシュ group）
3. `state`: `tapZone` / `autoOpenLast` 追加
4. 定数: `TAP_EDGE_RATIO`、モジュール変数 `_tapGuideOpen` / `_sharedFlowActive`
5. 関数追加: `tapZoneAction` / `runTapAction` / `changeTapZone` / `showTapGuide` / `hideTapGuide` /
   `toggleAutoOpenLast` / `updateAutoOpenToggleUI` / `autoOpenLastBook`
6. `EPUB_TAP` ハンドラ置換、`handleFxlTap` のタイマー内置換（座標基準変更込み）
7. `keydown` 早期ガード追加
8. `saveSettings` / `loadSettings` に 2 キー
9. `loadEpubFromCache(bookKey, opts)` の 3 箇所ピッカーガード
10. `loadEpub()` 初回描画後にガイド初回フック
11. `updateHelpContent()` にガイド表示ボタン（`state.epub` 条件内）
12. init: `_idbGetAllKeys().then` 末尾に `autoOpenLastBook()`、`updateAutoOpenToggleUI()` を Init 群へ
13. I18N 4 言語 × 11 キー

### `yomikake.html` のみ

14. `handleSharedFile()` に `_sharedFlowActive = true`（replaceState より前）

### `yomikake_ios.html` のみ

15. `_sharedFlowActive` は宣言のみ（共有受信が無いため常に false）

### リリース

16. `sw.js` の `VERSION` を `'yomikake-shell-v2.7.0'` → `'yomikake-shell-v2.8.0'` にバンプ
17. `CLAUDE.md` 更新（下記§リリース手順）
18. `git tag v2.8.0 && git push --tags`

---

## テスト項目（手動）

1. **ゾーン判定**: 4 パターン × 縦書き / 横書き / publisher(axis h・v) / FXL(rtl・ltr) で
   次・前・メニュー・無反応領域が表どおりか。L字のコーナー 4 箇所が「次優先」か
2. **境界**: xr=0.3 / 0.7 付近で中央と端帯が排他か（タイル確認）
3. **既存操作の無影響**: リンクタップ・テキスト選択（`sel.type==='Range'`）・iOS スワイプ（各書字モード）・
   キーボード・`#btn-scroll-fwd`・FXL ダブルタップ（ズーム切替）・FXL ズーム中のタップ無効
4. **章跨ぎ**: 端タップ連打で章末→次章、最終ページで `showFinishedBanner()`、`_isRendering` 中の連打で
   章スキップしない（`_pendingScrollAfterRender` 経路の回帰確認）
5. **ガイド**: 3 トリガー各経路 / 初回フラグの一回性 / 縦書き・横書きでの左右反転描画 /
   表示中に Escape・Space・矢印が裏に抜けない / 8 テーマでの視認性 / サイドバー開閉・リサイズ後のズレ /
   本未オープン時にヘルプへボタンが出ないこと
6. **自動オープン**: キャッシュ有→前回位置で開く／キャッシュ無→ウェルカム／読了本→スキップ／
   `?shared=1` 共有オープンと競合しない／OFF 設定で不発／purge 済みで不発／
   プライベートモードで不発（例外を出さない）／**自動オープン時にピッカーが絶対に開かない**／
   自動オープン直後の初回ガイド連鎖
7. **設定永続化**: `tapZone` / `autoOpenLast` のリロード後復元、不正値の握り潰し、
   言語切替後もラベルが正しい（`applyI18n()` との整合）
8. **両ファイル**: CRLF / LF が保たれているか（`file yomikake.html` で確認）、iOS 実機で
   FXL タップ 320ms 遅延・スワイプ共存

## リリース手順

1. 両ファイル実装 → `sw.js` の `VERSION` バンプ（HTML 変更のため必須）
2. `CLAUDE.md` 更新:
   - 「Both files」リストに `tapZoneAction` / `runTapAction` / `showTapGuide` / `hideTapGuide` /
     `autoOpenLastBook` を追記
   - `state` 一覧に `tapZone` / `autoOpenLast`
   - localStorage 表に `epub_tap_guide_v1`、`epub_settings` の内容を更新
   - 「Feature differences」に `_sharedFlowActive` の PC/iOS 差を追記
3. `git tag v2.8.0 && git push --tags`

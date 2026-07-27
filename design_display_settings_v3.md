# 表示設定 第3弾 概要設計書（v2.15.0）

対象: `yomikake.html`・`yomikake_ios.html` **両ファイル**（行番号は `yomikake.html` 基準・v2.14.0 時点）

前提: `design_display_settings.md`（第1弾 v2.13.0 / 第2弾 v2.14.0）の続き。§9 に概要だけ書いてあった 3 項目を精緻化する。
B-7（本ごとの表示設定）は規模と永続データ構造が別問題なので `design_per_book_settings.md` に分離し、**v2.16.0** とする。

| 項目 | 内容 | 規模 |
|------|------|------|
| **B-11** | 行間の連続値化 ＋ 字間の追加 | 中 |
| **B-12** | 読み上げ速度を設定パネルにも | 小 |
| **B-13** | 画面の向きロック（対応環境のみ） | 小〜中（環境依存の扱いが本体） |

推奨実装順: **B-12 → B-11 → B-13**（小さく確実なものから。B-13 は実機でしか最終確認できないので最後）

---

## B-11. 行間の連続値化 ＋ 字間

### B-11-1. 現状

```html
<select class="modern-select" id="lineh-select" onchange="changeLineHeight(this.value)">
  <option value="1.6">狭い</option><option value="2.0" selected>標準</option>
  <option value="2.4">広い</option><option value="2.8">かなり広い</option>
</select>
```

`state.lineHeight`（数値）は `buildSrcdoc()`（`yomikake.html:3623`）で 2 箇所に注入される。

```js
'html{font-size:' + state.fontSize + '%!important;line-height:' + state.lineHeight + '!important;' + wmHtml + '}',
'body{' + wmBody + 'line-height:' + state.lineHeight + '!important;}',
```

4 段階固定だが、**縦書きの行間は好みの幅が広い**（明朝で詰めたい人と、ルビ付きで広く取りたい人で 1.6 と 2.8 の間が欲しくなる）。字間（`letter-spacing`）は現在**一切注入していない**。

### B-11-2. 行間：連続値スライダー化

- `<select id="lineh-select">` を **`<input type="range" id="lineh-range" min="1.4" max="3.0" step="0.1">`** に置換。
  第2弾で入れた `.range-wrap` / `.set-range` / `.range-val` をそのまま使う。
- 既存の保存値 1.6 / 2.0 / 2.4 / 2.8 は**すべて新レンジ内かつ 0.1 刻みに乗る**ので移行処理は不要。
- `changeLineHeight(v)` は `parseFloat` のまま。範囲外を弾くガードを追加する。

```js
function changeLineHeight(v) {
  const n = Math.round(parseFloat(v) * 10) / 10;
  if (!(n >= 1.4 && n <= 3.0)) return;
  state.lineHeight = n;
  const el = document.getElementById('lineh-val'); if (el) el.textContent = n.toFixed(1);
  saveSettings();
  rerenderKeepPos();
}
```

`loadSettings()` の検証も範囲チェックに変える（現状は `if (s.lineHeight)` の真偽だけ）:

```js
if (typeof s.lineHeight === 'number' && s.lineHeight >= 1.4 && s.lineHeight <= 3.0) {
  state.lineHeight = Math.round(s.lineHeight * 10) / 10;
  const el = document.getElementById('lineh-range'); if (el) el.value = String(state.lineHeight);
}
```

- **`#lineh-select` を参照している箇所を全部潰すこと**: `loadSettings()`（`:5448`）、`syncAllSettingsUI()`（`:7656`）、`tests/cases/display-reset.js`。
  v2.13.0 で直した「`String(2.0)` が `'2'` になり option と一致しない」問題は、**range には存在しない**（range は数値として解釈する）。むしろこの置換でその落とし穴自体が消える。
- **スライダーは `oninput` で即時反映しない**。`rerenderKeepPos()` は章全体を再描画するので、ドラッグ中に毎ステップ走ると重い。**`onchange`（ドラッグ終了時）で再描画**し、`oninput` では数値ラベルだけ更新する。これは明るさ（CSS 変数だけで完結）と事情が違う点に注意。

### B-11-3. 字間（letter-spacing）

- `state.letterSpacing`（0–5 の段階）を追加。**`state.warmth` と同じ 0–5 の段階方式**に揃える
  （`em` の生値をスライダーに出しても大半の読者には意味が読めないため）。

```js
// 段階 → em。日本語縦組みでは 0.12em でもかなり緩い
const LETTER_SPACING_EM = [0, 0.02, 0.04, 0.06, 0.09, 0.12];
```

- `buildSrcdoc()` の注入は **`body` 側 1 箇所**に足す（`html` には入れない。`html` に入れると
  ルビや縦中横の計算基準がぶれるうえ、`body` へ継承されるので二重指定になる）:

```js
const ls = LETTER_SPACING_EM[state.letterSpacing] || 0;
// body の既存注入に追記
'body{' + wmBody + 'line-height:' + state.lineHeight + '!important;'
  + (ls ? 'letter-spacing:' + ls + 'em!important;' : '') + '}',
```

- **`rt` は必ず打ち消す**。`letter-spacing` は継承するので、指定するとルビ文字まで間延びして親字とのバランスが崩れる。
  オーバーライド CSS に 1 行足す:

```css
rt, rp { letter-spacing: normal !important; }
```

- **既知の副作用（設計書に残す）**
  - CSS の `letter-spacing` は**最後の文字の後ろにも**空きを入れる。ePub 側が `text-align:justify` を
    かけている本では行末が 1 字分ずれて見えることがある。0 のときは注入自体をしないので、既定では発生しない。
  - `text-combine-upright`（縦中横）の内側には効かないが、その塊の**後ろ**には空きが入る。
  - FXL は画像なので無関係。字間の行はタイポグラフィグループ（`.fxl-hide-group`）にあるので
    FXL では自動的に隠れる。**新たな出し分けは不要**。

### B-11-4. UI

タイポグラフィグループの「行間」行を置換し、その下に「字間」を足す。

```html
<div class="set-row">
  <span class="set-label" data-i18n="settings.lineHeight">行間</span>
  <div class="range-wrap">
    <input type="range" class="set-range" id="lineh-range" min="1.4" max="3.0" step="0.1" value="2.0"
           oninput="previewLineHeight(this.value)" onchange="changeLineHeight(this.value)">
    <span class="range-val" id="lineh-val">2.0</span>
  </div>
</div>
<div class="set-row">
  <span class="set-label" data-i18n="settings.letterSpacing">字間</span>
  <div class="range-wrap">
    <input type="range" class="set-range" id="letter-spacing-range" min="0" max="5" step="1" value="0"
           oninput="previewLetterSpacing(this.value)" onchange="changeLetterSpacing(this.value)">
    <span class="range-val" id="letter-spacing-val">0</span>
  </div>
</div>
```

`previewXxx()` は数値ラベルの更新のみ（再描画しない）。

### B-11-5. 追加キーとリセット

| キー | 型 / 範囲 | 既定 |
|------|-----------|------|
| `lineHeight` | number 1.4–3.0（0.1 刻み） | `2.0`（変更なし） |
| `letterSpacing` | number 0–5 | `0` |

`DISPLAY_DEFAULTS` に `letterSpacing:0` を追加。`syncAllSettingsUI()` で 2 つの range と数値ラベルを同期。

### B-11-6. i18n

`settings.letterSpacing`（字間 / Letter spacing / 字距 / 字距）。行間のラベルキーは既存を流用。
「狭い/標準/広い/かなり広い」の 4 キー（`lh.narrow` 等）は**未使用になるが削除しない**
（他所からの参照が無いことを確認したうえで、消すなら別コミットにする）。

---

## B-12. 読み上げ速度を設定パネルにも

### B-12-1. 現状の非対称

`state.ttsRate` は **`#tts-bar` の ＋/－ ボタン（`changeTtsRate(±0.25)`）からしか変更できない**。
`#tts-bar` は `body.tts-active` のときだけ出るので、**再生を始める前に速度を決められない**。
一方 `#tts-settings-group`（🔊 読み上げ）には「音声」しか無く、速度だけが設定に無い。

### B-12-2. 変更

- **絶対値セッター `setTtsRate(v)` を新設**し、`changeTtsRate(delta)`（バーの ＋/－ 用・HTML の
  インライン `onclick` から呼ばれている）はそれを呼ぶ薄いラッパにする。

```js
function setTtsRate(v) {
  var r = Math.round(parseFloat(v) * 100) / 100;
  if (!(r >= 0.5 && r <= 2)) return;
  if (r === state.ttsRate) { updateTtsUI(); return; }
  state.ttsRate = r;
  saveSettings();
  updateTtsUI();
  if (_tts.active && !_tts.paused) ttsSpeakNext();   // 現チャンクを新速度で再生し直す
}
function changeTtsRate(delta) {
  setTtsRate(Math.max(0.5, Math.min(2, (state.ttsRate || 1) + delta)));
}
```

- 設定の「🔊 読み上げ」グループに「速度」行（`<select id="tts-rate-select">`・0.5 / 0.75 / 1.0 / 1.25 / 1.5 / 1.75 / 2.0）を
  **「音声」行の上**に置く（速度のほうが使用頻度が高い）。
- **`updateTtsUI()` にセレクトの同期を足す**のが要点。バーで変えても設定側が追従しないと 2 つの UI が食い違う。

```js
var rs = document.getElementById('tts-rate-select');
if (rs) rs.value = (state.ttsRate || 1).toFixed(2);
```

  `<option value="1.00">` のように **`toFixed(2)` と一致する文字列**を value に書くこと
  （v2.13.0 の行間セレクト空欄バグと同じ罠）。

### B-12-3. ついでに直す既存の不整合

`ttsInit()`（`:5843`）は `_ttsSupported` が false のとき **`#tts-btn` を隠すだけ**で、
`#tts-settings-group` は出したままになっている。音声が 1 つも無い環境（ヘッドレス、Linux Firefox 等）で
「音声：自動」だけの空グループが残るので、**グループごと隠す**。

```js
if (!_ttsSupported) {
  var b = document.getElementById('tts-btn'); if (b) b.style.display = 'none';
  var g = document.getElementById('tts-settings-group'); if (g) g.style.display = 'none';
  return;
}
```

これは A-2（ツールバー項目）で「効果の無い設定行は出さない」と決めた方針と同じ。

### B-12-4. リセットの扱い

**`ttsRate` はリセット対象に入れない**（第1弾で決めた「読み上げ設定は触らない」を維持）。
設定パネルに現れるようになっても方針は変えない — 表示設定ではなく読み上げの設定であるため。

---

## B-13. 画面の向きロック

### B-13-1. 何が難しいか

`screen.orientation.lock()` は**環境差が大きく、しかも失敗の仕方が分かりにくい** API。

| 環境 | 想定 |
|------|------|
| Android Chrome・**全画面 or インストール済み PWA** | 動く見込み |
| Android Chrome・通常のタブ | `lock()` が reject（全画面/standalone が要る） |
| iOS Safari / ホーム画面 PWA | **`lock()` 自体が無い見込み** |
| デスクトップ | 意味が無い（`lock()` があっても効果なし） |

**これらは実装時に実機で確認すること。** 本設計はブラウザの挙動を当てにせず、
**「機能検出 → 実際に試す → 失敗したら黙って元に戻して理由を伝える」**で組む。

### B-13-2. 設計方針

1. **設定行は `screen.orientation` に `lock` が生えている環境でだけ出す。**
   出しっぱなしにすると iPhone で「押しても何も起きない設定」になる（B-13 を第3弾に落とした元々の理由）。

```js
const _orientationLockSupported =
  typeof screen !== 'undefined' && screen.orientation &&
  typeof screen.orientation.lock === 'function';
```

2. **ロックは全画面（読書モード）に紐付ける。** 単独で `lock()` を呼んでも多くの環境で reject されるため、
   `toggleFullscreen()` で全画面に入るときに掛け、抜けるときに解除する。
   これは「向きを固定したいのは没入して読むとき」という実際の用途とも合う。
3. **失敗は握り潰さず、設定を `'off'` に戻して 1 度だけトーストで伝える。**
   黙って効かない設定が残るのがいちばん悪い。

### B-13-3. state と UI

```js
orientationLock:'off',   // 'off' | 'portrait' | 'landscape'（epub_settings に永続化）
```

レイアウトグループに 1 行。`_orientationLockSupported` が false なら行ごと `display:none`。

```html
<div class="set-row" id="orientation-lock-row">
  <span class="set-label" data-i18n="settings.orientationLock">画面の向き（全画面時）</span>
  <select class="modern-select" id="orientation-lock-select" onchange="changeOrientationLock(this.value)">
    <option value="off" data-i18n="orient.off">固定しない</option>
    <option value="portrait" data-i18n="orient.portrait">縦で固定</option>
    <option value="landscape" data-i18n="orient.landscape">横で固定</option>
  </select>
</div>
```

ラベルに **「（全画面時）」を必ず入れる** — 通常のタブでは効かないことを UI 自身に語らせる。

### B-13-4. 実装

```js
function changeOrientationLock(v) {
  if (['off','portrait','landscape'].indexOf(v) < 0) return;
  state.orientationLock = v;
  saveSettings();
  applyOrientationLock();   // 全画面中なら即座に反映
}

// 全画面に入る/出る・設定変更 のすべてから呼ぶ同期点
function applyOrientationLock() {
  if (!_orientationLockSupported) return;
  if (!state.fullscreen || state.orientationLock === 'off') {
    try { screen.orientation.unlock(); } catch (e) {}
    return;
  }
  screen.orientation.lock(state.orientationLock).catch(() => {
    // 全画面/インストール要求など、環境が許さなかった場合は設定ごと戻す
    state.orientationLock = 'off';
    const el = document.getElementById('orientation-lock-select'); if (el) el.value = 'off';
    saveSettings();
    showToast(t('toast.orientationFailed'));
  });
}
```

- `toggleFullscreen()` の**両方の分岐**の後（= `syncFsHud()` の隣）で `applyOrientationLock()` を呼ぶ。
- `fullscreenchange` の外部解除ハンドラでも呼ぶ（B-9 の `syncFsHud()` と同じ扱い）。
- `screen.orientation.lock()` は Promise を返さない実装が過去にあったため、
  **`.catch` を呼ぶ前に返り値が thenable か確認する**のが安全:

```js
const p = screen.orientation.lock(state.orientationLock);
if (p && typeof p.catch === 'function') p.catch(onFail); 
```

### B-13-5. i18n

`settings.orientationLock` / `orient.off` / `orient.portrait` / `orient.landscape` / `toast.orientationFailed`。

トースト文面（ja）: 「画面の向きを固定できませんでした。ホーム画面に追加した状態でお試しください」
— 失敗理由として最も多いと見込まれる条件を示す。

### B-13-6. リセット

`DISPLAY_DEFAULTS` に `orientationLock:'off'` を追加。リセット時は `applyOrientationLock()` も呼んで解除する。

---

## 共通事項

### 追加する `epub_settings` キー

| キー | 型 / 範囲 | 既定 | 項目 |
|------|-----------|------|------|
| `letterSpacing` | number 0–5 | `0` | B-11 |
| `orientationLock` | `'off'｜'portrait'｜'landscape'` | `'off'` | B-13 |

`lineHeight` は型・キーとも変更なし（値域が 4 値 → 1.4–3.0 に広がるだけ）。
`ttsRate` は既存キーのまま（UI が増えるだけ）。

### テスト（`tests/cases/`）

- **`typography.js`（新規）** — 行間 range の範囲・0.1 刻み・範囲外の拒否・保存復元、
  字間の段階→em 変換、`rt` の打ち消しが注入 CSS に入ること、リセット、i18n。
  **`buildSrcdoc()` の出力文字列を直接検査**するのが確実（`state` を変えて `renderPage` 後の
  `iframe.srcdoc` に `letter-spacing` と `rt{...normal}` が含まれるかを見る）。
- **`tts-rate.js`（新規）** — `setTtsRate` の範囲、バー ⇄ セレクトの相互同期（**両方向**）、
  `toFixed(2)` と option value の一致、`_ttsSupported=false` でグループが隠れること、
  **リセットで `ttsRate` が変わらないこと**。
- **`orientation-lock.js`（新規）** — `screen.orientation.lock` をモックして
  成功時／reject 時の挙動（設定が `off` に戻る・トースト）、非対応環境で行が隠れること、
  全画面の出入りで `lock`/`unlock` が呼ばれること。**実機の実挙動は対象外**。
- 既存 `display-reset.js` の `lineHeight` 期待値を range 前提に更新。

### 実機で確認すること

- **B-11**: 縦書きで字間を上げたときのルビ・縦中横の見え方（`rt` 打ち消しが効いているか）、
  行末の揃い方。スライダーのドラッグ中に再描画が走らないこと（`onchange` 方式の確認）。
- **B-13**: Android Chrome の通常タブ／全画面／ホーム画面 PWA の 3 通り、iPhone・iPad で
  **設定行がそもそも出ないこと**。失敗トーストが出る条件。

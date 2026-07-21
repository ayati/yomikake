# 設計書: 読み上げ機能（design_tts.md）

作成日: 2026-07-20
最終更新: 2026-07-21（実装完了・Playwright 自動検証済み）
対象: `yomikake.html` / `yomikake_ios.html`（両ファイル共通実装）
ステータス: **実装済み（v2.9.0・両ファイル＋sw.js VERSION→v2.9.0 バンプ済み。実機テストはユーザー担当・未コミット）**

> **実装メモ（設計との差分）:**
> - 手動ナビ再読込は `ttsOnUserNavigate()` → `setTimeout(0)` → `ttsLoadChapterAndSpeak(currentSpineIdx,0,false)` に分離。
>   章送りの `ttsAdvanceChapter()` も同じ `ttsLoadChapterAndSpeak(next,0,true)` を使い、空章は `skipToNext` で次章へ送る。
> - プレイヤーバーのボタン記号は絵文字を避け幾何文字（◀◀ ‖ ▶▶ ■ － ＋）を採用（テキストフォントで確実に表示）。
> - `ttsPlay()` 冒頭で `state.renderMode==="fxl"` ガード（🔊 は CSS で非表示だが二重の安全弁）。
> - **自動検証（Playwright・両ファイル ALL PASS・37項目）**: `speechSynthesis`/`SpeechSynthesisUtterance` を
>   モックし `onend` を手動発火。抽出（ルビ rt 優先・rp 除去・rt 無しフォールバック・複数 rt・head 除去・
>   ブロック改行・エンティティ・tcy 残存）、分割（句点3分割・閉じ括弧巻込み・120字強制分割・読点分割・空捨て）、
>   状態遷移（active/バー表示/1文単位 speak/pause-resume/idx進行）、章送り・手動ナビ読み直し、
>   速度clamp・音声フィルタ・永続化、クリーンアップ（stop/closeBook/本切替）、FXL で 🔊 非表示＋非起動、
>   ヘルプ4言語を確認。既存6スイート回帰なし。実音声・iOS ジェスチャ・Wake Lock はユーザー実機テスト。

## 決定事項（設計前提）

- 方式は **Web Speech API（`speechSynthesis`）** — 追加依存ゼロ・無料・オフライン可・2ファイル構成維持
- **同期ハイライトはやらない**（「音声だけ流す」割り切り。画面との同期は章単位のみ）
- ルビは **rt 優先固定**（ふりがなを読み、親文字を捨てる。設定切替なし）
- 画面追従は **章単位**（章を読み終えたら自動で次章へ `renderPage`。しおりは文単位で保存）
- **Wake Lock（画面消灯防止）は Phase 1 に含める**（画面ロックで停止する制約の緩和として必須）

## 現行コード照合で判明した設計変更（初版からの修正）

v2.8.0 実装後の現行コードを検証した結果、初版設計を以下のとおり修正した。行番号はいずれも v2.8.0 時点。

| # | 初版 | 修正後 | 根拠 |
|---|------|--------|------|
| 1 | テキスト取得は runSearch と同じ `state.opfDir + item.href.split('#')[0]` で再構築 | **`state.spine[idx].absPath` を直接使う** | spine 構築時に `absPath: state.opfDir + href` を格納済み（yomikake.html:2492）。`renderPage` も `state.epub.file(spineItem.absPath)` で取得している（yomikake.html:3401）。同じ経路に揃える |
| 2 | EPUB_POS ハンドラで「savePos をスキップ」 | **既存の `if (!_isRendering)` ブロック内で `savePos` だけを `!_tts.active` でガードし、`_intraChapterRatio` 更新と `updatePageInfo()` は残す** | 現行は `_intraChapterRatio = e.data.ratio; savePos(e.data.ratio); updatePageInfo();` が一体（yomikake.html:4404-4412）。進捗バー表示は残す必要があるため savePos だけ分岐 |
| 3 | 章末→次章は「EPUB_EDGE と同じ」 | **TTS 独自に `renderPage(idx+1,'start')` を呼ぶ**（EPUB_EDGE 経由ではない） | EPUB_EDGE はスクロール由来（yomikake.html:4388）。TTS は章末チャンクの `onend` で自分で次章へ進む。最終章は EPUB_EDGE と同じく `savePos(1.0)` + `showFinishedBanner()` |
| 4 | `renderPage()` 冒頭にフック | **`renderPage` の早期 return（`if(!state.epub...) return`）の直後、FXL 分岐より前**に置く | FXL 分岐が冒頭にある（yomikake.html:3385）。TTS は reflow のみだが、手動ナビ検出フックは全経路が通る位置＝早期 return 直後が最適 |
| 5 | 自動テスト前提 | **ヘッドレス環境は音声ゼロ（実測: Chromium で `getVoices()=0`）。Playwright は API 呼び出し・状態遷移・UI 出現・テキスト抽出/分割・クリーンアップまでを検証し、実音声は手動確認**（§テスト参照） | ヘッドレス Chromium に TTS エンジンが無いことを確認済み。`speechSynthesis` / `SpeechSynthesisUtterance` / `navigator.wakeLock` の存在は確認済み |

## 背景・方式選定

却下した代替案：

| 案 | 却下理由 |
|----|----------|
| クラウド TTS API（Google/Polly/OpenAI 等） | 静的 HTML では API キー管理が破綻。従量課金・要ネットワークが「無料・オフライン・サーバレス」方針に反する |
| ブラウザ内ニューラル TTS（Piper/VOICEVOX 系 WASM） | モデル数十〜数百 MB。単一 HTML 同梱不能・実装大 |
| OS 機能の案内のみ（iOS 画面の読み上げ等） | 章跨ぎ・自動送りができず体験が劣る。**ヘルプ内の補足案内として吸収** |

Web Speech API の音質は端末依存（iOS の Kyoko/Siri 音声は良好、Windows/Android は中程度）だが、
なろう系 Web 小説の「ながら聴き」用途には十分と判断。

## スコープ

| Phase | 内容 |
|-------|------|
| 1 | リフロー本の読み上げ一式：rt 優先抽出・文分割チャンク再生・章自動送り・文単位しおり保存・Wake Lock・プレイヤー UI・音声/速度設定 |
| 2 | FXL 透明テキスト読み上げ（ルビ・柱・ノンブルの font-size フィルタ）、スリープタイマー（15/30/60分）、（検討）文頭への画面スクロール同期 |
| 対象外 | 同期ハイライト、バックグラウンド再生（`speechSynthesis` は Media Session に乗らず技術的に不可能）、クラウド TTS |

## state / 永続化

`state` オブジェクトに追加（`autoOpenLast` の近く）：

```js
// epub_settings に永続化
ttsRate:  1.0,    // 0.5–2.0（0.25 刻み）
ttsVoice: '',     // 選択音声の voiceURI。'' = 自動（bookLang 一致のデフォルト音声）
// セッションのみ（永続化しない）
bookLang: 'ja',   // OPF dc:language の先頭2文字。loadEpub で抽出、無ければ 'ja'
```

`saveSettings()`（yomikake.html:5013 付近 / ios:5013）の JSON に `ttsRate` / `ttsVoice` を追加。
`loadSettings()` に検証付き復元（`ttsRate` は 0.5–2.0 の数値のみ、`ttsVoice` は文字列）。

```js
// モジュール変数（非永続 — 再生状態は本を開くたびリセット）
let _tts = { active:false, paused:false, chunks:[], idx:0, spineIdx:-1 };
let _ttsWakeLock = null;      // WakeLockSentinel
let _ttsInternalNav = false;  // TTS 自身の章送り renderPage を手動操作と区別するフラグ
```

**`bookLang` の抽出**は `loadEpub()` の dc:creator 読み出し（yomikake.html:2565-2567 / ios:2882）の直後に追加：

```js
const langEl = opfDoc.querySelector('metadata > *|language, metadata > language');
state.bookLang = (langEl && langEl.textContent.trim().slice(0,2).toLowerCase()) || 'ja';
```

（`dc:language` は `ja` / `ja-JP` / `en` 等。先頭2文字で voice の `lang` 前方一致に使う）

## テキスト抽出（`ttsExtractText` / `ttsSplitChunks`）

取得経路は `renderPage` と同一：`state.epub.file(state.spine[idx].absPath).async('text')`。

**既存 `htmlToText()`（yomikake.html:4881 / ios:5151）は流用しない**（検索用に温存）。`<rt>` を除去しないため
読み上げに使うと「漢字かんじ」の二重読みになる。新設 `ttsExtractText(html)` のパイプライン：

1. `<head>` / `<script>` / `<style>` 除去（htmlToText と同一の正規表現）
2. **ルビ置換（rt 優先）**：`<ruby ...>…</ruby>` ブロックを内部の `<rt>` 内容の連結で置換。
   `<rp>` は除去。`<rt>` が 1 つも無い ruby は内部テキスト（タグ除去のみ）にフォールバック。
   なろう系の人名・固有名詞ルビが正しく読まれるのが最大の品質改善
3. ブロック要素の閉じ（`</p>` `</div>` `</h1>`〜`</h6>` `</li>` `</blockquote>`）と `<br>` を改行に変換
   （文境界の手がかりを残してから 4 でタグ除去）
4. 残りタグ除去・エンティティ復元（htmlToText と同一）。ただし空白正規化は**行単位**
   （`\s+`→` ` の全面つぶしをせず改行は保持）

`ttsSplitChunks(text)` — 文単位チャンク分割：

- `。．！？!?` の直後で分割（直後に続く `」』）】` などの閉じ括弧は前の文に含める）。改行も境界
- **1 チャンク最大 ~120 文字のハードキャップ**。超過時は `、` で、それも無ければ強制分割。
  これは好みでなく必須 — Chrome はネットワーク音声の長い utterance が約 15 秒で無音停止するバグがあり、
  短文チャンクが唯一堅牢な回避策
- 空白のみのチャンクは捨てる。結果 `string[]` を `_tts.chunks` に保持

## 再生エンジン

```
ttsPlay()        — 🔊 ボタン。未再生なら現在章を抽出し、開始チャンク =
                   floor(_intraChapterRatio × chunks.length) から再生（読んでいた位置の近くから）。
                   再生中なら一時停止/再開トグル
ttsSpeakNext()   — chunks[idx] の utterance を speak。onend → savePos(idx/chunks.length) → idx++ → 次へ。
                   idx が末尾を超えたら章送り（下記）
ttsPause()       — speechSynthesis.cancel() + paused=true。※pause()/resume() は iOS で不安定なため不使用。
                   再開は現チャンク頭から ttsSpeakNext()
ttsStop()        — cancel + 状態クリア + Wake Lock 解放 + UI 非表示 + savePos
ttsPrevSent() / ttsNextSent() — idx±1 して cancel → ttsSpeakNext()（プレイヤーバーの ⏮⏭）
```

- utterance には `voice`（解決順：保存 voiceURI → bookLang 前方一致のデフォルト → 中止）、`rate`、
  `lang = state.bookLang` を設定
- `onerror` は `interrupted` / `canceled`（自分の cancel 由来）を無視し、それ以外は toast + `ttsStop()`
- `getVoices()` は非同期投入されるため `voiceschanged` イベントで音声リストを再構築
  （実測：Chromium は初回 `getVoices()` が 0 を返し、`voiceschanged` 後に埋まる）
- **速度変更は現チャンクを cancel して同 idx から再開**（即時反映。utterance 途中の rate 変更は
  ブラウザが無視するため）
- **該当言語の音声がゼロの環境**（Linux Firefox・ヘッドレス等）：再生開始を中止し toast `tts.noVoice`
  （英語音声で日本語を読んでも無意味なため続行しない）

### iOS のジェスチャアンロック

iOS Safari は最初の `speak()` がユーザージェスチャ由来であることを要求する。チャンク抽出は
async（`file.async`）でジェスチャコンテキストを失うため、**🔊 クリックハンドラ内で同期的に
空 utterance（`' '`）を speak してアンロック**し、その後 async 抽出 → 本再生に入る。
rate は iOS で実効範囲が狭いため 0.5–2.0 に clamp（両ファイル共通で同じ clamp を適用）。

## 章単位追従

- 章末到達（`idx >= chunks.length`）→ 次章があれば
  `_ttsInternalNav = true; await renderPage(spineIdx+1, 'start'); _ttsInternalNav = false` →
  新章を `ttsExtractText`/`ttsSplitChunks` で抽出し `idx=0` から継続。
  `renderPage` 冒頭の既存 `savePos(0)`（yomikake.html:3398）で章頭しおりも既存経路のまま保存される
- 最終章の末尾まで読み終えたら `savePos(1.0)` + `_bookFinished = true` + `showFinishedBanner()` + `ttsStop()`
  （スクロール読了と同じ扱い。`_bookFinished` は yomikake.html:3355 の既存フラグ）
- **手動ナビゲーションとの整合**：`renderPage()` の早期 return 直後（FXL 分岐より前）にフックを 1 つ追加：
  ```js
  if (_tts.active && !_ttsInternalNav) { ttsOnUserNavigate(idx); }
  ```
  `ttsOnUserNavigate(idx)` は cancel して **新章の頭（idx=0）から読み直し**。TOC・章ボタン・検索ジャンプ・
  進捗バークリック・アンカージャンプはすべて `renderPage` を通るため個別対応不要
- **章内スクロールは TTS に影響しない**。ただし再生中は EPUB_POS ハンドラ（yomikake.html:4404-4412）の
  **`savePos` のみ `!_tts.active` でスキップ**（TTS の文単位しおりを無意識スクロールで上書きさせない）。
  `_intraChapterRatio = e.data.ratio` と `updatePageInfo()` は残す（進捗バーは動いてよい）：
  ```js
  if (!_isRendering) {
    _rdRecordActivity();
    _intraChapterRatio = e.data.ratio;
    if (!_tts.active) savePos(e.data.ratio);   // ← TTS 中はしおり保存だけ抑止
    updatePageInfo();
  }
  ```

## Wake Lock（Phase 1）

- 再生開始で `navigator.wakeLock.request('screen')`、`ttsPause()` / `ttsStop()` / エラーで release
  （`navigator.wakeLock` の存在は実測確認済み。無い環境は try/catch で黙って無視）
- Wake Lock はタブ非表示で自動解放されるため、`visibilitychange` で visible 復帰時に
  `_tts.active && !_tts.paused` なら**再取得＋現チャンクから再生再開を試みる**（画面ロックで
  speechSynthesis が止まった後の復帰を best effort でカバー）
- 非対応ブラウザは黙って続行（読み上げ自体は可能。画面消灯で止まるのは既知の制限として明記）

## UI

### ツールバー 🔊 ボタン（`#tts-btn`）

- `icon-btn`。目アイコン（`showNavHint` を呼ぶ `btn.flash` ボタン、yomikake.html:687）の隣に配置
- 未再生 → `ttsPlay()`。再生中 → 一時停止/再開トグル。再生中は `.tts-active` クラスでアクセント表示
- **FXL 本では非表示**（`body.mode-fxl #tts-btn { display:none }` — `mode-fxl` は yomikake.html:2524 で
  toggle 済み。Phase 2 で解禁）

### プレイヤーバー（`#tts-bar`）

- `#main` 内下部の固定バー（`#fxl-region-pill`（yomikake.html:365,919）と同系の浮遊 UI）。
  `body.tts-active` クラスで表示制御。**z-index は 40 前後**（`#mobile-progress`=25 / `#fxl-region-pill`=28
  より上、`#finished-banner`=50・`#modal-overlay`=200 より下。モーダル/読了バナー表示時はそれらが上に載る）
- 要素：`⏮`（前の文）・`⏯`（一時停止/再開）・`⏭`（次の文）・`■`（停止）・
  `－ 1.0x ＋`（速度 0.25 刻み 0.5–2.0、変更時 `saveSettings()`）・進捗テキスト `文 i/total`
- **フルスクリーン中も表示される**：`#toolbar` / `#statusbar` は `position:fixed` で画面外へ退避する
  （yomikake.html:588-593）が、`#tts-bar` は `#main` の子なので退避対象に含まれない。追加対応不要
- Escape 優先度チェーンには**入れない**（誤停止防止。停止は明示的に ■ で）

### 設定ポップオーバー

「🔊 読み上げ」group を **`#drive-auto-group`（yomikake.html:844）の直前**に新設。行は **音声選択のみ**
（`#tts-voice-select`：先頭に「自動」、以下 `getVoices()` を `state.bookLang` 前方一致でフィルタ、
該当ゼロなら全音声。`voiceschanged` と本オープンで再構築）。速度はプレイヤーバー側に一本化し
二重 UI の状態同期を避ける。

## クリーンアップ・安全策

- `ttsStop()` を呼ぶ箇所：`closeBook()`（yomikake.html:6132 付近、`hideTapMenu()` の並び）、
  `loadEpub()` 冒頭（本切替、`finalizeCurrentBook()` の並び yomikake.html:2446）。二重呼び出し安全に実装
- `beforeunload` で `speechSynthesis.cancel()`（ブラウザによってはページ離脱後も声が残るため）
- ePub 由来テキストは `SpeechSynthesisUtterance.text` に渡すのみ（DOM 注入なし）で XSS 面の新規リスクなし

## 既知の制限（ヘルプに明記する内容）

1. **画面ロック・タブ切替で停止する**（`speechSynthesis` は Media Session 非対応で回避不能）。
   Wake Lock により再生中は画面が消灯しない。輝度を下げての利用を案内
2. 音質・アクセントは端末の TTS エンジン依存。iOS は 設定→アクセシビリティ→読み上げコンテンツ で
   高品質声を追加ダウンロード可能（ヘルプに記載）
3. ルビ付き箇所はルビ（ふりがな）を読む。義訓ルビ（「本気（マジ）」等）は原文と読みが変わる
4. OS 標準の読み上げ機能（iOS「画面の読み上げ」/ Android「選択して読み上げ」）も併用可能な旨を補足

## i18n キー（4 言語: ja / en / zh-TW / zh-CN）

`I18N` の各言語ブロックに追加（`btn.flash` などツールバー系キーの近傍）。iOS も同構成。

| キー | ja | en |
|------|----|----|
| `btn.tts`（title） | 読み上げ | Read aloud |
| `tts.pause` | 一時停止 | Pause |
| `tts.resume` | 再開 | Resume |
| `tts.stop` | 停止 | Stop |
| `tts.prevSent` | 前の文 | Previous sentence |
| `tts.nextSent` | 次の文 | Next sentence |
| `tts.noVoice` | この言語の音声がこの端末にありません | No voice for this language on this device |
| `tts.done` | 読み上げが終わりました | Finished reading |
| `settings.ttsGroup` | 🔊 読み上げ | 🔊 Read aloud |
| `settings.ttsVoice` | 音声 | Voice |
| `tts.voiceAuto` | 自動 | Auto |
| `tts.speed` | 速度 | Speed |

ヘルプ本文（`help.body`・4言語×2ファイル）にも「🔊 読み上げ」節を1つ追加し、上記の既知の制限を記載する。

## localStorage / 設定への追加まとめ

| 保存先 | キー | 内容 |
|--------|------|------|
| `epub_settings` | `ttsRate` | 0.5–2.0（既定 1.0） |
| `epub_settings` | `ttsVoice` | 選択音声の voiceURI（既定 `''` = 自動） |

`bookLang` は state のみ（永続化しない）。Drive 同期・しおりエクスポートには含めない（表示設定と同じ端末ローカル方針）。

## テスト戦略（ヘッドレスに音声が無い前提）

ヘッドレス Chromium は `getVoices()=0`（実測）で**実音声を鳴らせない**。自動と手動を分ける。

### Playwright で自動検証できるもの

- `ttsExtractText`：ルビ rt 優先置換（`<ruby>漢<rt>かん</rt></ruby>` → `かん`）、rt 無し ruby のフォールバック、
  `<rp>` 除去、ブロック境界の改行化、エンティティ復元
- `ttsSplitChunks`：句読点分割、120 字ハードキャップ、句読点なし長文の強制分割、閉じ括弧の巻き込み、空チャンク除去
- 音声ゼロ環境で `ttsPlay()` が `tts.noVoice` トーストを出して再生に入らないこと（＝ヘッドレスそのものが検証環境）
- `SpeechSynthesisUtterance` をモック（`window.speechSynthesis` を差し替え）して：
  chunk キューが順に speak されること、`onend` で idx が進むこと、章末で `renderPage` が呼ばれること、
  `savePos(idx/total)` が呼ばれること、手動ナビ（`renderPage`）で `ttsOnUserNavigate` が発火すること、
  EPUB_POS 中に TTS active なら savePos が抑止されること
- UI：🔊 ボタンの表示/トグル、プレイヤーバーの `body.tts-active` 表示、FXL 本で 🔊 非表示、
  設定の音声セレクト構築、`closeBook`/`loadEpub` でバーが消え `_tts.active=false` になること
- 設定永続化：`ttsRate`/`ttsVoice` のリロード復元、不正値の握り潰し

### 手動確認（実機・実音声）

1. **ルビ**：rt 優先で二重読みなし・縦中横（tcy span）が数字として読まれる
2. **チャンク**：長章（1万字超）を 10 分以上連続再生して Chrome 15 秒バグが出ない
3. **章送り**：章末→次章の自動継続・最終章末で読了バナー＋停止
4. **iOS**：ジェスチャアンロック（初回タップで確実に鳴る）・cancel＋再開方式の一時停止・rate clamp
5. **Wake Lock**：再生中の画面消灯なし・pause/stop で解放・タブ復帰で再取得＋再生再開
6. **音声/速度**：voiceURI 永続化・保存音声が無い端末で自動フォールバック・速度即時反映
7. **クリーンアップ**：本切替/リストへ/リロードで声が残らない・`file://` で動作

## 実装チェックリスト（ファイル別）

`yomikake.html` は **CRLF**、`yomikake_ios.html` は **LF**。編集時は改行コードを保つこと
（複数行の機械編集は Python スクリプトで改行変換して literal replace する）。

### 共通（両ファイル・同一内容）

1. HTML：`#tts-btn`（ツールバー）、`#tts-bar`（`#main` 内）、設定「🔊 読み上げ」group、`#tts-voice-select`
2. CSS：`#tts-btn` / `#tts-bar` / `.tts-active` / `body.mode-fxl #tts-btn{display:none}`
3. `state`：`ttsRate` / `ttsVoice` / `bookLang` 追加
4. モジュール変数：`_tts` / `_ttsWakeLock` / `_ttsInternalNav`
5. 関数：`ttsExtractText` / `ttsSplitChunks` / `ttsPlay` / `ttsSpeakNext` / `ttsPause` / `ttsStop` /
   `ttsPrevSent` / `ttsNextSent` / `ttsOnUserNavigate` / `ttsResolveVoice` / `ttsRequestWakeLock` /
   `ttsReleaseWakeLock` / `changeTtsRate` / `changeTtsVoice` / `buildTtsVoiceSelect` / `updateTtsUI`
6. `loadEpub`：`bookLang` 抽出、冒頭に `ttsStop()`
7. `renderPage`：早期 return 直後に手動ナビ検出フック
8. EPUB_POS ハンドラ：`savePos` を `!_tts.active` でガード
9. `closeBook`：`ttsStop()`
10. `saveSettings` / `loadSettings`：`ttsRate` / `ttsVoice`
11. `voiceschanged` リスナー、`beforeunload` で cancel、`visibilitychange` で Wake Lock 再取得
12. i18n 4 言語 × 12 キー、ヘルプ本文に「🔊 読み上げ」節

### リリース

13. `sw.js` の `VERSION` を `yomikake-shell-v2.8.0` → `v2.9.0` にバンプ
14. `CLAUDE.md` 更新（下記§リリース手順）
15. `README.md` に「読み上げ」機能を追記
16. `git tag v2.9.0 && git push --tags`

## リリース手順

1. 両ファイル実装 → `sw.js` の `VERSION` バンプ
2. `CLAUDE.md` 更新：「Both files」リストに `ttsPlay` / `ttsStop` / `ttsExtractText` / `ttsSplitChunks` /
   `ttsSpeakNext` / `ttsOnUserNavigate` 等を追記、`state` に `ttsRate` / `ttsVoice` / `bookLang`、
   `epub_settings` の内容更新、ヘルプ記載事項、postMessage 表への影響なし
3. `README.md` に機能追記
4. `git tag v2.9.0 && git push --tags`

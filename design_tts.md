# 設計書: 読み上げ機能（design_tts.md）

作成日: 2026-07-20
対象: `yomikake.html` / `yomikake_ios.html`（両ファイル共通実装）
ステータス: **未実装（v2.9.0 として実装予定）**

## 決定事項（設計前提）

- 方式は **Web Speech API（`speechSynthesis`）** — 追加依存ゼロ・無料・オフライン可・2ファイル構成維持
- **同期ハイライトはやらない**（「音声だけ流す」割り切り。画面との同期は章単位のみ）
- ルビは **rt 優先固定**（ふりがなを読み、親文字を捨てる。設定切替なし）
- 画面追従は **章単位**（章を読み終えたら自動で次章へ `renderPage`。しおりは文単位で保存）
- **Wake Lock（画面消灯防止）は Phase 1 に含める**（画面ロックで停止する制約の緩和として必須）

## 背景・方式選定

却下した代替案：

| 案 | 却下理由 |
|----|----------|
| クラウド TTS API（Google/Polly/OpenAI 等） | 静的 HTML では API キー管理が破綻。従量課金・要ネットワークが「無料・オフライン・サーバレス」方針に反する |
| ブラウザ内ニューラル TTS（Piper/VOICEVOX 系 WASM） | モデル数十〜数百 MB。単一 HTML 同梱不能・実装大 |
| OS 機能の案内のみ（iOS 画面の読み上げ等） | 章跨ぎ・自動送りができず体験が劣る。**A 案ヘルプ内の補足案内として吸収** |

Web Speech API の音質は端末依存（iOS の Kyoko/Siri 音声は良好、Windows/Android は中程度）だが、
なろう系 Web 小説の「ながら聴き」用途には十分と判断。

## スコープ

| Phase | 内容 |
|-------|------|
| 1 | リフロー本の読み上げ一式：rt 優先抽出・文分割チャンク再生・章自動送り・文単位しおり保存・Wake Lock・プレイヤー UI・音声/速度設定 |
| 2 | FXL 透明テキスト読み上げ（ルビ・柱・ノンブルの font-size フィルタ）、スリープタイマー（15/30/60分）、（検討）文頭への画面スクロール同期 |
| 対象外 | 同期ハイライト、バックグラウンド再生（`speechSynthesis` は Media Session に乗らず技術的に不可能）、クラウド TTS |

## state / 永続化

```js
// state 追加（epub_settings に永続化）
ttsRate:  1.0,    // 0.5–2.0（0.25 刻み）
ttsVoice: '',     // 選択音声の voiceURI。'' = 自動（bookLang 一致のデフォルト音声）
// state 追加（セッションのみ）
bookLang: 'ja',   // OPF dc:language（新規抽出。loadEpub で metadata > *|language、無ければ 'ja'）
```

```js
// モジュール変数（非永続 — 再生状態は本を開くたびリセット）
let _tts = { active:false, paused:false, chunks:[], idx:0, spineIdx:-1 };
let _ttsWakeLock = null;      // WakeLockSentinel
let _ttsInternalNav = false;  // TTS 自身の章送り renderPage を手動操作と区別するフラグ
```

`dc:language` の抽出は `loadEpub()` の dc:title/dc:creator 読み出し（yomikake.html:2403-2408）の直後に追加。

## テキスト抽出（`ttsExtractText` / `ttsSplitChunks`）

取得経路は `runSearch()`（yomikake.html:4673）と同一: `state.opfDir + item.href.split('#')[0]` →
`state.epub.file(absPath).async('string')`。

**既存 `htmlToText()`（yomikake.html:4558）は流用しない**（検索用に温存）。`<rt>` を除去しないため
読み上げに使うと「漢字かんじ」の二重読みになる。新設 `ttsExtractText(html)` のパイプライン:

1. `<head>` / `<script>` / `<style>` 除去（htmlToText と同一の正規表現）
2. **ルビ置換（rt 優先）**: `<ruby ...>…</ruby>` ブロックを内部の `<rt>` 内容の連結で置換。
   `<rp>` は除去。`<rt>` が 1 つも無い ruby は内部テキスト（タグ除去のみ）にフォールバック。
   なろう系の人名・固有名詞ルビが正しく読まれるのが最大の品質改善
3. ブロック要素の閉じ（`</p>` `</div>` `</h1>`〜`</h6>` `</li>` `</blockquote>`）と `<br>` を改行に変換
   （文境界の手がかりを残してから 4 でタグ除去）
4. 残りタグ除去・エンティティ復元（htmlToText と同一）。ただし空白正規化は**行単位**
   （`\s+`→` ` の全面つぶしをせず改行は保持）

`ttsSplitChunks(text)` — 文単位チャンク分割:

- `。．！？!?` の直後で分割（直後に続く `」』）】's quotes` は前の文に含める）。改行も境界
- **1 チャンク最大 ~120 文字のハードキャップ**。超過時は `、` で、それも無ければ強制分割。
  これは好みでなく必須 — Chrome はネットワーク音声の長い utterance が約 15 秒で無音停止するバグがあり、
  短文チャンクが唯一堅牢な回避策
- 空白のみのチャンクは捨てる。結果 `string[]` を `_tts.chunks` に保持

## 再生エンジン

```
ttsPlay()        — 🔊 ボタン。現在章を抽出し、開始チャンク = floor(_intraChapterRatio × chunks.length)
                   から再生（読んでいた位置の近くから始まる）。active 中は 一時停止/再開トグル
ttsSpeakNext()   — chunks[idx] の utterance を speak。onend → savePos(idx/chunks.length) → idx++ → 次へ。
                   idx が末尾を超えたら章送り（下記）
ttsPause()       — speechSynthesis.cancel() + paused=true。※pause()/resume() は iOS で不安定なため不使用。
                   再開は現チャンク頭から ttsSpeakNext()
ttsStop()        — cancel + 状態クリア + Wake Lock 解放 + UI 非表示 + savePos
ttsPrevSent() / ttsNextSent() — idx±1 して cancel → ttsSpeakNext()（プレイヤーバーの ⏮⏭）
```

- utterance には `voice`（解決順: 保存 voiceURI → bookLang 前方一致のデフォルト → 中止）、`rate`、
  `lang = state.bookLang` を設定
- `onerror` は `interrupted` / `canceled`（自分の cancel 由来）を無視し、それ以外は toast + `ttsStop()`
- `getVoices()` は非同期投入されるため `voiceschanged` イベントで音声リストを再構築
- **速度変更は現チャンクを cancel して同 idx から再開**（即時反映。utterance 途中の rate 変更は
  ブラウザが無視するため）
- **該当言語の音声がゼロの環境**（Linux Firefox 等）: 再生開始を中止し toast `tts.noVoice`
  （英語音声で日本語を読んでも無意味なため続行しない）

### iOS のジェスチャアンロック

iOS Safari は最初の `speak()` がユーザージェスチャ由来であることを要求する。チャンク抽出は
async（`file.async`）でジェスチャコンテキストを失うため、**🔊 クリックハンドラ内で同期的に
空 utterance（`' '`）を speak してアンロック**し、その後 async 抽出 → 本再生に入る。
rate は iOS で実効範囲が狭いため 0.5–2.0 に clamp（両ファイル共通で同じ clamp を適用）。

## 章単位追従（決定事項 A-4）

- 章末到達 → `_ttsInternalNav = true; renderPage(spineIdx+1, 'start'); _ttsInternalNav = false` →
  新章を抽出して idx=0 から継続。**EPUB_READY は待たない**（描画と音声は独立。iframe 完成前に
  読み始めてよい）。`renderPage` 冒頭の既存 `savePos(0)` で章頭しおりも既存経路のまま保存される
- 最終章の末尾まで読み終えたら `savePos(1.0)` + `showFinishedBanner()` + `ttsStop()`
  （スクロール読了と同じ扱い。`_bookFinished` フラグも同様にセット）
- **手動ナビゲーションとの整合**: `renderPage()` 冒頭にフックを 1 つ追加 —
  `if (_tts.active && !_ttsInternalNav) ttsOnUserNavigate(idx)` → cancel して**新章の頭から読み直し**
  （TOC・章ボタン・検索ジャンプ・進捗バークリックのすべてがここを通るため個別対応不要）
- **章内スクロールは TTS に影響しない**。ただし再生中は `EPUB_POS` ハンドラの `savePos` をスキップ
  （`_tts.active` ガード）— TTS の文単位しおりをユーザーの無意識のスクロールで上書きさせない。
  `_intraChapterRatio` の更新と進捗バー表示は従来どおり

## Wake Lock（決定事項 A-5・Phase 1）

- 再生開始で `navigator.wakeLock.request('screen')`、`ttsPause()` / `ttsStop()` / エラーで release
- Wake Lock はタブ非表示で自動解放されるため、`visibilitychange` で visible 復帰時に
  `_tts.active && !paused` なら**再取得＋現チャンクから再生再開を試みる**（画面ロックで
  speechSynthesis が止まった後の復帰を best effort でカバー）
- 非対応ブラウザは黙って続行（読み上げ自体は可能。画面消灯で止まるのは既知の制限として明記）

## UI

### ツールバー 🔊 ボタン（`#tts-btn`）

- `icon-btn`。目アイコン（`flashNavButtons`）ボタンの隣に配置
- 未再生 → `ttsPlay()`。再生中 → 一時停止/再開トグル。再生中は `.tts-active` クラスでアクセント表示
- **FXL 本では非表示**（`body.mode-fxl #tts-btn { display:none }` — Phase 2 で解禁）

### プレイヤーバー（`#tts-bar`）

- `#main` 内下部の固定バー（`#fxl-region-pill`（yomikake.html:365,933）と同系の浮遊 UI）。
  `body.tts-active` クラスで表示制御
- 要素: `⏮`（前の文）・`⏯`（一時停止/再開）・`⏭`（次の文）・`■`（停止）・
  `－ 1.0x ＋`（速度 0.25 刻み 0.5–2.0、変更時 `saveSettings()`）・進捗テキスト `sent i/total`
- **フルスクリーン中も表示**（`body.fullscreen` の退避対象から除外 — 再生操作は読書中の必須動線）
- Escape 優先度チェーンには**入れない**（誤停止防止。停止は明示的に ■ で）

### 設定ポップオーバー

「🔊 読み上げ」group を Google Drive group の上に新設。行は **音声選択のみ**
（`#tts-voice-select`: 先頭に「自動」、以下 `getVoices()` を `state.bookLang` 前方一致でフィルタ、
該当ゼロなら全音声。`voiceschanged` と本オープンで再構築）。速度はプレイヤーバー側に一本化し
二重 UI の状態同期を避ける。

## クリーンアップ・安全策

- `ttsStop()` を呼ぶ箇所: `closeBook()`、`loadEpub()` 冒頭（本切替）、`finalizeCurrentBook()` 経由でも
  二重呼び出し安全に
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

| キー | ja 例 |
|------|-------|
| `btn.tts`（title） | 読み上げ |
| `tts.pause` / `tts.resume` / `tts.stop` | 一時停止 / 再開 / 停止 |
| `tts.prevSent` / `tts.nextSent` | 前の文 / 次の文 |
| `tts.noVoice` | この言語の音声がこの端末にありません |
| `tts.done` | 読み上げが終わりました |
| `settings.ttsGroup` | 🔊 読み上げ |
| `settings.ttsVoice` | 音声 |
| `tts.voiceAuto` | 自動 |

## テスト項目（手動）

1. **ルビ**: rt 優先で二重読みなし・rt 無し ruby のフォールバック・縦中横（tcy span）が数字として読まれる
2. **チャンク**: 長章（1万字超）を 10 分以上連続再生して Chrome 15 秒バグが出ない・句読点なし長文の強制分割
3. **章送り**: 章末→次章の自動継続・最終章末で読了バナー＋停止・手動章移動（TOC/ボタン/検索/進捗バー）で新章頭から読み直し
4. **しおり**: 文単位 `savePos` → 停止して再開すると近い位置から始まる・再生中の手スクロールがしおりを上書きしない（EPUB_POS ガード）
5. **iOS**: ジェスチャアンロック（初回クリックで確実に鳴る）・cancel＋再開方式の一時停止・rate clamp
6. **Wake Lock**: 再生中の画面消灯なし・pause/stop で解放・タブ復帰で再取得＋再生再開
7. **音声/速度**: voiceURI 永続化・保存音声が無い端末で自動フォールバック・速度即時反映・日本語音声ゼロ環境で中止トースト
8. **クリーンアップ**: 本切替/リストへ/リロードで声が残らない・FXL 本で 🔊 非表示・`file://` で動作
9. **両ファイル**: yomikake.html（CRLF）・yomikake_ios.html（LF）で同一挙動

## リリース手順

1. 両ファイル実装 → `sw.js` の `VERSION` バンプ
2. `CLAUDE.md` 更新: 「Both files」リストに `ttsPlay` / `ttsStop` / `ttsExtractText` / `ttsSplitChunks` /
   `ttsOnUserNavigate` 等を追記、`state` に `ttsRate` / `ttsVoice` / `bookLang`、`epub_settings` の内容更新、
   ヘルプ記載事項
3. `git tag v2.9.0 && git push --tags`

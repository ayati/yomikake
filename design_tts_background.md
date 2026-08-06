# 設計書: 読み上げのバックグラウンド強化と外部アプリ委託（design_tts_background.md）

作成日: 2026-08-06
最終更新: 2026-08-06（Phase A+B 実機確認完了）
対象: `yomikake.html` / `yomikake_ios.html`（両ファイル共通実装）
前提設計書: `design_tts.md`（v2.9.0 で実装済みの読み上げ本体）
ステータス: **Phase A+B 実装・実機確認済み（v2.18.0）／Phase C は不要と判定・着手しない／Phase F 実装・実機確認済み（v2.19.0 予定・未リリース）**

## Phase F の実機確認（2026-08-06・ご本人による）

| 環境 | 結果 |
|------|------|
| Android + @Voice Aloud Reader | **良好。**目的を達成した |
| iPhone / iPad | **受け側アプリが見つからない。** 共有そのものは成立するが、共有先に出る Voicepaper は処理中アイコンのまま再生が始まらない。クリップボード経由・text 経由でも同様 |

**判定: 当面「Android 向けの機能」として説明する。** 機能自体は全環境で有効なまま残す
（共有は成立しており、受け側アプリが対応すれば実装を変えずにそのまま使えるため）。
`handoff.note`（モーダル内注記）と `settings.ttsHandoffHelp`、README にその旨を明記した。

> この分野は変化が速く、**iOS で使える受け側アプリが後から現れる可能性はある**。
> そのときコード変更は不要で、更新するのは注記の文言だけ — これは
> 「連携先ごとの分岐コードを書かない」（§F-5）という設計判断の効果がそのまま出た形。

**BOM は残す（結論）。** @Voice で問題なく読めており、外して得るものが無い:

- 外すと受け側が文字コードを推測することになる。UTF-8 のバイト列はほぼ誤りなく判定できるが、
  **日本語テキストを扱う Android アプリには Shift_JIS を先に試す実装が残っており**、
  当たると全文が文字化けする
- 付けたままのデメリットは「BOM を剥がさないアプリで先頭に U+FEFF が 1 個残る」だけ。
  zero-width no-break space なので表示・読み上げとも無視される

したがって **BOM なし版の実機テストは行わない**（判断材料が増えないため）。
なお `navigator.share({ text })` の経路には BOM を付けていない — 文字列として渡るので
符号化の推測が発生せず、付けると余計な文字になるだけだから（実装は既に分岐済み）。

> **実装メモ（Phase F・2026-08-06）**
> - 設計との差分:
>   - **ヘルプ本文ではなくモーダル内の注記（`handoff.note`）に制限事項を書いた。** 使う直前に
>     目に入る位置のほうが伝わるため。`help.body` を 4 言語ぶん膨らませずに済む副次効果もある。
>   - **`_handoffSliceFrom()` を追加。** 設計では「チャンクを slice して渡す」と書いていたが、
>     チャンク列を join すると **1 文 1 段落**になり、受け側アプリの段落ナビが細かくなりすぎる。
>     チャンクは開始位置の目印としてだけ使い、本文は `ttsExtractText()` の行構造をそのまま渡す。
>     目印の文が本文中に見つからない場合は**章まるごと**にフォールバックする（読み飛ばしより安全）。
>   - **FXL 本は ePub 実体の受け渡しのみ許可。** 本文テキストを取り出せないため範囲選択を出さない。
>     キャッシュも無ければモーダルごと開かず `handoff.fxl` を出す。
>   - 「しおりを進める」チェックは `range === 'chapter'` のときだけ有効。他の範囲を選ぶと
>     `_handoffSyncUI()` が disabled にしてチェックも外す（黙って無視すると嘘になるため）。
> - **BOM はソースに不可視文字で置かない。** `'﻿'` のエスケープ表記で書く
>   （実装時に一度リテラルの U+FEFF を埋め込んだが、編集で黙って消える事故を招く）。
>   なお `Blob.text()` は仕様どおり BOM を剥がすので、**テストは生バイトで確かめること**。
> - 自動テスト `tests/cases/tts-handoff.js`（両ファイル各 58 assertion・fixture の実本を開いて
>   生成テキストを検証）。既存スイート回帰なし（全体 PASS=1219 / FAIL=0）。

## 実機確認の結果（2026-08-06・ご本人による）

| 環境 | 結果 | 設計時の見込み |
|------|------|---------------|
| Windows 11 + Chrome | **良好** | ◎ 想定どおり |
| MacBook + Safari | **良好** | （想定していなかった） |
| iPad Safari | **良好** | ✗ と見込んでいた → **外れ** |
| iPhone Safari | **良好** | ✗ と見込んでいた → **外れ** |
| Android Chrome（他アプリへ切替） | **不可** | △ 五分五分 → 悪いほうに確定 |
| Android Chrome（別タブへ切替） | **不可** | 同上 |

**判定:**

- **PC のバックグラウンド再生は改善完了。→ Phase C（Document PiP）は着手しない。**
  A のキープアライブだけで目的を達したので、常時最前面の小窓という副作用の大きい手段は不要。
- **iOS は設計の見込みが外れて「効いた」。** 「背面で AudioContext ごと suspend されるので
  効果は見込めない」と書いていたが、`<audio>` 要素のループ再生は suspend されず、
  iPhone / iPad とも背面で読み上げが継続した。**コード中のこの旨のコメントは実測に合わせて訂正済み。**
- **Android Chrome だけが残った。** これは A の想定していた失敗モード
  （「タブ hidden で `speechSynthesis` を止める実装を Chrome が持っている場合」）に該当する。
  タブを audible にしても回避できない＝**キープアライブでは原理的に届かない**ため、
  **Android は Phase F（外部読み上げアプリへの委託）で対応する**。
- `ttsKeepAlive` の既定は **ON のまま据え置く**。Android で効果が無いだけで害も無く、
  「Android だけ既定 OFF」にすると端末ごとに設定の初期値が変わって説明が難しくなる。

> **実装メモ（Phase A+B・2026-08-06）**
> - 両ファイルの TTS ブロックは実装後も **477 行で byte 一致**（`sed` で切り出して `diff` が空）。
>   同期崩れの検知はこの diff を取るだけでよい。
> - 自動テスト `tests/cases/tts-background.js` を追加（**両ファイル各 69 assertion・ALL PASS**）。
>   既存スイートの回帰なし（全体 PASS=1103 / FAIL=0）。
> - 設計から変えた点: `ttsPrevSent` / `ttsNextSent` が一時停止中に押されたときの復帰を
>   `_ttsUnpauseForSeek()` に切り出した。`ttsPause()` でキープアライブと Wake Lock を
>   落としているため、ここで掛け直さないと「一時停止 → ▶▶ で再開」した後に背面で止まる。
>   （現行コードは Wake Lock について同じ穴を持っていた＝ついでに塞いだ）
> - `TTS_KEEPALIVE_AMP = 0.004`（≈ -48dBFS）は**初期値のまま実機で通った**。調整は不要だった。

> **実装メモ（Phase A+B・2026-08-06）**
> - 両ファイルの TTS ブロックは実装後も **477 行で byte 一致**（`sed` で切り出して `diff` が空）。
>   同期崩れの検知はこの diff を取るだけでよい。
> - 自動テスト `tests/cases/tts-background.js` を追加（**両ファイル各 69 assertion・ALL PASS**）。
>   既存スイートの回帰なし（全体 PASS=1103 / FAIL=0）。
> - 設計から変えた点: `ttsPrevSent` / `ttsNextSent` が一時停止中に押されたときの復帰を
>   `_ttsUnpauseForSeek()` に切り出した。`ttsPause()` でキープアライブと Wake Lock を
>   落としているため、ここで掛け直さないと「一時停止 → ▶▶ で再開」した後に背面で止まる。
>   （現行コードは Wake Lock について同じ穴を持っていた＝ついでに塞いだ）
> - **未実施**: 実機確認（`TTS_KEEPALIVE_AMP` の実効値・Android で効くか・ロック画面の操作子）と
>   `scripts/release.sh` によるリリース。

## 現行コード照合（実装前ブラッシュアップ）

v2.17.0 の実コードと突き合わせて判明した事実と、それによる設計の修正。

| # | 事実 | 設計への反映 |
|---|------|-------------|
| 1 | **TTS ブロックは両ファイルで完全一致**（293 行・改行コードのみ差）。`sed` で切り出して `diff` して確認済み | 新ブロックを 1 度作って両ファイルへ同一適用できる。この repo 最大の弱点（同期崩れ）が構造的に発生しにくい箇所 |
| 2 | `DISPLAY_DEFAULTS`（yomikake.html:7979）に `ttsRate`/`ttsVoice` は**入っていない** | `ttsKeepAlive` をここに足さなければ自動的にリセット対象外になる。「対象外にする」ための追加作業は不要 |
| 3 | `chapterLabelForSpine()` が両ファイルに存在（yomikake.html:6035） | Media Session の `title` にそのまま使える。関数宣言は巻き上げられるので TTS ブロックより後の定義でも問題ない |
| 4 | `ttsPlay()` の**同期部は `u0` speak の 1 行だけ**で、直後に `await` が来る | キープアライブの `play()` はこの直後に置く。ただし**そこから先に早期 return が 4 経路ある**（音声なし / `!item` / ZIP 読み失敗 / チャンク 0）ので、全経路で停止が要る |
| 5 | 現行の `savePos` は `onend` で `_tts.idx / len` を保存（yomikake.html:5806） | 先読みキュー化すると、チャンク i の `onend` 時点では既に i+1 が発話中で **保存位置が 1 つ後ろにずれる**。→ **`savePos` は `onstart` へ移す**（下記 B-1 で詳述） |
| 6 | `updateTtsUI()` の進捗表示は `Math.min(_tts.idx + 1, len)` | `_tts.idx` の意味を「発話中のチャンク」に保つ限り表示式は不変。変更不要 |
| 7 | `ttsStop()` は `_ttsSupported` だけ見て `_tts.active` を見ずに全部片付ける。呼び出し元は loadEpub(3152) / closeBook(8055) / onerror / advanceChapter / loadChapterAndSpeak | キープアライブ停止を `ttsStop()` に 1 箇所置けば主要経路は全部カバーされる |
| 8 | トグル行の既存パターンは `#book-prefs-toggle` / `#drive-auto-toggle`（`background`/`color`/`borderColor` を直接書き換え） | `#tts-keepalive-toggle` も同じ書式に揃える |

## 背景：なぜ今のままでは背面で止まるのか

`speechSynthesis` はブラウザから見て **「メディア再生」ではない**。ここが全ての原因で、
利用者側の設定（電池最適化の解除・PiP 許可・通知許可・PWA インストール）はどれも
動画/ネイティブメディア向けのスイッチなので、この経路には一切効かない。

| 事象 | 原因 |
|------|------|
| Android で他アプリに切り替えると即停止 | タブの *audible* フラグが立たない → 背面タブの凍結（Page Lifecycle）とタイマースロットリングの対象になる |
| ロック画面・通知に操作子が出ない | Media Session API は `<audio>`/`<video>`/WebAudio の実音声にしか紐づかない。`speechSynthesis` からは登録すらできない |
| PC でも背面で頻繁に途切れる | (1) 背面タブのスロットリング (2) Chrome の既知バグ（長い utterance が約 15 秒で無音停止）(3) **現実装が 1 チャンクずつ `onend` → JS → 次を speak の直列チェーン**（yomikake.html:5804-5815）なので、JS が遅延するとそのままチャンク間の無音になる |

`design_tts.md` §スコープ の「対象外：バックグラウンド再生（`speechSynthesis` は Media Session に
乗らず技術的に不可能）」は、**`speechSynthesis` を使い続ける限り正しい**。
Chrome 自身の「このページを読み上げ」が後に背面再生に対応したのも、あれが Web Speech API ではなく
ネイティブのメディア再生経路だからで、この結論を裏付けている。

したがって本設計は **「`speechSynthesis` を延命する（Phase A/B/C）」** と
**「Android では読み上げの実行そのものを外部アプリへ委託する（Phase F）」** の二本立てにする。

## スコープ

| Phase | 内容 | 主目的 | 版数 |
|-------|------|--------|------|
| A | 無音キープアライブ ＋ Media Session | PC の途切れ解消。Android は実測で判定 | v2.18.0 |
| B | 発話の先読みキュー化 | 同上（A と対で効く） | v2.18.0 |
| C | Document Picture-in-Picture | **A で PC が解決しなかった場合のみ着手** | 保留 |
| F | 外部読み上げアプリへの受け渡し | Android の現実解。yomikake はしおりを持ち、読み上げだけ委託 | v2.19.0 |
| 対象外 | クラウド TTS / WASM ニューラル TTS / ネイティブ包装 | 「実音声にする」本命路線。別設計書 | — |

**Phase C は条件付き。** A+B の実機テストで PC の途切れが解消したら着手しない。
判断はご本人の実機テスト結果を待つ。

---

# Phase A — 無音キープアライブ ＋ Media Session

TTS 再生中だけ極小音量のループ音声を `<audio>` で流し、タブを *audible* にして
凍結・スロットリングの対象外にする。副産物として Media Session が使えるようになり、
通知・ロック画面に操作子が出せる。

## A-1. キープアライブ音声

```js
const TTS_KEEPALIVE_HZ  = 19000;   // 実機調整パラメータ（下記）
const TTS_KEEPALIVE_AMP = 0.004;   // ≈ -48 dBFS
let _ttsKeepAudio = null;          // HTMLAudioElement（遅延生成・使い回し）
```

- `_ttsMakeKeepAliveUri()` が **実行時に WAV を組み立てて data URI を返す**（44 バイトの RIFF ヘッダ ＋
  16bit PCM モノラル・44100Hz・1 秒）。外部アセットを増やさないので **2 ファイル構成を守れる**。
- `<audio loop>` に食わせて `play()`。生成は 1 度だけで、以降は同じ要素を使い回す。

### ⚠ 完全な無音では効かない（本設計唯一の実測依存パラメータ）

Chrome の `AudioStreamMonitor` は**実際の振幅**を見て audible を判定するので、
振幅ゼロの無音ファイルではタブが audible にならず、キープアライブとして機能しない。
かといって可聴音では読書の邪魔になる。そこで **19kHz 前後・-48dBFS 前後**を初期値とする
（成人にはほぼ聞こえず、スマホのスピーカーは再生帯域外で物理的に出せない）。

**検証方法**: 再生中にタブに**スピーカーアイコンが出るか**を目視する。
これが出ている＝ブラウザが audible と判定している、の直接の証拠になる。
出なければ `TTS_KEEPALIVE_AMP` を上げる（-48 → -40 → -34 dBFS）。
ヘッドホンで気になる場合は `TTS_KEEPALIVE_HZ` を下げずに振幅だけ下げる。

## A-2. ライフサイクル

| 契機 | 動作 |
|------|------|
| `ttsPlay()` の**同期部**（既存の iOS ジェスチャアンロック `u0` speak の直後） | `_ttsKeepAliveStart()`。**ユーザージェスチャ内でなければ autoplay policy に弾かれる**ので、`await` より前に置くこと |
| `ttsPause()` / `ttsStop()` | `_ttsKeepAliveStop()` |
| `u.onerror` で `ttsStop()` に落ちる経路 | 同上（`ttsStop()` 内に置けば自動で通る） |
| `beforeunload` | 同上 |

**「無音だけが鳴り続ける」状態を絶対に作らないこと。** 停止は `ttsStop()` の 1 箇所に集約し、
`_tts.active` が false になる経路が必ずそこを通ることを確認する。

## A-3. Media Session

```js
function ttsSyncMediaSession() // 章が変わるたび＋再生/停止のたびに呼ぶ
```

| 項目 | 値 |
|------|-----|
| `metadata.title` | 章タイトル（`chapterLabelForSpine(state.currentSpineIdx)` を流用） |
| `metadata.artist` | `state.bookCreator` |
| `metadata.album` | `state.bookTitle` |
| `metadata.artwork` | `state.bookCoverDataUri`（**既存の 160×224 JPEG data URI がそのまま使える**） |
| `playbackState` | `'playing'` / `'paused'` / `'none'` |

アクションハンドラは既存関数にそのまま繋ぐ:

| アクション | 接続先 |
|-----------|--------|
| `play` | `ttsResume()` |
| `pause` | `ttsPause()` |
| `stop` | `ttsStop()` |
| `previoustrack` / `seekbackward` | `ttsPrevSent()` |
| `nexttrack` / `seekforward` | `ttsNextSent()` |

`'mediaSession' in navigator` で feature detect し、無ければ全て no-op。

## A-4. 設定と副作用

- **副作用**: キープアライブは音声フォーカスを取るので、**他アプリで再生中の音楽が止まる／
  ダッキングされる**可能性がある。逃げ道は必須。
- `state.ttsKeepAlive`（`epub_settings` に永続化・**既定 ON**）を追加し、
  設定の「🔊 読み上げ」グループ（`#tts-settings-group`）にトグル行を出す。
- **リセット（`resetDisplaySettings`）の対象外**。`ttsRate` / `ttsVoice` と同じ扱い
  （読み上げ設定は触らない方針・CLAUDE.md 既述）。

## A-5. 見込みと正直な限界

| 環境 | 見込み |
|------|--------|
| PC (Chrome/Edge) | **◎ 解決するはず。** 背面タブのスロットリング除外が本来の効果 |
| Android Chrome | **△ 五分五分。** Chrome が「タブ hidden で `speechSynthesis` を止める」実装を持っている場合は、audible にしても効かない。ただし検証は実機 5 分で済むので先にやる価値がある |
| iOS Safari | **✗ 効かない見込み。** 背面で AudioContext ごと suspend される |

**Android で効かなかった場合の落とし穴**: キープアライブは鳴るので
Media Session の操作子（ロック画面のコントロール）だけが出て、押しても音が出ない、という
最悪の見せかけになりうる。**A の実機テストでは「操作子が出るか」ではなく
「実際に読み上げが継続するか」を合否条件にすること。** 継続しないなら
Android では `ttsKeepAlive` を既定 OFF にして Phase F へ倒す。

---

# Phase B — 発話の先読みキュー化

`speechSynthesis.speak()` は本来キューなので、数チャンク先まで積んでおけば
JS が止まってもエンジン側が喋り続ける。A と対で効く。

## B-1. 状態の分離（設計の核心）

現行の `_tts.idx` は「今読んでいる位置」と「次に積む位置」を兼ねている。
キュー化するとこれが破綻するので **2 つに分ける**:

```js
_tts.idx      // 今まさに発話中のチャンク index（UI 表示・しおり保存に使う）
_tts.queuedTo // speak() に積み終わった index（排他的上限）
const TTS_LOOKAHEAD = 3;
```

**`_tts.idx` の更新と `savePos` は、どちらも `onend` ではなく `onstart` で行う。**
`onend` で `idx++` すると先読み分だけ位置が進みすぎ、**しおりが実際の再生位置より
先に飛ぶ**（読み上げを止めた場所より先から再開してしまう）。
逆に現行どおり `onend` で `savePos(_tts.idx/len)` を残すと、チャンク i の `onend` の時点では
既に i+1 が発話中なので、今度は**しおりが 1 つ後ろにずれる**。
`onstart` に寄せれば「発話開始＝現在地の確定＝保存」が 1 箇所に揃い、どちらのズレも起きない。

```js
u.onstart = () => {                       // 現在地の確定・保存はここだけ
  _tts.idx = i;
  savePos(i / _tts.chunks.length);
  updateTtsUI();
  ttsFillQueue();                         // ← 下記の「キューが枯れる」対策
};
u.onend = () => {
  if (_tts.idx < i + 1 && i + 1 < _tts.chunks.length) _tts.idx = i + 1;  // onstart 未発火エンジンの保険
  if (i >= _tts.chunks.length - 1) ttsAdvanceChapter();   // 最終チャンクのみ
  else ttsFillQueue();
};
```

### ⚠ `onstart` からも `ttsFillQueue()` を呼ばないとキューが 1 本ずつ枯れる

`onend(i)` と `onstart(i+1)` の発火順は保証されない。`onend(i)` が先に走ると、その時点の
`_tts.idx` はまだ i なので上限は `i + TTS_LOOKAHEAD` ＝ `queuedTo` と同値になり、**1 本も補充されない**。
その後 `onstart(i+1)` で `_tts.idx` が進んでも、補充を呼ぶものが無い。
これを毎チャンク繰り返すとキューが 1 本ずつ減り、数チャンクで先読みが消えて元の直列動作に戻る。
**両方から呼ぶ**こと（`ttsFillQueue()` は `queuedTo` で上限が閉じているので多重呼び出しは無害）。

`i` はループ変数なので、`var` のままだとクロージャが最後の値を共有する。
**utterance の生成は `_ttsMakeUtterance(i, voice, rate)` に切り出して関数スコープを作る**。

## B-2. 関数の再構成

| 現行 | 変更後 |
|------|--------|
| `ttsSpeakNext()` — cancel してから 1 件 speak | **`ttsRestartQueue()`** — cancel → `_tts.queuedTo = _tts.idx` → `ttsFillQueue()` |
| （新規） | **`ttsFillQueue()`** — `active && !paused` の間、`_tts.queuedTo < min(chunks.length, _tts.idx + TTS_LOOKAHEAD)` の分だけ積む |

`ttsSpeakNext()` の呼び出し元（`ttsPlay` / `ttsResume` / `ttsPrevSent` / `ttsNextSent` /
`setTtsRate` / `changeTtsVoice` / `ttsLoadChapterAndSpeak` / `visibilitychange` 復帰）は
**すべて `ttsRestartQueue()` に置き換える**。意味論が「今の位置からキューを組み直す」で一致するため、
呼び出し側の変更は名前だけで済む。

**`ttsSpeakNext()` 冒頭の `speechSynthesis.cancel()`（yomikake.html:5814）は撤去する。**
これがあるとキューが毎回消えて先読みの意味がなくなる。cancel は
`ttsRestartQueue` / `ttsPause` / `ttsStop` / `ttsOnUserNavigate` だけが呼ぶ。

## B-3. 気をつける点

- **章送りの二重発火**: `cancel()` はキュー中の全 utterance に `onerror` を出す。
  現行の「`interrupted`/`canceled` は無視」（5811 行）は維持しつつ、
  `_ttsAdvancing` フラグで `ttsAdvanceChapter()` の多重呼び出しを防ぐ。
  **ただし `ttsAdvanceChapter()` は内部で `ttsLoadChapterAndSpeak()` を呼び、その先で
  `ttsFillQueue()` に到達する。** `_ttsAdvancing` を立てたまま await すると
  新章の補充が自分のフラグで止まるので、**`ttsLoadChapterAndSpeak()` を呼ぶ直前に
  明示的に降ろす**（`finally` でもう一度降ろすのは冪等なので無害）。
- **速度・音声変更**: 積んだ utterance は変更できないので `ttsRestartQueue()` で組み直す（現行と同じ挙動）。
- **`ttsPrevSent` / `ttsNextSent`**: `_tts.idx` を動かしてから `ttsRestartQueue()`。
- **120 字ハードキャップは維持**（Chrome 15 秒バグ回避・`design_tts.md` 既述）。
- **Firefox**: cancel 直後の speak が無視される既知挙動があるが、現行も同じ条件なので現状維持。

---

# Phase C — Document Picture-in-Picture（**不要と判定・着手しない**）

> 2026-08-06 の実機確認で **A+B だけで PC のバックグラウンド再生が成立した**ため、
> 発動条件（「A で PC が解決しなかった場合のみ」）を満たさなくなった。以下は記録として残す。


`documentPictureInPicture.requestWindow()` で常時最前面の小窓を出し、TTS バーの複製を置く。
ページが hidden にならないのでスロットリングを完全に回避できる。

- **Chrome / Edge デスクトップ 116+ 限定。Android 非対応**（＝スマホ問題の解にはならない）
- `'documentPictureInPicture' in window` で feature detect し、**対応時のみ**設定に行を出す
- **A+B の実機テストで PC が解決したら着手しない**

---

# Phase F — 外部読み上げアプリへの受け渡し（Android の現実解）

**yomikake が「蔵書・しおり・読書位置」を持ち、読み上げの実行だけを外部アプリへ委託する。**
当面の連携先は [@Voice Aloud Reader](https://hyperionics.com/atVoice/)。
同アプリは Android 標準の共有（`ACTION_SEND`）でテキストを受け取り、
TXT / EPUB / HTML / PDF / DOC などのファイルも直接開ける。

## F-1. 往路はできる、復路はできない — それをどう設計に織り込むか

| 方向 | 可否 |
|------|------|
| yomikake → アプリ（どこから読むか） | **できる。** しおり位置の文からテキストを切り出して渡せる |
| アプリ → yomikake（どこまで読んだか） | **できない。** Web からアプリの再生位置を取得する API は存在しない |

復路が無いことを前提に、**受け渡しの既定単位を「1 章」にする**。
「この章を渡す」という操作そのものが進捗の記録になり、戻ってきたらもう一度渡すだけで進む。
章の粒度は既存の目次サイドバー・進捗バー・章送りボタンとも一致するので、
ズレたときにユーザーが手で直す動線も既にある。

## F-2. 渡すテキストの生成

```js
function ttsHandoffText(spineIdx, opts)   // opts = { range, fromCurrentPos }
```

**既存の `ttsExtractText()` と `ttsSplitChunks()` をそのまま再利用する。**
ルビが rt 優先で解決済み・タグ除去済みのプレーンテキストは、外部読み上げアプリに渡す形として
そのまま最適（これが Phase F の実装コストを極小にしている理由）。

- **開始位置**: `_tts.active` なら `_tts.idx`、そうでなければ `_intraChapterRatio` から
  chunk 境界を求めて `slice()` する。**しおり位置の文から始まる**。
- **ヘッダ**: 先頭に `『書名』` ／ 章タイトルの 2 行を入れる。アプリが最初にこれを読むので、
  **現在地が耳で分かる**。
- **章区切り**（`toEnd` / `book` のとき）: `\n\n──── 第N章 ────\n\n`。
  段落ナビで章を飛べるようにする。
- **文字コード**: UTF-8 ＋ **BOM 付き**。一部の Android リーダーが Shift_JIS と誤判定するのを避ける
  （@Voice で不要なら外す — 実機で確認する項目）。

| `opts.range` | 内容 |
|-------------|------|
| `'chapter'` | **既定。** 現在章の現在位置から章末まで |
| `'toEnd'` | 現在位置から本の末尾まで |
| `'book'` | 全文（先頭から） |
| `'epub'` | テキストではなく **ePub 実体そのもの**（下記 F-4） |

## F-3. 受け渡し経路（優先順）

| # | 経路 | 条件 | 備考 |
|---|------|------|------|
| 1 | `navigator.share({ files:[File] })` | `navigator.canShare({files})` が true | **本命。** `text/plain` の File として渡す。量の制限が実質無い |
| 2 | `navigator.share({ title, text })` | ファイル共有不可時 | **Android の Intent extras にサイズ制限（TransactionTooLarge）があるので `range:'chapter'` のときだけ許可する** |
| 3 | `.txt` ダウンロード（`createObjectURL` + `<a download>`） | 常に | 最終手段。PC / iOS 用。アプリ側のファイルブラウザから開いてもらう |

## F-4. ePub 実体をそのまま渡す（副経路）

`_idbGet(bookKey)` の `buf`（IDB の ePub キャッシュ）から `File` を作って共有する。
@Voice / Moon+ Reader / Speech Central はいずれも ePub を直接読める。

- 読書位置は伝わらないが、**「蔵書としてまるごと渡したい」需要**に応える
- **iOS でも有効**（共有シート → Files / 対応アプリ）
- キャッシュが無い本では選択肢ごと出さない（`_cachedKeys.has(bookKey)` で判定）

## F-5. 連携先の拡張性 — テーブル方式にはしない（設計判断）

将来 Speech Central / Legere / Voice Dream 等を足したくなっても、
**アプリ別の分岐コードは書かない。** 理由:

- Web からは**インストール済みアプリを列挙できない**
- **特定アプリを名指しで起動できない**（`intent://...#Intent;package=...;end` は Android Chrome で
  形式上は可能だが、テキストを extras に載せると URI 長で破綻し、PWA からの起動も信頼性が低く、
  iOS では原理的に不可）

→ **OS の共有シートに委ねるのが唯一の汎用解。**
yomikake が持つ責務は「**どの範囲を・どの形式で・どこから**」テキストを作ることだけで、
宛先はユーザーが共有シートで選ぶ。この形なら **@Voice 以外のアプリは実装ゼロで既に対応済み**になる。

アプリごとに持つべきは**推奨設定のドキュメントだけ**（ヘルプに @Voice の推奨設定を書く）。
連携先が増えても増えるのはヘルプの記述だけで、コードは増えない。**これが本設計の拡張性そのもの。**

## F-6. UI

**エントリは 2 箇所**:

1. **`#tts-bar` に `📤` ボタン** — 読み上げ中に「続きをスマホの外部アプリで」。
   PC で聴いていたものをスマホへ移す導線として自然。
2. **設定の「🔊 読み上げ」グループに行** — 本を開いていれば常に使える。

どちらも **`#tts-handoff-modal`** を開く:

```
現在地：第 12 章「◯◯」 34%

範囲   ◉ この章（現在位置から）
       ○ ここから最後まで
       ○ 全文
       ○ ePub ファイルごと            ← キャッシュがある本のみ

□ 渡したあと、しおりを次の章の先頭に進める

        [ 共有 ]  [ ダウンロード ]
```

- 「渡したあと〜」チェックは **既定 OFF**。ON にすると共有成功後に
  `renderPage(idx+1, 'start')` して次章を現在地にする。
  これで「渡す → 聴く → 戻ってもう一度渡す」の周回が 1 タップで回る。
  渡したが聴かなかった場合に位置が進みすぎるので既定は OFF、説明文を添える。
- 共有後のトーストで「第 N 章を渡しました」を出し、現在地を明示する。
- `navigator.share` 非対応環境では「共有」ボタンを出さない。

## F-7. 明記すべき制限（ヘルプに書く）

- **どこまで聴いたかは戻ってこない。** 章送りで手動調整する
- 読み上げ速度・音声は**受け側アプリの設定**
- テキスト量が多いとファイル経路が必須（`range:'book'` は経路 2 を使わない）
- iOS は共有シート → Files / 対応アプリ経由

---

# 共通事項

## state / 永続化

```js
// epub_settings に追加
ttsKeepAlive: true,      // Phase A。既定 ON
ttsHandoffRange: 'chapter',  // Phase F。最後に選んだ範囲を覚える
```

いずれも **`resetDisplaySettings()` の対象外**（読み上げ設定は触らない方針）。
`loadSettings()` に検証付き復元を足す（`ttsKeepAlive` は boolean、
`ttsHandoffRange` は `'chapter'|'toEnd'|'book'|'epub'` のホワイトリスト）。

## i18n（4 言語すべてに追加）

`tts.keepAlive` / `tts.keepAliveHint` / `tts.handoff` / `handoff.title` / `handoff.current` /
`handoff.range` / `handoff.rangeChapter` / `handoff.rangeToEnd` / `handoff.rangeBook` /
`handoff.rangeEpub` / `handoff.advance` / `handoff.share` / `handoff.download` /
`toast.handoffDone`（`{chapter}` プレースホルダ）/ `toast.handoffFailed`

## テスト

**`tests/lib/run.sh` に追加**（両ファイルに同じ assertion を流す＝同期崩れ検知が主目的）:

- Phase A: `_ttsMakeKeepAliveUri()` が妥当な WAV data URI を返す（RIFF ヘッダ・長さ）。
  `ttsPlay` → `<audio>` の `play()` が呼ばれる、`ttsStop` → `pause()` が呼ばれる。
  `mediaSession.metadata` / `playbackState` / 各 `setActionHandler` の登録。
  `navigator.mediaSession` と `HTMLAudioElement.prototype.play` をモックする。
- Phase B: キューが `TTS_LOOKAHEAD` 本まで積まれる。`onstart` で `_tts.idx` が動く
  （`onend` では動かない）。cancel でキューがリセットされる。
  **章末の `ttsAdvanceChapter()` が 1 回だけ呼ばれる**。しおりが先読み分だけ先に進まない。
- Phase F: `ttsHandoffText()` の生成物（開始位置が chunk 境界・ヘッダ・章区切り・4 つの range）。
  `navigator.share` / `canShare` をモックして経路 1/2/3 の分岐。
  ダウンロード経路の Blob 内容。「しおりを進める」チェックの副作用。

**担保できない（実機必須）**:

- **`TTS_KEEPALIVE_AMP` の実効値**（タブのスピーカーアイコンが出るか＝ audible 判定）
- **A が Android で実際に効くか**（本設計最大の未知数）
- 共有シートに @Voice が出るか・実際に読めるか・サイズ上限・BOM の要否
- Media Session の操作子がロック画面に出るか

## CLAUDE.md への追記

実装後、「読み上げ（TTS・…・v2.9.0）」節に続けて
「読み上げのバックグラウンド強化（v2.18.0）」「外部読み上げアプリ連携（v2.19.0）」を追加し、
関数名一覧・`epub_settings` のキー表・**「`onstart` で `_tts.idx` を更新する理由」**
（しおりが先読み分ずれる罠）・**「連携先はテーブル方式にしない理由」**を明記する。

## 実装順とリリース

| 版 | 内容 | 実機判定 |
|----|------|---------|
| v2.18.0 | Phase A + B | PC の途切れが止まったか／Android で継続するか |
| （分岐） | Android が ✗ なら `ttsKeepAlive` を Android 既定 OFF に。PC が ✗ なら Phase C 着手 | |
| v2.19.0 | Phase F | @Voice への受け渡しが実用になるか |

Phase A と B は同一版にまとめる（どちらも既存の再生経路の内部改修で、切り分けても
実機テストの手間が変わらない）。Phase F は新規機能で独立しているので版を分ける。

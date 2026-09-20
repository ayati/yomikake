# ブラウザ翻訳を本文にも効かせる 概要設計書

対象: `yomikake.html`・`yomikake_ios.html` **両ファイル**

関連: `design_iframe_sandbox.md`（v2.23.0 で sandbox を入れた経緯）・`design_kosync.md`（localStorage に資格情報が載った経緯）

**実装状況: 実装完了（v2.24.0 予定）・実機確認済み（2026-09-20）。**
Windows PC・Android・iOS Chrome・MacBook Chrome で**本文の翻訳を確認**。既存機能の退行なし。
**Edge だけ章送りに追従しない**（§2-2・見送り）。

---

## 1. なぜやるか

**想定利用者は日本語学習中の英語話者・中国語話者**で、主対象は **PC と MacBook**。
Android も救えるなら救う。**iOS は対象外**（ただしコードは両ファイル共通なので壊さない）。

この人たちは **ブラウザのページ翻訳で本文を読む**。ところが Chrome / Edge では
**ツールバーと本棚だけが訳され、本文は日本語のまま**残る。Firefox と macOS Safari では本文も訳せる。

原因は **v2.23.0 で本文 iframe に入れた `sandbox`**。`allow-same-origin` を与えていないので
本文フレームは**不透明オリジン**になり、Chrome / Edge の翻訳がフレームの中に届かない。
Firefox と Safari の翻訳はブラウザ内部でフレームごとに走るため影響を受けない。

**つまり v2.23.0 の退行**である。sandbox の狙い（ePub のコードに `localStorage` の
KOReader 資格情報を読ませない）は正しいので、**狙いを保ったまま翻訳を取り戻す**のが本件。

---

## 2. 実測（2026-09-20・Chrome PC・localhost 配信・右クリック → 翻訳 → 簡体字中国語）

検査ページ **`tests/probe/translate-frames.html`**（＋ `translate-frames-child.html`）。
同じ日本語の一文を 8 条件に置き、翻訳の可否と、フレーム内でスクリプトがどう扱われたかを同時に見る。

| | 条件 | 翻訳された? | 自前スクリプト | ePub のインライン script / `on*` |
|---|---|---|---|---|
| A | 親ドキュメント | ○ | — | — |
| B | srcdoc・sandbox なし・CSP なし（〜v2.22.1 の本文） | **○** | 動いた | **実行された** |
| C | srcdoc・**現行の sandbox**（v2.23.x の本文） | **×** | 動いた | 実行された |
| C2 | srcdoc・sandbox＋`allow-same-origin`・CSP なし | **○** | 動いた | **実行された** |
| C3 | srcdoc・sandbox なし＋**nonce CSP** | **○** | 動いた | **阻止された** |
| C4 | srcdoc・sandbox＋`allow-same-origin`＋**nonce CSP** | **○** | 動いた | **阻止された** |
| D | 同一オリジンの別ファイルを `src=` | ○ | — | — |
| E | 親ドキュメント内の Shadow DOM | ○ | — | — |
| F | C4 と同じ条件で縦書き＋ルビ＋縦中横 | ○（ただし §4） | 動いた | 阻止された |

### 2-1. ここから確定したこと

- **Chrome は同一オリジンの iframe なら中まで翻訳する。** 訳されないのは不透明オリジンの C だけ。
  「Chrome は iframe を一切訳さない」という二次情報（Chromium issue 41090662 まわり）は**誤り**。
  **翻訳を止めているのは `sandbox` ただ一点**
- **nonce の CSP は翻訳を妨げない**（C3・C4 が訳された）。翻訳エージェントは親フレームから
  子の DOM を書き換えており、子フレームの `script-src` に縛られない
- **CSP は ePub 由来の実行経路を種類ごと止める**（C3・C4 で `<script>` と `on*` の双方が阻止）。
  サニタイザ（v2.22.1）と違い**列挙型ではない**
- Translator API（Chrome 138+ / Edge 148+）は手元の PC で `ja→zh-Hans = downloadable`。
  ただし**公表上デスクトップのみで Android には無い**ので、本件の主軸には使わない（§7）

### 2-2. 章送りに翻訳が追従するか（2026-09-20・Edge 実機）

**Edge では章を移ると本文が原文に戻る**（トップバーは訳されたまま）。`renderPage()` は章ごとに
`iframe.srcdoc` を入れ替える＝**フレームの中で別の文書へ移動している**ため。Chrome の翻訳は
サブフレームの新しい文書を拾い直すが、**Edge の翻訳は最初に掴んだ文書しか見ていない**。

検査は同じ probe の G / H / I / J（翻訳をかけた状態のままボタンを押す）。

| | やること | 翻訳が続く? |
|---|---|---|
| G | `fr.srcdoc` を入れ替える（**現行の章送り**） | **×** |
| H | `contentDocument.body.innerHTML` を差し替え | **○** |
| I | `insertAdjacentHTML` で段落を足す | **○** |
| J | `document.open()/write()/close()` | **×**（注入スクリプトは動いた＝CSP は保たれる） |

- **同じ Document を保ったまま DOM を書き換えれば追従する**（H・I）。
  **文書の載せ替えは srcdoc でも `document.open()` でも駄目**（G・J）。
- **J で「書き直し後のスクリプト: 動いた」** ＝ `document.open()` は元の文書の CSP を保つ。
  将来 in-place 化するなら **nonce はフレーム文書ごとに固定**して使い回せばよい、ということ。

### 2-3. 直すとしたら（やるなら別の設計書を立てる）

「章送りを**文書の移動から同じ文書の書き換え**に変える」＝ `renderPage` → `buildSrcdoc` →
`srcdoc` 代入という本文描画の中核の作り替え。波及:

- **注入スクリプトの後始末が要る** —— 同じ文書に章ごとのリスナー・タイマーが積み重なる。
  `buildScrollScript` の **3 IIFE × 2 ファイル**に teardown を足す話になる
- CSP の nonce をフレーム文書ごとに固定（§2-2）。`<head>` の差し替え範囲（ePub 由来の style だけ
  入れ替え、CSP meta と `@font-face` は残す）を決める必要
- `EPUB_READY` / `_isRendering` / `_renderSeq` の受け渡し、iOS の transform スクロールの初期化
- **rAF を差し替えた自動テストでは守れない領域**（`tests/README.md`「担保できないこと」）

**副産物として速くなる見込みもある**: 文書を作り直さなくなれば、ローカルフォントの data URI を
章ごとに再デコードしなくて済む（`design_iframe_sandbox.md` §2 の +82ms/章が消える）。

**現時点の判断: 見送る。** Chrome は PC / Mac / Android / iOS すべてで章送りに追従しており、
Edge でも「翻訳し直せば読める」。退行リスクに見合わない。

---

## 3. 方針 ── 同一オリジンに戻し、守りを CSP に移す

```html
<iframe id="content-iframe" src="about:blank"
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"></iframe>
```

```html
<!-- buildSrcdoc() が <head> の先頭に入れる -->
<meta http-equiv="Content-Security-Policy" content="
  default-src 'none';
  script-src 'nonce-XXXXXXXX';
  style-src 'unsafe-inline' data: https://fonts.googleapis.com;
  img-src data: blob: https:;
  font-src data: https://fonts.gstatic.com;
  media-src data: blob:;
  connect-src 'none'; form-action 'none'; base-uri 'none';
  frame-src 'none'; object-src 'none'">
```

守りは 3 層になる:

1. **サニタイザ**（v2.22.1）— `<script>` / `on*` / 入れ子の実行コンテナ / `javascript:` を除去（列挙型）
2. **nonce CSP**（新規）— **注入した自分のスクリプトだけが動く**。ePub 由来のインラインスクリプトも
   `on*` も `javascript:` も外部スクリプトも、**種類ごと**動かない。sandbox が担っていた
   「クラスごと消す」性質はここが引き継ぐ
3. **sandbox の残り**（`allow-same-origin` を足しても外れない）— フォーム送信・トップナビゲーション・
   モーダル・ポインタロックは禁止のまま。**つまり万一スクリプトが動いてもフォーム送信での持ち出しは塞がっている**

### 3-1. 各ディレクティブの理由

| ディレクティブ | 理由 |
|---|---|
| `script-src 'nonce-…'` | **本設計の要。`'unsafe-inline'` を足したら全部無意味になる**（ePub のスクリプトが動く） |
| `style-src 'unsafe-inline' data: https://fonts.googleapis.com` | ePub の style 属性・インライン `<style>`・`FONT_URLS` の `@import`（`yomikake.html:4212`） |
| `font-src data: https://fonts.gstatic.com` | ローカルフォントは data URI（v2.23.0）・Google Fonts の実体 |
| `img-src data: blob: https:` | 本文画像は `toDataUri()` 済み。稀に残る外部画像で本が壊れないよう `https:` を許す |
| `connect-src 'none'` | 注入スクリプトは `postMessage` しか使わない。**持ち出し経路を塞ぐ** |
| `form-action 'none'` / `base-uri 'none'` | 同上 |

### 3-2. 実装上の罠

- **meta の CSP は `<head>` の先頭に置く**。後ろに置くと、それより前の内容は保護されない
- **nonce は 1 描画ごとに作り直す**（`crypto.getRandomValues`）。固定値にすると ePub 側に書けてしまう
- **`nonce` 属性が `outerHTML` の直列化で消えないことを確認する**（ブラウザには nonce hiding が
  あり、CSP 下の文書では属性値が空にされる）。消えるようなら文字列で埋め込む。
  **テストで「生成された srcdoc に `nonce=` が入っていること」を検査する**
- **CSP 非対応の古いブラウザ**では層 2 が無効になるが、層 1・3 は残る

---

## 4. ルビをどうするか（未決・要判断）

F の実測では**翻訳はされるが訳文が壊れる**。`<ruby>漢字<rt>かんじ</rt></ruby>` があると
翻訳エンジンがテキストノード単位に分断して訳すため、文がつながらない
（実測では「縦書きで表示した本文です」が「这太棒了」＋「縦書表示本文」のような断片になった）。

**日本語学習者向けの本ほどルビが多い**ので、ここは効く。選択肢:

- (a) **何もしない（採用）** — ルビの無い本（多くの Web 小説）は問題なく訳せる。ブラウザ側で
  原文に戻せるので、**大きな破綻が出るまで凝った仕組みは作らない**（2026-09-20 の判断）。
  ヘルプの「🌐 ブラウザの翻訳で読む」に一文だけ書いてある
- (b) **設定「翻訳しやすさ優先」** — ON のとき `buildSrcdoc()` で `<ruby>` を親字だけに開き、
  文を 1 つのテキストノードに戻す。ルビは読めなくなるが訳文は自然になる
- (c) **章単位の対訳ビュー** — 今読んでいる章のテキストを**親ドキュメント**に出す別画面。
  原文と訳を並べられる／ブラウザ翻訳がそのまま効く／`ttsExtractText()`（ルビは `rt` 優先で
  既に処理済み）を再利用できる。**学習者向けにはこれが本命になりうる**が、本件とは独立した機能

**§3 だけ先に入れて実機で読み、(b)(c) の要否はそのあと決める。**

---

## 5. 実装手順

| Step | 中身 |
|---|---|
| 1 | `buildSrcdoc()` に nonce 生成＋CSP meta 挿入＋注入スクリプトへの nonce 付与（**両ファイル**） |
| 2 | `<iframe>` の sandbox に `allow-same-origin` を足す（**両ファイル**） |
| 3 | テスト更新: `tests/cases/epub-sanitize.js`（`allow-same-origin` が**ある**ことに反転・CSP の存在・nonce の一致・`'unsafe-inline'` が `script-src` に無いこと） |
| 4 | `CLAUDE.md` と `design_iframe_sandbox.md` の「`allow-same-origin` は絶対に与えない」を改訂 |
| 5 | **実機確認**（§5-1） |

### 5-1. 実機で見るところ

- **Chrome / Edge で本文が訳せること**（PC・Mac・Android）。**Firefox・Safari で従来どおり訳せること**
- CSP で**本が壊れていないこと** — 画像・Google Fonts・ローカルフォント・縦中横・ルビ・
  外部リンク（`allow-popups`）・目次ジャンプ・検索ジャンプ・読み上げ・キーボード（`EPUB_KEY`）・
  KOReader 同期。**コンソールに CSP 違反が出ていないか**を必ず見る
- iOS（対象外だが壊さない確認）

### 5-2. あとで拾える副産物（本件では触らない）

`allow-same-origin` が戻ると**ローカルフォントの `blob:` 経路が再び使える**
（v2.23.0 で data URI に一本化した際の代償は章あたり +98ms・`design_iframe_sandbox.md` §2）。
戻すなら `font-src` に `blob:` が要る。**別件として、速度が気になってから判断する。**

---

## 6. 代償

- **CSP が破られれば localStorage に届く**（不透明オリジンなら届かなかった）。
  KOReader の `userkey` はパスワードと等価なので、ここが本件で手放す唯一のもの
- 層 2 はブラウザの CSP 実装に依存する。sandbox と違い「オリジンが違う」という強さは無い

---

## 7. 却下した案

- **設定で sandbox を切り替える** — 保護が設定依存になる。`design_iframe_sandbox.md` §3-1 の
  「設定次第で保護が消える形は採らない」をここでも守る。CSP なら**分岐なしで両立できる**
- **Translator API で yomikake 自身が訳す** — **デスクトップ限定で Android に無い**。
  ブラウザ純正の翻訳を置き換える理由が無い。ただし §4(c) の対訳ビューを作るなら実装手段として有力
- **本文を親ドキュメントに描く** — 描画パイプラインが二重になる（両ファイル × 通常/翻訳で 4 系統）

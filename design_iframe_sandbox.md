# 本文 iframe の sandbox 化 概要設計書

対象: `yomikake.html`・`yomikake_ios.html` **両ファイル**

関連: `design_kosync.md`（localStorage に長期の資格情報が載った経緯）・`design_font_extension.md`（ローカルフォント）

**実装状況: 未着手。実測（§2）は完了しており、設計の分岐は解けている。**

---

## 1. なぜやるか

本文は `srcdoc` の `<iframe>` に描いており、この iframe は **親と同一オリジン**で `sandbox` も無い。
つまり ePub の中でコードが動けば `localStorage` を丸ごと読める。

v2.22.1 で ePub 由来の実行経路（インライン `on*`・入れ子 `<iframe>`/`<object>`/`<embed>`・
`javascript:`）を除去したが、**あれは数え上げ型の防御**で、ブラウザに新しい経路が増えたら
追随が要る。`sandbox` はクラスごと消す。

`_driveToken` を「XSS 対策で localStorage 非使用」としている既存方針とも、こちらのほうが揃う。

---

## 2. 実測（2026-08-30・iPad Safari）

検査ページ `tests/probe/font-sandbox.html`。フォントは `AyatiShowaSerif-Regular.ttf`（8.64 MB →
data URI 11.52 MB）。各 10 回の中央値。

| 条件 | 中央値 | FontFace | 判定 |
|---|---|---|---|
| ① **sandbox + data URI** | **138 ms** | `loaded` / `check=true` / 幅差 28.1px | **読めた** |
| ② sandbox なし + data URI | 122 ms | `loaded` | 読めた |
| ③ sandbox なし + blob（**現行**） | **40 ms** | `loaded` | 読めた |
| ④ sandbox + blob | 73 ms | `unloaded` / `check=false` / 幅差 0px | **読めない** |

連打耐久: **data URI で 30 回連続描画 → 3592 ms・失敗 0 回・ページ再読み込みなし**。

別の検査（`temp_sample/sandbox probe.png`）で sandbox 内の環境も確認済み:
`origin = null` / `localStorage: SecurityError` / `postMessage`・`getComputedStyle`・
`PointerEvent`・`ontouchstart` すべて生存 / クロスオリジン fetch は CORS で弾かれない。

### 2-1. ここから確定したこと

- **`blob:` は sandbox 下で読めない**（④）。blob URL は生成元オリジンに紐づくため。
  WebKit bug 170075 は 2021 年に FIXED だが regression 222312 があり、**現に今も落ちる**
- **`data:` は sandbox 下でも読める**（①）。**これで設計の分岐が解けた**
- **sandbox 自体のコストは小さい**（②→① で +16 ms）
- **重いのは data URI 側**（③→② で +82 ms）＝フォントの再デコード
- **合計の代償は +98 ms**。ただし**章が変わるときだけ**で、章内のページ送りは
  `scrollPage()`（スクロール）なので iframe を作り直さない
- **メモリは持つ**（30 回連続で失敗ゼロ）

### 2-2. 測定で 2 回間違えた記録

- 初版は「同じ文字列を対象フォントと serif で描いて幅が変わるか」で判定した。
  **日本語のグリフは全角固定なのでフォントが変わっても幅が 1px も動かず**、全条件が偽陰性になった。
  → **FontFace の `status` を正とする**。幅を見るならラテン文字を混ぜる
- headless では sandbox 付き iframe が応答せず、`FileReader` も virtual-time で発火しない。
  **この検査は実機でしか成立しない**

---

## 3. 設計

### 3-1. 常に sandbox する（分岐を作らない）

```html
<iframe id="content-iframe" src="about:blank"
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"></iframe>
```

- `allow-same-origin` は**与えない**。これが要点
- `allow-popups` は `CLICK_HANDLER` の `window.open`（外部リンク）に要る。
  `allow-popups-to-escape-sandbox` が無いと開いた先まで sandbox が伝播する

**条件分岐で sandbox を外す設計（当初の案 C）は採らない。** ①が通った以上、外す理由が無い。
設定次第で保護が消える形は「ガイドが嘘をつかない」という既存の思想にも反する。

### 3-2. ローカルフォントは常に data URI にする

`cfGetFontSrc()` の `location.protocol !== 'file:'` 分岐（Blob URL 経路）を**削除**し、
data URI 経路に一本化する。`file://` 用に既にある実装をそのまま使うので**新規実装はほぼ無い**。

代償は §2 のとおり章あたり +98 ms（8.6 MB のフォントで実測）。`CF_MAX_SIZE` は 20 MB なので
最悪ケースはこの 2.3 倍程度と見込まれる。**ローカルフォントを使っている本だけが負う**。

### 3-3. 同一オリジンに依存していないことの確認（済）

| 確認項目 | 結果 |
|---|---|
| 親が `contentDocument` / `contentWindow.document` を触る箇所 | **0 件** |
| 注入コードの `localStorage` / `cookie` 使用 | **なし** |
| 注入コードが使う API | `postMessage` / `getComputedStyle` / Pointer・Touch — オリジン非依存 |
| 本文画像 | `toDataUri()` で `data:` 化済み |
| FXL（マンガ） | iframe を使わないので無関係 |

### 3-4. 試してはいけない案（記録）

**Service Worker でフォントを配る案は成立しない。** 不透明オリジンの iframe は
**Service Worker に制御されない**ため、そのサブリソース要求は `fetch` ハンドラに届かない。

---

## 4. 実装手順

| Step | 中身 |
|---|---|
| 1 | `cfGetFontSrc()` を data URI 一本化（blob 経路と `_cfBlobUrlCache` を削除） |
| 2 | `<iframe>` に `sandbox` 属性を付ける（両ファイル） |
| 3 | テスト: sandbox 属性が焼き込まれていること・blob 経路が消えたこと |
| 4 | **4 環境の実機確認**（PC / Android / iPhone / iPad） |

⚠ Step 4 が本体。**自動テストでは担保できない** —— headless は rAF を差し替えており、
sandbox 起因のタイミング差は隠れる（`tests/README.md` の「担保できないこと」と同じ理由）。

### 4-1. 実機で見るところ

ページ送り・章送り・スワイプ（iOS）・目次ジャンプ・本文内リンク・**外部リンク**（`allow-popups`）・
検索ジャンプ・縦中横・ルビ・**ローカルフォントの適用と体感速度**・読み上げ・キーボード操作
（`EPUB_KEY` 転送）・FXL（無関係のはずだが一応）。

---

## 5. 未確定

- `CF_MAX_SIZE`（20 MB）いっぱいのフォントでの体感。§2 は 8.64 MB での実測
- Google Fonts の `@font-face` 実体読み込み（CORS は通ることを確認済みだが、実際の適用は未確認）

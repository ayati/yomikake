# yomikake テスト

```sh
tests/lib/run.sh              # 全ケースを両ファイルに対して実行
tests/lib/run.sh theme        # 名前に "theme" を含むケースだけ
CHROME=/path/to/chrome tests/lib/run.sh
```

依存は **python3・node・Chrome 系ブラウザ 1 本**だけ。npm install も CI 設定も要らない。
Chrome は自動探索する（Playwright のキャッシュ／`/usr/bin/chromium`／macOS の Google Chrome）。
見つからなければ **SKIP** して落ちない。

## このテストの位置づけ

**回帰検知の網であって、動作保証ではない。実機テストを置き換えない。**

いちばんの目的は **`yomikake.html` と `yomikake_ios.html` の同期崩れの検知**。
同じ assertion を両ファイルに流すので、片方だけ直した事故がその場で出る。
この repo は「ほとんどの機能を 2 ファイルに手で同期させる」構造が最大の弱点で、
そこを人間の注意力ではなくコードで見張るためにある。

### 担保できること

- 両 HTML の inline `<script>` が構文として通る
- 設定の保存・復元・不正値の除去
- DOM の状態遷移（クラス付与、トグル、表示/非表示）
- CSS の計算値・実測ジオメトリ（グリッドの列数、パネルの位置と寸法、折り返しの有無）
- 実際に描画された画素（明るさフィルタが本当に効いているか、対象外の UI を巻き込んでいないか）
- i18n 4 言語のキーが揃っていること
- 実 ePub を開いてからの表示設定変更（読書位置の保持、`mode-fxl` の維持、`closeBook`）

### 担保できないこと（重要）

- **タイミング依存の挙動** — headless の `--dump-dom` では `requestAnimationFrame` が発火せず
  `loadEpub()` が完了しないため、E2E ケースでは **rAF を `setTimeout` に差し替えている**
  （`RAF_SHIM=1`）。つまり iPad の `double-rAF + 500ms フォールバック`、`EPUB_READY` の
  seq 競合、`_isRendering` の窓といった**タイミング由来のバグは検出できないどころか隠れる**。
- **狭い画面の実寸** — headless のビューポートは 500px 未満にならない。iPhone SE 相当（320px）
  のレイアウトは測れていない。
- **iOS Safari 固有の挙動** — CSS transform スクロール、`dvh` と URL バーの相互作用、
  セーフエリア、ホーム画面 PWA の別ストレージ。
- **実音声（TTS）・Google Drive 連携・File System Access API・タッチ/スワイプ**。
- ブラウザ間差異（Firefox の RTL `scrollLeft` 符号など）。

これらは従来どおり実機（PC / Android / iPhone / iPad）での手動確認が要る。

## 構成

```
tests/
  lib/run.sh            全ケースを両ファイルに流す。落ちたら exit 1
  lib/dom-test.sh       HTML の末尾に assertion を注入して headless Chrome で実行
  lib/syntax-check.js   inline <script> を vm.Script でパースするだけ
  lib/make-fixtures.py  テスト用の小さな ePub を生成（tests/.fixtures/・gitignore）
  lib/pixel-test.sh     スクリーンショットを撮って画素を読む（Pillow が要る。無ければ SKIP）
  cases/*.js            DOM テストのケース本体
  pixel/*.sh            画素テストのケース本体（PASS/FAIL 行を print する）
```

**画素テスト**は「CSS 変数は入っているのに実際には見えていない」類の事故を拾うためにある。
たとえば明るさフィルタは、重ね順を1つ間違えると本文の下に潜って何も起きない／
逆に操作系 UI まで暗くしてしまうが、computed style だけ見ても気づけない。
実際に描画された画素を測れば一発で分かる。

`temp_sample/`（個人の蔵書）には依存しない。E2E は `make-fixtures.py` が生成する
**リフロー本（4章）と FXL 本（4ページ・rtl・pre-paginated）** を使うので、
クローン直後でもそのまま通る。

## ケースの書き方

`tests/cases/` に `.js` を置くだけで `run.sh` が拾う。ページのスコープでそのまま実行されるので、
`state` や各関数を直接呼べる。

```js
T('名前', 条件, '詳細（任意）');     // 1 行 = 1 assertion
```

非同期でもよい（結果は 100ms 毎に書き出される）。実 ePub を開くケースは
`run.sh` の `CASE_ENV` に `RAF_SHIM=1 VTB=30000` を足すこと。

### 落とし穴

- **CSS transition の途中で測らない**。開いた直後の `getBoundingClientRect()` は
  アニメーション中の値を返す。計測前に `el.style.transition = 'none'` を入れる
  （`settings-sheet.js` が実例）。
- **再描画は非同期**。`changeTheme()` などの後に `iframe.srcdoc` を見るなら待つ
  （`e2e-reflow.js` が実例）。
- **`localStorage.clear()` でケースを終える**。ケース間で状態が漏れる。
- ケースが `--dump-dom` の前に完了しないと結果が空になる。長い処理は `VTB` を伸ばす。

## 新機能を足すときの型

1. `tests/cases/` にケースを足す（**両ファイルに同じ assertion が流れる**）
2. `tests/lib/run.sh` で緑を確認
3. 実機で「担保できないこと」の欄を手で確認

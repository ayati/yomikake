// iframe へ注入するスクロール制御コードの検査
//
// 主眼は「viewport の寸法が変わったときに読書位置を保てるか」。
// iOS 版は CSS transform でスクロールを実装しているため、位置（tx/ty）が
// viewport の寸法に依存する（ms = 本文の長さ − 表示サイズ）。サイドバーの開閉や
// 全画面の切替で寸法が変わると、同じ tx が別の位置を指してしまう。
// 発端: 目次から章へ飛んだあとサイドバーを閉じると、本文がサイドバー幅ぶんずれた
//      （初期からの不具合。iPad 実機で発見）。

// _handleKeys（File System Access のハンドル集合）は yomikake.html にしか無い
var IS_IOS = (typeof _handleKeys === 'undefined');
T('対象ファイルを判別できる', typeof IS_IOS === 'boolean');
T('buildScrollScript がある', typeof buildScrollScript === 'function');

['vertical', 'horizontal', 'publisher'].forEach(function (mode) {
  var src = buildScrollScript('start', mode, 1);
  T(mode + ': スクリプトが生成される', typeof src === 'string' && src.length > 200);

  // ⚠ tests/lib/syntax-check.js は HTML 内の <script> しか見ない。
  //    iframe へ注入されるこの文字列は素通りするので、ここで構文を確かめる
  var ok = true;
  try { new Function(src); } catch (e) { ok = false; }
  T(mode + ': 生成されたコードが構文的に妥当', ok);

  if (IS_IOS) {
    T(mode + ': resize を購読する',        src.indexOf("addEventListener('resize'") > 0);
    T(mode + ': 位置を引き直す関数がある',  src.indexOf('reflowKeepPos') > 0);
    T(mode + ': 読書位置を比率で保持する',  src.indexOf('_ratio') > 0);
    T(mode + ': 寸法が変わらなければ何もしない', src.indexOf('_rzW') > 0 && src.indexOf('_rzH') > 0);
    T(mode + ': デバウンスする',            src.indexOf('_rzT') > 0);
    // 比率は setTx / setTy を通ったときに更新される（そこが唯一の更新点）
    T(mode + ': 位置の設定時に比率を更新する',
      /_ratio = _ms[xy]? > 0/.test(src) || /_ratio = _ms > 0/.test(src));
  } else {
    // 本体は本物のスクロール API を使うのでブラウザが位置を維持する。
    // transform スクロールは CLAUDE.md でも iOS 専用と明記されている
    T(mode + ': 本体は transform スクロールではないので resize 補正を持たない',
      src.indexOf('reflowKeepPos') < 0);
  }
});

// 読書データ「よく読む著者」の棒グラフの検査
//
// 発端: 実データ（読了 158 冊）でも棒が 1 ドットも描かれなかった。
//       .rd-author-bar は <span>＝インラインなので width/height/min-width が効かず、
//       見えていたのは下地（.rd-author-bar-wrap の背景）だけだった。
//       → 幅が実際に描かれているか（0 でないか・件数に比例しているか）を画素で見る。

var KEYS = [];
function seed(title, creator, count) {
  // 読了本（finishedAt あり）を count 冊ぶん作る
  for (var i = 0; i < count; i++) {
    var k = 'epub_pos_' + makeBookKey(title + i, creator);
    localStorage.setItem(k, JSON.stringify({
      spineIdx: 9, ratio: 1, spineCount: 10, creator: creator,
      lastOpenedAt: Date.now() - i * 86400000,
      finishedAt: Date.now() - i * 86400000, finishedCount: 10
    }));
    KEYS.push(k);
  }
}
seed('三冊の本', '著者アルファ', 3);
seed('一冊の本', '著者ベータ', 1);

openReadingData();

var rows  = document.querySelectorAll('#reading-data-body .rd-author-row');
var bars  = document.querySelectorAll('#reading-data-body .rd-author-bar');
var wraps = document.querySelectorAll('#reading-data-body .rd-author-bar-wrap');

T('著者の行が出る', rows.length >= 2, '行数=' + rows.length);

if (bars.length >= 2) {
  var w0 = bars[0].getBoundingClientRect().width;
  var w1 = bars[1].getBoundingClientRect().width;
  var track = wraps[0].getBoundingClientRect().width;

  T('棒が実際に描かれている（幅 0 でない）', w0 > 0, '1位の棒幅=' + w0.toFixed(1) + 'px');
  T('2位の棒も描かれている', w1 > 0, '2位の棒幅=' + w1.toFixed(1) + 'px');
  T('件数の比が棒の長さに出ている（3:1）',
    w0 > w1 * 2 && w0 < w1 * 4, '1位=' + w0.toFixed(1) + ' / 2位=' + w1.toFixed(1));
  T('1位の棒は下地いっぱい', track > 0 && Math.abs(w0 - track) < 2,
    '棒=' + w0.toFixed(1) + ' / 下地=' + track.toFixed(1));
  T('棒は下地からはみ出さない', w0 <= track + 1);
  T('棒に高さがある', bars[0].getBoundingClientRect().height > 4,
    '高さ=' + bars[0].getBoundingClientRect().height.toFixed(1) + 'px');
}

closeReadingData();
KEYS.forEach(function (k) { localStorage.removeItem(k); });

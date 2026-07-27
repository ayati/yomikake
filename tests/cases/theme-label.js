// B-4 テーマ名ラベルのテスト
var cells = document.querySelectorAll('.theme-cell');
T('テーマセルが8個', cells.length === 8, String(cells.length));
T('各セルに丸と名前', Array.prototype.every.call(cells,
  function (c) { return c.querySelector('.theme-btn') && c.querySelector('.theme-name'); }));

// 名前をクリックしてもテーマが変わる（onclick はセル側）
cells[5].querySelector('.theme-name').click();   // 星空
T('名前クリックでテーマ変更', state.theme === 'hoshi', state.theme);
T('active が丸に付く', cells[5].querySelector('.theme-btn').classList.contains('active'));
T('選択中の名前が強調',
  getComputedStyle(cells[5].querySelector('.theme-name')).fontWeight === '700');

// updateThemeBtnUI が新DOMでも動く（.tb-* セレクタ維持の回帰テスト）
state.theme = 'matcha'; updateThemeBtnUI();
T('updateThemeBtnUI が追従',
  document.querySelector('.tb-matcha').classList.contains('active') &&
  !document.querySelector('.tb-hoshi').classList.contains('active'));

// レイアウト：4列に収まり、名前が折り返さない（4言語）
function checkLayout(lg, width) {
  setLang(lg);
  var opts = document.querySelector('.theme-options');
  var cs = getComputedStyle(opts);
  var cols = cs.gridTemplateColumns.split(' ').length;
  T('4列グリッド (' + lg + ')', cols === 4, cs.gridTemplateColumns);
  var over = [], tops = {};
  Array.prototype.forEach.call(document.querySelectorAll('.theme-name'), function (n) {
    // 折り返すと高さが2行分になる → 1行の line-height(10px*1.2=12px) を大きく超える
    if (n.getBoundingClientRect().height > 15) over.push(n.textContent);
    // セルからの横はみ出し
    var cr = n.parentElement.getBoundingClientRect(), nr = n.getBoundingClientRect();
    if (nr.width > cr.width + 1) over.push(n.textContent + '(はみ出し)');
    tops[Math.round(n.getBoundingClientRect().top)] = 1;
  });
  T('名前が折り返さない (' + lg + ')', over.length === 0, over.join(','));
  T('2行に並ぶ (' + lg + ')', Object.keys(tops).length === 2, Object.keys(tops).join('/'));
}
// 設定パネルを開いた状態で計測する
toggleSettings();
['ja', 'en', 'zh-TW', 'zh-CN'].forEach(function (lg) { checkLayout(lg, 0); });
setLang('ja');
T('popover 幅', true, Math.round(document.getElementById('settings-popover').getBoundingClientRect().width) + 'px');
localStorage.clear();

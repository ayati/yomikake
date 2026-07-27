var pop = document.getElementById('settings-popover');
pop.style.transition = 'none';
toggleSettings();
var r = pop.getBoundingClientRect();
var mobile = innerWidth <= 640;
T('viewport', true, innerWidth + 'x' + innerHeight + (mobile ? ' (mobile)' : ' (desktop)'));
if (mobile) {
  T('下端に接地', Math.abs(r.bottom - innerHeight) < 2, 'bottom=' + Math.round(r.bottom) + ' vh=' + innerHeight);
  T('全幅', Math.abs(r.width - innerWidth) < 2, Math.round(r.width) + '/' + innerWidth);
  T('高さが 82dvh 以下', r.height <= innerHeight * 0.83 + 1, Math.round(r.height) + '/' + Math.round(innerHeight * 0.82));
  T('背景の本文が覗く', r.top > 40, 'top=' + Math.round(r.top));
  T('グラバー表示', getComputedStyle(document.querySelector('.pop-grabber')).display === 'block');
  T('上角のみ丸い', getComputedStyle(pop).borderTopLeftRadius === '18px' &&
                    getComputedStyle(pop).borderBottomLeftRadius === '0px');
  T('本体がはみ出さない', r.left >= -1 && r.right <= innerWidth + 1);
} else {
  T('右上に出る', r.top < 100 && Math.abs(r.right - (innerWidth - 16)) < 2,
    'top=' + Math.round(r.top) + ' right=' + Math.round(r.right));
  T('幅 340px', Math.round(r.width) === 340, String(Math.round(r.width)));
  T('グラバー非表示', getComputedStyle(document.querySelector('.pop-grabber')).display === 'none');
}
// 開閉が効く
toggleSettings();
T('閉じると visibility:hidden', getComputedStyle(pop).visibility === 'hidden');
toggleSettings();
T('再度開ける', getComputedStyle(pop).visibility === 'visible');
// 最下部の項目まで到達できる（スクロール可能）
var body = document.querySelector('.pop-body');
T('pop-body がスクロール可能', body.scrollHeight > body.clientHeight,
  body.scrollHeight + '>' + body.clientHeight);
body.scrollTop = body.scrollHeight;
var last = document.querySelector('#settings-popover .set-group:last-child');
T('最下部グループが画面内に', last.getBoundingClientRect().bottom <= innerHeight + 1,
  Math.round(last.getBoundingClientRect().bottom) + '/' + innerHeight);

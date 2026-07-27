// リフロー本を開き、明るさ最暗＋暖色最大にしてから撮影する
fetch('tests/.fixtures/reflow.epub').then(function(r){return r.blob();})
.then(function(b){ return loadEpub(new File([b],'reflow.epub',{type:'application/epub+zip'})); })
.then(function(){
  hideTapGuide();                       // 初回オープンの操作ガイドが本文を覆うので消す
  changeTheme('white');                 // 紙 #ffffff を基準にすると減光量が読みやすい
  return new Promise(function(r){ setTimeout(r, 1500); });
})
.then(function(){
  if (location.hash === '#dim') { changeBrightness(30); changeWarmth(5); }
  return new Promise(function(r){ setTimeout(r, 600); });
})
.then(function(){ window.__READY = true; });

#!/usr/bin/env bash
#
# 対象 HTML の末尾に assertion スクリプトを差し込んだ一時コピーを作り、
# headless Chrome の --dump-dom で走らせて結果行を取り出す。
#
#   tests/lib/dom-test.sh <html> <case.js> [chrome への追加フラグ...]
#
# 環境変数:
#   CHROME     Chrome/Chromium の実行ファイル（省略時は自動探索）
#   VTB        --virtual-time-budget のミリ秒（既定 8000）
#   RAF_SHIM   1 なら requestAnimationFrame を setTimeout に差し替える
#              （headless の --dump-dom では rAF が発火せず loadEpub が完了しないため。
#                これを使うテストは「タイミング依存の挙動を検査できない」ことに注意）
#
# case.js の中では次が使える:
#   T(name, cond, detail)   結果を1行記録する
#   非同期テストは自由に Promise を使ってよい（結果は 100ms 毎に書き出される）
set -euo pipefail

[ $# -ge 2 ] || { echo "usage: $0 <html> <case.js> [chrome flags...]" >&2; exit 2; }
SRC="$1"; CASE="$2"; shift 2

find_chrome() {
  [ -n "${CHROME:-}" ] && { echo "$CHROME"; return; }
  local c
  for c in \
    "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux64/chrome \
    "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux/chrome \
    /usr/bin/chromium /usr/bin/chromium-browser /usr/bin/google-chrome \
    /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome
  do [ -x "$c" ] && { echo "$c"; return; }; done
}
CHROME_BIN="$(find_chrome || true)"
if [ -z "$CHROME_BIN" ]; then
  echo "SKIP | Chrome が見つかりません（CHROME=/path/to/chrome を指定してください）"
  exit 0
fi

DIR="$(cd "$(dirname "$SRC")" && pwd)"
TMP="$DIR/.__domtest_$(basename "$SRC" .html)_$$.html"
trap 'rm -f "$TMP"' EXIT

RAF_SHIM="${RAF_SHIM:-0}" python3 - "$SRC" "$CASE" "$TMP" <<'PY'
import io, os, sys
src, case, out = sys.argv[1], sys.argv[2], sys.argv[3]
html = io.open(src, encoding='utf-8').read()
code = io.open(case, encoding='utf-8').read()

shim = ('<script>/* headless の --dump-dom では rAF が発火しないので差し替える */\n'
        'window.requestAnimationFrame=function(f){return setTimeout(function(){f(performance.now());},8);};\n'
        'window.cancelAnimationFrame=function(i){clearTimeout(i);};</script>\n')

# ⚠ 出力先は画面の外へ固定する。本文の流れに置くと結果が増えるたびにページが伸び、
#    アプリ側の読書エリア（dvh/flex）が縮む。実寸を測るケースでは、同じ本の同じ章が
#    assertion の数だけ長くなって見え、比較が成立しなくなる（--dump-dom は見た目に
#    関係なく DOM を出すので、隠しても結果の取り出しには影響しない）。
inject = ('<div id="yomi-test-out" style="position:fixed;left:-99999px;top:0;'
          'width:1px;height:1px;overflow:hidden"></div>\n<script>\n'
          'window.__T=[];window.T=function(n,c,d){__T.push((c?"PASS":"FAIL")+" | "+n+(d?" | "+d:""));};\n'
          'window.onerror=function(m){__T.push("FAIL | window.onerror | "+m);};\n'
          'window.addEventListener("unhandledrejection",function(e){'
          '__T.push("FAIL | 未捕捉 reject | "+(e.reason&&e.reason.message||e.reason));});\n'
          'setInterval(function(){document.getElementById("yomi-test-out").textContent='
          '"\\n"+__T.join("\\n")+"\\n";},100);\n'
          'window.addEventListener("load",function(){setTimeout(function(){\n'
          'try{\n' + code + '\n}catch(e){__T.push("FAIL | ケースが例外 | "+(e.stack||e.message));}\n'
          '},300);});\n</script>\n')

assert html.rstrip().endswith('</html>'), src + ' が </html> で終わっていません'
if os.environ.get('RAF_SHIM') == '1':
    html = html.replace('<script', shim + '<script', 1)
io.open(out, 'w', encoding='utf-8').write(html.rstrip()[:-len('</html>')] + inject + '</html>\n')
PY

"$CHROME_BIN" --headless --disable-gpu --no-sandbox \
  --virtual-time-budget="${VTB:-8000}" --dump-dom "$@" "file://$TMP" 2>/dev/null \
  | python3 -c "
import sys, re, html
d = sys.stdin.read()
m = re.search(r'<div id=\"yomi-test-out\"[^>]*>(.*?)</div>', d, re.S)
if not m:
    print('FAIL | ページが実行されませんでした（出力なし）'); sys.exit(0)
body = html.unescape(m.group(1)).strip()
print(body if body else 'FAIL | 結果が空です（テストが完了していません）')
"

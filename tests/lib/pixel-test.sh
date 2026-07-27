#!/usr/bin/env bash
#
# 実際に描画された画素を見て検証する。DOM/CSS の計算値ではなく「本当にそう見えるか」を確かめる用。
#
#   tests/lib/pixel-test.sh <html> <setup.js> <probe.py> [chrome flags...]
#
# setup.js  : スクリーンショット前に走らせる準備コード（window.__READY=true を立てると待機終了）
# probe.py  : 撮影した PNG を受け取り PASS/FAIL 行を print する（引数1 = PNG のパス）
#
# 環境変数: CHROME / VTB / WINDOW（既定 900,700） / HASH（URL に付ける #... ）
#           KEEP_PNG=<path> を指定すると撮影画像を残す
set -euo pipefail
[ $# -ge 3 ] || { echo "usage: $0 <html> <setup.js> <probe.py> [chrome flags...]" >&2; exit 2; }
SRC="$1"; SETUP="$2"; PROBE="$3"; shift 3

find_chrome() {
  [ -n "${CHROME:-}" ] && { echo "$CHROME"; return; }
  local c
  for c in "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux64/chrome \
           "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux/chrome \
           /usr/bin/chromium /usr/bin/chromium-browser /usr/bin/google-chrome
  do [ -x "$c" ] && { echo "$c"; return; }; done
}
CHROME_BIN="$(find_chrome || true)"
[ -n "$CHROME_BIN" ] || { echo "SKIP | Chrome が見つかりません"; exit 0; }
python3 -c "import PIL" 2>/dev/null || { echo "SKIP | Pillow がありません（pip install Pillow）"; exit 0; }

DIR="$(cd "$(dirname "$SRC")" && pwd)"
TMP="$DIR/.__pixtest_$(basename "$SRC" .html)_$$.html"
PNG="$(mktemp -u /tmp/yomikake-pix-XXXXXX.png)"
trap 'rm -f "$TMP" "$PNG"' EXIT

python3 - "$SRC" "$SETUP" "$TMP" <<'PY'
import io, sys
src, setup, out = sys.argv[1], sys.argv[2], sys.argv[3]
html = io.open(src, encoding='utf-8').read()
code = io.open(setup, encoding='utf-8').read()
shim = ('<script>window.requestAnimationFrame=function(f){return setTimeout(function(){f(performance.now());},8);};'
        'window.cancelAnimationFrame=function(i){clearTimeout(i);};</script>\n')
inject = ('<script>\nwindow.addEventListener("load",function(){setTimeout(function(){\n'
          'try{\n' + code + '\n}catch(e){console.error(e);}\n},300);});\n</script>\n')
html = html.replace('<script', shim + '<script', 1)
io.open(out, 'w', encoding='utf-8').write(html.rstrip()[:-len('</html>')] + inject + '</html>\n')
PY

"$CHROME_BIN" --headless --disable-gpu --no-sandbox --hide-scrollbars \
  --window-size="${WINDOW:-900,700}" --virtual-time-budget="${VTB:-20000}" \
  --screenshot="$PNG" "$@" "file://$TMP${HASH:-}" >/dev/null 2>&1 || true

[ -s "$PNG" ] || { echo "FAIL | スクリーンショットが撮れませんでした"; exit 0; }
[ -n "${KEEP_PNG:-}" ] && cp "$PNG" "$KEEP_PNG"
python3 "$PROBE" "$PNG"

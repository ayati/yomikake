#!/usr/bin/env bash
#
# Web Share Target の往復を「実際の Service Worker」で確かめる。
#
#   tests/lib/share-e2e.sh
#
# なぜ専用スクリプトなのか:
#   SW も Cache Storage も**セキュアコンテキスト限定**で、dom-test.sh の file:// では
#   一切動かない。共有経路（sw.js の POST 受信 → 退避 → ページが拾って開く）は
#   この repo で唯一 file:// では検査できない機能なので、localhost に立てて流す。
#
# 検査する形は実機と同じ「ナビゲーション POST」（<form> の submit）。
# fetch() の POST では request.mode が navigate にならず、実機と経路が変わる。
#
# 環境変数: CHROME（省略時は自動探索）
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

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
[ -n "$CHROME_BIN" ] || { echo "SKIP | Chrome が見つかりません"; exit 0; }
[ -f tests/.fixtures/reflow.epub ] || python3 tests/lib/make-fixtures.py >/dev/null 2>&1
[ -f tests/.fixtures/reflow.epub ] || { echo "SKIP | fixture がありません"; exit 0; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cp sw.js "$WORK/" && cp tests/.fixtures/reflow.epub "$WORK/book.epub"

# 受け側のページ: 開けたか／何のトーストが出たかを1回だけ報告させる
python3 - "$WORK" <<'PY'
import io, sys
work = sys.argv[1]
html = io.open('yomikake.html', encoding='utf-8').read()
probe = '''<script>
(function(){
  var sent = false, n = 0;
  function send(m){ if (sent) return; sent = true; try { fetch('/report?m=' + encodeURIComponent(m)); } catch(e){} }
  var iv = setInterval(function(){
    n++;
    var toast = document.getElementById('toast');
    if (typeof state !== 'undefined' && state.epub) { clearInterval(iv); send('OPENED ' + (state.bookTitle || '')); }
    else if (toast && toast.classList.contains('show') && toast.textContent) { clearInterval(iv); send('TOAST ' + toast.textContent); }
    else if (n > 75) { clearInterval(iv); send('TIMEOUT'); }
  }, 200);
})();
</script>
'''
io.open(work + '/yomikake.html', 'w', encoding='utf-8').write(html.replace('</body>', probe + '</body>', 1))
PY

# 共有元のページ（実機と同じナビゲーション POST を起こす）
make_driver() {  # $1=出力 $2=ファイルを組む JS
  cat > "$WORK/$1" <<EOF
<!doctype html><html><head><meta charset="utf-8"></head><body>
<form id="f" method="POST" enctype="multipart/form-data" action="share-receive">
<input type="file" id="fi" name="epub"></form>
<script>
(async () => {
  try {
    await navigator.serviceWorker.register('sw.js');
    await navigator.serviceWorker.ready;
    const f = await (async () => { $2 })();
    const dt = new DataTransfer(); dt.items.add(f);
    document.getElementById('fi').files = dt.files;
    setTimeout(() => document.getElementById('f').submit(), 200);
  } catch (e) { fetch('/report?m=' + encodeURIComponent('DRIVER ' + e)); }
})();
</script></body></html>
EOF
}
make_driver drv_ok.html \
  "const b = await (await fetch('book.epub')).arrayBuffer();
   return new File([b], 'テスト用リフロー.epub', {type:'application/epub+zip'});"
make_driver drv_empty.html \
  "return new File([], 'からっぽ.epub', {type:'application/epub+zip'});"

cat > "$WORK/srv.py" <<'PY'
import http.server, socketserver, urllib.parse, sys
class H(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/report'):
            q = urllib.parse.urlparse(self.path).query
            print(urllib.parse.parse_qs(q).get('m', [''])[0], flush=True)
            self.send_response(204); self.end_headers(); return
        return super().do_GET()
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('127.0.0.1', int(sys.argv[1])), H) as s: s.serve_forever()
PY

PORT="$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')"
( cd "$WORK" && python3 srv.py "$PORT" > report.log 2>&1 ) &
SRV=$!
trap 'kill $SRV 2>/dev/null; rm -rf "$WORK"' EXIT
for _ in $(seq 1 50); do
  python3 -c "import socket,sys;s=socket.socket();sys.exit(0 if s.connect_ex(('127.0.0.1',$PORT))==0 else 1)" && break
  sleep 0.1
done

run_case() {  # $1=見出し $2=ドライバ $3=期待の正規表現
  # ⚠ report.log は truncate しない。サーバが開いたままのファイルを空にすると
  #   書き込み位置が戻らず、先頭に NUL が詰まって行頭一致が効かなくなる。
  #   代わりに開始時のバイト位置を覚えて、そこから後ろだけを読む。
  local off; off="$(stat -c %s "$WORK/report.log" 2>/dev/null || echo 0)"
  rm -rf "$WORK/prof"
  "$CHROME_BIN" --headless=new --disable-gpu --no-sandbox \
    --user-data-dir="$WORK/prof" "http://127.0.0.1:$PORT/$2" >/dev/null 2>&1 &
  local cpid=$! i line=""
  for i in $(seq 1 400); do
    line="$(tail -c "+$((off + 1))" "$WORK/report.log" 2>/dev/null |
            grep -a -m1 -E '^(OPENED|TOAST|TIMEOUT|DRIVER)' || true)"
    [ -n "$line" ] && break
    sleep 0.1
  done
  kill $cpid 2>/dev/null; wait $cpid 2>/dev/null
  if [ -z "$line" ]; then echo "FAIL | $1 | 報告が来なかった（ブラウザが起動しない環境かも）"; return; fi
  if echo "$line" | grep -qE "$3"; then echo "PASS | $1"
  else echo "FAIL | $1 | 期待=$3 実際=$line"; fi
}

# 1) 正常系: 共有 → 本が開く（ここが実機で壊れている経路そのもの）
run_case '共有した ePub が開く' drv_ok.html '^OPENED テスト用リフロー'
# 2) 実体が空: 黙って失敗せず、理由コードと「何が届いていたか」を出す
#    （実機では POST は届くのにファイルパートだけ無い状態が起きている。
#      keys= と len= がその切り分けの材料なので、消えたらここで落とす）
run_case '空ファイルは理由コードを出す'   drv_empty.html '^TOAST .*nofile:empty'
run_case '届いた中身の要約を出す'         drv_empty.html '^TOAST .*keys=epub:f0.*len=[0-9]+.*ct=mp'

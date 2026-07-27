#!/usr/bin/env bash
#
# 明るさ・暖色フィルタが「実際に描画結果を変えているか」を画素で確かめる。
# CSS 変数が入っているだけでは分からない、重ね順やスタッキングコンテキストの
# 事故（本文の上に乗っていない／操作系 UI まで暗くしている）をここで拾う。
#
#   tests/pixel/screen-filter.sh <html>
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
HTML="${1:-yomikake.html}"
DIR=tests/pixel
LIB=tests/lib/pixel-test.sh
chmod +x "$LIB" 2>/dev/null || true

norm="$(WINDOW=900,700 "$LIB" "$HTML" $DIR/screen-filter.setup.js $DIR/screen-filter.probe.py \
        --allow-file-access-from-files)"
case "$norm" in SKIP*|FAIL*) echo "$norm"; exit 0;; esac

dim="$(HASH='#dim' WINDOW=900,700 "$LIB" "$HTML" $DIR/screen-filter.setup.js $DIR/screen-filter.probe.py \
       --allow-file-access-from-files)"
case "$dim" in SKIP*|FAIL*) echo "$dim"; exit 0;; esac

python3 - "$norm" "$dim" <<'PY'
import sys
def parse(s):
    p = s.strip().split('\n')[-1].split()
    return [float(x) for x in p[:3]], [float(x) for x in p[3:6]]

(nr, ng, nb), (ntr, ntg, ntb) = parse(sys.argv[1])
(dr, dg, db), (dtr, dtg, dtb) = parse(sys.argv[2])

def T(name, cond, detail=''):
    print(('PASS' if cond else 'FAIL') + ' | ' + name + (' | ' + detail if detail else ''))

T('通常時は白紙テーマが明るいまま', nr > 225,
  'reading=%.0f,%.0f,%.0f' % (nr, ng, nb))
T('最暗+暖色で本文が実際に暗くなる', dr < nr - 50,
  '%.0f → %.0f' % (nr, dr))
T('暖色で青が赤より強く落ちる', (nb - db) > (nr - dr) + 20,
  'ΔR=%.0f ΔG=%.0f ΔB=%.0f' % (nr - dr, ng - dg, nb - db))
T('真っ黒にはしない（本文が読める明るさを残す）', dr > 60, 'R=%.0f' % dr)
T('ツールバーは暗くしない（操作系UIは対象外）', abs(ntr - dtr) < 12,
  'toolbar %.0f → %.0f' % (ntr, dtr))
PY

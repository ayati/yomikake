#!/usr/bin/env bash
#
# yomikake テスト一式を両ファイルに対して流す。
#
#   tests/lib/run.sh            全部
#   tests/lib/run.sh theme      名前に "theme" を含むケースだけ
#
# 環境変数: CHROME（Chrome の実行ファイル）
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

FILTER="${1:-}"
HTML=(yomikake.html yomikake_ios.html)
DOMTEST=tests/lib/dom-test.sh
chmod +x "$DOMTEST" 2>/dev/null || true

# E2E は実 ePub を開くため rAF シムと長めの virtual time が要る
declare -A CASE_ENV=(
  [e2e-reflow]="RAF_SHIM=1 VTB=30000"
  [e2e-fxl]="RAF_SHIM=1 VTB=30000"
  [typography]="RAF_SHIM=1 VTB=30000"
  [book-prefs]="RAF_SHIM=1 VTB=40000"
)
declare -A CASE_FLAGS=(
  [e2e-reflow]="--allow-file-access-from-files"
  [e2e-fxl]="--allow-file-access-from-files"
  [typography]="--allow-file-access-from-files"
  [book-prefs]="--allow-file-access-from-files"
)

pass=0; fail=0; failed_lines=()

echo "══ 構文チェック ══"
if node tests/lib/syntax-check.js "${HTML[@]}"; then pass=$((pass+1)); else fail=$((fail+1)); failed_lines+=("構文チェック"); fi

echo
echo "══ fixture 生成 ══"
python3 tests/lib/make-fixtures.py | sed 's/^/  /'

echo
echo "══ DOM テスト ══"
for c in tests/cases/*.js; do
  name="$(basename "$c" .js)"
  [ -n "$FILTER" ] && [[ "$name" != *"$FILTER"* ]] && continue
  for h in "${HTML[@]}"; do
    out="$(env ${CASE_ENV[$name]:-} "$DOMTEST" "$h" "$c" ${CASE_FLAGS[$name]:-})"
    p=$(echo "$out" | grep -c '^PASS' || true)
    f=$(echo "$out" | grep -c '^FAIL' || true)
    s=$(echo "$out" | grep -c '^SKIP' || true)
    if [ "$s" -gt 0 ]; then
      printf "  %-18s %-16s SKIP\n" "$h" "$name"
      echo "$out" | sed 's/^/      /'
      continue
    fi
    printf "  %-18s %-16s PASS=%-3s FAIL=%s\n" "$h" "$name" "$p" "$f"
    pass=$((pass+p)); fail=$((fail+f))
    if [ "$f" -gt 0 ]; then
      echo "$out" | grep '^FAIL' | sed 's/^/      /'
      failed_lines+=("$h / $name")
    fi
  done
done

echo
echo "══ 画素テスト ══"
for px in tests/pixel/*.sh; do
  [ -f "$px" ] || continue
  name="$(basename "$px" .sh)"
  [ -n "$FILTER" ] && [[ "$name" != *"$FILTER"* ]] && continue
  chmod +x "$px" 2>/dev/null || true
  for h in "${HTML[@]}"; do
    out="$("$px" "$h")"
    p=$(echo "$out" | grep -c '^PASS' || true)
    f=$(echo "$out" | grep -c '^FAIL' || true)
    s=$(echo "$out" | grep -c '^SKIP' || true)
    if [ "$s" -gt 0 ]; then printf "  %-18s %-16s SKIP\n" "$h" "$name"; continue; fi
    printf "  %-18s %-16s PASS=%-3s FAIL=%s\n" "$h" "$name" "$p" "$f"
    pass=$((pass+p)); fail=$((fail+f))
    if [ "$f" -gt 0 ]; then
      echo "$out" | grep '^FAIL' | sed 's/^/      /'
      failed_lines+=("$h / $name (画素)")
    fi
  done
done

echo
echo "══ 結果 ══"
echo "  PASS=$pass  FAIL=$fail"
if [ "$fail" -gt 0 ]; then
  printf '  落ちたケース: %s\n' "${failed_lines[@]}"
  exit 1
fi
echo "  ✅ すべて通りました"

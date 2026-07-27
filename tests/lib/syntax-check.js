// 各 HTML の inline <script> を抜き出して構文チェックする。
// 使い方: node tests/lib/syntax-check.js yomikake.html yomikake_ios.html
const fs = require('fs');
const vm = require('vm');

let bad = 0;
for (const f of process.argv.slice(2)) {
  const html = fs.readFileSync(f, 'utf8');
  const re = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m, i = 0;
  while ((m = re.exec(html))) {
    i++;
    const code = m[1];
    const line = html.slice(0, m.index).split('\n').length;
    try {
      new vm.Script(code, { filename: `${f}#script${i}@L${line}` });
      console.log(`  OK   ${f} script#${i} (L${line}, ${code.length} chars)`);
    } catch (e) {
      bad++;
      console.log(`  FAIL ${f} script#${i} (L${line}): ${e.message}`);
    }
  }
  if (i === 0) { bad++; console.log(`  FAIL ${f}: inline <script> が見つかりません`); }
}
process.exit(bad ? 1 : 0);

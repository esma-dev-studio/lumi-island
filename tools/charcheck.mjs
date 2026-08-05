// 同形異文字・非日本語CJK混入チェック(過去プロジェクトで実害があったため機械検査する)
// 使い方: node tools/charcheck.mjs [対象ディレクトリ...]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const TARGET_EXT = new Set(['.ts', '.js', '.mjs', '.md', '.html', '.css', '.json']);
// このファイル自体はパターン定義に該当文字を含むため検査対象から除外する
const SUSPICIOUS = [
  { name: 'キリル文字', re: new RegExp('[Ѐ-ӿ]', 'g') },
  // π(3c0)とθ(3b8)は数学記号として日本語コメントで意図的に使うため除外する
  // (ラテン文字と見分けがつく字形なので、同形異字の混入検査としては対象外でよい)
  { name: 'ギリシャ文字', re: new RegExp('[Ͱ-ηι-ορ-Ͽ]', 'g') },
  { name: 'ハングル', re: new RegExp('[가-힯ᄀ-ᇿ㄰-㆏]', 'g') },
  // 日本語文書に現れないはずの簡体字(日本語と同形の字は含めない)
  {
    name: '簡体字',
    re: new RegExp(
      '[头发见说这时间门车图线现样动气电记读还过进远运选边达迟红绿蓝颜]',
      'g'
    ),
  },
];
const SELF = 'charcheck.mjs';

const roots = process.argv.slice(2);
const targets = roots.length ? roots : ['src', 'tools', 'tests', '.'];
const files = [];
function walk(dir, depth) {
  if (depth > 4) return;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'dist') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, depth + 1);
    else if (TARGET_EXT.has(extname(name))) files.push(p);
  }
}
for (const t of targets) {
  try {
    const st = statSync(t);
    if (st.isDirectory()) walk(t, 0);
    else files.push(t);
  } catch {
    /* skip */
  }
}

let bad = 0;
for (const f of [...new Set(files)].filter((f) => !f.endsWith(SELF))) {
  const text = readFileSync(f, 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const { name, re } of SUSPICIOUS) {
      const m = line.match(re);
      if (m) {
        bad++;
        console.log(`NG ${f}:${i + 1} [${name}] ${[...new Set(m)].join(' ')} | ${line.trim().slice(0, 80)}`);
      }
    }
  });
}
console.log(bad === 0 ? 'charcheck OK (0件)' : `charcheck NG: ${bad}件`);
process.exit(bad === 0 ? 0 : 1);

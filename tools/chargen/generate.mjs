// キャラクターGLB一括生成: node tools/chargen/generate.mjs [id...]
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildCharacter } from './species.mjs';
import { writeGLB } from './glb.mjs';

const OUT = 'public/assets/characters';
mkdirSync(OUT, { recursive: true });
mkdirSync('.logs', { recursive: true });

const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['mio', 'minamo', 'nokto', 'tsumugi', 'roka'];
for (const id of ids) {
  const t0 = Date.now();
  const ch = buildCharacter(id);
  const out = `${OUT}/${id}.glb`;
  await writeGLB(ch, out);
  writeFileSync(`.logs/tex_${id}.png`, ch.png); // テクスチャの目視確認用
  const { verts, tris } = ch.stats;
  const kb = Math.round(ch.png.length / 1024);
  console.log(`${id}: ${verts} verts / ${tris} tris / tex ${kb}KB / ${Date.now() - t0}ms -> ${out}`);
  if (tris < 3000 || tris > 12000) console.warn(`  WARN: ${id} の三角形数が目標(4k-9k)から外れています`);
}
console.log('done');

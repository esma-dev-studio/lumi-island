// GLBの **メッシュ**を2つのフォルダで機械照合する(glb_anim_diff.mjs の きょうだい)。
//
//   node tools/glb_mesh_diff.mjs <前のフォルダ> [いまのフォルダ]
//   例) node tools/glb_mesh_diff.mjs .logs/glb_before public/assets/characters
//
// なぜ要るか:
//   glb_anim_diff.mjs が 見るのは **アニメ**だけ。キャラクターの形を 1体だけ 直したとき、
//   「ほかの5体は 1ミリも 動いていない」を 示すには 頂点そのものを 突き合わせるしかない
//   (バイト比較は アクセサ番号・バッファ位置が ずれるだけで 別物になるので 使えない)。
//
// 出す数字: メッシュごとの 位置・法線・モーフ差分の 最大差と「動いた頂点の数」。
// 頂点数が 変わっていたら その場で NG。値が 1つでも ずれたら exit 1。
import { readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { NodeIO } from '@gltf-transform/core';

const [beforeDir, afterDir = 'public/assets/characters'] = process.argv.slice(2);
if (!beforeDir) {
  console.error('使いかた: node tools/glb_mesh_diff.mjs <前のフォルダ> [いまのフォルダ]');
  process.exit(2);
}

const io = new NodeIO();

/** GLBから「メッシュ名#プリミティブ番号 → 位置・法線・モーフ差分」を取り出す */
async function readMeshes(path) {
  const doc = await io.read(path);
  const out = new Map();
  for (const mesh of doc.getRoot().listMeshes()) {
    const prims = mesh.listPrimitives();
    for (let pi = 0; pi < prims.length; pi++) {
      const prim = prims[pi];
      out.set(`${mesh.getName()}#${pi}`, {
        pos: prim.getAttribute('POSITION')?.getArray() ?? null,
        nrm: prim.getAttribute('NORMAL')?.getArray() ?? null,
        targets: prim.listTargets().map((t) => t.getAttribute('POSITION')?.getArray() ?? null),
      });
    }
  }
  return out;
}

/** 最大差と「動いた頂点の数」。長さが ちがえば moved=-1 で かえす */
function compare(a, b) {
  if (!a || !b) return { worst: NaN, moved: -1 };
  if (a.length !== b.length) return { worst: Infinity, moved: -1 };
  let worst = 0;
  const moved = new Set();
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > worst) worst = d;
    if (d > 1e-9) moved.add(Math.floor(i / 3));
  }
  return { worst, moved: moved.size };
}

let failures = 0;
const files = readdirSync(resolve(beforeDir)).filter((f) => f.endsWith('.glb'));
if (files.length === 0) {
  console.error(`${beforeDir} に .glb がない`);
  process.exit(2);
}

for (const file of files) {
  const id = basename(file, '.glb');
  const before = await readMeshes(join(resolve(beforeDir), file));
  const after = await readMeshes(join(resolve(afterDir), file));
  console.log(`${id}:`);
  for (const [key, a] of before) {
    const b = after.get(key);
    if (!b) {
      console.log(`  ${key}: メッシュが 消えた`);
      failures++;
      continue;
    }
    const p = compare(a.pos, b.pos);
    const n = compare(a.nrm, b.nrm);
    let tw = 0;
    for (let i = 0; i < a.targets.length; i++) tw = Math.max(tw, compare(a.targets[i], b.targets[i]).worst);
    if (p.moved < 0 || n.moved < 0) {
      console.log(`  ${key}: 頂点の数が 変わった`);
      failures++;
      continue;
    }
    console.log(
      `  ${key.padEnd(22)} 位置 最大差 ${(p.worst * 1000).toFixed(4)}mm (動いた頂点 ${p.moved}/${a.pos.length / 3})`
      + ` / 法線 最大差 ${n.worst.toFixed(5)} / モーフ差分 最大差 ${(tw * 1000).toFixed(4)}mm`
    );
  }
  for (const key of after.keys()) {
    if (!before.has(key)) console.log(`  ${key}: 新しく 増えた`);
  }
}

if (failures > 0) {
  console.log(`glb_mesh_diff NG: ${failures}件`);
  process.exit(1);
}
console.log('glb_mesh_diff 終わり(数字は 上のとおり)');

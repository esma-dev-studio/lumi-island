// GLBのアニメーションを2つのフォルダで機械照合する。
//
//   node tools/glb_anim_diff.mjs <前のフォルダ> [いまのフォルダ]
//   例) node tools/glb_anim_diff.mjs .logs/glb_before public/assets/characters
//
// なぜ要るか:
//   キャラクターのアニメを1本足すと、GLBの中の並び(アクセサ番号・バッファ位置)が
//   ぜんぶ ずれるので、ファイルのバイト比較では「変わっていない」ことを示せない。
//   ここでは **クリップ名 → ジョイント → path(rotation/translation)** の単位まで
//   ほどいてから、時刻列と値列を数値で突き合わせる。
//   これが「既存アニメは1ミリも変わっていない」の証明になる(Showcaseの目視より強い)。
//
// 出力: 既存クリップの一致/不一致、新しく増えたクリップ、消えたクリップ。
// 1つでも値がずれていたら exit 1。
import { readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { NodeIO } from '@gltf-transform/core';

/** 浮動小数の許容差。同じ式・同じサンプリングなので本来は完全一致する */
const EPS = 1e-6;

const [beforeDir, afterDir = 'public/assets/characters'] = process.argv.slice(2);
if (!beforeDir) {
  console.error('使い方: node tools/glb_anim_diff.mjs <前のフォルダ> [いまのフォルダ]');
  process.exit(2);
}

const io = new NodeIO();

/**
 * GLBから「クリップ名 → チャンネルの一覧」を取り出す。
 * チャンネルの並び順は生成のたびに変わりうるので、キー(ジョイント名+path)で引けるようにする。
 */
async function readAnims(path) {
  const doc = await io.read(path);
  const out = new Map();
  for (const anim of doc.getRoot().listAnimations()) {
    const chans = new Map();
    for (const ch of anim.listChannels()) {
      const node = ch.getTargetNode();
      const sampler = ch.getSampler();
      if (!node || !sampler) continue;
      const input = sampler.getInput();
      const output = sampler.getOutput();
      const key = `${node.getName()}::${ch.getTargetPath()}`;
      chans.set(key, {
        times: input ? Array.from(input.getArray() ?? []) : [],
        values: output ? Array.from(output.getArray() ?? []) : [],
        interpolation: sampler.getInterpolation(),
      });
    }
    out.set(anim.getName(), chans);
  }
  return out;
}

function diffArrays(a, b) {
  if (a.length !== b.length) return `長さ ${a.length} → ${b.length}`;
  let worst = 0;
  let at = -1;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > worst) {
      worst = d;
      at = i;
    }
  }
  return worst > EPS ? `最大差 ${worst.toExponential(3)} (${at}番目: ${a[at]} → ${b[at]})` : null;
}

let failures = 0;
let checkedClips = 0;
let checkedChannels = 0;
const added = [];

const files = readdirSync(resolve(beforeDir)).filter((f) => f.endsWith('.glb'));
if (files.length === 0) {
  console.error(`${beforeDir} に .glb がない`);
  process.exit(2);
}

for (const file of files) {
  const id = basename(file, '.glb');
  const before = await readAnims(join(resolve(beforeDir), file));
  const after = await readAnims(join(resolve(afterDir), file));
  for (const [name, chansB] of before) {
    const chansA = after.get(name);
    if (!chansA) {
      console.log(`NG ${id}: クリップ「${name}」が消えた`);
      failures++;
      continue;
    }
    checkedClips++;
    if (chansB.size !== chansA.size) {
      console.log(`NG ${id}/${name}: チャンネル数 ${chansB.size} → ${chansA.size}`);
      failures++;
    }
    for (const [key, b] of chansB) {
      const a = chansA.get(key);
      if (!a) {
        console.log(`NG ${id}/${name}: チャンネル ${key} が消えた`);
        failures++;
        continue;
      }
      checkedChannels++;
      if (a.interpolation !== b.interpolation) {
        console.log(`NG ${id}/${name}/${key}: 補間 ${b.interpolation} → ${a.interpolation}`);
        failures++;
      }
      const dt = diffArrays(b.times, a.times);
      if (dt) {
        console.log(`NG ${id}/${name}/${key} times: ${dt}`);
        failures++;
      }
      const dv = diffArrays(b.values, a.values);
      if (dv) {
        console.log(`NG ${id}/${name}/${key} values: ${dv}`);
        failures++;
      }
    }
  }
  for (const name of after.keys()) {
    if (!before.has(name)) added.push(`${id}/${name}`);
  }
}

console.log(`照合: ${files.length}体 / 既存クリップ ${checkedClips}本 / チャンネル ${checkedChannels}本`);
if (added.length > 0) console.log(`新しく増えたクリップ: ${added.join(', ')}`);
if (failures === 0) {
  console.log('glb_anim_diff OK (既存アニメは完全に一致)');
} else {
  console.log(`glb_anim_diff NG: ${failures}件`);
  process.exit(1);
}

// @vitest-environment jsdom
// v8で足したメッシュの法線の向きを機械検査する。
//
// 教訓(ゲーム開発の教訓.md 1・4): appendBlobだけで作った形はComputeNormalsが内向きになるので
// toMeshに'flip'が要る。部品が散っている形では重心による'auto'判定は当てにならず、
// 内向きのまま出荷すると「昼なのに真っ黒」になる(実際にv8のかりくさで起きた)。
// ここでは「いちばん上の頂点の法線が上を向いているか」で外向きを判定する。
import { describe, it, expect } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { makeTwigNode, makeCutGrassNode, makeClayNode, makeGlassFloat } from '../../src/entities/flora';
import { makeSeabird } from '../../src/entities/deco';
import { makeFurnitureMesh } from '../../src/entities/furniture';
import type { ItemId } from '../../src/data/items';

const engine = new NullEngine();
const scene = new Scene(engine);

/**
 * 「部品ごと」に外向きかを見る。
 * メッシュ全体の重心で判定すると、離れた部品を1つにまとめた形では当てにならない(toMeshの'auto'の弱点)。
 * そこで三角形のつながり(連結成分)で部品に分け、部品の重心から見て法線が外を向いているかを数える。
 * 返り値は「外向きだった部品の割合」と、部品ごとの内訳。
 */
function outwardParts(mesh: Mesh): { bad: { verts: number; score: number; kind: string }[]; parts: number } {
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind)!;
  const nrm = mesh.getVerticesData(VertexBuffer.NormalKind)!;
  const idx = mesh.getIndices()!;
  // ComputeNormalsそのままの向き(=toMeshの'keep')。'flip'ならこれの反対になっている
  const base: number[] = [];
  VertexData.ComputeNormals([...pos], [...idx], base);
  const n = pos.length / 3;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let t = 0; t < idx.length; t += 3) {
    union(idx[t], idx[t + 1]);
    union(idx[t + 1], idx[t + 2]);
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(i);
    else groups.set(r, [i]);
  }
  const bad: { verts: number; score: number; kind: string }[] = [];
  let parts = 0;
  for (const verts of groups.values()) {
    if (verts.length < 4) continue; // 面になっていない断片は見ない
    parts++;
    let cx = 0, cy = 0, cz = 0;
    for (const v of verts) {
      cx += pos[v * 3]; cy += pos[v * 3 + 1]; cz += pos[v * 3 + 2];
    }
    cx /= verts.length; cy /= verts.length; cz /= verts.length;
    let score = 0;
    let flipped = 0;
    for (const v of verts) {
      score += (pos[v * 3] - cx) * nrm[v * 3]
        + (pos[v * 3 + 1] - cy) * nrm[v * 3 + 1]
        + (pos[v * 3 + 2] - cz) * nrm[v * 3 + 2];
      const dot = nrm[v * 3] * base[v * 3] + nrm[v * 3 + 1] * base[v * 3 + 1] + nrm[v * 3 + 2] * base[v * 3 + 2];
      if (dot < 0) flipped++;
    }
    const s = Math.round(score * 10000) / 10000;
    if (Math.abs(score) < 1e-6) {
      // 平らな1枚板(fbox/appendBoxの1面)。自分の重心では外向きを決められないので、
      // 「appendBox系の巻き順はComputeNormalsのままが外向き」という実測(機械確認ずみ)で見る
      if (flipped > 0) bad.push({ verts: verts.length, score: s, kind: 'flat-flipped' });
    } else if (score <= 0) {
      bad.push({ verts: verts.length, score: s, kind: 'inward' });
    }
  }
  return { bad, parts };
}

describe('v8メッシュの法線が外向き(昼に真っ黒にならない)', () => {
  it('採取ノード4種', () => {
    const meshes: [string, Mesh][] = [
      ['twig', makeTwigNode(scene, 3)],
      ['cutgrass', makeCutGrassNode(scene, 5)],
      ['clay', makeClayNode(scene, 7)],
      ['glassfloat', makeGlassFloat(scene, 9)],
    ];
    for (const [name, m] of meshes) {
      const r = outwardParts(m);
      expect(r.bad, `${name} (部品${r.parts})`).toEqual([]);
    }
  });

  it('うみどり(からだ・翼)', () => {
    const b = makeSeabird(scene, 11);
    for (const [name, m] of [['body', b.root], ['wingL', b.wingL], ['wingR', b.wingR]] as [string, Mesh][]) {
      const r = outwardParts(m);
      expect(r.bad, `${name} (部品${r.parts})`).toEqual([]);
    }
  });

  it('新家具7種(光る部分もふくむ)', () => {
    const items: ItemId[] = ['f_broom', 'f_pot', 'f_jar', 'f_birdhouse', 'f_pinwheel', 'f_seamobile', 'f_gardentable'];
    for (const item of items) {
      const fm = makeFurnitureMesh(scene, item);
      const r = outwardParts(fm.root);
      expect(r.bad, `${item} (部品${r.parts})`).toEqual([]);
      if (fm.glowPart) {
        const g = outwardParts(fm.glowPart);
        expect(g.bad, `${item} 光る部分`).toEqual([]);
      }
      expect(fm.colliderR, `${item} コライダー`).toBeGreaterThan(0);
    }
  });

  it('かざぐるまは羽根の子メッシュを持つ(回転させる対象)', () => {
    const fm = makeFurnitureMesh(scene, 'f_pinwheel');
    const blades = fm.root.getChildMeshes().find((m) => m.name === 'f_pinwheel_blades');
    expect(blades).toBeDefined();
    expect(blades!.rotation.z).toBe(0);
  });
});

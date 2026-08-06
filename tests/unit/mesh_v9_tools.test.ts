// @vitest-environment jsdom
// v9-P1(虫あみ・シャベル・カマ)で足したメッシュの法線の向きを機械検査する。
//
// 教訓(ゲーム開発の教訓.md 1・4): appendBlobだけで作った形はComputeNormalsが内向きになるので
// toMeshに'flip'が要る。部品が散っている形では重心による'auto'判定は当てにならず、
// 内向きのまま出荷すると「昼なのに真っ黒」になる(v8のかりくさで実際に起きた)。
// 判定のしかたは tests/unit/mesh_v8.test.ts と同じ(三角形の連結成分ごとに外向きを数える)。
import { describe, it, expect } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { makeTallGrassNode, makeDigMound } from '../../src/entities/deco';
import { makeBugMesh, makeCagedBugMesh } from '../../src/entities/bugs';
import { makeFurnitureMesh } from '../../src/entities/furniture';
import { BUG_IDS } from '../../src/systems/BugSystem';
import type { ItemId } from '../../src/data/items';

const engine = new NullEngine();
const scene = new Scene(engine);

/** 「部品ごと」に外向きかを見る(mesh_v8.test.ts と同じ判定) */
function outwardParts(mesh: Mesh): { bad: { verts: number; score: number; kind: string }[]; parts: number } {
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind)!;
  const nrm = mesh.getVerticesData(VertexBuffer.NormalKind)!;
  const idx = mesh.getIndices()!;
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
    if (verts.length < 4) continue;
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
      if (flipped > 0) bad.push({ verts: verts.length, score: s, kind: 'flat-flipped' });
    } else if (score <= 0) {
      bad.push({ verts: verts.length, score: s, kind: 'inward' });
    }
  }
  return { bad, parts };
}

/**
 * 「巻き順」も外向きかを見る(v9で見つかった見た目のバグの回帰テスト)。
 *
 * 法線が外を向いていても、三角形の巻き順が内向きだと backFaceCulling が
 * 外がわの面を消してしまい、実際に描かれるのは「向こう側の内面」になる。
 * まるい形では気づけないが、平たい形(ほりあと・チョウの羽)では
 * 光の当たらない下面が見えて まっ黒になる。実機の接写で発見した。
 * ここでは「巻き順から求めた面の向き」と「頂点法線」が同じ向きかを数える。
 */
function windingAgreesWithNormals(mesh: Mesh): number {
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind)!;
  const nrm = mesh.getVerticesData(VertexBuffer.NormalKind)!;
  const idx = mesh.getIndices()!;
  // 「巻き順から決まる向き」の基準は Babylon 自身に出させる(左手系・表裏の規約を自前で書かない)。
  // 正しく描けているメッシュでは、持っている法線が この向きと同じになる。
  // toMeshの'flip'だけを掛けた形は ここが逆向きになり、外がわの面がカリングで消えてしまう。
  const fromWinding: number[] = [];
  VertexData.ComputeNormals([...pos], [...idx], fromWinding);
  let ok = 0, total = 0;
  for (let i = 0; i < nrm.length; i += 3) {
    const d = nrm[i] * fromWinding[i] + nrm[i + 1] * fromWinding[i + 1] + nrm[i + 2] * fromWinding[i + 2];
    if (Math.abs(d) < 1e-9) continue;
    total++;
    if (d > 0) ok++;
  }
  return total === 0 ? 1 : ok / total;
}

describe('v9メッシュの巻き順が法線と合っている(平たい面が真っ黒にならない)', () => {
  it('虫・ミニ虫・ほりあと・背の高い草・新家具', () => {
    const meshes: [string, Mesh][] = [
      ['digmound', makeDigMound(scene, 7)],
      ['tallgrass', makeTallGrassNode(scene, 3)],
    ];
    for (const id of BUG_IDS) {
      const b = makeBugMesh(scene, id, 13);
      meshes.push([`bug:${id}`, b.root]);
      if (b.wingL) meshes.push([`bug:${id}:wingL`, b.wingL]);
      if (b.glowPart) meshes.push([`bug:${id}:glow`, b.glowPart]);
      meshes.push([`caged:${id}`, makeCagedBugMesh(scene, id, 5)]);
    }
    for (const item of ['f_bugcage', 'f_ancient_pot', 'f_strawmat', 'f_scarecrow',
      'f_finetable', 'f_fishtrophy', 'f_starmap'] as ItemId[]) {
      const fm = makeFurnitureMesh(scene, item);
      meshes.push([item, fm.root]);
      for (const ch of fm.root.getChildMeshes()) meshes.push([`${item}:${ch.name}`, ch as Mesh]);
    }
    for (const [name, m] of meshes) {
      const rate = windingAgreesWithNormals(m);
      expect(rate, `${name} の巻き順と法線が合っている割合`).toBeGreaterThan(0.9);
    }
  });
});

describe('v9メッシュの法線が外向き(昼に真っ黒にならない)', () => {
  it('虫6種(からだ・羽・光る おしり)', () => {
    for (const id of BUG_IDS) {
      const b = makeBugMesh(scene, id, 13);
      const r = outwardParts(b.root);
      expect(r.bad, `${id} からだ (部品${r.parts})`).toEqual([]);
      for (const [name, w] of [['wingL', b.wingL], ['wingR', b.wingR]] as [string, Mesh | undefined][]) {
        if (!w) continue;
        const rw = outwardParts(w);
        expect(rw.bad, `${id} ${name}`).toEqual([]);
      }
      if (b.glowPart) expect(outwardParts(b.glowPart).bad, `${id} 光る部分`).toEqual([]);
    }
  });

  it('むしかごの中に入れる ミニ虫6種', () => {
    for (const id of BUG_IDS) {
      const m = makeCagedBugMesh(scene, id, 5);
      const r = outwardParts(m);
      expect(r.bad, `${id} (部品${r.parts})`).toEqual([]);
    }
  });

  it('背の高い草・ほりあと', () => {
    for (const [name, m] of [
      ['tallgrass', makeTallGrassNode(scene, 3)],
      ['digmound', makeDigMound(scene, 7)],
    ] as [string, Mesh][]) {
      const r = outwardParts(m);
      expect(r.bad, `${name} (部品${r.parts})`).toEqual([]);
    }
  });

  it('新家具4種+おくりもののお礼3種(子メッシュもふくむ)', () => {
    const items: ItemId[] = [
      'f_bugcage', 'f_ancient_pot', 'f_strawmat', 'f_scarecrow',
      // v9 おくりものの お礼レシピ(データは別担当・メッシュはここ)
      'f_finetable', 'f_fishtrophy', 'f_starmap',
    ];
    for (const item of items) {
      const fm = makeFurnitureMesh(scene, item);
      const r = outwardParts(fm.root);
      expect(r.bad, `${item} (部品${r.parts})`).toEqual([]);
      for (const child of fm.root.getChildMeshes()) {
        const rc = outwardParts(child as Mesh);
        expect(rc.bad, `${item} の ${child.name}`).toEqual([]);
      }
    }
  });
});

describe('v9家具の作り', () => {
  it('むしかごには 入れた虫(content)が入っている(枠なので外から見える)', () => {
    // v10: 中身は「最後に つかまえた虫」ではなく、プレイヤーが えらんで入れた1匹
    const fm = makeFurnitureMesh(scene, 'f_bugcage', 'b_kabuto');
    const inner = fm.root.getChildMeshes().find((m) => m.name.startsWith('cagedBug_'));
    expect(inner, 'かごの中の虫').toBeDefined();
    expect(inner!.name).toBe('cagedBug_b_kabuto');
    // 中の虫は かごの中(高さ0〜0.5m・横0.2m以内)にある
    expect(inner!.position.y).toBeGreaterThan(0.05);
    expect(inner!.position.y).toBeLessThan(0.5);
    const fm2 = makeFurnitureMesh(scene, 'f_bugcage', 'b_hotaru');
    expect(fm2.root.getChildMeshes().find((m) => m.name.startsWith('cagedBug_'))!.name)
      .toBe('cagedBug_b_hotaru');
    // 何も入れていなければ 空のかご
    expect(makeFurnitureMesh(scene, 'f_bugcage').root.getChildMeshes()
      .some((m) => m.name.startsWith('cagedBug_'))).toBe(false);
  });

  it('わらのマットは踏んで通れる(コライダー0)。ほかはぶつかる', () => {
    expect(makeFurnitureMesh(scene, 'f_strawmat').colliderR).toBe(0);
    for (const item of ['f_bugcage', 'f_ancient_pot', 'f_scarecrow',
      'f_finetable', 'f_fishtrophy', 'f_starmap'] as ItemId[]) {
      expect(makeFurnitureMesh(scene, item).colliderR, item).toBeGreaterThan(0);
    }
  });

  it('おくりもののお礼3種は「既定の茶色い立方体」ではない(プレースホルダー禁止)', () => {
    // default: は fbox 1つ(24頂点・12面)だけ。ちゃんと作り込まれていれば必ずこれより多い
    for (const item of ['f_finetable', 'f_fishtrophy', 'f_starmap'] as ItemId[]) {
      const fm = makeFurnitureMesh(scene, item);
      expect(fm.root.name, item).toBe(item); // default は `f_${item}` になるので名前で見分けられる
      expect(fm.root.getTotalVertices(), item).toBeGreaterThan(200);
    }
    // さかなのトロフィーは魚を別メッシュで持つ(丸い部品と角の部品を混ぜない規約)
    const trophy = makeFurnitureMesh(scene, 'f_fishtrophy');
    expect(trophy.root.getChildMeshes().some((m) => m.name === 'f_fishtrophy_fish')).toBe(true);
  });

  it('かかしの顔は「点2つ」ではない(ボタン目1つ+ぬい目)', () => {
    // 教訓1: まるい面に左右対称の白い点を2つ置くと顔の記号になってしまう。
    // かかしは わざと顔を作る対象だが、点2つではなく「片目だけボタン」で非対称にする。
    const fm = makeFurnitureMesh(scene, 'f_scarecrow');
    const buttons = fm.root.getChildMeshes().filter((m) => m.name === 'f_scarecrow_button');
    expect(buttons.length).toBe(1);
  });
});

// マイホームの模様替え(かべがみ・ゆかいた)の見た目。
//
// 設計の要点:
//  - 部屋(buildHomeRoom)は頂点カラーの1メッシュなので、壁や床だけ色を差し替えることができない。
//    そこで「壁の面のすぐ内がわ」「床のすぐ上」に薄い板(パネル)を1枚ずつ重ね、
//    そのマテリアルだけを取りかえる。部屋そのものの形・当たり判定は一切変わらない。
//  - もようは絵ファイルではなくプログラム生成(DynamicTexture)。単色べた塗りにはせず、
//    いた目・タイルのめじ・おりめ・葉のもようを必ず入れる(教訓1)。
//  - マテリアルとテクスチャは種類ごとに1つだけ作って使い回す(切り替えのたびに作らない)。
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import type { DecorId } from '../data/items';

/**
 * もようの1タイルが実寸で何メートルぶんか(uScale/vScaleの計算に使う)。
 * 部屋は6×5m・カメラは5.6m先なので、1mを画面上の約80pxで見ることになる。
 * 板の目地・タイルのめじ・おりめは「実寸で2cm以上」ないと、ミップマップに溶けて
 * ただの単色に見える(実機のスクショで確認して太くした)。
 */
const TILE_M = 1.0;
const TEX = 512;

type Ctx = CanvasRenderingContext2D;

/** 0..1の決まった疑似乱数(見た目を毎回同じにする。乱数を保存しなくてよい) */
function rnd(i: number): number {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// ---- もようの描画(すべて上下左右がつながる=タイルできる形にする) ----

/** 実寸(m)をテクスチャのピクセルへ。もようの太さは必ずこれで指定する */
const M = (meters: number): number => meters * TEX;

function drawWallCream(c: Ctx): void {
  c.fillStyle = '#f0e4d0';
  c.fillRect(0, 0, TEX, TEX);
  // 布ばりの織り目(たて糸・よこ糸)。1本2cm・4cm間かくで、遠目でも「のっぺり」に見えない
  c.strokeStyle = 'rgba(206,186,152,0.55)';
  c.lineWidth = M(0.006);
  for (let i = 0; i < 25; i++) {
    const p = (i + 0.5) * (TEX / 25);
    c.beginPath();
    c.moveTo(p, 0);
    c.lineTo(p, TEX);
    c.stroke();
    c.beginPath();
    c.moveTo(0, p);
    c.lineTo(TEX, p);
    c.stroke();
  }
  // しっくいのざらり感
  for (let i = 0; i < 1800; i++) {
    c.fillStyle = rnd(i * 3 + 3) > 0.5 ? 'rgba(255,250,238,0.6)' : 'rgba(188,168,136,0.34)';
    c.fillRect(rnd(i * 3 + 1) * TEX, rnd(i * 3 + 2) * TEX, M(0.008), M(0.008));
  }
  // かべ紙の継ぎ目(1mごとのたての細い線)。「紙を貼ってある」ことを見せる
  c.strokeStyle = 'rgba(190,166,128,0.7)';
  c.lineWidth = M(0.008);
  c.beginPath();
  c.moveTo(M(0.004), 0);
  c.lineTo(M(0.004), TEX);
  c.stroke();
}

function drawWallSky(c: Ctx): void {
  c.fillStyle = '#d3e5f2';
  c.fillRect(0, 0, TEX, TEX);
  // たてじま(明るい太い帯+濃い細線の2本組)。1mに4組=25cmピッチ
  const pitch = TEX / 4;
  for (let i = 0; i < 4; i++) {
    const x = i * pitch;
    c.fillStyle = '#eef6fb';
    c.fillRect(x, 0, M(0.115), TEX);
    c.fillStyle = '#a9caE0'.toLowerCase();
    c.fillRect(x + M(0.155), 0, M(0.022), TEX);
    c.fillStyle = '#bcd8ea';
    c.fillRect(x + M(0.2), 0, M(0.014), TEX);
  }
  // 紙の目(たての細かいむら)
  for (let i = 0; i < 1200; i++) {
    c.fillStyle = rnd(i * 5 + 11) > 0.5 ? 'rgba(255,255,255,0.4)' : 'rgba(150,180,200,0.18)';
    c.fillRect(rnd(i * 5 + 7) * TEX, rnd(i * 5 + 9) * TEX, M(0.004), M(0.012));
  }
}

function drawWallLeaf(c: Ctx): void {
  c.fillStyle = '#dfeccf';
  c.fillRect(0, 0, TEX, TEX);
  // 葉っぱのもよう(高さ約20cm)。はみ出したぶんは反対がわにも描いてタイルをつなげる
  const leaf = (lx: number, ly: number, rot: number, sc: number): void => {
    for (const [ox, oy] of [[0, 0], [TEX, 0], [-TEX, 0], [0, TEX], [0, -TEX]]) {
      c.save();
      c.translate(lx + ox, ly + oy);
      c.rotate(rot);
      c.scale(sc, sc);
      const h = M(0.1);
      const w = M(0.062);
      c.beginPath();
      c.moveTo(0, -h);
      c.bezierCurveTo(w, -h * 0.36, w, h * 0.45, 0, h);
      c.bezierCurveTo(-w, h * 0.45, -w, -h * 0.36, 0, -h);
      c.closePath();
      c.fillStyle = '#a9ce88';
      c.fill();
      c.strokeStyle = '#84b365';
      c.lineWidth = M(0.008);
      c.stroke();
      c.beginPath();
      c.moveTo(0, -h * 0.86);
      c.lineTo(0, h * 0.86);
      c.stroke();
      for (const s of [-0.4, 0, 0.4]) {
        c.beginPath();
        c.moveTo(0, h * s);
        c.lineTo(w * 0.6, h * (s + 0.22));
        c.moveTo(0, h * s);
        c.lineTo(-w * 0.6, h * (s + 0.22));
        c.stroke();
      }
      c.restore();
    }
  };
  for (let i = 0; i < 9; i++) {
    leaf(rnd(i * 7 + 11) * TEX, rnd(i * 7 + 13) * TEX, rnd(i * 7 + 17) * Math.PI * 2, 0.8 + rnd(i * 7 + 19) * 0.45);
  }
  // 地のかすかなむら
  for (let i = 0; i < 1200; i++) {
    c.fillStyle = rnd(i * 11 + 7) > 0.5 ? 'rgba(255,255,255,0.34)' : 'rgba(150,180,130,0.16)';
    c.fillRect(rnd(i * 11 + 3) * TEX, rnd(i * 11 + 5) * TEX, M(0.006), M(0.006));
  }
}

function drawFloorWood(c: Ctx): void {
  // たて3枚のいた(部屋の奥ゆき方向に走る)。1枚33cm。1枚ずつ色を変えて「1枚板」に見せない
  const tones = ['#c99a68', '#b78757', '#d3a677'];
  const n = 3;
  const pw = TEX / n;
  for (let i = 0; i < n; i++) {
    c.fillStyle = tones[i];
    c.fillRect(i * pw, 0, pw, TEX);
    // 木目(たての ゆるい波)
    for (let g = 0; g < 4; g++) {
      const gx = i * pw + (g + 0.7) * (pw / 5);
      c.strokeStyle = g % 2 ? 'rgba(126,88,52,0.42)' : 'rgba(232,203,166,0.45)';
      c.lineWidth = g % 2 ? M(0.012) : M(0.008);
      c.beginPath();
      c.moveTo(gx, 0);
      for (let y = 0; y <= TEX; y += 24) c.lineTo(gx + Math.sin((y / TEX) * Math.PI * 2 + g + i) * M(0.012), y);
      c.stroke();
    }
    // 木口(いたの継ぎ目)。板ごとに位置をずらす
    const seamY = ((i * 197) % TEX);
    c.fillStyle = 'rgba(104,72,42,0.7)';
    c.fillRect(i * pw, seamY, pw, M(0.018));
  }
  // いたのあいだの目地(2.4cm)。左右がつながるよう、はしは半分ずつ描く
  c.fillStyle = 'rgba(96,66,38,0.85)';
  const gw = M(0.024);
  for (let i = 0; i < n; i++) c.fillRect(i * pw - gw / 2, 0, gw, TEX);
  c.fillRect(TEX - gw / 2, 0, gw, TEX);
}

function drawFloorTile(c: Ctx): void {
  // 50cm角のタイル+3.5cmのめじ
  c.fillStyle = '#b7c3c8';
  c.fillRect(0, 0, TEX, TEX);
  const n = 2;
  const s = TEX / n;
  const gap = M(0.035);
  for (let ix = 0; ix < n; ix++) {
    for (let iz = 0; iz < n; iz++) {
      c.fillStyle = (ix + iz) % 2 ? '#e4eaec' : '#f0f3f4';
      c.fillRect(ix * s + gap / 2, iz * s + gap / 2, s - gap, s - gap);
      // タイルのふちの光沢(左上)と かげ(右下)
      c.fillStyle = 'rgba(255,255,255,0.85)';
      c.fillRect(ix * s + gap / 2, iz * s + gap / 2, s - gap, M(0.012));
      c.fillRect(ix * s + gap / 2, iz * s + gap / 2, M(0.012), s - gap);
      c.fillStyle = 'rgba(160,175,182,0.45)';
      c.fillRect(ix * s + gap / 2, iz * s + s - gap / 2 - M(0.012), s - gap, M(0.012));
      c.fillRect(ix * s + s - gap / 2 - M(0.012), iz * s + gap / 2, M(0.012), s - gap);
    }
  }
  // 石の粒(白一色にしない)
  for (let i = 0; i < 1400; i++) {
    c.fillStyle = rnd(i * 3 + 21) > 0.5 ? 'rgba(178,192,198,0.5)' : 'rgba(255,255,255,0.55)';
    c.fillRect(rnd(i * 3 + 23) * TEX, rnd(i * 3 + 29) * TEX, M(0.007), M(0.007));
  }
}

function drawFloorRug(c: Ctx): void {
  c.fillStyle = '#cf9a72';
  c.fillRect(0, 0, TEX, TEX);
  // おりめ: よこ糸(12.5cm)とたて糸を重ねる。糸の太さを実寸で決めて、遠目でも布に見せる
  const step = TEX / 8;
  for (let i = 0; i < 8; i++) {
    c.fillStyle = 'rgba(232,203,166,0.9)';
    c.fillRect(0, i * step, TEX, step * 0.34);
    c.fillStyle = 'rgba(166,110,74,0.55)';
    c.fillRect(0, i * step + step * 0.52, TEX, step * 0.22);
  }
  for (let i = 0; i < 8; i++) {
    c.fillStyle = 'rgba(214,166,124,0.55)';
    c.fillRect(i * step + step * 0.18, 0, step * 0.3, TEX);
  }
  // ふとい たて縞のアクセント(1mに2本)
  for (const fx of [step * 1.5, step * 5.5]) {
    c.fillStyle = 'rgba(240,214,178,0.55)';
    c.fillRect(fx, 0, step * 0.7, TEX);
  }
  // 毛羽立ち
  for (let i = 0; i < 1600; i++) {
    c.fillStyle = rnd(i * 3 + 31) > 0.5 ? 'rgba(248,228,204,0.4)' : 'rgba(140,92,60,0.3)';
    c.fillRect(rnd(i * 3 + 37) * TEX, rnd(i * 3 + 41) * TEX, M(0.008), M(0.008));
  }
}

/**
 * v12 くみあわせで見つかる かべがみ「ももいろのかべ」。
 * 木の実で そめた ももいろの地に、白い水玉と 紙の目。
 * 水玉は はみ出したぶんを 反対がわにも描いて タイルをつなげる(わかばのかべと同じ流儀)。
 */
function drawWallRose(c: Ctx): void {
  c.fillStyle = '#e8cdd2';
  c.fillRect(0, 0, TEX, TEX);
  // そめむら(たての はけ目)。単色べた塗りにしない
  for (let i = 0; i < 26; i++) {
    c.fillStyle = rnd(i * 7 + 3) > 0.5 ? 'rgba(240,214,218,0.5)' : 'rgba(206,158,166,0.28)';
    c.fillRect(rnd(i * 7 + 5) * TEX, 0, M(0.02 + rnd(i * 7 + 9) * 0.03), TEX);
  }
  // 白い水玉(直径6cm・25cm間かくの ちどり)
  const pitch = TEX / 4;
  for (let gy = 0; gy < 4; gy++) {
    for (let gx = 0; gx < 4; gx++) {
      const cx = gx * pitch + (gy % 2 ? pitch * 0.5 : 0) + pitch * 0.25;
      const cy = gy * pitch + pitch * 0.25;
      for (const [ox, oy] of [[0, 0], [TEX, 0], [-TEX, 0], [0, TEX], [0, -TEX]]) {
        c.beginPath();
        c.arc(cx + ox, cy + oy, M(0.03), 0, Math.PI * 2);
        c.fillStyle = 'rgba(252,246,244,0.92)';
        c.fill();
        c.strokeStyle = 'rgba(214,166,174,0.5)';
        c.lineWidth = M(0.005);
        c.stroke();
      }
    }
  }
  // 紙のざらり感
  for (let i = 0; i < 1400; i++) {
    c.fillStyle = rnd(i * 3 + 17) > 0.5 ? 'rgba(255,250,250,0.45)' : 'rgba(196,146,154,0.24)';
    c.fillRect(rnd(i * 3 + 19) * TEX, rnd(i * 3 + 23) * TEX, M(0.008), M(0.008));
  }
}

/**
 * v12 くみあわせで見つかる かべがみ「ほしぞらのかべ」。
 * こんいろの地(ほしぞらのちず f_starmap と同じ系統の色)に 星を ちりばめる。
 * 星は大きさを3段階にして ならびも ふぞろいにする
 * (等間かくだと「もよう」に見えて 空にならない)。
 */
function drawWallNight(c: Ctx): void {
  c.fillStyle = '#2f3e5c';
  c.fillRect(0, 0, TEX, TEX);
  // 夜空の むら(うすい雲)
  for (let i = 0; i < 22; i++) {
    c.beginPath();
    c.arc(rnd(i * 11 + 3) * TEX, rnd(i * 11 + 7) * TEX, M(0.12 + rnd(i * 11 + 13) * 0.18), 0, Math.PI * 2);
    c.fillStyle = rnd(i * 11 + 17) > 0.5 ? 'rgba(70,92,132,0.24)' : 'rgba(30,42,68,0.28)';
    c.fill();
  }
  // 星(60こ)。3段階の大きさ+大きいものだけ 十字の光すじ
  for (let i = 0; i < 60; i++) {
    const x = rnd(i * 5 + 1) * TEX;
    const y = rnd(i * 5 + 2) * TEX;
    const big = rnd(i * 5 + 3);
    const r = M(big > 0.9 ? 0.016 : big > 0.6 ? 0.009 : 0.005);
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fillStyle = i % 5 === 1 ? '#fff6d8' : '#e8eeff';
    c.fill();
    if (big > 0.9) {
      c.strokeStyle = 'rgba(232,238,255,0.6)';
      c.lineWidth = M(0.004);
      c.beginPath();
      c.moveTo(x - r * 2.6, y);
      c.lineTo(x + r * 2.6, y);
      c.moveTo(x, y - r * 2.6);
      c.lineTo(x, y + r * 2.6);
      c.stroke();
    }
  }
}

const PAINTERS: Record<DecorId, (c: Ctx) => void> = {
  wall_cream: drawWallCream,
  wall_sky: drawWallSky,
  wall_leaf: drawWallLeaf,
  wall_rose: drawWallRose,
  wall_night: drawWallNight,
  floor_wood: drawFloorWood,
  floor_tile: drawFloorTile,
  floor_rug: drawFloorRug,
};

// ---- マテリアル(種類ごとに1つ。シーンを作りなおしたら作りなおす) ----
let mats: Partial<Record<DecorId, StandardMaterial>> = {};
let matsScene: Scene | null = null;

/** 模様替え1種ぶんのマテリアル。同じIDなら毎回おなじものを返す */
export function getStyleMaterial(scene: Scene, id: DecorId): StandardMaterial {
  if (matsScene !== scene) {
    mats = {};
    matsScene = scene;
  }
  const cached = mats[id];
  if (cached) return cached;
  const tex = new DynamicTexture(`homeTex_${id}`, { width: TEX, height: TEX }, scene, true);
  PAINTERS[id](tex.getContext() as unknown as Ctx);
  tex.update(false);
  // くり返し(WRAP)を必ず指定する。DynamicTextureの既定はCLAMPで、UVが1をこえた先が
  // 「はしの1列を引きのばしたもの」になり、部屋のほとんどが単色に見えていた(実機で発覚)
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  // 床は浅い角度で見るので、異方性フィルタが無いと目地が奥でにじんで消える
  tex.anisotropicFilteringLevel = 8;
  const m = new StandardMaterial(`homeMat_${id}`, scene);
  m.diffuseTexture = tex;
  m.diffuseColor = Color3.White();
  m.specularColor = Color3.Black();
  // 壁ぎわの板は真裏から見ることはないが、巻き順の取りちがえで消えるより「両面」のほうが安全。
  // 平らな1枚板なので、両面にしても見た目の破綻はない
  m.backFaceCulling = false;
  mats[id] = m;
  return m;
}

/**
 * 平らな板を1枚つくる(部屋のローカル座標)。
 * o=左下の角、u=横方向のベクトル、v=たて方向のベクトル、normal=表の向き。
 * UVは実寸(m)から張るので、どの面でも もようの大きさがそろう。
 */
export function makeStylePanel(
  scene: Scene, name: string,
  o: [number, number, number], u: [number, number, number], v: [number, number, number],
  normal: [number, number, number]
): Mesh {
  const p = (a: number, b: number): number[] => [
    o[0] + u[0] * a + v[0] * b, o[1] + u[1] * a + v[1] * b, o[2] + u[2] * a + v[2] * b,
  ];
  const positions = [...p(0, 0), ...p(1, 0), ...p(1, 1), ...p(0, 1)];
  const uLen = Math.hypot(u[0], u[1], u[2]) / TILE_M;
  const vLen = Math.hypot(v[0], v[1], v[2]) / TILE_M;
  const uvs = [0, 0, uLen, 0, uLen, vLen, 0, vLen];
  const normals: number[] = [];
  for (let i = 0; i < 4; i++) normals.push(normal[0], normal[1], normal[2]);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = [0, 1, 2, 0, 2, 3];
  vd.normals = normals;
  vd.uvs = uvs;
  const mesh = new Mesh(name, scene);
  vd.applyToMesh(mesh);
  mesh.isPickable = false;
  return mesh;
}

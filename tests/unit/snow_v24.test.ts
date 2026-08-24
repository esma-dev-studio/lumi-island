// v24 ゆきの日(まれな天気)。
//
// 見ているのは
//   1) 決定論(日づけだけで決まる)・あめとの 排他・出る割合(10日に1回ぐらい)
//   2) **あめの日づけが v23 から 1日も 動いていない**(ゆきは くもりの帯から 分けた)
//   3) ゆきの白さは **見た目だけ**: 歩ける格子のダンプが 1バイトも 変わらない
//   4) ゆきを あつめる(3回で ゆきだるま)・その日 同じ ふきだまりは 1回だけ
//   5) 「きょうの島」カードに 予告が 1行 出る
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import {
  SNOW_COVER_HOURS, SNOW_NEED, SNOW_REACH, SNOW_SPOTS, SNAIL_SPOTS, SNAIL_REACH,
  WEATHER_RATE, WeatherSystem, addSnowScoop, coldLevelFor, rainLevelFor, snowCount,
  snowCoverFor, snowLevelFor, weatherOfDay, willRainbowOn, willSnowOn, type Weather,
} from '../../src/systems/WeatherSystem';
import {
  applySnowCover, makeSnowDrift, registerSnowSurface, snowDriftArrays,
} from '../../src/entities/effects';
import { buildGridDump } from './grid_dump_helper';
import { todayCard } from '../../src/systems/TodayCard';
import { newGameState } from '../../src/game/GameState';
import { ICONS } from '../../src/ui/icons';

/** v24 に手をつける前(v23)の あめの日づけ。ここが 動いたら 天気の帯を こわしている */
const RAINY_DAYS_V23: number[] = [];
for (let d = 1; d <= 200; d++) {
  // v23の しきい値: u<0.6 はれ / u<0.8 くもり / それ以外 あめ
  // (weatherSeed は 1バイトも 変えていないので、ここでは 天気の帯だけを 写して 突き合わせる)
  const u = (() => {
    let a = Math.imul(d + 1, 0x9e3779b1) >>> 0;
    a ^= a >>> 16;
    a = Math.imul(a, 0x21f0aaad) >>> 0;
    a ^= a >>> 15;
    a = Math.imul(a, 0x735a2d97) >>> 0;
    a ^= a >>> 15;
    return (a >>> 0) / 4294967296;
  })();
  if (d > 1 && u >= 0.8) RAINY_DAYS_V23.push(d);
}

describe('v24 ゆきの日(決まりかた)', () => {
  it('日づけだけで決まる(何度きいても 同じ)', () => {
    for (let d = 1; d <= 300; d++) expect(weatherOfDay(d)).toBe(weatherOfDay(d));
    const a = new WeatherSystem();
    const b = new WeatherSystem();
    for (let d = 1; d <= 300; d++) expect(a.weatherOf(d)).toBe(b.weatherOf(d));
  });

  it('あめの日は v23 から 1日も 動いていない(ゆきは くもりから 分けた)', () => {
    const now: number[] = [];
    for (let d = 2; d <= 200; d++) if (weatherOfDay(d) === 'rainy') now.push(d);
    expect(now).toEqual(RAINY_DAYS_V23);
    expect(now.length).toBeGreaterThan(20);
  });

  it('およそ10日に1回(1000日で 8〜12%)', () => {
    let n = 0;
    for (let d = 1; d <= 1000; d++) if (weatherOfDay(d) === 'snowy') n++;
    expect(n / 1000).toBeGreaterThan(0.08);
    expect(n / 1000).toBeLessThan(0.12);
    expect(WEATHER_RATE.snowy).toBe(0.1);
    expect(WEATHER_RATE.sunny + WEATHER_RATE.cloudy + WEATHER_RATE.snowy + WEATHER_RATE.rainy).toBeCloseTo(1, 6);
  });

  it('あめと ゆきは 同じ日には ぜったいに 出ない(排他)', () => {
    for (let d = 1; d <= 500; d++) {
      const w = weatherOfDay(d);
      for (let h = 0; h < 24; h += 0.5) {
        const rain = rainLevelFor(w, h);
        const snow = snowLevelFor(w, h);
        expect(rain > 0 && snow > 0, `day${d} ${h}時`).toBe(false);
      }
      if (w === 'snowy') {
        expect(willRainbowOn(d), 'ゆきの日に 虹は 出ない').toBe(false);
        expect(willSnowOn(d)).toBe(true);
      } else {
        expect(willSnowOn(d), `day${d}`).toBe(false);
      }
    }
  });

  it('1日じゅう ふる(よるの ゆきも 見られる)。朝には もう 積もっている', () => {
    expect(snowLevelFor('snowy', 0)).toBe(0);
    expect(snowLevelFor('snowy', 1)).toBe(1);
    expect(snowLevelFor('snowy', 12)).toBe(1);
    expect(snowLevelFor('snowy', 22)).toBe(1); // よるも ふっている(あめは15時で あがる)
    expect(rainLevelFor('rainy', 22)).toBe(0);
    expect(snowCoverFor('snowy', SNOW_COVER_HOURS)).toBe(1);
    expect(snowCoverFor('snowy', 6)).toBe(1); // 起きたときには まっ白
    expect(snowCoverFor('rainy', 6)).toBe(0);
    expect(snowCoverFor('sunny', 6)).toBe(0);
  });

  it('ゆきの日は 寒い色(くもりより ずっと つよく・1日じゅう)', () => {
    expect(coldLevelFor('snowy', 12)).toBeGreaterThan(coldLevelFor('cloudy', 12));
    expect(coldLevelFor('snowy', 12)).toBeGreaterThanOrEqual(0.72);
    // よるも 朝も 寒いまま(あめは 15時に あがって ふつうの空へ もどる)
    expect(coldLevelFor('snowy', 22)).toBeGreaterThanOrEqual(0.72);
    expect(coldLevelFor('rainy', 22)).toBe(0);
    expect(coldLevelFor('sunny', 12)).toBe(0);
  });

  it('雨の日の 遊び(カタツムリ)は ゆきの日には 出ない', () => {
    const w = new WeatherSystem();
    w.setForced('snowy');
    const now = w.update(0.1, 5, 12);
    expect(now.snails).toEqual([]);
    expect(now.drifts.length).toBe(SNOW_SPOTS.length);
    w.setForced('rainy');
    const rainy = w.update(0.1, 5, 12);
    expect(rainy.drifts).toEqual([]);
    expect(rainy.snails.length).toBe(SNAIL_SPOTS.length);
  });
});

describe('v24 ゆきを あつめる', () => {
  it('ふきだまりは カタツムリと 同じ4か所・同じ とどく距離', () => {
    expect(SNOW_SPOTS).toBe(SNAIL_SPOTS); // 表を 二重に持たない
    expect(SNOW_REACH).toBe(SNAIL_REACH);
  });

  it('3回 あつめると ゆきだるま(数は 0にもどる)', () => {
    const s = newGameState();
    expect(snowCount(s, 5)).toBe(0);
    expect(addSnowScoop(s, 5)).toBe(false);
    expect(snowCount(s, 5)).toBe(1);
    expect(addSnowScoop(s, 5)).toBe(false);
    expect(snowCount(s, 5)).toBe(2);
    expect(addSnowScoop(s, 5)).toBe(true); // 3回めで できる
    expect(snowCount(s, 5)).toBe(0);
  });

  it('日づけが かわれば 0から(日ごとの リセット処理を ふやさない)', () => {
    const s = newGameState();
    addSnowScoop(s, 5);
    addSnowScoop(s, 5);
    expect(snowCount(s, 5)).toBe(2);
    expect(snowCount(s, 6)).toBe(0);
    expect(addSnowScoop(s, 6)).toBe(false);
    expect(snowCount(s, 6)).toBe(1);
  });

  it('同じ ふきだまりは その日 1回だけ(4か所あるので 1日1こ できる)', () => {
    const w = new WeatherSystem();
    w.setForced('snowy');
    w.update(0.1, 5, 12);
    const p = SNOW_SPOTS[1];
    expect(w.driftWithinReach(p.x, p.z)?.spot).toBe(1);
    w.markDriftTaken(1);
    expect(w.driftWithinReach(p.x, p.z)).toBeNull();
    // ほかの ふきだまりは のこっている
    expect(w.driftWithinReach(SNOW_SPOTS[2].x, SNOW_SPOTS[2].z)?.spot).toBe(2);
    // 4か所 ≥ 3回 = その日のうちに かならず 1こ 作れる
    expect(SNOW_SPOTS.length).toBeGreaterThanOrEqual(SNOW_NEED);
  });

  it('とどく距離の外では 拾えない', () => {
    const w = new WeatherSystem();
    w.setForced('snowy');
    w.update(0.1, 5, 12);
    const p = SNOW_SPOTS[0];
    expect(w.driftWithinReach(p.x + SNOW_REACH + 0.2, p.z)).toBeNull();
  });
});

describe('v24 ゆきの白さは 見た目だけ(判定は 1つも 変わらない)', () => {
  it('歩ける・水・高さ・釣りの格子ダンプが ゆきで 変わらない', () => {
    const before = buildGridDump();
    const engine = new NullEngine();
    const scene = new Scene(engine);
    // 上を向いた面(地面のかわり)を1まい 作って 登録する。
    // 5点めだけ よこ向きの法線(かべ)にして、「上を向いた面にだけ 積もる」ことを 見る
    const mesh = new Mesh('snowTestGround', scene);
    const vd = new VertexData();
    vd.positions = [-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1, 0, 1, 0];
    vd.indices = [0, 1, 2, 0, 2, 3];
    vd.normals = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0];
    vd.colors = [0.2, 0.5, 0.2, 1, 0.2, 0.5, 0.2, 1, 0.2, 0.5, 0.2, 1, 0.2, 0.5, 0.2, 1, 0.2, 0.5, 0.2, 1];
    vd.applyToMesh(mesh);
    registerSnowSurface(mesh);
    const pos0 = [...mesh.getVerticesData(VertexBuffer.PositionKind)!];
    const nrm0 = [...mesh.getVerticesData(VertexBuffer.NormalKind)!];
    const col0 = [...mesh.getVerticesData(VertexBuffer.ColorKind)!];

    applySnowCover(snowCoverFor('snowy', 12));

    // 白くなったのは 頂点の色だけ。形も 法線も 1バイトも 動いていない
    const col1 = [...mesh.getVerticesData(VertexBuffer.ColorKind)!];
    expect([...mesh.getVerticesData(VertexBuffer.PositionKind)!]).toEqual(pos0);
    expect([...mesh.getVerticesData(VertexBuffer.NormalKind)!]).toEqual(nrm0);
    expect(col1).not.toEqual(col0);
    // 上を向いた面(はじめの4点)は 白へ寄り、よこ向きの面(5点め)は そのまま
    expect(col1[0]).toBeGreaterThan(col0[0]);
    expect(col1[1]).toBeGreaterThan(col0[1]);
    expect(col1[16]).toBeCloseTo(col0[16], 6);
    expect(col1[17]).toBeCloseTo(col0[17], 6);

    // 判定の格子は 1バイトも 変わらない
    const after = buildGridDump();
    expect(after.counts).toEqual(before.counts);
    expect(createHash('sha256').update(after.text).digest('hex')).toBe(
      createHash('sha256').update(before.text).digest('hex')
    );

    // とけたら もとの色に もどる(その日が おわれば 天気ごと 変わる)
    applySnowCover(0);
    expect([...mesh.getVerticesData(VertexBuffer.ColorKind)!]).toEqual(col0);
  });
});

describe('v24 ふきだまりの 面は 外を向いている(灰色の岩に 見えない)', () => {
  // 出荷まえに 実機で 灰色の岩に 見えていた事故の 再発ふせぎ。
  // 頂点色は ほぼ白(0.88/0.90/0.92)なのに、巻き順が 内向きだったため
  // 表の面が カリングされ、「向こう側の 内面」が 描かれて 暗くなっていた。
  // 実機の画素で 4通り 測って 決めた形(巻き順を 反転 + 法線は ComputeNormals のまま)を
  // ここで 数として 固定する。GPU も canvas も いらない。
  /**
   * できあがった メッシュの 面の向きを 2つの数で 見る。
   *
   *   normalOut … 頂点の 法線が 重心から 外を 向いている割合。
   *               `toMesh(..., 'flip')` を わすれると ここが 0 に 落ちる。
   *   agree     … 「巻き順から出る 幾何法線(右手系の外積)」と「入っている法線」が
   *               同じ向きの割合。**この島では 低いのが 正しい**——
   *               Babylon は 左手系なので、表の面が 手前に 来ているとき
   *               この2つは 逆向きに なる。`faceOutward` を わすれると 0.93 に はね上がる。
   *
   * 出荷まえの ふきだまりは normalOut 0.99 / agree 0.93 で、実機では 灰色の岩だった。
   * 直したあとは normalOut 0.99 / agree 0.00。どちらの数も 大きく はなれているので、
   * 片方だけ 直しわすれても ここで 止まる。
   */
  const faceStats = (mesh: Mesh): { normalOut: number; agree: number } => {
    const p = mesh.getVerticesData(VertexBuffer.PositionKind)!;
    const n = mesh.getVerticesData(VertexBuffer.NormalKind)!;
    const idx = mesh.getIndices()!;
    const N = p.length / 3;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < N; i++) { cx += p[i * 3]; cy += p[i * 3 + 1]; cz += p[i * 3 + 2]; }
    cx /= N; cy /= N; cz /= N;
    let out = 0, agree = 0, tri = 0;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      const e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
      const e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
      const g = [
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
      ];
      const mx = (p[a] + p[b] + p[c]) / 3 - cx;
      const my = (p[a + 1] + p[b + 1] + p[c + 1]) / 3 - cy;
      const mz = (p[a + 2] + p[b + 2] + p[c + 2]) / 3 - cz;
      if (n[a] * mx + n[a + 1] * my + n[a + 2] * mz > 0) out++;
      if (g[0] * n[a] + g[1] * n[a + 1] + g[2] * n[a + 2] > 0) agree++;
      tri++;
    }
    return { normalOut: out / tri, agree: agree / tri };
  };

  it('どの ふきだまりも 法線は 外向き・表の面が 手前(灰色の岩に ならない)', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    for (let i = 0; i < SNOW_SPOTS.length; i++) {
      const m = makeSnowDrift(scene, i * 17 + 3);
      expect(m.getIndices()!.length % 3, `spot${i}`).toBe(0);
      const st = faceStats(m);
      expect(st.normalOut, `spot${i} 法線が外向き`).toBeGreaterThan(0.9); // 実測 0.99
      expect(st.agree, `spot${i} 表の面が手前`).toBeLessThan(0.15); // 実測 0.00(こわれると 0.93)
      m.dispose();
    }
    scene.dispose();
    engine.dispose();
  });

  it('ふきだまりの 色は ほぼ白(暗い岩の色では ない)', () => {
    const A = snowDriftArrays(3);
    let r = 0, g = 0, b = 0;
    const n = A.col.length / 4;
    for (let i = 0; i < n; i++) { r += A.col[i * 4]; g += A.col[i * 4 + 1]; b += A.col[i * 4 + 2]; }
    expect(r / n).toBeGreaterThan(0.8);
    expect(g / n).toBeGreaterThan(0.8);
    expect(b / n).toBeGreaterThan(0.8);
  });
});

describe('v24 あとから 足した面にも その場で ゆきが 積もる', () => {
  it('積もっている まっ最中に 登録した面は すぐ 白くなる(登録の順番で 差が つかない)', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const makeGround = (name: string): Mesh => {
      const m = new Mesh(name, scene);
      const vd = new VertexData();
      vd.positions = [-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1];
      vd.indices = [0, 1, 2, 0, 2, 3];
      vd.normals = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
      vd.colors = [0.2, 0.5, 0.2, 1, 0.2, 0.5, 0.2, 1, 0.2, 0.5, 0.2, 1, 0.2, 0.5, 0.2, 1];
      vd.applyToMesh(m);
      return m;
    };
    // 1まいめは 先に 登録して 積もらせる
    const first = makeGround('snowFirst');
    registerSnowSurface(first);
    applySnowCover(1);
    const white = [...first.getVerticesData(VertexBuffer.ColorKind)!];
    expect(white[0]).toBeGreaterThan(0.2);

    // 2まいめ(入り江・いちばの地面のように あとから 作られる面)は、
    // applySnowCover を もう1度 呼ばなくても 同じ白さに なること
    const later = makeGround('snowLater');
    registerSnowSurface(later);
    const lateColors = [...later.getVerticesData(VertexBuffer.ColorKind)!];
    expect(lateColors[0]).toBeCloseTo(white[0], 6);
    expect(lateColors[1]).toBeCloseTo(white[1], 6);
    expect(lateColors[2]).toBeCloseTo(white[2], 6);

    // かたづけ: とけた ところまで もどす(ほかのテストへ 持ちこさない)
    applySnowCover(0);
    first.dispose();
    later.dispose();
    scene.dispose();
    engine.dispose();
  });
});

describe('v24 きょうの島カードの ゆき予告', () => {
  it('ゆきの日には 1行 出る(絵も 実在する)', () => {
    const s = newGameState();
    let found = false;
    for (let d = 2; d <= 120; d++) {
      const card = todayCard(s, d);
      const snow = card.events.find((e) => e.id === 'snow');
      if (weatherOfDay(d) === 'snowy') {
        // 2件までの わくなので、まつり・でんしゃが 先に入る日は 出ないことがある
        if (snow) {
          found = true;
          expect(snow.text).toContain('ゆき');
          expect(ICONS[snow.icon]).toBeTruthy();
        }
      } else {
        expect(snow, `day${d}`).toBeUndefined();
      }
    }
    expect(found, 'ゆきの予告が 1度も 出なかった').toBe(true);
  });
});

/** 天気の 4種類が すべて 型に のっている(足しわすれの 検出) */
it('天気は 4種類', () => {
  const all: Weather[] = ['sunny', 'cloudy', 'rainy', 'snowy'];
  for (const w of all) expect(typeof WEATHER_RATE[w]).toBe('number');
  expect(Object.keys(WEATHER_RATE).sort()).toEqual([...all].sort());
});

// v9の天気(はれ・くもり・あめ)と、雨の日のカタツムリ・水たまりのテスト。
// WeatherSystemは純ロジックなので、実時間・Babylon・DOMに依存せず決定的に確かめられる。
import { describe, it, expect } from 'vitest';
import {
  WeatherSystem,
  weatherOfDay,
  weatherSeed,
  rainLevelFor,
  rainbowLevelFor,
  coldLevelFor,
  fishWaitScaleFor,
  snailPose,
  sharedWeather,
  WEATHER_RATE,
  RAIN_END_HOUR,
  RAIN_FADE_HOURS,
  RAINBOW_HOURS,
  RAIN_FISH_WAIT_SCALE,
  SUNNY_UNTIL_DAY,
  SNAIL_SPOTS,
  SNAIL_WANDER_R,
  SNAIL_REACH,
  PUDDLE_SPOTS,
  type Weather,
} from '../../src/systems/WeatherSystem';
import {
  GATHER_NODES, STAR_SPOTS, DRIFT_SPOTS, ENTRANCES, NPC_SPOTS, POIS, DECO_TREES, POND,
} from '../../src/data/island';
import { terrainHeight, pondShoreR, pathDist } from '../../src/entities/terrain';
import { ITEMS, validateItemData } from '../../src/data/items';
import { ICONS } from '../../src/ui/icons';
import { newGameState, invAddRecorded } from '../../src/game/GameState';

// IslandScene.walkable と同じしきい値(content_v8.test.ts と同じ写し)
function walkable(x: number, z: number): boolean {
  const h = terrainHeight(x, z);
  if (h < 0.33) return false;
  const pdx = x - POND.x, pdz = z - POND.z;
  const pdist = Math.hypot(pdx, pdz);
  if (pdist < 16 && h < POND.waterY + 0.05) {
    if (pdist < pondShoreR(Math.atan2(pdz, pdx)) + 1.2) return false;
  }
  return true;
}

// ---- E候補の射程(InteractionRouting / InteractionSystem / FishingSystem の値) ----
const GATHER_HINT_R = 1.9; // InteractionSystem.update の bestD
const NPC_NEAR_R = 1.8; // NPCSystem.nearest の既定 range
const NPC_WANDER_R = 2.2; // NPC_SPOTS の wanderR 既定値
const DOOR_R = 2.0; // 家のドア・店のカウンター
const SHOP_POINT = { x: POIS.shop.x + 4.6, z: POIS.shop.z };
const HOME_POINT = { x: -30.9, z: 6.7 };

/** カタツムリが動きうる範囲すべて(円周＋中心)を点で返す */
function wanderPoints(spot: number): { x: number; z: number }[] {
  const s = SNAIL_SPOTS[spot];
  const pts = [{ x: s.x, z: s.z }];
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
    pts.push({ x: s.x + Math.cos(a) * SNAIL_WANDER_R, z: s.z + Math.sin(a) * SNAIL_WANDER_R });
  }
  return pts;
}

describe('天気の決まり方(日付だけで決まる)', () => {
  it('1日目は必ず はれ(チュートリアル保護)', () => {
    for (let d = 0; d <= SUNNY_UNTIL_DAY; d++) expect(weatherOfDay(d)).toBe('sunny');
  });

  it('同じ日なら何度呼んでも同じ(乱数を使っていない)', () => {
    for (let d = 1; d <= 200; d++) {
      const first = weatherOfDay(d);
      for (let i = 0; i < 5; i++) expect(weatherOfDay(d)).toBe(first);
    }
  });

  it('リロード相当(新しいインスタンス)でも同じ天気になる=セーブ不要', () => {
    const a = new WeatherSystem();
    const b = new WeatherSystem();
    for (let d = 1; d <= 120; d++) {
      expect(b.weatherOf(d)).toBe(a.weatherOf(d));
      expect(b.weatherOf(d)).toBe(weatherOfDay(d));
    }
    // 途中まで進めた個体と、まっさらな個体で 同じ日の結果が変わらない
    for (let i = 0; i < 500; i++) a.update(0.5, 9, 8);
    expect(a.update(0.5, 30, 9).weather).toBe(new WeatherSystem().update(0.5, 30, 9).weather);
  });

  // v24 「ゆき」を くもりの帯から 分けて足した(くもり20% → くもり10% + ゆき10%)。
  // あめの帯(u>=0.8)は 1つも 動かないので、あめの日づけは v23 と 同じまま
  it('確率は はれ60% / くもり10% / ゆき10% / あめ20%(1000日で±3%以内)', () => {
    const N = 1000;
    const count: Record<Weather, number> = { sunny: 0, cloudy: 0, rainy: 0, snowy: 0 };
    for (let d = 1; d <= N; d++) count[weatherOfDay(d)]++;
    expect(count.sunny + count.cloudy + count.rainy + count.snowy).toBe(N);
    for (const w of ['sunny', 'cloudy', 'rainy', 'snowy'] as Weather[]) {
      expect(Math.abs(count[w] / N - WEATHER_RATE[w]), `${w}=${count[w]}`).toBeLessThan(0.03);
    }
    // 4種類ともちゃんと出る(片寄って1種類だけ、にならない)
    expect(count.cloudy).toBeGreaterThan(50);
    expect(count.rainy).toBeGreaterThan(100);
    expect(count.snowy).toBeGreaterThan(50);
  });

  it('シードは0以上1未満にちらばる', () => {
    const buckets = new Array(10).fill(0);
    for (let d = 1; d <= 2000; d++) {
      const u = weatherSeed(d);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
      buckets[Math.floor(u * 10)]++;
    }
    for (const b of buckets) expect(b).toBeGreaterThan(120); // どの区間も空にならない
  });

  it('最初の30日は同じ天気が続きすぎない(毎日に変化がある)', () => {
    let run = 1, maxRun = 1;
    for (let d = 2; d <= 30; d++) {
      run = weatherOfDay(d) === weatherOfDay(d - 1) ? run + 1 : 1;
      maxRun = Math.max(maxRun, run);
    }
    expect(maxRun).toBeLessThanOrEqual(5);
    // 遊びはじめて まもなく 雨とくもりの日が来る
    const early = [];
    for (let d = 1; d <= 15; d++) early.push(weatherOfDay(d));
    expect(early).toContain('rainy');
    expect(early).toContain('cloudy');
  });
});

describe('1日の中の移りかわり(あめ→虹→はれ)', () => {
  it('あめの日は 0時から15時まで降り、前後30分で強さが変わる', () => {
    expect(rainLevelFor('rainy', 0)).toBe(0);
    expect(rainLevelFor('rainy', RAIN_FADE_HOURS / 2)).toBeCloseTo(0.5, 5);
    expect(rainLevelFor('rainy', RAIN_FADE_HOURS)).toBe(1);
    expect(rainLevelFor('rainy', 6)).toBe(1); // 起きたときは本降り
    expect(rainLevelFor('rainy', 12)).toBe(1);
    expect(rainLevelFor('rainy', RAIN_END_HOUR - RAIN_FADE_HOURS)).toBe(1);
    expect(rainLevelFor('rainy', RAIN_END_HOUR - RAIN_FADE_HOURS / 2)).toBeCloseTo(0.5, 5);
    expect(rainLevelFor('rainy', RAIN_END_HOUR)).toBe(0); // 15時に上がる
    expect(rainLevelFor('rainy', 18)).toBe(0);
    expect(rainLevelFor('rainy', 23.9)).toBe(0);
  });

  it('はれ・くもりの日は1日じゅう降らないし虹も出ない', () => {
    for (let h = 0; h < 24; h += 0.25) {
      for (const w of ['sunny', 'cloudy'] as Weather[]) {
        expect(rainLevelFor(w, h), `${w} ${h}`).toBe(0);
        expect(rainbowLevelFor(w, h), `${w} ${h}`).toBe(0);
      }
    }
  });

  it('虹は雨が上がった15:00から30分だけ出る(山なりに濃くなる)', () => {
    expect(rainbowLevelFor('rainy', RAIN_END_HOUR - 0.01)).toBe(0);
    expect(rainbowLevelFor('rainy', RAIN_END_HOUR)).toBe(0);
    expect(rainbowLevelFor('rainy', RAIN_END_HOUR + 0.05)).toBeGreaterThan(0);
    expect(rainbowLevelFor('rainy', RAIN_END_HOUR + RAINBOW_HOURS / 2)).toBeCloseTo(1, 5);
    expect(rainbowLevelFor('rainy', RAIN_END_HOUR + RAINBOW_HOURS - 0.01)).toBeGreaterThan(0);
    expect(rainbowLevelFor('rainy', RAIN_END_HOUR + RAINBOW_HOURS)).toBe(0);
    expect(rainbowLevelFor('rainy', 20)).toBe(0);
  });

  it('雨と虹は同時に出ない(上がってから出る)', () => {
    for (let h = 0; h < 24; h += 0.01) {
      const r = rainLevelFor('rainy', h);
      const b = rainbowLevelFor('rainy', h);
      expect(r > 0 && b > 0, `h=${h.toFixed(2)}`).toBe(false);
    }
  });

  it('空の寒色ぐあい: くもりは中くらい・雨は強い・雨上がりはもどっていく', () => {
    expect(coldLevelFor('sunny', 12)).toBe(0);
    expect(coldLevelFor('cloudy', 12)).toBeCloseTo(0.55, 5);
    expect(coldLevelFor('rainy', 12)).toBe(1);
    expect(coldLevelFor('rainy', RAIN_END_HOUR + 0.02)).toBeLessThan(0.36);
    expect(coldLevelFor('rainy', RAIN_END_HOUR + 0.02)).toBeGreaterThan(0);
    expect(coldLevelFor('rainy', RAIN_END_HOUR + RAINBOW_HOURS * 2)).toBe(0); // すっかり晴れる
    for (let h = 0; h < 24; h += 0.25) {
      for (const w of ['sunny', 'cloudy', 'rainy'] as Weather[]) {
        const c = coldLevelFor(w, h);
        expect(c, `${w} ${h}`).toBeGreaterThanOrEqual(0);
        expect(c, `${w} ${h}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('WeatherSystem.updateが同じ移りかわりを返す(あめの日で通し)', () => {
    const w = new WeatherSystem();
    w.setForced('rainy');
    expect(w.update(0.5, 5, 6).rain).toBe(1); // 朝は本降り
    expect(w.update(0.5, 5, 6).rainbow).toBe(0);
    const noon = w.update(0.5, 5, 12);
    expect(noon.rain).toBe(1);
    expect(noon.cold).toBe(1);
    const bow = w.update(0.5, 5, RAIN_END_HOUR + RAINBOW_HOURS / 2);
    expect(bow.rain).toBe(0);
    expect(bow.rainbow).toBeCloseTo(1, 5);
    const evening = w.update(0.5, 5, 18);
    expect(evening.rain).toBe(0);
    expect(evening.rainbow).toBe(0);
    expect(evening.cold).toBe(0);
  });

  it('就寝・時間スキップ(いきなり翌朝6時)でも正しく切りかわる', () => {
    const w = new WeatherSystem();
    // あめの日の夜ふかし → 就寝 → はれの日の朝
    w.setForced('rainy');
    const night = w.update(0.5, 5, 3); // 0〜15時なので夜中でも降っている
    expect(night.rain).toBe(1);
    expect(night.snails.length).toBe(SNAIL_SPOTS.length);
    w.setForced('sunny');
    const morning = w.update(0.016, 6, 6); // ベッドで朝まで寝た
    expect(morning.rain).toBe(0);
    expect(morning.snails).toEqual([]);
    expect(morning.cold).toBe(0);
  });
});

describe('釣りの待ち時間(雨のあいだだけ短くなる)', () => {
  it('雨のあいだは0.6倍、それ以外は1.0倍', () => {
    expect(RAIN_FISH_WAIT_SCALE).toBe(0.6);
    expect(fishWaitScaleFor('rainy', 12)).toBe(RAIN_FISH_WAIT_SCALE);
    expect(fishWaitScaleFor('rainy', 3)).toBe(RAIN_FISH_WAIT_SCALE);
    expect(fishWaitScaleFor('rainy', RAIN_END_HOUR)).toBe(1); // 上がったらもどる
    expect(fishWaitScaleFor('rainy', 20)).toBe(1);
    expect(fishWaitScaleFor('sunny', 12)).toBe(1);
    expect(fishWaitScaleFor('cloudy', 12)).toBe(1);
  });

  it('WeatherSystem.fishWaitScale が日付から同じ答えを出す', () => {
    const w = new WeatherSystem();
    w.setForced('rainy');
    expect(w.fishWaitScale(5, 12)).toBe(0.6);
    w.setForced('sunny');
    expect(w.fishWaitScale(5, 12)).toBe(1);
    w.setForced(null);
    expect(w.fishWaitScale(1, 12)).toBe(1); // 1日目は必ず はれ
  });
});

describe('カタツムリ(雨の日だけ)', () => {
  it('アイテムの中身(名前・売値・種別・アイコン・ずかん)', () => {
    expect(validateItemData()).toEqual([]);
    expect(ITEMS.snail).toMatchObject({ name: 'カタツムリ', sell: 14, kind: 'material' });
    expect(ITEMS.snail.desc.length).toBeGreaterThan(3);
    expect(ICONS.snail).toBeDefined();
    expect(ICONS.snail.startsWith('<svg')).toBe(true);
    const s = newGameState();
    invAddRecorded(s, 'snail', 2);
    expect(s.codex.snail).toBe(2); // ずかんに載る
    expect(s.inventory.snail).toBe(2);
  });

  it('雨のあいだだけ出る(はれ・くもり・雨上がりには出ない)', () => {
    const w = new WeatherSystem();
    w.setForced('sunny');
    expect(w.update(0.5, 5, 12).snails).toEqual([]);
    w.setForced('cloudy');
    expect(w.update(0.5, 5, 12).snails).toEqual([]);
    w.setForced('rainy');
    expect(w.update(0.5, 5, 12).snails.length).toBe(SNAIL_SPOTS.length);
    expect(w.update(0.5, 5, RAIN_END_HOUR + 0.2).snails).toEqual([]); // 虹の時間には ひっこむ
  });

  it('拾った場所はその雨のあいだ出ない(次の雨の日には また出る)', () => {
    const w = new WeatherSystem();
    w.setForced('rainy');
    w.update(0.5, 5, 8);
    w.markSnailTaken(1);
    expect(w.isSnailTaken(1)).toBe(true);
    expect(w.state.snails).not.toContain(1);
    expect(w.update(0.5, 5, 12).snails).not.toContain(1); // 同じ日はもう出ない
    w.update(0.5, 5, 18); // 雨が上がる
    expect(w.update(0.5, 6, 8).snails).toContain(1); // 次の雨の日には もどる
  });

  it('動きは決定的で、ゆっくり・決めた範囲から出ない', () => {
    for (let spot = 0; spot < SNAIL_SPOTS.length; spot++) {
      const s = SNAIL_SPOTS[spot];
      let prev = snailPose(spot, 0);
      let maxSpeed = 0;
      const seen = new Set<string>();
      for (let t = 0; t <= 600; t += 0.25) {
        const p = snailPose(spot, t);
        expect(snailPose(spot, t)).toEqual(p); // 同じtなら同じ姿勢
        expect(Math.hypot(p.x - s.x, p.z - s.z), `spot${spot} t=${t}`).toBeLessThanOrEqual(SNAIL_WANDER_R * 1.42 + 1e-6);
        maxSpeed = Math.max(maxSpeed, Math.hypot(p.x - prev.x, p.z - prev.z) / 0.25);
        seen.add(`${p.x.toFixed(1)},${p.z.toFixed(1)}`);
        prev = p;
      }
      expect(maxSpeed, `spot${spot}`).toBeLessThan(0.12); // カタツムリらしいゆっくりさ
      expect(maxSpeed, `spot${spot}`).toBeGreaterThan(0.005); // 止まったままではない
      expect(seen.size, `spot${spot}`).toBeGreaterThan(20); // 同じ点を往復するだけではない
    }
  });

  it('出る場所は歩ける草の上・道の上ではない', () => {
    for (let i = 0; i < SNAIL_SPOTS.length; i++) {
      for (const p of wanderPoints(i)) {
        expect(walkable(p.x, p.z), `spot${i} (${p.x.toFixed(1)},${p.z.toFixed(1)})`).toBe(true);
        const h = terrainHeight(p.x, p.z);
        expect(h, `spot${i}`).toBeGreaterThan(0.8); // 浜の砂ではなく草
        expect(h, `spot${i}`).toBeLessThan(2.6); // 高台でもない
      }
      const s = SNAIL_SPOTS[i];
      expect(pathDist(s.x, s.z), `spot${i}`).toBeGreaterThan(2); // 道の上に置かない
    }
  });

  it('出る場所どうしが離れている(同じ場所に見えない)', () => {
    for (let i = 0; i < SNAIL_SPOTS.length; i++) {
      for (let j = i + 1; j < SNAIL_SPOTS.length; j++) {
        const d = Math.hypot(SNAIL_SPOTS[i].x - SNAIL_SPOTS[j].x, SNAIL_SPOTS[i].z - SNAIL_SPOTS[j].z);
        expect(d, `spot${i}と${j}`).toBeGreaterThan(8);
      }
    }
  });

  /**
   * ここが「Eの横取り」を構造で防ぐ根拠。
   * 手のとどく距離(SNAIL_REACH)まで近づいたとき、ほかのE候補が1つも射程に入らないことを固定する。
   * GameScene.routeWithSnail は「ほかの候補が無いときだけ」拾う実装なので、
   * この検査が通っているかぎり「見えているのに拾えない」も起きない。
   */
  it('ほかのE候補と取り合いにならない距離をとってある', () => {
    const npcPts = Object.values(NPC_SPOTS).flatMap((s) => Object.values(s));
    for (let i = 0; i < SNAIL_SPOTS.length; i++) {
      for (const p of wanderPoints(i)) {
        for (const n of GATHER_NODES) {
          expect(Math.hypot(p.x - n.x, p.z - n.z), `spot${i} と ${n.id}`)
            .toBeGreaterThan(GATHER_HINT_R + SNAIL_REACH);
        }
        for (const q of npcPts) {
          expect(Math.hypot(p.x - q.x, p.z - q.z), `spot${i} と NPC(${q.x},${q.z})`)
            .toBeGreaterThan(NPC_NEAR_R + NPC_WANDER_R + SNAIL_REACH);
        }
        for (const q of [SHOP_POINT, HOME_POINT, ...ENTRANCES]) {
          expect(Math.hypot(p.x - q.x, p.z - q.z), `spot${i} と 入口(${q.x},${q.z})`)
            .toBeGreaterThan(DOOR_R + SNAIL_REACH);
        }
        // 釣り場(池の帯 sr-2.0〜sr+1.0)にも重ねない
        const dx = p.x - POND.x, dz = p.z - POND.z;
        const d = Math.hypot(dx, dz);
        const sr = pondShoreR(Math.atan2(dz, dx));
        expect(d - sr, `spot${i} 池の岸線から`).toBeGreaterThan(1 + SNAIL_REACH);
        // 装飾の木・ほしのかけら・うきだまとも重ねない
        for (const [tx, tz] of DECO_TREES) {
          expect(Math.hypot(p.x - tx, p.z - tz), `spot${i} と 木(${tx},${tz})`).toBeGreaterThan(1.5);
        }
        for (const q of [...STAR_SPOTS, ...DRIFT_SPOTS]) {
          expect(Math.hypot(p.x - q.x, p.z - q.z), `spot${i}`).toBeGreaterThan(SNAIL_REACH + 1);
        }
      }
    }
  });

  it('手のとどく判定は1匹だけを返す(いちばん近いもの)', () => {
    const w = new WeatherSystem();
    w.setForced('rainy');
    const now = w.update(0.5, 5, 10);
    const p = snailPose(0, now.t);
    expect(w.snailWithinReach(p.x, p.z)?.spot).toBe(0);
    expect(w.snailWithinReach(p.x + SNAIL_REACH + 0.2, p.z)).toBeNull(); // とどかない
    w.markSnailTaken(0);
    expect(w.snailWithinReach(p.x, p.z)).toBeNull(); // 拾ったあとは もういない
    // はれの日は どこに立ってもいない
    w.setForced('sunny');
    w.update(0.5, 5, 10);
    expect(w.snailWithinReach(p.x, p.z)).toBeNull();
  });
});

describe('水たまり', () => {
  it('3〜5個あり、歩ける平らな地面の上にある', () => {
    expect(PUDDLE_SPOTS.length).toBeGreaterThanOrEqual(3);
    expect(PUDDLE_SPOTS.length).toBeLessThanOrEqual(5);
    for (const p of PUDDLE_SPOTS) {
      expect(walkable(p.x, p.z), `(${p.x},${p.z})`).toBe(true);
      expect(p.rx, `(${p.x},${p.z})`).toBeGreaterThan(0.5);
      expect(p.rx, `(${p.x},${p.z})`).toBeLessThan(2);
      expect(p.rz).toBeLessThan(p.rx); // まん丸でなく 浅い楕円
      // ふちまで平ら(坂に貼ると水面が傾いて見える)
      const r = Math.max(p.rx, p.rz);
      let lo = Infinity, hi = -Infinity;
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const h = terrainHeight(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
      expect(hi - lo, `(${p.x},${p.z}) の起伏`).toBeLessThan(0.4);
    }
  });

  it('採取ノード・NPCの立ち位置・池の水面に重ねない', () => {
    const npcPts = Object.values(NPC_SPOTS).flatMap((s) => Object.values(s));
    for (const p of PUDDLE_SPOTS) {
      const r = Math.max(p.rx, p.rz);
      for (const n of GATHER_NODES) {
        expect(Math.hypot(p.x - n.x, p.z - n.z), `(${p.x},${p.z}) と ${n.id}`).toBeGreaterThan(r + 1.5);
      }
      for (const q of npcPts) {
        expect(Math.hypot(p.x - q.x, p.z - q.z), `(${p.x},${p.z})`).toBeGreaterThan(r + 2);
      }
      const dx = p.x - POND.x, dz = p.z - POND.z;
      const d = Math.hypot(dx, dz);
      expect(d - pondShoreR(Math.atan2(dz, dx)), `(${p.x},${p.z}) 池から`).toBeGreaterThan(r + 2);
    }
  });

  it('水たまりどうしが重ならない', () => {
    for (let i = 0; i < PUDDLE_SPOTS.length; i++) {
      for (let j = i + 1; j < PUDDLE_SPOTS.length; j++) {
        const a = PUDDLE_SPOTS[i], b = PUDDLE_SPOTS[j];
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        expect(d, `${i}と${j}`).toBeGreaterThan(Math.max(a.rx, a.rz) + Math.max(b.rx, b.rz) + 1);
      }
    }
  });
});

describe('共有インスタンス', () => {
  it('sharedWeather は同じものを返す(FishingSystemとGameSceneが同じ天気を見る)', () => {
    expect(sharedWeather()).toBe(sharedWeather());
    const w = sharedWeather();
    w.reset();
    expect(w.forcedWeather).toBeNull();
    w.setForced('rainy');
    expect(sharedWeather().fishWaitScale(5, 12)).toBe(RAIN_FISH_WAIT_SCALE);
    w.reset(); // ほかのテストへ持ちこさない
    expect(sharedWeather().fishWaitScale(5, 12)).toBe(weatherOfDay(5) === 'rainy' ? RAIN_FISH_WAIT_SCALE : 1);
  });
});

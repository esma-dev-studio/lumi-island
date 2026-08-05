// 天気(はれ・くもり・あめ)。描画・Babylon・DOMに依存しない純ロジック。
//
// 仕様:
//   - 天気は「日付」だけで決まる(乱数を直接呼ばない)。同じ日なら何度リロードしても同じ天気。
//     そのためセーブは不要 — 日付から毎回みちびき直せる。
//   - 確率は はれ60% / くもり20% / あめ20%。日付をハッシュした0〜1の値で振り分ける。
//   - 1日目は必ず「はれ」。最初の遊び方をおぼえる日に、雨で見通しが悪くなるのを避ける
//     (チュートリアル保護)。
//   - あめの日は 0:00 から降りはじめ、15:00 に上がる。上がったあと30分(ゲーム内)だけ虹が出る。
//     TimeSystemは0時で日付が変わるので、「あめの日」= その日付の0〜15時が雨、という形にすると、
//     朝6時に起きた子どもは必ず「今日は雨だ」と分かる。夜ふかしして0時をまたぐと降りはじめる。
//   - 雨のあいだだけ カタツムリが地面に出る(手でひろえる)。拾った場所はその雨のあいだ出ない。
//
// 時間の進みは呼び出し側(GameScene)から渡す。ポーズ・モーダル中はupdateが呼ばれないので、
// 凍結中に勝手に進まない(ほしのかけら・うきだまと同じ考え方)。

export type Weather = 'sunny' | 'cloudy' | 'rainy';

/** 出現確率(合計1)。テストがこの値と実際の分布を突き合わせる */
export const WEATHER_RATE: Record<Weather, number> = { sunny: 0.6, cloudy: 0.2, rainy: 0.2 };

/** 雨が上がる時刻 */
export const RAIN_END_HOUR = 15;
/** 降りはじめ・上がりぎわの、雨脚がかわる時間(時)。ぱっと消えないようにする */
export const RAIN_FADE_HOURS = 0.5;
/** 虹が出ている長さ(ゲーム内の時間) */
export const RAINBOW_HOURS = 0.5;
/** あめの日は釣りの待ち時間がこの倍率になる(体感でわかる程度) */
export const RAIN_FISH_WAIT_SCALE = 0.6;
/** チュートリアル保護: この日までは必ず はれ */
export const SUNNY_UNTIL_DAY = 1;

/**
 * 日付を0〜1の値にちらす(整数ハッシュ。乱数ではないので、いつ・何度呼んでも同じ)。
 * 実測: 1〜10000日で はれ59.0% / くもり20.4% / あめ20.6%。
 */
export function weatherSeed(day: number): number {
  let a = Math.imul(Math.floor(day) + 1, 0x9e3779b1) >>> 0; // 黄金比の定数でばらす
  a ^= a >>> 16;
  a = Math.imul(a, 0x21f0aaad) >>> 0;
  a ^= a >>> 15;
  a = Math.imul(a, 0x735a2d97) >>> 0;
  a ^= a >>> 15;
  return (a >>> 0) / 4294967296;
}

/** その日の天気(日付だけで決まる) */
export function weatherOfDay(day: number): Weather {
  if (day <= SUNNY_UNTIL_DAY) return 'sunny';
  const u = weatherSeed(day);
  if (u < WEATHER_RATE.sunny) return 'sunny';
  if (u < WEATHER_RATE.sunny + WEATHER_RATE.cloudy) return 'cloudy';
  return 'rainy';
}

/** 0〜1に丸める */
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * 雨脚の強さ(0=降っていない 1=本降り)。
 * 0:00に降りはじめ(30分かけて強くなる)、15:00に上がる(手前30分で弱まる)。
 */
export function rainLevelFor(weather: Weather, hour: number): number {
  if (weather !== 'rainy') return 0;
  if (hour < 0 || hour >= RAIN_END_HOUR) return 0;
  if (hour < RAIN_FADE_HOURS) return clamp01(hour / RAIN_FADE_HOURS);
  if (hour > RAIN_END_HOUR - RAIN_FADE_HOURS) return clamp01((RAIN_END_HOUR - hour) / RAIN_FADE_HOURS);
  return 1;
}

/**
 * 虹の濃さ(0〜1)。雨が上がった15:00から30分だけ、ふわりと出て ふわりと消える。
 * 端を丸めるので「出た瞬間に真っ濃い」にはならない。
 */
export function rainbowLevelFor(weather: Weather, hour: number): number {
  if (weather !== 'rainy') return 0;
  const t = (hour - RAIN_END_HOUR) / RAINBOW_HOURS;
  if (t <= 0 || t >= 1) return 0;
  return Math.sin(Math.PI * t); // 山なり(出ぎわ・消えぎわがなめらか)
}

/**
 * 空と光を寒色へ寄せる度合い(0=いつもの色 1=いちばん寒い)。
 * くもりは弱く、あめは雨脚と同じだけ効かせる。虹の時間は空が晴れていく途中なので、
 * 雨がやんだあとも少しだけ残す(急に真夏の空にならない)。
 */
export function coldLevelFor(weather: Weather, hour: number): number {
  if (weather === 'cloudy') return 0.55;
  if (weather !== 'rainy') return 0;
  const rain = rainLevelFor(weather, hour);
  if (rain > 0) return Math.max(rain, 0.35);
  // 雨上がり: 虹のあいだに ゆっくり ふつうの空へもどす
  const t = (hour - RAIN_END_HOUR) / (RAINBOW_HOURS * 2);
  return t > 0 && t < 1 ? 0.35 * (1 - t) : 0;
}

/**
 * 釣りの待ち時間の倍率。雨がふっているあいだだけ短くする。
 * 「雨だから魚がよくつれる」と結びつけて分かるようにしたいので、
 * 雨が上がったあと(虹・夕方)は元にもどす。
 */
export function fishWaitScaleFor(weather: Weather, hour: number): number {
  return rainLevelFor(weather, hour) > 0 ? RAIN_FISH_WAIT_SCALE : 1;
}

// ---------------------------------------------------------------------------
// カタツムリ(雨のあいだだけ地面に出る)
// ---------------------------------------------------------------------------

/**
 * カタツムリが出る場所。決定的(乱数なし)。
 * 置き場所の条件は tests/unit/weather.test.ts が機械検査している:
 *   - 歩ける草の上・道の上ではない
 *   - 採取ノードから5m以上・NPCの立ち位置から7m以上・入口/建物から5m以上
 *   → 「Eでひろえる距離(1m)」に立ったとき、ほかのE候補が1つも射程に入らない。
 */
export const SNAIL_SPOTS: { x: number; z: number }[] = [
  { x: 10.5, z: -2 }, // 広場の東の草地
  { x: -8.5, z: 8 }, // 工房の南の草地
  { x: -1, z: -13.5 }, // ルミの木の南(林へ向かう草地)
  { x: -2.5, z: 20 }, // 浜へ下りる道のわき
];

/** その場所を中心に、これだけの範囲をゆっくり動きまわる(m) */
export const SNAIL_WANDER_R = 0.9;
/** Eでひろえる距離(m)。近づいてしゃがむ感じの短さにする */
export const SNAIL_REACH = 1.0;

/** カタツムリの位置と向き(時間だけで決まる=決定的)。t は実秒 */
export function snailPose(spot: number, t: number): { x: number; z: number; rotY: number } {
  const s = SNAIL_SPOTS[spot % SNAIL_SPOTS.length];
  // 周期の合わない2つの往復を組み合わせて、同じ道をなぞって見えないようにする。
  // 速さは最大でも約0.07m/s(カタツムリらしいゆっくりさ)
  const wx = 0.055, wz = 0.037 * 1.618;
  const a = t * wx + spot * 1.7;
  const b = t * wz + spot * 2.3;
  const dx = Math.cos(a) * wx * SNAIL_WANDER_R;
  const dz = Math.cos(b) * wz * SNAIL_WANDER_R;
  return {
    x: s.x + Math.sin(a) * SNAIL_WANDER_R,
    z: s.z + Math.sin(b) * SNAIL_WANDER_R,
    // 進む向き。ほぼ止まっている一瞬だけ向きを変えない(0を向いてカクつかせない)
    rotY: Math.hypot(dx, dz) < 1e-5 ? 0 : Math.atan2(dx, dz),
  };
}

// ---------------------------------------------------------------------------
// 水たまり(雨のあいだ地面にできて、上がると かわく)
// ---------------------------------------------------------------------------

/** 水たまりの場所と大きさ(浅い楕円)。決定的。当たり判定は付けない(踏み越えられる) */
export const PUDDLE_SPOTS: { x: number; z: number; rx: number; rz: number; rot: number }[] = [
  { x: -5, z: -4.5, rx: 1.35, rz: 0.95, rot: 0.5 }, // 広場の西
  { x: 5.5, z: -0.5, rx: 1.1, rz: 0.8, rot: -0.9 }, // 広場の東(ランプのそば)
  { x: -6, z: 4.5, rx: 1.5, rz: 0.9, rot: 2.1 }, // 工房から浜へ下りる道のわき
  { x: -0.5, z: -15, rx: 1.2, rz: 0.85, rot: 1.2 }, // 林へ向かう道のわき
  { x: -9.5, z: -15, rx: 0.95, rz: 0.7, rot: -0.4 }, // 林の手前
];

// ---------------------------------------------------------------------------
// 天気のいまの状態(表示側へ渡すひとまとまり)
// ---------------------------------------------------------------------------

export interface WeatherNow {
  weather: Weather;
  /** 雨脚(0〜1) */
  rain: number;
  /** 虹の濃さ(0〜1) */
  rainbow: number;
  /** 空・光を寒色へ寄せる度合い(0〜1) */
  cold: number;
  /** いま地面に出ているカタツムリの場所番号 */
  snails: number[];
  /** カタツムリの姿勢を出すための通し時間(実秒) */
  t: number;
}

export class WeatherSystem {
  /** 検証・デバッグ用の固定(?weather=rain など)。nullなら日付から決める */
  private forced: Weather | null = null;
  /** 「いまの雨」の識別子。変わったら拾った記録を捨てる */
  private key = '';
  private taken = new Set<number>();
  private elapsed = 0;
  private now: WeatherNow = { weather: 'sunny', rain: 0, rainbow: 0, cold: 0, snails: [], t: 0 };

  /** シーンを作り直したとき(タイトル→本編)に、持ちこしの状態を捨てる */
  reset(): void {
    this.forced = null;
    this.key = '';
    this.taken.clear();
    this.elapsed = 0;
    this.now = { weather: 'sunny', rain: 0, rainbow: 0, cold: 0, snails: [], t: 0 };
  }

  /** 天気を固定する(検証用)。null で解除 */
  setForced(w: Weather | null): void {
    this.forced = w;
  }
  get forcedWeather(): Weather | null {
    return this.forced;
  }

  /** その日の天気(固定されていればそれ) */
  weatherOf(day: number): Weather {
    return this.forced ?? weatherOfDay(day);
  }

  get state(): WeatherNow {
    return this.now;
  }

  /**
   * 時間を進めて、いまの天気の状態を返す。
   * @param dt 実秒(ポーズ・モーダル中は呼ばれない)
   */
  update(dt: number, day: number, hour: number): WeatherNow {
    this.elapsed += dt;
    const weather = this.weatherOf(day);
    const rain = rainLevelFor(weather, hour);
    // 「いまの雨」= 日付。雨が上がる/次の日になれば、拾った記録は捨てる
    const key = rain > 0 ? String(Math.floor(day)) : '';
    if (key !== this.key) {
      this.key = key;
      this.taken.clear();
    }
    const snails: number[] = [];
    if (rain > 0) {
      for (let i = 0; i < SNAIL_SPOTS.length; i++) {
        if (!this.taken.has(i)) snails.push(i);
      }
    }
    this.now = {
      weather,
      rain,
      rainbow: rainbowLevelFor(weather, hour),
      cold: coldLevelFor(weather, hour),
      snails,
      t: this.elapsed,
    };
    return this.now;
  }

  /** 拾われた: その雨のあいだ、その場所にはもう出ない */
  markSnailTaken(spot: number): void {
    this.taken.add(spot);
    this.now = { ...this.now, snails: this.now.snails.filter((s) => s !== spot) };
  }
  isSnailTaken(spot: number): boolean {
    return this.taken.has(spot);
  }

  /**
   * 手の届くところにいるカタツムリ(いなければnull)。
   * ヒントの表示とEの実行は必ずこの1つの判定から出す(隠れ候補をつくらない)。
   */
  snailWithinReach(px: number, pz: number): { spot: number; x: number; z: number } | null {
    let best: { spot: number; x: number; z: number } | null = null;
    let bestD = SNAIL_REACH;
    for (const spot of this.now.snails) {
      const p = snailPose(spot, this.now.t);
      const d = Math.hypot(px - p.x, pz - p.z);
      if (d < bestD) {
        bestD = d;
        best = { spot, x: p.x, z: p.z };
      }
    }
    return best;
  }

  /** 釣りの待ち時間の倍率(FishingSystemが使う) */
  fishWaitScale(day: number, hour: number): number {
    return fishWaitScaleFor(this.weatherOf(day), hour);
  }
}

/**
 * 天気システムのシングルトン。
 * FishingSystem のような「GameSceneから配線を増やしたくない場所」も、ここから読む。
 */
let shared: WeatherSystem | null = null;
export function sharedWeather(): WeatherSystem {
  if (!shared) shared = new WeatherSystem();
  return shared;
}

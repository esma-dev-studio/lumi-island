// v20 第3章「いちば島」の地形(純関数。Babylon・DOMに依存しない)。
//
// 立ち位置:
//   よるの入り江(src/entities/terrain.ts の COVE ブロック)と まったく同じ流儀の
//   「別空間はオフセット方式」。ここには **歩ける・立てる高さの規則だけ** を置く。
//   見た目は src/entities/market.ts、出し入れは src/scenes/MarketArea.ts が持つ。
//
// 場所の決め方:
//   セーブのロード時クランプ(±70。src/save/SaveSystem.ts)の内がわで、
//   **ほかの別空間(よるの入り江・マイホーム・3人の家)とも 島の歩ける地面とも
//   1mmも かさならない**場所を、±70の中を1mきざみで 総当たりして選んだ。
//   ±70の中は もう ほとんど うまっていて(入り江が南西・部屋が四すみ・
//   さんばしの よこに 第3章の えき)、条件を満たす中心は わずかしか残っていない。
//   その中で いちばん余裕のある 南東の帯から (30, 58) を採用した。
//   z は 岸線のゆらぎ(半径の±22%)を のせても 歩ける点が z=70 を こえない値にしてある
//   ——こえると セーブのクランプで 海へ 飛ばされる(実測: z=60 だと 70.2 の点が出た)。
//
//   歩ける範囲: x∈[18.9,41.1] / z∈[46.9,69.2]、駅の桟橋の先でも z=46.8。
//   はたらく範囲(insideMarketArea): x∈[13.8,46.2] / z∈[42.8,73.2]。
//   ここには 島の歩ける地面も ほかの別空間も 1点もない
//   (実測。tests/unit/market.test.ts が 0.4mきざみで 機械検査する)。
//
// 「島から近い(南の浜まで約12m)のに いいのか」について:
//   いちば島にいるあいだ 島の見た目は 丸ごと消え、島にいるあいだ いちば島は消える。
//   ——入り江が48mはなれているのは 当時 空いていたからで、必要な条件は距離ではなく
//   **判定と見た目のかさなりが無いこと**。かさならないことは 上のとおり機械検査してある。
//   ただし 夜のプレイヤー近傍ライト(nearestGlowSource の半径12m)は世界にひとつなので、
//   いちばの あかりは **いちば島にいるあいだだけ** 登録する(MarketArea.setActive)。
//
// 入り江との ちがいは「ゆるい浜が どちらを向くか」だけ:
//   入り江は 南(+z)が浜 = ふねが着く側。
//   いちば島は **北(-z)が浜** = 島のほうを向いた側に 駅の桟橋を出す
//   (でんしゃは 島と いちば島の あいだの海を 行き来する)。
import { vnoise } from './terrain';

/** ガウス(まるい山・平場を作る)。terrain.ts の同じ式を写したもの(相互importを作らないため) */
const gauss = (x: number, z: number, cx: number, cz: number, r: number): number =>
  Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (r * r));

const sstep = (t: number): number => t * t * (3 - 2 * t);

/** いちば島の中心と岸線(だ円)の半径(m)。世界座標 */
export const MARKET = { x: 30, z: 58, rx: 12.2, rz: 9.2 } as const;
/** いちば島の海面。島の海面(entities/water.ts SEA_Y)と同じ値にそろえる */
export const MARKET_SEA_Y = 0.3;
/** いちば島で歩ける高さのしきい値(海面+3cm)。入り江の COVE_WALK_Y と同じ考え方 */
export const MARKET_WALK_Y = 0.33;

/**
 * いちば島の駅の桟橋(世界座標)。島の桟橋(water.ts PIER)と同じ持ちかた。
 * 北(-z)へ突き出していて、先(z0)がわに でんしゃが とまる。
 */
export const MARKET_PIER = {
  x: MARKET.x - 4.2,
  w: 2.4,
  z0: MARKET.z - 11.2,
  z1: MARKET.z - 4.4,
  y: 1.06,
} as const;

/** 岸から内へ上がりきる高さ(海面から)。これ以上は坂で上がらない=まん中は平ら */
const MARKET_RISE = 1.5;
/** 北(浜=駅がわ)のこう配。ゆるいほど 波うちぎわの砂が広くなる */
const MARKET_SLOPE_N = 0.105;
/** 南・東西(岩ばた)のこう配。浜より急にして「小島のふところ」に見せる */
const MARKET_SLOPE_S = 0.42;
/** 岸線より外(海)へ落ちるこう配。見えない壁ではなく地形で止めるための下り */
const MARKET_DROP = 0.62;

/** 市場通りの平場(ローカル)。屋台とちょうちんが ならぶ場所 */
export const MARKET_STREET = { lx: -1.6, lz: 0.6, r: 4.4 } as const;
/** 見はらしの丘(ローカル)。市場通りの南東 */
export const MARKET_HILL = { lx: 6.2, lz: 3.8, r: 3.8, rise: 1.45 } as const;

/** いちば島のローカル座標(中心が原点) */
export function marketLocal(x: number, z: number): { lx: number; lz: number } {
  return { lx: x - MARKET.x, lz: z - MARKET.z };
}

/** ローカル座標を世界座標へ */
export function marketWorld(lx: number, lz: number): { x: number; z: number } {
  return { x: MARKET.x + lx, z: MARKET.z + lz };
}

/**
 * 岸線の半径(中心から見た方向ごと)。
 * だ円のままだと「置いたリング」に見えるので、決定論ノイズで2段のゆらぎを足す
 * (入り江の coveShoreRadius と同じ考え方。種だけ変えて別の形にしてある)。
 */
export function marketShoreRadius(cx: number, cz: number): number {
  const base = 1 / Math.hypot(cx / MARKET.rx, cz / MARKET.rz);
  const wob =
    (vnoise(cx * 2.6 + 133, cz * 2.6 + 87) - 0.5) * 0.3 +
    (vnoise(cx * 6.1 + 47, cz * 6.1 + 151) - 0.5) * 0.13;
  return base * (1 + wob);
}

/** 岸線までの符号つき距離(m)。中が+、海がわが- */
export function marketShoreDist(lx: number, lz: number): number {
  const L = Math.hypot(lx, lz);
  const cx = L < 1e-6 ? 1 : lx / L;
  const cz = L < 1e-6 ? 0 : lz / L;
  return marketShoreRadius(cx, cz) - L;
}

/** いちば島の地面の高さ(ローカル座標)。海面0.3を下回るところが海 */
export function marketHeightLocal(lx: number, lz: number): number {
  const t = marketShoreDist(lx, lz);
  if (t <= 0) return MARKET_SEA_Y + t * MARKET_DROP; // 岸の外: そのまま海底へ下る
  const L = Math.hypot(lx, lz);
  const north = L < 1e-6 ? 0 : Math.max(0, -lz / L); // 1=真北(-z)=浜 / 0=東西・南=岩ばた
  const slope = MARKET_SLOPE_S - (MARKET_SLOPE_S - MARKET_SLOPE_N) * Math.pow(north, 0.75);
  let h = MARKET_SEA_Y + MARKET_RISE * (1 - Math.exp(-(slope * t) / MARKET_RISE));
  // 起伏。波うちぎわでは効かせない(小さな水たまりで歩ける範囲が分断されるのを防ぐ)
  const inland = sstep(Math.max(0, Math.min(1, (t - 0.6) / 4.4)));
  h += (vnoise(lx * 0.19 + 97, lz * 0.19 + 61) - 0.5) * 0.4 * inland;
  h += (vnoise(lx * 0.55 + 23, lz * 0.55 + 5) - 0.5) * 0.12 * inland;
  // 見はらしの丘(南東)
  h += MARKET_HILL.rise * gauss(lx, lz, MARKET_HILL.lx, MARKET_HILL.lz, MARKET_HILL.r);
  // 市場通りは ゆるく平ら(屋台とちょうちんが ならぶ面をつくる)
  const pad = gauss(lx, lz, MARKET_STREET.lx, MARKET_STREET.lz, MARKET_STREET.r);
  h = h * (1 - pad * 0.55) + 1.62 * pad * 0.55;
  return h;
}

/** いちば島のはたらく範囲(この外は島の規則にまかせる)。駅の桟橋の先までふくむ */
export function insideMarketArea(x: number, z: number): boolean {
  const { lx, lz } = marketLocal(x, z);
  return Math.abs(lx) < MARKET.rx + 4 && Math.abs(lz) < MARKET.rz + 6;
}

/** 駅の桟橋のデッキの上か(島の onPier と同じ判定のしかた) */
export function onMarketPier(x: number, z: number): boolean {
  return (
    Math.abs(x - MARKET_PIER.x) < MARKET_PIER.w / 2 + 0.1 &&
    z > MARKET_PIER.z0 - 0.2 &&
    z < MARKET_PIER.z1 + 0.2
  );
}

/** いちば島の接地高さ(範囲の外はnull)。IslandScene.groundY が最優先で見る */
export function marketGroundY(x: number, z: number): number | null {
  if (!insideMarketArea(x, z)) return null;
  if (onMarketPier(x, z)) return MARKET_PIER.y;
  const { lx, lz } = marketLocal(x, z);
  return marketHeightLocal(lx, lz);
}

/** いちば島で歩けるか(高さの規則だけ。コライダーは IslandScene.resolveCollision が足す) */
export function marketWalkable(x: number, z: number): boolean {
  if (!insideMarketArea(x, z)) return false;
  if (onMarketPier(x, z)) return true;
  const { lx, lz } = marketLocal(x, z);
  return marketHeightLocal(lx, lz) >= MARKET_WALK_Y;
}

// ===========================================================================
// いちば島の間どり(純データ。見た目・当たり判定・テストが ここを唯一の情報源にする)
// ===========================================================================
/**
 * でんしゃを降りたときの立ち位置(駅ホームの板の上)。
 * **降車点は かならず 乗車圏の内がわ**(教訓5)。ここは onMarketPier が true なので、
 * canBoardMarketTrain も かならず true になる(tests/unit/market.test.ts が機械検査)。
 */
export const MARKET_SPAWN = { x: MARKET_PIER.x, z: MARKET.z - 7.6 };
/** でんしゃが とまる ホームの先。矢印の目的地と カメラの注視点に つかう */
export const MARKET_TRAIN_POINT = { x: MARKET_PIER.x, z: MARKET.z - 9.6 };
/** ホームの外がわの のりしろ(m)。板から はみ出た 砂でも のれるようにする */
export const MARKET_BOARD_R = 2.6;

/** かえりの でんしゃに のれる場所か(ホームの板の上なら どこでも + のりしろの輪) */
export function canBoardMarketTrain(x: number, z: number): boolean {
  if (onMarketPier(x, z)) return true;
  return Math.hypot(x - MARKET_TRAIN_POINT.x, z - MARKET_TRAIN_POINT.z) < MARKET_BOARD_R;
}

/** でんしゃの車体を 置く場所(ホームの西どなりの海の上)。z は 車りょうの まん中 */
export const MARKET_TRAIN_POSE = { x: MARKET_PIER.x - 3.3, z: MARKET.z - 7.8 };

/**
 * 屋台(4つ)。lx/lz はローカル、rotY は「通りのほうを向く」向き。
 * 通りは lx ≈ -1.65 を まん中に 南北へ のびる。屋台は 東西に 2つずつ ならぶので、
 * あいだの通り道は 3.2m(当たり判定のふちどうしで 3.2 - 0 = 3.2m)ひらいている
 * = 体半径0.3を 引いても 2.6m あり、袋小路にならない。
 */
export const MARKET_STALLS: { lx: number; lz: number; rotY: number; kind: 'cloth' | 'fruit' | 'lamp' | 'pot' }[] = [
  { lx: 0.9, lz: -1.8, rotY: -Math.PI / 2, kind: 'cloth' }, // テンの店(駅から いちばん近い)
  { lx: -4.2, lz: -0.6, rotY: Math.PI / 2, kind: 'fruit' },
  { lx: 0.9, lz: 2.6, rotY: -Math.PI / 2, kind: 'lamp' },
  { lx: -4.2, lz: 3.4, rotY: Math.PI / 2, kind: 'pot' },
];
/** 屋台の当たり判定の半径(見た目の 1.7m×1.2m を おおう円) */
export const MARKET_STALL_R = 0.95;

/**
 * ちょうちんを つるす柱(通りの南北のはし。ここに ひもを わたす)。
 *
 * 東がわの柱は **屋台と同じ lx=0.9 の線にそろえてある**。
 * lx=0.1(通りのふち)に置いたときは、柱の判定と 屋台の判定の あいだに
 * **1マスだけの すきま**ができて 連結成分が2つになった(実測: local(0.4,-3.0) が孤立)。
 * 同じ線にそろえると 2つの判定がかさなり、すきまが 原理的に できない(教訓5)。
 */
export const MARKET_POLES: [number, number][] = [
  [-3.4, -3.4], [0.9, -3.4], [-3.4, 4.6], [0.9, 4.6],
];
/** 柱の当たり判定の半径 */
export const MARKET_POLE_R = 0.12;

/** テンの店のカウンター(世界座標)。ここで E を おすと 週がわりの店がひらく */
export const MARKET_SHOP_POINT = marketWorld(-0.8, -1.8);
/** カウンターの E がとどく距離。ツムギ工房(2.0m)より すこし せまい */
export const MARKET_SHOP_R = 1.7;

/** 見はらしの丘の ベンチ(世界座標と 背もたれの向き)。すわると 海と いちばが 見える */
export const MARKET_BENCH: [number, number, number] = [MARKET.x + 7.0, MARKET.z + 1.0, -2.356];

/** いちば島の当たり判定(世界座標)。IslandScene.circles へ足す */
export const MARKET_CIRCLES: { x: number; z: number; r: number }[] = [
  ...MARKET_STALLS.map((s) => ({ ...marketWorld(s.lx, s.lz), r: MARKET_STALL_R })),
  ...MARKET_POLES.map(([lx, lz]) => ({ ...marketWorld(lx, lz), r: MARKET_POLE_R })),
];

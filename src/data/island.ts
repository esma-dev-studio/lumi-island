// 島のレイアウトデータ(座標系: x=東+, z=南+, y=高さ)。ロジックに埋め込まず全部ここで管理。
export interface POI {
  id: string;
  name: string;
  x: number;
  z: number;
  rotY?: number;
}

// 主要地点
export const POIS: Record<string, POI> = {
  plaza: { id: 'plaza', name: 'ひろば', x: 0, z: 0 },
  lumiTree: { id: 'lumiTree', name: 'ルミの木', x: 0, z: -7 },
  playerHouse: { id: 'playerHouse', name: 'ミオの家', x: -34, z: 6, rotY: Math.PI / 2.3 },
  minamoHouse: { id: 'minamoHouse', name: 'ミナモの小屋', x: 33, z: 14, rotY: -Math.PI / 2.2 },
  noktoHouse: { id: 'noktoHouse', name: 'ノクトの家', x: 24, z: -30, rotY: Math.PI + 0.5 },
  shop: { id: 'shop', name: 'ツムギ工房', x: -9, z: -1, rotY: Math.PI / 2 },
  pier: { id: 'pier', name: 'さんばし', x: 4, z: 48 },
  pond: { id: 'pond', name: '池', x: 30, z: 20 },
  hill: { id: 'hill', name: '高台', x: 28, z: -27 },
  beach: { id: 'beach', name: '浜べ', x: -6, z: 42 },
  meadow: { id: 'meadow', name: '草原', x: -22, z: 10 },
  forest: { id: 'forest', name: '林', x: -2, z: -32 },
  bed: { id: 'bed', name: 'おうちのベッド', x: -30.9, z: 6.7 }, // ミオの家のドア前(ねる場所)
};

// 建物の入口(家具で塞げない)
// 建物のPOI座標とrotY(向き)から求めたドア前の立ち位置。NPCの出入りと就寝導線を守るため配置禁止。
export const ENTRANCES: { x: number; z: number }[] = [
  { x: -30.9, z: 6.7 }, // ミオの家のドア前(POIS.bedと同じ)
  { x: 29.7, z: 14.5 }, // ミナモの小屋のドア前
  { x: 22.3, z: -33.1 }, // ノクトの家のドア前
  { x: -4.6, z: 0.6 }, // ツムギ工房のカウンター前
];

// 道(ポリライン)。地形の頂点色と平滑化に使う
export const PATHS: [number, number][][] = [
  [[0, 3], [0, 20], [-2, 32], [-4, 42], [4, 47]], // 広場→浜→桟橋
  [[-4, 1], [-14, 3], [-24, 5], [-32, 6]], // 広場→ミオ家
  [[3, 1], [14, 6], [24, 10], [30, 13]], // 広場→池・ミナモ小屋
  [[2, -4], [10, -12], [17, -20], [22, -26], [25.4, -25.7], [27.6, -25.3]], // 広場→高台・ノクト家→観測スペースへの坂道
  [[-2, -4], [-4, -16], [-3, -26]], // 広場→林
  [[-4, -1], [-7, -1]], // 広場→工房前
];

// 池(中心+半径)と池の水面高さ
export const POND = { x: 30, z: 20, r: 9, waterY: 0.42 };
export const SEA_LEVEL = 0.0;

// 建物フットプリント(地形平滑化に使用)
export const BUILDINGS = [
  { id: 'playerHouse', w: 7, d: 6.4, kind: 'player' },
  { id: 'minamoHouse', w: 5.6, d: 5.2, kind: 'minamo' },
  { id: 'noktoHouse', w: 5.8, d: 5.6, kind: 'nokto' },
  { id: 'shop', w: 8.2, d: 6.8, kind: 'shop' },
] as const;

// 採取ノード(リスポーンあり)
export type NodeKind = 'tree' | 'berry' | 'rock' | 'ore' | 'grass' | 'moss';
export interface GatherNodeDef {
  id: string;
  kind: NodeKind;
  x: number;
  z: number;
}
const N = (kind: NodeKind, x: number, z: number, i: number): GatherNodeDef => ({
  id: `${kind}${i}`, kind, x, z,
});
export const GATHER_NODES: GatherNodeDef[] = [
  // 林の木(木材)
  N('tree', -8, -26, 1), N('tree', 2, -30, 2), N('tree', 8, -25, 3), N('tree', -12, -33, 4),
  N('tree', 4, -38, 5), N('tree', -4, -40, 6), N('tree', 12, -33, 7), N('tree', -16, -25, 8),
  // 草原・そのほかの木
  N('tree', -26, 14, 9), N('tree', -20, -6, 10), N('tree', 20, 26, 11), N('tree', -30, -4, 12),
  // ベリーの木
  N('berry', -20, 16, 1), N('berry', -14, 22, 2), N('berry', 6, -20, 3), N('berry', -26, -12, 4),
  N('berry', 16, 18, 5), N('berry', -34, 14, 6),
  // 岩(石)
  N('rock', 14, -14, 1), N('rock', -18, -18, 2), N('rock', 22, 4, 3), N('rock', -28, 20, 4),
  N('rock', 10, 30, 5), N('rock', -12, 36, 6), N('rock', 36, -18, 7), N('rock', -38, -2, 8),
  // 鉱石(高台の露頭)
  N('ore', 32, -24, 1), N('ore', 27, -34, 2), N('ore', 35, -30, 3), N('ore', 30, -21, 4),
  // 草むら(クサツル)
  N('grass', -16, 10, 1), N('grass', -24, 2, 2), N('grass', 12, 14, 3), N('grass', -8, 24, 4),
  N('grass', 18, -6, 5), N('grass', -30, 12, 6), N('grass', 21, 12, 7), N('grass', -22, 26, 8), // grass7は池の西岸(新しい岸線の外)
  N('grass', 8, 6, 9), N('grass', -12, -10, 10), N('grass', 34, 6, 11), N('grass', -36, 10, 12),
  // ヒカリゴケ(林・岩かげ、夜に光る)
  N('moss', -6, -35, 1), N('moss', 6, -33, 2), N('moss', -14, -29, 3), N('moss', 10, -28, 4),
  N('moss', 25, -31, 5), N('moss', -20, -22, 6), N('moss', 33, -27, 7), N('moss', -2, -24, 8),
];

// 装飾の木・やぶ(採取不可のにぎやかし)
export const DECO_TREES: [number, number, number][] = [
  // [x, z, スケール]
  [-14, -38, 1.1], [16, -38, 0.9], [-22, -34, 1.2], [20, -30, 1.0], [-8, -44, 0.95],
  [8, -44, 1.15], [-28, -26, 0.9], [-40, 6, 1.0], [-38, 16, 0.85], [40, -12, 0.9],
  [38, 2, 1.05], [23.5, 33.5, 0.9], [14, 34, 0.85], [-30, 28, 0.95], [-42, -8, 0.8], // (26,30)は池の入り江の中になったため南へ
  [34, -38, 0.85], [-34, -18, 1.0], [44, -22, 0.75], [-16, 40, 0.8], [22, 38, 0.75],
  // 林を密に
  [-6, -30, 1.05], [10, -30, 0.95], [0, -42, 1.1], [-18, -36, 0.9], [14, -42, 0.95],
  // 林の高低差・密度をさらに(高い木と低い若木をまぜる)
  [-10, -40, 1.32], [9, -37, 0.72], [-19, -31, 1.24], [13, -26, 0.78], [3, -33, 1.15], [-9, -29, 0.68],
];

export const SPAWN = { x: -3, z: 6, rotY: Math.PI };

// NPCのスケジュール用スポット
// 注意: スポットは必ず建物コライダーの外に置く(中に置くとNPCが到達できない)
// wanderR: その場のうろうろ半径(省略時2.2m)。壁ぎわ・水ぎわのスポットで絞る
export const NPC_SPOTS: Record<string, Record<string, { x: number; z: number; rotY?: number; wanderR?: number }>> = {
  minamo: {
    home: { x: 29.7, z: 14.5, rotY: 1.6 }, // 小屋のドア前(西向きの入口)
    // 西岸の水ぎわ(旧26.5,17.5は水中だった)。会話も乾いた岸で成立する
    pond: { x: 23.6, z: 14.6, rotY: -2.27 },
    pier: { x: 4, z: 49.5, rotY: Math.PI },
    plaza: { x: 3, z: 2 },
  },
  nokto: {
    home: { x: 22.3, z: -33.1, rotY: -0.5 }, // 家のドア前
    // 観測スペース(28,-25.5)の上。鉱石帯(32,-24 / 30,-21)から4m以上離す
    // (近いと採取のEを会話が横取りする=399秒問題)。北の見晴らしを背に立つ
    hill: { x: 27.4, z: -25.0, rotY: 0.15, wanderR: 1.2 }, // うろうろを絞り、家の無地の壁ぎわへ寄らない
    tree: { x: 1.5, z: -5.5 },
    forest: { x: -2, z: -30 },
  },
  tsumugi: {
    // 軒先から1.3mほど出た位置(旧-4.6,0.6は軒下で、会話クローズアップに屋根がかぶる)
    shop: { x: -3.9, z: 1.4, rotY: -1.9 },
    bench: { x: 2.1, z: -1.5, rotY: -1.2 }, // ベンチのわき
    plaza: { x: -2, z: 3 },
    lumi: { x: -1.5, z: -5.5 },
  },
};

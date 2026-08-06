// キャラクター設定: モデルパス・縮尺・アニメ名はここで一元管理(ロジックに埋め込まない)
export interface CharacterDef {
  id: string;
  name: string; // 表示名
  species: string;
  path: string; // GLBパス
  scale: number;
  yOffset: number;
  walkSpeed: number; // m/s (walkアニメと同期する基準速度)
  runSpeed: number;
  animNames: readonly string[];
}

export const ANIMS = [
  'idle', 'walk', 'run', 'talk', 'interact', 'pickup', 'happy', 'surprised', 'blink', 'fish_idle',
] as const;
export type AnimName = (typeof ANIMS)[number];

export const CHARACTERS: Record<string, CharacterDef> = {
  mio: {
    id: 'mio', name: 'ミオ', species: '人間の子', path: 'assets/characters/mio.glb',
    scale: 1, yOffset: 0, walkSpeed: 1.7, runSpeed: 3.6, animNames: ANIMS,
  },
  minamo: {
    id: 'minamo', name: 'ミナモ', species: 'カワウソ', path: 'assets/characters/minamo.glb',
    scale: 1, yOffset: 0, walkSpeed: 1.45, runSpeed: 3.0, animNames: ANIMS,
  },
  nokto: {
    id: 'nokto', name: 'ノクト', species: 'フクロウ', path: 'assets/characters/nokto.glb',
    scale: 1, yOffset: 0, walkSpeed: 1.35, runSpeed: 2.8, animNames: ANIMS,
  },
  tsumugi: {
    id: 'tsumugi', name: 'ツムギ', species: 'ヤギ', path: 'assets/characters/tsumugi.glb',
    scale: 1, yOffset: 0, walkSpeed: 1.6, runSpeed: 3.2, animNames: ANIMS,
  },
  // v11第2章 ロカ(ペンギン)。よちよち歩きなので いちばん おそい
  roka: {
    id: 'roka', name: 'ロカ', species: 'ペンギン', path: 'assets/characters/roka.glb',
    scale: 1, yOffset: 0, walkSpeed: 1.2, runSpeed: 2.4, animNames: ANIMS,
  },
};

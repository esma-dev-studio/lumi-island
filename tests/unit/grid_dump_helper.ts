// 「見た目だけの変更である」ことの証拠になる、判定の格子ダンプ。
//
// v13.1 の pond_water_edge.test.ts と同じ考え方を、島ぜんたい・海ぜんたいへ広げたもの。
// 歩ける/水/接地高さ/釣りのゾーンを 0.5m きざみで走査して1本の文字列にする。
// 見た目(頂点カラー・帯・粒)を足しても この文字列は 1バイトも変わらない
// —— 変わったら、それは判定に手が入ったということ。
//
// ここが読むのは **純関数だけ**(Babylon も DOM も要らない)ので、
// vitest で数秒で回り、ブラウザを立ち上げずに before/after を比べられる。
import { coveWalkable, terrainHeight, walkableGround, waterBodyAt } from '../../src/entities/terrain';
import { marketWalkable } from '../../src/entities/marketTerrain';
import { findCastPoint, fishingGate } from '../../src/systems/FishingCast';

/** 島ぜんたい(セーブのクランプ±70の内がわ)を 0.5m きざみで */
const HALF = 70;
const STEP = 0.5;
/** 釣りの判定は 池と桟橋のまわりだけを こまかく(findCastPoint は重いので範囲をしぼる) */
const FISH = { x0: -6, x1: 46, z0: 4, z1: 56, step: 0.5 };

export interface GridDump {
  text: string;
  counts: Record<string, number>;
}

/** 判定の格子ダンプ(before/after でバイト一致することを確かめるための文字列) */
export function buildGridDump(): GridDump {
  const lines: string[] = [];
  const counts: Record<string, number> = {
    walkable: 0, pond: 0, sea: 0, cove: 0, market: 0, fishPond: 0, fishSea: 0, castable: 0,
  };
  lines.push(`# walk grid half=${HALF} step=${STEP}`);
  for (let z = -HALF; z <= HALF + 1e-9; z += STEP) {
    const row: string[] = [];
    for (let x = -HALF; x <= HALF + 1e-9; x += STEP) {
      const w = walkableGround(x, z);
      const b = waterBodyAt(x, z);
      const cv = coveWalkable(x, z);
      const mk = marketWalkable(x, z);
      if (w) counts.walkable++;
      if (b === 'pond') counts.pond++;
      if (b === 'sea') counts.sea++;
      if (cv) counts.cove++;
      if (mk) counts.market++;
      // 高さは 0.1mm きざみの整数にして、浮動小数の表示ゆれを消す
      const h = Math.round(terrainHeight(x, z) * 10000);
      row.push(`${w ? 1 : 0}${b === 'pond' ? 'p' : b === 'sea' ? 's' : '-'}${cv ? 1 : 0}${mk ? 1 : 0}:${h}`);
    }
    lines.push(row.join(','));
  }
  lines.push(`# fish grid ${JSON.stringify(FISH)}`);
  for (let z = FISH.z0; z <= FISH.z1 + 1e-9; z += FISH.step) {
    const row: string[] = [];
    for (let x = FISH.x0; x <= FISH.x1 + 1e-9; x += FISH.step) {
      const gate = fishingGate(x, z);
      let cell = '-';
      if (gate) {
        const cast = findCastPoint(x, z, { anyMatch: true, zone: gate });
        if (gate === 'pond') counts.fishPond++;
        else counts.fishSea++;
        if (cast) counts.castable++;
        cell = `${gate[0]}${cast ? 1 : 0}`;
      }
      row.push(cell);
    }
    lines.push(row.join(''));
  }
  lines.push(`# counts ${JSON.stringify(counts)}`);
  return { text: lines.join('\n'), counts };
}

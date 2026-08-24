// カメラ遮蔽: カメラとプレイヤーの間に入った物を半透明にし、外れたら元に戻す。
// 会話・見せ場の前には即時復元して、主役が透けたまま始まらないようにする。
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { IslandScene } from './IslandScene';
import type { CameraController } from './CameraController';
import type { PlayerController } from '../systems/PlayerController';

// ---------------------------------------------------------------------------
// v26 「緑のベタ膜」をやめる。
//
// 実測(tools/shots_world_v26.mjs / 写真41・29 と同じ構図):
//   にわ    … 半透明にされたのは 木 1本だけ。なのに その1本の外わくが **画面の100%** をおおい、
//              透けぐあい0.35 の緑が 画面ぜんたいに かかっていた(膜の強さ 0.35)
//   夜の池  … 同じく 木1本で 画面の82%(膜の強さ 0.287)
//   林の中  … 木1本で 画面の22%(膜の強さ 0.076)
// つまり **「対象が多すぎる」のではなく「1枚が 大きすぎて 濃すぎる」**。
// 対象をしぼる(候補を減らす)方向では 何も直らない——どの場面でも
// 半透明にされていたのは「本当に プレイヤーの前に立っている 1本」だった。
//
// なおしかた: **透けぐあいを 画面の ふさぎぐあいで 決める**。
//   画面を まるごと ふさぐ 葉群 → 0.12(ほとんど かすみ。景色が そのまま 読める)
//   小さな遮蔽物(ベンチ・灯り・岩) → 0.34(これまでどおり。形が消えると 物が
//                                        「消えた」ように 見えて かえって おかしい)
// ふさぎぐあいは「外わくの半径 ÷ カメラからの距離」で見る(=見かけの角の大きさ)。
// 射影しなくても 1回の割り算で 求まるので、15Hzの判定に そのまま のる。
// ---------------------------------------------------------------------------
/** 小さな遮蔽物の 透けぐあいの下限(形が読めるていどに残す) */
const FADE_SMALL = 0.34;
/** 画面を まるごと ふさぐ 大きな葉群・屋根の 透けぐあいの下限 */
const FADE_HUGE = 0.12;
/** 見かけの角の大きさ(外わく半径 ÷ 距離)。この間で FADE_SMALL → FADE_HUGE へ移る */
const HUGE_K0 = 0.3;
const HUGE_K1 = 0.78;
/**
 * 下限まで かかる時間(秒)。深さが変わっても 同じ時間で とどくように、
 * 1歩の幅を (1 - 下限) から 割り出す(深いフェードだけ もたつく、が起きない)。
 */
const FADE_STEPS = 5.5;
/** 元にもどる1歩(15Hzごと)。かかりは はやく・もどりは ゆっくり(しっとり側に寄せる) */
const RECOVER_STEP = 0.1;

/**
 * その遮蔽物を どこまで透かすか(0..1。小さいほど 透ける)。
 * @param radiusWorld 外わく(境界球)の半径 m
 * @param dc          カメラから 外わくの中心までの距離 m
 */
export function fadeFloor(radiusWorld: number, dc: number): number {
  const k = radiusWorld / Math.max(0.4, dc);
  const t = Math.max(0, Math.min(1, (k - HUGE_K0) / (HUGE_K1 - HUGE_K0)));
  const s = t * t * (3 - 2 * t); // なめらかに(しきい値で かくかく 変わらない)
  return FADE_SMALL + (FADE_HUGE - FADE_SMALL) * s;
}

export class OcclusionController {
  private faded = new Set<Mesh>();
  private recovering = new Set<Mesh>();
  private occScratch = new Set<Mesh>(); // 15Hzごとのnew Setを避ける
  /** 今回のフレームで決めた「そのメッシュの下限」。ループを2回まわさないための入れもの */
  private floorOf = new Map<Mesh, number>();

  constructor(
    private island: IslandScene,
    private player: PlayerController,
    private camCtl: CameraController
  ) {}

  /** 透明化中・回復途中のメッシュを即座に全復元する(会話・イベントカメラ開始前に呼ぶ) */
  restoreAllImmediately(): void {
    for (const m of this.faded) m.visibility = 1;
    for (const m of this.recovering) m.visibility = 1;
    this.faded.clear();
    this.recovering.clear();
    this.floorOf.clear();
  }

  /** いま半透明にしているメッシュ(検証・撮影用。読むだけで副作用はない) */
  get fadedList(): { name: string; visibility: number; floor: number }[] {
    const out: { name: string; visibility: number; floor: number }[] = [];
    for (const m of this.faded) {
      out.push({ name: m.name, visibility: m.visibility, floor: this.floorOf.get(m) ?? FADE_SMALL });
    }
    return out;
  }

  update(): void {
    const p = this.player;
    const c = this.camCtl.cam.position;
    const dx = p.x - c.x, dy = p.y + 0.8 - c.y, dz = p.z - c.z;
    const L = Math.hypot(dx, dy, dz);
    const nowFaded = this.occScratch;
    nowFaded.clear();
    this.floorOf.clear();
    // 画面に写っていないメッシュは 透かす意味がない(カメラを ふり向けた先が
    // 最初から うすくなっている、が起きる)。frustumPlanes は 1フレームめだけ
    // まだ無いことがあるので、そのときは これまでどおり 全部を見る
    const planes = this.island.scene.frustumPlanes ?? null;
    for (const m of this.island.occludables) {
      const b = m.getBoundingInfo().boundingSphere;
      const cw = b.centerWorld;
      const dc = Math.hypot(cw.x - c.x, cw.y - c.y, cw.z - c.z);
      const inside = dc < b.radiusWorld * 0.95;
      let blocks = inside;
      if (!inside) {
        const t = Math.max(0.05, Math.min(0.95, ((cw.x - c.x) * dx + (cw.y - c.y) * dy + (cw.z - c.z) * dz) / (L * L)));
        const qx = c.x + dx * t, qy = c.y + dy * t, qz = c.z + dz * t;
        const d = Math.hypot(cw.x - qx, cw.y - qy, cw.z - qz);
        blocks = d < b.radiusWorld * 0.72 && t < 0.93;
      }
      if (!blocks) continue;
      if (planes && !m.isInFrustum(planes)) continue;
      nowFaded.add(m);
      this.floorOf.set(m, fadeFloor(b.radiusWorld, dc));
    }
    for (const m of nowFaded) {
      const floor = this.floorOf.get(m) ?? FADE_SMALL;
      // 深いフェードほど 1歩を大きくして、下限に とどくまでの時間を そろえる
      const step = (1 - floor) / FADE_STEPS;
      if (m.visibility > floor) m.visibility = Math.max(floor, m.visibility - step);
      else if (m.visibility < floor) m.visibility = Math.min(floor, m.visibility + step);
      this.recovering.delete(m);
    }
    // 対象から外れたメッシュは、完全に戻りきるまで回復を続ける(途中で0.98等のまま残さない)
    for (const m of this.faded) {
      if (!nowFaded.has(m)) this.recovering.add(m);
    }
    for (const m of this.recovering) {
      m.visibility = Math.min(1, m.visibility + RECOVER_STEP);
      if (m.visibility >= 1) this.recovering.delete(m);
    }
    this.occScratch = this.faded; // 前回セットを次回のスクラッチとして再利用
    this.faded = nowFaded;
  }
}

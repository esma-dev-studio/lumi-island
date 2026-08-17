// 目的地の誘導: 画面端の方向矢印+距離 / 目的地の光の柱 / NPC頭上マーカー(!・報告)
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
// 型だけを借りる(実体は cam.viewport.toGlobal から1回だけもらう)。
// @babylonjs/core の値としてのimportを1本足すだけで Vite の依存プリバンドルの割りかたが変わり、
// Engine のプロトタイプ拡張(createDynamicTexture 等)が別インスタンスに乗って
// 起動ごと落ちることがある——実際にこの1行で「boot failed」になった。
import type { Viewport } from '@babylonjs/core/Maths/math.viewport';
import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import { terrainHeight } from '../entities/terrain';

export interface MarkerNpc {
  id: string;
  x: number;
  y: number;
  z: number;
  kind: 'target' | 'report';
}

const AMBER = '#e8c890';

/**
 * 方向矢印+距離を消す距離(m)。「もう手がとどく」ところまでは必ず出しつづける。
 * 島でいちばん狭い操作圏(採取1.9m / NPC会話1.8m / ベッド・ドア1.4m)より大きい値にして、
 * 「矢印が消えた=Eのヒントが出ているはず」が成り立つようにしてある
 * (tests/unit/guidance.test.ts が ObjectiveHud の距離表示ともども機械検査する)。
 */
export const ARROW_ARRIVE_R = 2.6;

export class WorldMarkerController {
  private arrowEl: HTMLElement;
  private arrowSvg!: HTMLElement; // 毎フレームの querySelector を避けるため作った直後に保持する
  private arrowDist!: HTMLElement;
  private npcEls = new Map<string, HTMLElement>();
  private npcLast = new Map<string, { x: number; y: number; text: string }>();
  private arrowLast = { x: 0, y: 0, deg: 0, dist: -1 };
  private beacon: Mesh;
  private beaconMat: StandardMaterial;
  private tmp = new Vector3();
  private idMatrix = Matrix.Identity();
  /** 使いまわしの射影結果とビューポート(毎フレームのnewを作らない。実体は初回に1個だけ作る) */
  private projected = new Vector3();
  private vp: Viewport | null = null;

  /**
   * @param heightAt 目的地の足もとの高さ。省略すると島の地形の高さ。
   *   v11第2章で入り江の目的地(灯台・帰りの桟橋)にも矢印と光の柱を出すようになったので、
   *   別空間の床を知っている関数(IslandScene.groundY)を渡せるようにした。
   *   島の上では従来どおり terrainHeight と同じ値になる(桟橋・観測デッキの上だけ床の高さ)。
   */
  constructor(private scene: Scene, private heightAt: (x: number, z: number) => number = terrainHeight) {
    this.arrowEl = document.createElement('div');
    this.arrowEl.className = 'dir-arrow hidden';
    this.arrowEl.innerHTML = `<svg viewBox="0 0 24 24" width="26" height="26"><path d="M12 2 L19 16 L12 12.5 L5 16 Z" fill="currentColor"/></svg><span class="dir-dist"></span>`;
    document.getElementById('ui-root')!.appendChild(this.arrowEl);
    this.arrowSvg = this.arrowEl.querySelector('svg') as unknown as HTMLElement;
    this.arrowDist = this.arrowEl.querySelector('.dir-dist') as HTMLElement;

    // 目的地の光の柱(控えめ)
    this.beacon = CreateCylinder('beacon', { height: 5.5, diameterTop: 1.15, diameterBottom: 0.55, tessellation: 12 }, scene);
    this.beaconMat = new StandardMaterial('beaconMat', scene);
    this.beaconMat.emissiveColor = Color3.FromHexString(AMBER);
    this.beaconMat.diffuseColor = Color3.Black();
    this.beaconMat.alpha = 0.16;
    this.beaconMat.disableLighting = true;
    this.beacon.material = this.beaconMat;
    this.beacon.isPickable = false;
    this.beacon.setEnabled(false);
  }

  private npcEl(id: string): HTMLElement {
    let el = this.npcEls.get(id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'npc-marker hidden';
      document.getElementById('ui-root')!.appendChild(el);
      this.npcEls.set(id, el);
    }
    return el;
  }

  /**
   * world→screen(CSSピクセル)。画面内ならtrue。
   *
   * 毎フレーム最大4回(目的地1+NPC3)呼ばれるので、新しいオブジェクトを1つも作らない:
   * ・Vector3.Project は結果の Vector3 を毎回 new するので ProjectToRef を使う
   * ・cam.viewport.toGlobal(w, h) も毎回 Viewport を new するので、使いまわしの1個へ書く
   * (CPUプロファイルで自己時間4.3%の上位に出ていた)
   */
  private project(x: number, y: number, z: number, out: { sx: number; sy: number; behind: boolean }): boolean {
    const engine = this.scene.getEngine();
    const w = engine.getRenderWidth();
    const h = engine.getRenderHeight();
    this.tmp.set(x, y, z);
    const cam = this.scene.activeCamera as Camera;
    // Viewport の実体は初回だけ作り、以後は同じ入れものへ書きなおす
    if (!this.vp) this.vp = cam.viewport.toGlobal(w, h);
    else cam.viewport.toGlobalToRef(w, h, this.vp);
    const p = this.projected;
    Vector3.ProjectToRef(this.tmp, this.idMatrix, this.scene.getTransformMatrix(), this.vp, p);
    out.sx = (p.x / w) * window.innerWidth;
    out.sy = (p.y / h) * window.innerHeight;
    out.behind = p.z > 1 || p.z < 0;
    return !out.behind && p.x >= 0 && p.x <= w && p.y >= 0 && p.y <= h;
  }

  /** 値が変わったときだけ style を書く(毎フレームの書きこみはレイアウト再計算を呼ぶ) */
  private place(el: HTMLElement, last: { x: number; y: number }, x: number, y: number): void {
    if (last.x !== x) {
      last.x = x;
      el.style.left = `${x}px`;
    }
    if (last.y !== y) {
      last.y = y;
      el.style.top = `${y}px`;
    }
  }

  private proj = { sx: 0, sy: 0, behind: false };

  /** 会話・達成バナー・見せ場の最中: 誘導(矢印・光の柱・頭上マーカー)をすべて消す */
  hideAll(): void {
    this.beacon.setEnabled(false);
    this.arrowEl.classList.add('hidden');
    for (const el of this.npcEls.values()) el.classList.add('hidden');
  }

  update(
    targetPos: { x: number; z: number } | null,
    targetIsNpc: boolean,
    playerX: number,
    playerZ: number,
    npcMarkers: MarkerNpc[],
    reportMode: boolean
  ): void {
    // 足もとの高さ(heightAt)は光の柱と矢印で同じ値を使う。
    // 中身は「入り江→部屋→NPCの家→桟橋→デッキ→地形」の6段をたどる関数なので、
    // 1フレームに2回呼ばない(目的地が無いフレームは1回も呼ばない)
    const dist = targetPos ? Math.hypot(playerX - targetPos.x, playerZ - targetPos.z) : 0;
    const groundY = targetPos ? this.heightAt(targetPos.x, targetPos.z) : 0;

    // ---- 光の柱(固定目的地のみ) ----
    if (targetPos && !targetIsNpc) {
      if (dist > 7) {
        this.beacon.setEnabled(true);
        this.beacon.position.set(targetPos.x, groundY + 2.6, targetPos.z);
        this.beaconMat.alpha = 0.1 + Math.min(0.1, (dist - 7) * 0.004);
      } else {
        this.beacon.setEnabled(false);
      }
    } else {
      this.beacon.setEnabled(false);
    }

    // ---- 方向矢印 ----
    if (targetPos) {
      const y = groundY + (targetIsNpc ? 1.2 : 1.5);
      this.project(targetPos.x, y, targetPos.z, this.proj);
      // v11: 「目的地が画面に入ったら矢印を消す」のをやめ、手がとどく距離(ARROW_ARRIVE_R)まで出しつづける。
      // 画面に入っていても、林の木も岩も見た目はどれも同じで「どれ?」は分からない。
      // 実害: 誘導が消えた3〜15mの帯で行き先を見失い、目的地のまわりを行ったり来たりする
      //   (UXボットの停滞ログ: v10「もくざい 0/5 →15m 63秒」「いし 0/1 63秒」、
      //    v10.1「ヒカリゴケ 0/2 →3m 62秒」「もくざい 2/5 →3m 64秒」。
      //    どれも「目的地に着いたのに採取のヒントが出ない」→ 周回、が同じ形で出ている)。
      // 画面内では矢印は目的地の上に重なる=「ここだよ」の目印になり、距離も読める。
      // 消えるのは「もうEで届く」ときだけなので、誘導が切れる空白が構造的に無くなる。
      if (dist < ARROW_ARRIVE_R) {
        this.arrowEl.classList.add('hidden');
      } else {
        // 画面外なら画面端へクランプ、画面内ならその場所に重ねて方向を示す
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        let dx = this.proj.sx - cx;
        let dy = this.proj.sy - cy;
        if (this.proj.behind) {
          dx = -dx;
          dy = -dy;
        }
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) dy = -1;
        const margin = 56;
        const kk = 1 / Math.max(Math.abs(dx) / (cx - margin), Math.abs(dy) / (cy - margin));
        const ex = cx + dx * Math.min(1, kk);
        const ey = cy + dy * Math.min(1, kk);
        const ang = Math.round((Math.atan2(dy, dx) * 180) / Math.PI + 90);
        const m = Math.round(dist);
        this.arrowEl.classList.remove('hidden');
        // 変わった値だけ書く(毎フレームの style / textContent 書きこみはレイアウトを呼ぶ)
        this.place(this.arrowEl, this.arrowLast, Math.round(ex), Math.round(ey));
        if (this.arrowLast.deg !== ang) {
          this.arrowLast.deg = ang;
          this.arrowSvg.style.transform = `rotate(${ang}deg)`;
        }
        if (this.arrowLast.dist !== m) {
          this.arrowLast.dist = m;
          this.arrowDist.textContent = `${m}m`;
        }
        this.arrowEl.classList.toggle('report', reportMode);
      }
    } else {
      this.arrowEl.classList.add('hidden');
    }

    // ---- NPC頭上マーカー ----
    const seen = new Set<string>();
    for (const m of npcMarkers.slice(0, 3)) {
      seen.add(m.id);
      const el = this.npcEl(m.id);
      const on = this.project(m.x, m.y + 1.45, m.z, this.proj);
      if (!on) {
        el.classList.add('hidden');
        continue;
      }
      el.classList.remove('hidden');
      el.classList.toggle('report', m.kind === 'report');
      let last = this.npcLast.get(m.id);
      if (!last) {
        last = { x: NaN, y: NaN, text: '' };
        this.npcLast.set(m.id, last);
      }
      const text = m.kind === 'report' ? '✓' : '!';
      if (last.text !== text) {
        last.text = text;
        el.textContent = text;
      }
      this.place(el, last, Math.round(this.proj.sx), Math.round(this.proj.sy));
    }
    for (const [id, el] of this.npcEls) {
      if (!seen.has(id)) el.classList.add('hidden');
    }
  }
}

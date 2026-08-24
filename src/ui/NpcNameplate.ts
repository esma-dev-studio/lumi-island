// v26 NPCの 頭の上に ふわっと出る 小さな名札。
//
// なにを解くか:
//   近づいた子は「この子だれ?」を 会話をひらくまで 知りようがなかった。
//   名前は 会話ボックスの見出しにしか 出ておらず、島を歩いているあいだは
//   だれが だれだか 分からない(UI総ざらいの 写真40)。
//   **名前をおぼえる装置**として、手のとどく距離まで 近づいたときだけ そっと出す。
//
// 主張しすぎないための決めごと:
//   ・出るのは 4mまで(会話の1.8mより外・ヒントの出る前から 顔と名前が むすびつく)
//   ・透明度 0.9・フェード0.25秒(CSSのopacityだけ。ちかちかしない)
//   ・**会話中・見せ場中・パネルを開いているあいだ・まつりの輪 では出さない**
//     (まつりは5人が1.7mの輪に立つので、名札が5枚 かさなって おまつりの絵をこわす)
//   ・立ち話の ふきだしを 出している人にも 出さない(ふきだしと 場所が かさなる)
//
// つくりは 立ち話の ふきだし(ChatBubbleUI)と まったく同じ world→screen の射影。
// クラス名は `.npc-nameplate` で、頭上の「!」(`.npc-marker`)とは 別の要素にしてある
// ——UXボットは `.npc-marker` を 読んで 誘導の判定に使っているので、
//   そこへ 名札が まざると ボットの画面読みが くるう。
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import type { Viewport } from '@babylonjs/core/Maths/math.viewport';
import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';

/** 名札が出はじめる距離(m)。会話のとどく距離(1.8m)より そとから 出す */
export const NAMEPLATE_R = 4.0;
/**
 * 名札が消える距離(m)。出はじめより ひとまわり 大きい(ヒステリシス)。
 * 4.0mちょうどを 行ったり来たりすると 名札が ちかちか 点滅するため。
 */
export const NAMEPLATE_R_OUT = 4.35;
/** 頭の上 これだけ上に出す(m)。ふきだし(1.62m)・「!」(1.45m)より 上 */
export const NAMEPLATE_Y = 1.9;
/** 同時に出す 上限(まいすう)。近い順 */
export const NAMEPLATE_MAX = 3;

/** 名札のもとになる1人ぶん(NPCSystem.nameplateSources が作る) */
export interface NameplateSource {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  /** ほしまつりの輪に 立っているか(輪のあいだは 名札を出さない) */
  inFestivalRing: boolean;
}

/** 名札を出す・出さないを決める まわりの ようす */
export interface NameplateContext {
  px: number;
  pz: number;
  /** 会話中・見せ場中・パネル表示中など、名札を1つも出さない場面 */
  suppressed: boolean;
  /** いま 立ち話の ふきだしを 出している人(いなければ null)。その人だけ 出さない */
  bubbleSpeaker?: string | null;
}

/**
 * いま名札を出す人(近い順)。**画面にも Babylonにも さわらない 純関数**。
 *
 * @param shown いま出ている人のid。出ている人だけ 消える距離を ひとまわり 広くする
 *              (ヒステリシス。境目での 点滅よけ)
 */
export function nameplateTargets(
  sources: readonly NameplateSource[],
  ctx: NameplateContext,
  shown?: ReadonlySet<string>
): NameplateSource[] {
  if (ctx.suppressed) return [];
  const near: { src: NameplateSource; d: number }[] = [];
  for (const s of sources) {
    if (s.inFestivalRing) continue;
    if (ctx.bubbleSpeaker && ctx.bubbleSpeaker === s.id) continue;
    const d = Math.hypot(ctx.px - s.x, ctx.pz - s.z);
    const limit = shown?.has(s.id) ? NAMEPLATE_R_OUT : NAMEPLATE_R;
    if (d > limit) continue;
    near.push({ src: s, d });
  }
  // 近い順。同じ距離のときは id 順(乱数も 登録順のゆらぎも 入れない=いつも同じ)
  near.sort((a, b) => (a.d !== b.d ? a.d - b.d : a.src.id < b.src.id ? -1 : 1));
  return near.slice(0, NAMEPLATE_MAX).map((n) => n.src);
}

export class NpcNameplate {
  private els = new Map<string, HTMLElement>();
  private last = new Map<string, { x: number; y: number; text: string }>();
  private shownIds = new Set<string>();
  private tmp = new Vector3();
  private projected = new Vector3();
  private idMatrix = Matrix.Identity();
  private vp: Viewport | null = null;
  private proj = { sx: 0, sy: 0 };

  constructor(private scene: Scene) {}

  /** いま出ている名札(検証・撮影用。読むだけで副作用はない) */
  get visibleNames(): string[] {
    const out: string[] = [];
    for (const id of this.shownIds) {
      const el = this.els.get(id);
      if (el) out.push(el.textContent ?? '');
    }
    return out.sort();
  }

  /** ぜんぶ しまう(ポーズ・会話・見せ場) */
  hideAll(): void {
    if (this.shownIds.size === 0) return;
    for (const id of this.shownIds) this.els.get(id)?.classList.remove('show');
    this.shownIds.clear();
  }

  /** そのフレームの名札。中身の判断は nameplateTargets(純関数)がぜんぶ持つ */
  update(sources: readonly NameplateSource[], ctx: NameplateContext): void {
    const want = nameplateTargets(sources, ctx, this.shownIds);
    const seen = new Set<string>();
    for (const s of want) {
      if (!this.project(s.x, s.y + NAMEPLATE_Y, s.z)) continue;
      seen.add(s.id);
      const el = this.el(s.id);
      let last = this.last.get(s.id);
      if (!last) {
        last = { x: NaN, y: NaN, text: '' };
        this.last.set(s.id, last);
      }
      if (last.text !== s.name) {
        last.text = s.name;
        el.textContent = s.name;
      }
      const px = Math.round(this.proj.sx);
      const py = Math.round(this.proj.sy);
      // 値が変わったときだけ style を書く(毎フレームの書きこみはレイアウト再計算を呼ぶ)
      if (last.x !== px) {
        last.x = px;
        el.style.left = `${px}px`;
      }
      if (last.y !== py) {
        last.y = py;
        el.style.top = `${py}px`;
      }
      if (!this.shownIds.has(s.id)) {
        this.shownIds.add(s.id);
        el.classList.add('show');
      }
    }
    for (const id of [...this.shownIds]) {
      if (seen.has(id)) continue;
      this.shownIds.delete(id);
      this.els.get(id)?.classList.remove('show');
    }
  }

  private el(id: string): HTMLElement {
    let el = this.els.get(id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'npc-nameplate';
      document.getElementById('ui-root')!.appendChild(el);
      this.els.set(id, el);
    }
    return el;
  }

  /** world→screen(CSSピクセル)。画面内なら true。ChatBubbleUI と同じやりかた */
  private project(x: number, y: number, z: number): boolean {
    const engine = this.scene.getEngine();
    const w = engine.getRenderWidth();
    const h = engine.getRenderHeight();
    const cam = this.scene.activeCamera as Camera | null;
    if (!cam || w === 0 || h === 0) return false;
    this.tmp.set(x, y, z);
    if (!this.vp) this.vp = cam.viewport.toGlobal(w, h);
    else cam.viewport.toGlobalToRef(w, h, this.vp);
    const p = this.projected;
    Vector3.ProjectToRef(this.tmp, this.idMatrix, this.scene.getTransformMatrix(), this.vp, p);
    this.proj.sx = (p.x / w) * window.innerWidth;
    this.proj.sy = (p.y / h) * window.innerHeight;
    return p.z >= 0 && p.z <= 1 && p.x >= 0 && p.x <= w && p.y >= 0 && p.y <= h;
  }
}

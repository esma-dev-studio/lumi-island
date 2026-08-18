// v21 NPCどうしの「立ち話」の 吹き出し(頭の上に出る 小さな ふきだし)。
//
// **会話ボックス(DialogueUI)は 1ミリも 使わない**。理由は2つ:
//   1. 立ち話は プレイヤーの 操作を 1つも うばわない。世界も 止めない
//      (会話ボックスを 出すと WorldPauseController が 世界を 凍らせてしまう)。
//   2. 自動化(UXボット)は 会話パネルが 出ているあいだ 一歩も 動かない設計なので、
//      通りかかっただけで ボットが 足止めされる = 走行が こわれる。
//   クラス名も `.chat-bubble` で、`.dialogue` とは まったく別の要素にしてある。
//
// 出しかたは NPC頭上マーカー(WorldMarkerController)と 同じ world→screen の射影。
// 毎フレーム 新しいオブジェクトを 1つも 作らない(射影の使いまわし)。
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import type { Viewport } from '@babylonjs/core/Maths/math.viewport';
import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';

/** 頭の上 これだけ上に 出す(m) */
const BUBBLE_Y = 1.62;

export class ChatBubbleUI {
  private el: HTMLElement;
  private textEl: HTMLElement;
  private last = { x: -1, y: -1, text: '' };
  private shown = false;
  private tmp = new Vector3();
  private projected = new Vector3();
  private idMatrix = Matrix.Identity();
  private vp: Viewport | null = null;

  constructor(private scene: Scene) {
    this.el = document.createElement('div');
    this.el.className = 'chat-bubble hidden';
    this.el.innerHTML = '<span class="chat-bubble-dots">••</span><span class="chat-bubble-text"></span>';
    document.getElementById('ui-root')!.appendChild(this.el);
    this.textEl = this.el.querySelector('.chat-bubble-text') as HTMLElement;
  }

  /** 立ち話が 出ていない/見えないとき */
  hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.el.classList.add('hidden');
  }

  /**
   * 吹き出しを その人の 頭の上に出す。
   * @param text null なら「••」だけ(遠くて 聞こえないとき)
   */
  show(x: number, y: number, z: number, text: string | null): void {
    if (!this.project(x, y + BUBBLE_Y, z)) {
      this.hide();
      return;
    }
    if (!this.shown) {
      this.shown = true;
      this.el.classList.remove('hidden');
    }
    const t = text ?? '';
    if (this.last.text !== t) {
      this.last.text = t;
      this.textEl.textContent = t;
      this.el.classList.toggle('quiet', t === '');
    }
    const px = Math.round(this.proj.sx);
    const py = Math.round(this.proj.sy);
    if (this.last.x !== px) {
      this.last.x = px;
      this.el.style.left = `${px}px`;
    }
    if (this.last.y !== py) {
      this.last.y = py;
      this.el.style.top = `${py}px`;
    }
  }

  /** いま 出ている本文(検証・テスト用。出ていなければ null) */
  get visibleText(): string | null {
    return this.shown ? this.textEl.textContent : null;
  }

  private proj = { sx: 0, sy: 0 };

  /** world→screen(CSSピクセル)。画面内なら true。WorldMarkerController と同じやりかた */
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

// 「いまやること」HUD(左上・常時1アクションのみ)
import type { Objective } from '../systems/ObjectiveSystem';

/**
 * 「→ Nm」を出さなくなる距離(m)。これ以下は「もう目の前」なので数字を消す。
 * v11で 3 → 1.8 にした: 3mで消すと、そこから操作圏(採取1.9m / NPC会話1.8m)までの
 * 1mちょっとが「進捗も距離も出ない」空白になり、あと少しなのか行きすぎたのか分からなかった。
 * 採取・会話の操作圏以下にそろえてあるので「数字が消えた=Eのヒントが出ている」が成り立つ。
 * 矢印(ARROW_ARRIVE_R=2.6m)→この数字→Eのヒント、と切れ目なく手わたす
 * (tests/unit/guidance.test.ts が機械検査する)。
 */
export const SUB_DIST_MIN = 1.8;

export class ObjectiveHud {
  private el: HTMLElement;
  private headEl: HTMLElement;
  private labelEl: HTMLElement;
  private subEl: HTMLElement;
  private lastKey = '';

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'obj-hud';
    this.el.innerHTML = `
      <div class="obj-head">いまやること</div>
      <div class="obj-label"></div>
      <div class="obj-sub"></div>
    `;
    document.getElementById('ui-root')!.appendChild(this.el);
    this.headEl = this.el.querySelector('.obj-head')!;
    this.labelEl = this.el.querySelector('.obj-label')!;
    this.subEl = this.el.querySelector('.obj-sub')!;
  }

  update(o: Objective, dist: number | null): void {
    const key = o.id + '|' + o.headline + '|' + o.label + '|' + (o.progress ? `${o.progress.cur}/${o.progress.max}` : '');
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.headEl.textContent = o.headline;
      this.headEl.classList.toggle('done', o.headline === 'できた!');
      this.labelEl.innerHTML = o.label;
    }
    let sub = '';
    if (o.progress) sub = `${o.progress.cur} / ${o.progress.max}`;
    this.shownDist = dist !== null && dist > SUB_DIST_MIN ? Math.round(dist) : null;
    if (this.shownDist !== null) sub += (sub ? '　' : '') + `→ ${this.shownDist}m`;
    if (this.lastSub !== sub) {
      this.lastSub = sub;
      this.subEl.textContent = sub;
      this.subEl.style.display = sub ? '' : 'none';
    }
  }
  private lastSub: string | null = null;

  /**
   * v16.1 いま このカードに 出ている「→ Nm」の N(出ていなければ null)。
   *
   * 矢印マーカーの m バッジは、この数と 同じときだけ 出さない
   * (同じ数字が 画面の2か所に 出るのを やめる。UI総ざらいの写真 41/24)。
   * 「何を出しているか」を 知っているのは このクラスだけなので、
   * 判定の元も ここ1つに しておく=表示と 突きあわせが ずれない。
   */
  private shownDist: number | null = null;
  get shownDistance(): number | null {
    return this.shownDist;
  }
}

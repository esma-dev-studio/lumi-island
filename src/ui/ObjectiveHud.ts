// 「いまやること」HUD(左上・常時1アクションのみ)
import type { Objective } from '../systems/ObjectiveSystem';

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
    if (dist !== null && dist > 3) sub += (sub ? '　' : '') + `→ ${Math.round(dist)}m`;
    if (this.lastSub !== sub) {
      this.lastSub = sub;
      this.subEl.textContent = sub;
      this.subEl.style.display = sub ? '' : 'none';
    }
  }
  private lastSub: string | null = null;
}

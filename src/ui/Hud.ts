// 常時表示HUD: 時計・ルミナ・操作ヒント(最小限に保つ)+ りょうりの効果のしるし
import type { ActiveEffect } from '../systems/CookingEffects';
import { icon } from './icons';
import { isTouchMode, hintWithoutKeys } from './inputMode';

export class Hud {
  private clockEl: HTMLElement;
  private luminaEl: HTMLElement;
  private hintEl: HTMLElement;
  private fxEl: HTMLElement;

  constructor() {
    const root = document.getElementById('ui-root')!;
    const bar = document.createElement('div');
    bar.className = 'hud-top';
    bar.innerHTML = `
      <div class="hud-chip" id="hud-clock">あさ 6:00</div>
      <div class="hud-chip" id="hud-lumina"><svg viewBox="0 0 16 16" width="13" height="13"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="8" r="2.2" fill="currentColor"/></svg><span>0</span></div>
    `;
    root.appendChild(bar);
    // v12 りょうりの効果(かかっているあいだだけ 時計の下に出る)
    const fx = document.createElement('div');
    fx.className = 'hud-fx';
    fx.id = 'hud-fx';
    root.appendChild(fx);
    const hint = document.createElement('div');
    hint.className = 'hud-hint';
    hint.id = 'hud-hint';
    root.appendChild(hint);
    this.clockEl = bar.querySelector('#hud-clock')!;
    this.luminaEl = bar.querySelector('#hud-lumina span')!;
    this.hintEl = hint;
    this.fxEl = fx;
  }

  private lastClock = '';
  setClock(label: string, day: number): void {
    const s = `${day}日め ${label}`;
    if (s !== this.lastClock) {
      this.lastClock = s;
      this.clockEl.textContent = s;
    }
  }
  private lastLumina = -1;
  setLumina(n: number): void {
    if (n !== this.lastLumina) {
      this.lastLumina = n;
      this.luminaEl.textContent = String(n);
    }
  }
  /**
   * v12 りょうりの効果のしるし。
   * 中身が変わったときだけ描きなおす(1秒ごとに のこり秒が変わるので、
   * キーは「効果のID+のこり秒(整数)」にして 毎フレームの書きかえを防ぐ)。
   */
  private lastFx = '';
  setEffects(list: ActiveEffect[]): void {
    const key = list.map((e) => `${e.def.id}:${Math.ceil(e.left)}`).join(',');
    if (key === this.lastFx) return;
    this.lastFx = key;
    this.fxEl.innerHTML = list
      .map((e) => {
        const sec = Math.ceil(e.left);
        const label = sec >= 60 ? `あと ${Math.ceil(sec / 60)}ふん` : `あと ${sec}びょう`;
        return `<div class="fx-chip" title="${e.def.desc}">
          <span class="inv-ico">${icon(e.def.icon)}</span>
          <span class="fx-name">${e.def.name}<small>${label}</small></span>
          <span class="fx-bar"><i style="width:${Math.round(e.ratio * 100)}%"></i></span>
        </div>`;
      })
      .join('');
    this.fxEl.classList.toggle('show', list.length > 0);
  }

  private lastHint = '';
  private lastTouch = false;
  setHint(html: string): void {
    // タッチのときはキーの表示を出さない(押す場所は画面のボタンなので)。
    // 入力手段は毎回見る: 途中で指に切り替わっても次の更新で入れ替わる。
    const touch = isTouchMode();
    if (this.lastHint !== html || this.lastTouch !== touch) {
      this.lastHint = html;
      this.lastTouch = touch;
      const shown = touch ? hintWithoutKeys(html) : html;
      this.hintEl.innerHTML = shown;
      this.hintEl.classList.toggle('show', !!shown);
    }
  }
}

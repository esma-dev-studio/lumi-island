// 常時表示HUD: 時計・ルミナ・操作ヒント(最小限に保つ)
export class Hud {
  private clockEl: HTMLElement;
  private luminaEl: HTMLElement;
  private hintEl: HTMLElement;

  constructor() {
    const root = document.getElementById('ui-root')!;
    const bar = document.createElement('div');
    bar.className = 'hud-top';
    bar.innerHTML = `
      <div class="hud-chip" id="hud-clock">あさ 6:00</div>
      <div class="hud-chip" id="hud-lumina"><svg viewBox="0 0 16 16" width="13" height="13"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="8" r="2.2" fill="currentColor"/></svg><span>0</span></div>
    `;
    root.appendChild(bar);
    const hint = document.createElement('div');
    hint.className = 'hud-hint';
    hint.id = 'hud-hint';
    root.appendChild(hint);
    this.clockEl = bar.querySelector('#hud-clock')!;
    this.luminaEl = bar.querySelector('#hud-lumina span')!;
    this.hintEl = hint;
  }

  setClock(label: string, day: number): void {
    this.clockEl.textContent = `${day}日め ${label}`;
  }
  setLumina(n: number): void {
    this.luminaEl.textContent = String(n);
  }
  private lastHint = '';
  setHint(html: string): void {
    if (this.lastHint !== html) {
      this.lastHint = html;
      this.hintEl.innerHTML = html;
      this.hintEl.classList.toggle('show', !!html);
    }
  }
}

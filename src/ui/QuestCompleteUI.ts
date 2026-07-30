// 依頼達成の専用表示(通常トーストより強い・短い・早送り可)
export class QuestCompleteUI {
  private el: HTMLElement;
  private timer: number | null = null;
  open = false;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'quest-complete hidden';
    document.getElementById('ui-root')!.appendChild(this.el);
    this.el.addEventListener('click', () => this.hide());
  }

  show(title: string, rewardLines: string[], nextLabel: string): void {
    const rewards = rewardLines.map((l) => `<div class="qc-reward">${l}</div>`).join('');
    this.el.innerHTML = `
      <div class="qc-band">おねがい たっせい!</div>
      <div class="qc-title">${title}</div>
      ${rewards}
      ${nextLabel ? `<div class="qc-next">つぎ: ${nextLabel}</div>` : ''}
    `;
    this.el.classList.remove('hidden');
    this.open = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.hide(), 2600);
  }

  /** Eキー等での早送り */
  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.el.classList.add('hidden');
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

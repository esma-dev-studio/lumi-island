// 会話ボックス(画面下)。Eかクリックで進む。
export class DialogueUI {
  private el: HTMLElement;
  private lines: string[] = [];
  private idx = 0;
  private speaker = '';
  open = false;
  onEnd: (() => void) | null = null;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'dialogue hidden';
    this.el.innerHTML = `
      <div class="dlg-name"></div>
      <div class="dlg-text"></div>
      <div class="dlg-next"><kbd>E</kbd>つぎへ</div>
    `;
    document.getElementById('ui-root')!.appendChild(this.el);
    this.el.addEventListener('click', () => this.advance());
  }

  show(speaker: string, lines: string[], onEnd?: () => void): void {
    this.speaker = speaker;
    this.lines = lines;
    this.idx = 0;
    this.onEnd = onEnd ?? null;
    this.open = true;
    this.el.classList.remove('hidden');
    this.renderLine();
  }

  advance(): void {
    if (!this.open) return;
    this.idx++;
    if (this.idx >= this.lines.length) {
      this.close();
    } else {
      this.renderLine();
    }
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.el.classList.add('hidden');
    const cb = this.onEnd;
    this.onEnd = null;
    cb?.();
  }

  private renderLine(): void {
    (this.el.querySelector('.dlg-name') as HTMLElement).textContent = this.speaker;
    (this.el.querySelector('.dlg-text') as HTMLElement).textContent = this.lines[this.idx];
    (this.el.querySelector('.dlg-next') as HTMLElement).innerHTML =
      this.idx >= this.lines.length - 1 ? '<kbd>E</kbd>おわる' : '<kbd>E</kbd>つぎへ';
  }
}

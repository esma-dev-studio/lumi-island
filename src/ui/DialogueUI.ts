// 会話ボックス(画面下)。Eかクリックで進む。
import { sfx } from '../audio/AudioSystem';
import { byInput } from './inputMode';

/**
 * 「つぎへ/おわる」の案内。押す場所は入力手段で違うので、出すたびに選び直す。
 * タッチではこのパネル自体のタップでも、右下の大きいボタン(「つぎへ」)でも進む。
 */
function nextLabel(last: boolean): string {
  const word = last ? 'おわる' : 'つぎへ';
  return byInput(`<kbd>E</kbd>${word}`, `タップで ${word}`);
}

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
      <div class="dlg-next">${nextLabel(false)}</div>
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
    sfx('talk');
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
      nextLabel(this.idx >= this.lines.length - 1);
  }
}

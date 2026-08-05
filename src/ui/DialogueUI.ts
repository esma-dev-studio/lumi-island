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
  /**
   * 上に小さなパネル(おくりもの)が出ているあいだ true。
   * このあいだは会話パネルのクリックでもEでも進まない(裏の会話だけ先に終わって
   * 選択パネルが取り残される事故を防ぐ)。Escは InputRouter が両方まとめて閉じる。
   */
  blockAdvance = false;
  /**
   * blockAdvance 中に「つぎへ」(E・タッチの丸ボタン)が押されたときの逃げ道。
   * 何も起きないボタンを画面に残さないため、上のパネル側が「やめる」を割りあてる。
   */
  onBlockedAdvance: (() => void) | null = null;
  /** 最終行にだけ出す任意ボタン(いまは「おくりものをする」)。押しても会話は進まない */
  private extraLabel: string | null = null;
  private extraHandler: (() => void) | null = null;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'dialogue hidden';
    this.el.innerHTML = `
      <div class="dlg-name"></div>
      <div class="dlg-text"></div>
      <div class="dlg-next">${nextLabel(false)}</div>
    `;
    document.getElementById('ui-root')!.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      // 任意ボタンは「会話を進めない」ので、advanceより先に見る
      if ((e.target as HTMLElement).closest('[data-dlg-extra]')) {
        this.extraHandler?.();
        return;
      }
      this.advance();
    });
  }

  show(speaker: string, lines: string[], onEnd?: () => void): void {
    this.speaker = speaker;
    this.lines = lines;
    this.idx = 0;
    this.onEnd = onEnd ?? null;
    this.open = true;
    this.blockAdvance = false;
    this.onBlockedAdvance = null;
    // 前の会話のボタンを持ちこさない(出す側が show のあとに setExtraAction で付け直す)
    this.extraLabel = null;
    this.extraHandler = null;
    this.el.classList.remove('hidden');
    this.renderLine();
  }

  /**
   * 最終行に出す任意ボタンを差しかえる(null で消す)。
   * 押さなければ何も起きない追加要素なので、Eだけで会話を送る自動テスト・ボットには影響しない。
   */
  setExtraAction(label: string | null, handler: (() => void) | null): void {
    this.extraLabel = label;
    this.extraHandler = handler;
    if (this.open) this.renderLine();
  }

  advance(): void {
    if (!this.open) return;
    if (this.blockAdvance) {
      this.onBlockedAdvance?.(); // 上のパネルを閉じて会話にもどす(押して無反応にしない)
      return;
    }
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
    this.blockAdvance = false;
    this.onBlockedAdvance = null;
    this.extraLabel = null;
    this.extraHandler = null;
    this.el.classList.add('hidden');
    const cb = this.onEnd;
    this.onEnd = null;
    cb?.();
  }

  private renderLine(): void {
    const last = this.idx >= this.lines.length - 1;
    (this.el.querySelector('.dlg-name') as HTMLElement).textContent = this.speaker;
    (this.el.querySelector('.dlg-text') as HTMLElement).textContent = this.lines[this.idx];
    const extra =
      last && this.extraLabel
        ? `<button class="craft-btn sub" data-dlg-extra style="margin-right:10px">${this.extraLabel}</button>`
        : '';
    (this.el.querySelector('.dlg-next') as HTMLElement).innerHTML = extra + nextLabel(last);
  }
}

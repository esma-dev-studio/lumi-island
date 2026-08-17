// v13 手紙UI(メッセージボトルの中身・ずかんからの読み返し)。
//
// 見た目の言語は他のパネル(もちもの・ずかん)と同じクラスを使い回し、
// 本文だけ「紙」の面にする。クリックは委譲リスナー1本だけ(CraftUI・GiftUIと同方針。
// 毎描画の onclick 割り当てだと「ボタンは見えるのに押せない」状態になり得る)。
//
// 手紙の流儀は なかよし度5の お礼の手紙(src/systems/GiftSystem.ts の thanksLetter)に そろえる:
// みじかい・詩のような・だれかの こえが きこえる文。ここでは それを3行ぶん 紙の上に置く。
import type { LetterDef } from '../data/letters';
import { icon } from './icons';
import { byInput } from './inputMode';
import { sfx } from '../audio/AudioSystem';

export class LetterUI {
  private el: HTMLElement;
  open = false;
  /** いま開いている手紙(検証・E2E用) */
  current: LetterDef | null = null;
  /** とじたとき(呼び出し側がセーブ・カメラ戻しをする) */
  onClose: (() => void) | null = null;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'panel letter-panel hidden';
    document.getElementById('ui-root')!.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-close]')) {
        sfx('close');
        this.close();
      }
    });
  }

  /**
   * 手紙をひらく。
   * @param lead ひろった瞬間だけ出す みじかい ひとこと(ずかんからの読み返しでは省く)
   */
  show(letter: LetterDef, lead?: string): void {
    this.current = letter;
    this.open = true;
    const body = letter.lines.map((l) => `<p>${l}</p>`).join('');
    this.el.innerHTML = `
      <div class="panel-title">てがみ
        <span class="panel-close" data-close>とじる</span>
      </div>
      ${lead ? `<div class="letter-lead">${lead}</div>` : ''}
      <div class="letter-paper">
        <div class="letter-head">
          <span class="inv-ico">${icon(letter.icon)}</span>
          <span class="letter-title">${letter.title}</span>
        </div>
        <div class="letter-body">${body}</div>
        <div class="letter-from">${letter.from} より</div>
      </div>
      <div class="panel-sub">${byInput(
        'よんだ てがみは ずかん(Z)の「てがみ」で もういちど よめるよ。',
        'よんだ てがみは 右上の「ずかん」の「てがみ」で もういちど よめるよ。'
      )}</div>
    `;
    this.el.classList.remove('hidden');
    sfx('letter'); // v18 びんの手紙は 数日に1本の出来事。汎用のUI音では もったいない
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.current = null;
    this.el.classList.add('hidden');
    this.onClose?.();
  }
}

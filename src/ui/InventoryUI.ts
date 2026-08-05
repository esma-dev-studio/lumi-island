// インベントリ画面(Tab/I)。もちもの+道具。家具は「おく」で配置モードへ、
// かべがみ・ゆかいたは(室内にいるときだけ)「つかう」で模様替えする。
import type { GameState } from '../game/GameState';
import { ITEMS, TOOLS, isDecor, type ItemId } from '../data/items';
import { icon } from './icons';
import { byInput } from './inputMode';

export class InventoryUI {
  private el: HTMLElement;
  open = false;
  onPlace: ((item: ItemId) => void) | null = null;
  /** かべがみ・ゆかいたの「つかう」。室内にいるときだけ押せる */
  onUse: ((item: ItemId) => void) | null = null;

  /**
   * @param getState いまのゲーム状態
   * @param isIndoor いま家の中にいるか。屋外では「つかう」を出さない
   *   (貼る相手の壁・床がその場に無いので、押せても何も起きないボタンになってしまう)
   */
  constructor(
    private getState: () => GameState,
    private isIndoor: () => boolean = () => false
  ) {
    this.el = document.createElement('div');
    this.el.className = 'panel inv-panel hidden';
    document.getElementById('ui-root')!.appendChild(this.el);
  }

  toggle(): void {
    this.open = !this.open;
    if (this.open) this.render();
    this.el.classList.toggle('hidden', !this.open);
  }
  close(): void {
    this.open = false;
    this.el.classList.add('hidden');
  }

  private render(): void {
    const s = this.getState();
    const indoor = this.isIndoor();
    const entries = Object.entries(s.inventory) as [ItemId, number][];
    const slots = entries
      .map(([id, n]) => {
        const def = ITEMS[id];
        let btn = '';
        if (def.kind === 'furniture') btn = `<button class="craft-btn sub" data-place="${id}">おく</button>`;
        // 模様替えは室内だけ。使っても無くならないので、個数がいくつでもボタンは1つ
        else if (isDecor(id) && indoor) btn = `<button class="craft-btn sub" data-use="${id}">つかう</button>`;
        return `<div class="inv-slot" title="${def.desc}">
          <span class="inv-ico">${icon(id)}</span>
          <span class="inv-name">${def.name}</span>
          <span class="inv-count">×${n}</span>
          ${btn}
        </div>`;
      })
      .join('');
    const tools = s.tools
      .map((t) => `<div class="inv-tool" title="${TOOLS[t].desc}"><span class="inv-ico">${icon(t)}</span><span>${TOOLS[t].name}</span></div>`)
      .join('');
    this.el.innerHTML = `
      <div class="panel-title">もちもの <span class="panel-close" data-close>${byInput('とじる(Tab)', 'とじる')}</span></div>
      <div class="inv-grid">${slots || '<div class="inv-empty">まだ何ももっていない。島で木をきったり、実をつんだりしてみよう!</div>'}</div>
      <div class="panel-sub">どうぐ</div>
      <div class="inv-tools">${tools}</div>
    `;
    this.el.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    this.el.querySelectorAll<HTMLButtonElement>('[data-place]').forEach((b) => {
      b.onclick = () => {
        this.close();
        this.onPlace?.(b.dataset.place as ItemId);
      };
    });
    // 模様替えはその場で切り替わる。もちものは閉じない(3種を見くらべながら選べるように)
    this.el.querySelectorAll<HTMLButtonElement>('[data-use]').forEach((b) => {
      b.onclick = () => {
        this.onUse?.(b.dataset.use as ItemId);
        this.render();
      };
    });
  }
}

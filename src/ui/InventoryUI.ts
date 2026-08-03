// インベントリ画面(Tab/I)。もちもの+道具。家具は「おく」で配置モードへ。
import type { GameState } from '../game/GameState';
import { ITEMS, TOOLS, type ItemId } from '../data/items';
import { icon } from './icons';
import { byInput } from './inputMode';

export class InventoryUI {
  private el: HTMLElement;
  open = false;
  onPlace: ((item: ItemId) => void) | null = null;

  constructor(private getState: () => GameState) {
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
    const entries = Object.entries(s.inventory) as [ItemId, number][];
    const slots = entries
      .map(([id, n]) => {
        const def = ITEMS[id];
        const placeBtn = def.kind === 'furniture' ? `<button class="craft-btn sub" data-place="${id}">おく</button>` : '';
        return `<div class="inv-slot" title="${def.desc}">
          <span class="inv-ico">${icon(id)}</span>
          <span class="inv-name">${def.name}</span>
          <span class="inv-count">×${n}</span>
          ${placeBtn}
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
  }
}

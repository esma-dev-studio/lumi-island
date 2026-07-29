// ツムギの店: うる/かう
import type { GameState } from '../game/GameState';
import { invRemove, invAdd, invCount } from '../game/GameState';
import { ITEMS, SHOP_STOCK, type ItemId } from '../data/items';
import { icon } from './icons';
import { toast } from './Toast';

export class ShopUI {
  private el: HTMLElement;
  open = false;
  private tab: 'sell' | 'buy' = 'sell';
  onTrade: (() => void) | null = null;

  constructor(private getState: () => GameState) {
    this.el = document.createElement('div');
    this.el.className = 'panel shop-panel hidden';
    document.getElementById('ui-root')!.appendChild(this.el);
  }

  show(): void {
    this.open = true;
    this.render();
    this.el.classList.remove('hidden');
  }
  close(): void {
    this.open = false;
    this.el.classList.add('hidden');
  }

  private render(): void {
    const s = this.getState();
    let body = '';
    if (this.tab === 'sell') {
      const entries = Object.entries(s.inventory) as [ItemId, number][];
      body = entries.length
        ? entries
            .map(([id, n]) => {
              const def = ITEMS[id];
              return `<div class="craft-row">
              <span class="inv-ico">${icon(id)}</span>
              <span class="craft-name">${def.name} <small>×${n}</small></span>
              <span class="shop-price">${icon('lumina')}${def.sell}</span>
              <button class="craft-btn" data-sell="${id}">うる</button>
              ${n > 1 ? `<button class="craft-btn sub" data-sellall="${id}">ぜんぶ</button>` : ''}
            </div>`;
            })
            .join('')
        : '<div class="inv-empty">売れるものがない。採取してからまた来よう!</div>';
    } else {
      body = SHOP_STOCK.map(({ item, price }) => {
        const def = ITEMS[item];
        const can = s.lumina >= price;
        return `<div class="craft-row">
          <span class="inv-ico">${icon(item)}</span>
          <span class="craft-name">${def.name}</span>
          <span class="shop-price">${icon('lumina')}${price}</span>
          <button class="craft-btn" data-buy="${item}" data-price="${price}" ${can ? '' : 'disabled'}>かう</button>
        </div>`;
      }).join('');
    }
    this.el.innerHTML = `
      <div class="panel-title">ツムギ工房
        <span class="shop-lumina">${icon('lumina')}${s.lumina}</span>
        <span class="panel-close" data-close>とじる(Esc)</span>
      </div>
      <div class="shop-tabs">
        <button class="shop-tab ${this.tab === 'sell' ? 'on' : ''}" data-tab="sell">うる</button>
        <button class="shop-tab ${this.tab === 'buy' ? 'on' : ''}" data-tab="buy">かう(家具)</button>
      </div>
      <div class="craft-list">${body}</div>
    `;
    this.el.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    this.el.querySelectorAll<HTMLButtonElement>('.shop-tab').forEach((b) => {
      b.onclick = () => {
        this.tab = b.dataset.tab as 'sell' | 'buy';
        this.render();
      };
    });
    this.el.querySelectorAll<HTMLButtonElement>('[data-sell]').forEach((b) => {
      b.onclick = () => {
        const id = b.dataset.sell as ItemId;
        if (invRemove(s, id, 1)) {
          s.lumina += ITEMS[id].sell;
          toast(`+${ITEMS[id].sell} ルミナ`, 'lumina');
          this.onTrade?.();
          this.render();
        }
      };
    });
    this.el.querySelectorAll<HTMLButtonElement>('[data-sellall]').forEach((b) => {
      b.onclick = () => {
        const id = b.dataset.sellall as ItemId;
        const n = invCount(s, id);
        if (n > 0 && invRemove(s, id, n)) {
          s.lumina += ITEMS[id].sell * n;
          toast(`+${ITEMS[id].sell * n} ルミナ`, 'lumina');
          this.onTrade?.();
          this.render();
        }
      };
    });
    this.el.querySelectorAll<HTMLButtonElement>('[data-buy]').forEach((b) => {
      b.onclick = () => {
        const id = b.dataset.buy as ItemId;
        const price = Number(b.dataset.price);
        if (s.lumina >= price) {
          s.lumina -= price;
          invAdd(s, id, 1);
          toast(`${ITEMS[id].name}を かった!`, id);
          this.onTrade?.();
          this.render();
        }
      };
    });
  }
}

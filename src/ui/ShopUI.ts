// ツムギの店: うる/かう
import type { GameState } from '../game/GameState';
import { invRemove, invAddRecorded, invCount } from '../game/GameState';
import { ITEMS, SHOP_STOCK, type ItemId } from '../data/items';
import { icon } from './icons';
import { byInput } from './inputMode';
import { toast } from './Toast';
import { sfx } from '../audio/AudioSystem';

export class ShopUI {
  private el: HTMLElement;
  open = false;
  private tab: 'sell' | 'buy' = 'sell';
  onTrade: (() => void) | null = null;

  constructor(private getState: () => GameState) {
    this.el = document.createElement('div');
    this.el.className = 'panel shop-panel hidden';
    document.getElementById('ui-root')!.appendChild(this.el);
    // クリックは委譲で1回だけ(描画途中の例外・再描画競合への免疫。CraftUIと同方針)
    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest(
        '[data-close], .shop-tab, [data-sell], [data-sellall], [data-buy]'
      ) as HTMLElement | null;
      if (!t) return;
      const s = this.getState();
      if (t.hasAttribute('data-close')) {
        sfx('close'); // v18 とじる操作の音(ここまで全パネルで無音だった)
        this.close();
        return;
      }
      if (t.classList.contains('shop-tab')) {
        sfx('page'); // v18 タブ切替は 紙をめくる音
        this.tab = t.dataset.tab as 'sell' | 'buy';
        this.render();
        return;
      }
      if (t.dataset.sell) {
        const id = t.dataset.sell as ItemId;
        if (invRemove(s, id, 1)) {
          s.lumina += ITEMS[id].sell;
          toast(`+${ITEMS[id].sell} ルミナ`, 'lumina');
          this.onTrade?.();
          this.render();
        }
      } else if (t.dataset.sellall) {
        const id = t.dataset.sellall as ItemId;
        const n = invCount(s, id);
        if (n > 0 && invRemove(s, id, n)) {
          s.lumina += ITEMS[id].sell * n;
          toast(`+${ITEMS[id].sell * n} ルミナ`, 'lumina');
          this.onTrade?.();
          this.render();
        }
      } else if (t.dataset.buy) {
        const id = t.dataset.buy as ItemId;
        const price = Number(t.dataset.price);
        if (s.lumina >= price && !(t as HTMLButtonElement).disabled) {
          s.lumina -= price;
          invAddRecorded(s, id, 1); // 買ったものもずかんに記録する(売却は記録しない)
          toast(`${ITEMS[id].name}を かった!`, id);
          this.onTrade?.();
          this.render();
        }
      }
    });
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
      // だいじなもの(依頼で使う道具。ITEMS の keyItem)は「うる」欄に出さない。
      // うっかり手ばなして依頼が進められなくなるのを、画面に出さないことで構造的に防ぐ
      const entries = (Object.entries(s.inventory) as [ItemId, number][]).filter(([id]) => !ITEMS[id]?.keyItem);
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
        <span class="panel-close" data-close>${byInput('とじる(Esc)', 'とじる')}</span>
      </div>
      <div class="shop-tabs">
        <button class="shop-tab ${this.tab === 'sell' ? 'on' : ''}" data-tab="sell">うる</button>
        <button class="shop-tab ${this.tab === 'buy' ? 'on' : ''}" data-tab="buy">かう(家具)</button>
      </div>
      <div class="craft-list">${body}</div>
    `;
    // クリック処理はコンストラクタの委譲リスナーが担当(ここでは付けない)
  }
}

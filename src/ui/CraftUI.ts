// クラフト画面(C)
import type { GameState } from '../game/GameState';
import { knownRecipes, canCraft, craft } from '../systems/CraftingSystem';
import { ITEMS, TOOLS, type ItemId, type ToolId } from '../data/items';
import { icon } from './icons';
import { byInput } from './inputMode';
import { sfx } from '../audio/AudioSystem';

export class CraftUI {
  private el: HTMLElement;
  open = false;
  onCrafted: (() => void) | null = null;

  constructor(private getState: () => GameState) {
    this.el = document.createElement('div');
    this.el.className = 'panel craft-panel hidden';
    document.getElementById('ui-root')!.appendChild(this.el);
    // クリックは委譲で1回だけ付ける(毎描画のonclick割当てだと、描画途中の例外や
    // 再描画競合で「ボタンは見えるのに押せない」状態になり得る。実地報告あり)
    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-close], .craft-btn') as HTMLElement | null;
      if (!t) return;
      if (t.hasAttribute('data-close')) {
        this.close();
        return;
      }
      const id = (t as HTMLButtonElement).dataset.id;
      if (!id || (t as HTMLButtonElement).disabled) return;
      const s = this.getState();
      const r = knownRecipes(s).find((x) => x.id === id);
      if (r && craft(s, r)) {
        sfx('craft');
        const outName = r.outKind === 'tool' ? TOOLS[r.out as ToolId].name : ITEMS[r.out as ItemId].name;
        this.showPop(outName, r.out);
        this.onCrafted?.();
        this.render();
      }
    });
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

  /** 完成の短いポップ(0.7秒・中央上) */
  private showPop(name: string, iconId: string): void {
    const pop = document.createElement('div');
    pop.className = 'craft-pop';
    pop.innerHTML = `<span class="inv-ico">${icon(iconId)}</span> ${name}を つくった!`;
    document.getElementById('ui-root')!.appendChild(pop);
    requestAnimationFrame(() => pop.classList.add('show'));
    setTimeout(() => {
      pop.classList.remove('show');
      setTimeout(() => pop.remove(), 250);
    }, 720);
  }

  private render(): void {
    const s = this.getState();
    const rows = knownRecipes(s)
      .map((r) => {
        const check = canCraft(s, r);
        const outName = r.outKind === 'tool' ? TOOLS[r.out as ToolId].name : ITEMS[r.out as ItemId].name;
        const cost = (Object.entries(r.cost) as [ItemId, number][])
          .map(([item, need]) => {
            const have = s.inventory[item] ?? 0;
            return `<span class="cost ${have >= need ? 'ok' : 'lack'}">${icon(item)}${have}/${need}</span>`;
          })
          .join('');
        const btn = check.alreadyOwned
          ? '<span class="crafted-label">もってる</span>'
          : `<button class="craft-btn" data-id="${r.id}" ${check.ok ? '' : 'disabled'}>つくる</button>`;
        return `<div class="craft-row">
          <span class="inv-ico">${icon(r.out)}</span>
          <span class="craft-name">${outName}</span>
          <span class="craft-costs">${cost}</span>
          ${btn}
        </div>`;
      })
      .join('');
    this.el.innerHTML = `
      <div class="panel-title">クラフト <span class="panel-close" data-close>${byInput('とじる(C)', 'とじる')}</span></div>
      <div class="craft-list">${rows || '<div class="inv-empty">まだレシピを知らない。島のみんなに聞いてみよう!</div>'}</div>
    `;
    // クリック処理はコンストラクタの委譲リスナーが担当(ここでは付けない)
  }
}

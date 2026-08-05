// おくりものの選択パネル(会話中に「おくりものをする」を押すと開く小さなパネル)。
//
// 見た目の言語は他のパネル(もちもの・クラフト)と同じクラスを使い回す。
// クリックは委譲リスナー1本だけ(CraftUI・InventoryUIと同方針。毎描画のonclick割当てだと
// 「ボタンは見えるのに押せない」状態になり得る)。キーボードでもタッチでも同じ経路を通る。
import type { GameState } from '../game/GameState';
import { ITEMS, type ItemId } from '../data/items';
import { giftableItems } from '../systems/GiftSystem';
import { icon } from './icons';
import { sfx } from '../audio/AudioSystem';

export class GiftUI {
  private el: HTMLElement;
  open = false;
  private npcName = '';
  /** ものを選んだ(呼び出し側が消費・反応セリフ・トーストを受けもつ) */
  onChoose: ((item: ItemId) => void) | null = null;
  /** やめる・とじる(会話はそのまま続く) */
  onCancel: (() => void) | null = null;

  constructor(private getState: () => GameState) {
    this.el = document.createElement('div');
    this.el.className = 'panel gift-panel hidden';
    document.getElementById('ui-root')!.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-close], [data-give]') as HTMLElement | null;
      if (!t) return;
      if (t.hasAttribute('data-close')) {
        this.cancel();
        return;
      }
      const id = t.dataset.give as ItemId | undefined;
      if (!id) return;
      this.onChoose?.(id);
    });
  }

  show(npcName: string): void {
    this.npcName = npcName;
    this.open = true;
    this.render();
    this.el.classList.remove('hidden');
    sfx('ui');
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.el.classList.add('hidden');
  }

  /** 「やめる」とEsc の共通経路(閉じて、会話をもとに戻す) */
  cancel(): void {
    if (!this.open) return;
    this.close();
    this.onCancel?.();
  }

  private render(): void {
    const s = this.getState();
    const items = giftableItems(s);
    const slots = items
      .map((id) => {
        const def = ITEMS[id];
        // 名前・ボタンは折り返さない。もちもの(3列)と同じ幅だと「サカ/ナ」のように
        // 1文字ずつ縦に割れてしまう(タッチ端末はrem基準が大きいのでとくに読めない)
        return `<div class="inv-slot" title="${def.desc}">
          <span class="inv-ico">${icon(id)}</span>
          <span class="inv-name" style="min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${def.name}</span>
          <span class="inv-count">×${s.inventory[id] ?? 0}</span>
          <button class="craft-btn sub" data-give="${id}" style="white-space:nowrap">あげる</button>
        </div>`;
      })
      .join('');
    // 1マスの最小幅を決めて列数は画面まかせにする(タッチでは自然に1列になる)
    const grid = 'grid-template-columns:repeat(auto-fill,minmax(12em,1fr))';
    this.el.innerHTML = `
      <div class="panel-title">${this.npcName}に おくりもの
        <span class="panel-close" data-close>やめる</span>
      </div>
      <div class="inv-grid" style="${grid}">${slots || '<div class="inv-empty">いま あげられるものが ない。島で なにか 見つけてこよう!</div>'}</div>
      <div class="panel-sub">おくりものは 1日に 1人1回まで。すきなものを あげると もっと よろこぶよ。</div>
    `;
    // クリック処理はコンストラクタの委譲リスナーが担当(ここでは付けない)
  }
}

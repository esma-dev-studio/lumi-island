// 展示家具(すいそう・むしかご)に いきものを入れる選択パネル。
//
// 見た目の言語は他のパネル(もちもの・クラフト・おくりもの)と同じクラスを使い回す。
// クリックは委譲リスナー1本だけ(GiftUI・CraftUI・InventoryUIと同方針。毎描画のonclick割当てだと
// 「ボタンは見えるのに押せない」状態になり得る)。キーボードでもタッチでも同じ経路を通る。
//
// このパネルは「置いてある家具そのもののメニュー」でもある:
//   - いきものを1匹えらんで いれる
//   - この家具を もちかえる(中身があれば いっしょに もちものへ戻る)
//   - やめる
// もちかえるをここに置いているのは、家具に立つと E が「いれる」になるため。
// パネルにも入口が無いと、水そう・むしかごだけ 置きなおせなくなってしまう。
import type { GameState } from '../game/GameState';
import { DISPLAY_FURNITURE, ITEMS, type DisplayFurnitureId, type ItemId } from '../data/items';
import { icon } from './icons';
import { sfx } from '../audio/AudioSystem';

/** そのケースに いま入れられる もちもの(所持数1以上のものだけ・表の順) */
export function displayableItems(state: GameState, furniture: DisplayFurnitureId): ItemId[] {
  return DISPLAY_FURNITURE[furniture].accepts.filter((id) => (state.inventory[id] ?? 0) > 0);
}

export class DisplayUI {
  private el: HTMLElement;
  open = false;
  private furniture: DisplayFurnitureId = 'f_aquarium';
  /** いきものを えらんだ(呼び出し側が 消費・保存・見た目の作り直しを受けもつ) */
  onChoose: ((item: ItemId) => void) | null = null;
  /** この家具を もちかえる */
  onCarry: (() => void) | null = null;

  constructor(private getState: () => GameState) {
    this.el = document.createElement('div');
    this.el.className = 'panel display-panel hidden';
    document.getElementById('ui-root')!.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-close], [data-carry], [data-put]') as HTMLElement | null;
      if (!t) return;
      if (t.hasAttribute('data-close')) {
        this.close();
        return;
      }
      if (t.hasAttribute('data-carry')) {
        this.close();
        this.onCarry?.();
        return;
      }
      const id = t.dataset.put as ItemId | undefined;
      if (!id) return;
      this.close();
      this.onChoose?.(id);
    });
  }

  show(furniture: DisplayFurnitureId): void {
    this.furniture = furniture;
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

  private render(): void {
    const s = this.getState();
    const def = DISPLAY_FURNITURE[this.furniture];
    const items = displayableItems(s, this.furniture);
    const slots = items
      .map((id) => {
        const item = ITEMS[id];
        // 名前・ボタンは折り返さない(もちもの3列の幅だと「サカ/ナ」のように1文字ずつ縦に割れる)
        return `<div class="inv-slot" title="${item.desc}">
          <span class="inv-ico">${icon(id)}</span>
          <span class="inv-name" style="min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.name}</span>
          <span class="inv-count">×${s.inventory[id] ?? 0}</span>
          <button class="craft-btn sub" data-put="${id}" style="white-space:nowrap">いれる</button>
        </div>`;
      })
      .join('');
    // 1マスの最小幅を決めて列数は画面まかせにする(タッチでは自然に1列になる)
    const grid = 'grid-template-columns:repeat(auto-fill,minmax(12em,1fr))';
    this.el.innerHTML = `
      <div class="panel-title">${def.label}に いきものを いれる
        <span class="panel-close" data-close>やめる</span>
      </div>
      <div class="inv-grid" style="${grid}">${slots || `<div class="inv-empty">${def.empty}</div>`}</div>
      <div class="panel-sub">入れた いきものは いつでも とりだせるよ。
        <button class="craft-btn sub" data-carry style="white-space:nowrap;margin-left:8px">${def.label}を もちかえる</button>
      </div>
    `;
    // クリック処理はコンストラクタの委譲リスナーが担当(ここでは付けない)
  }
}

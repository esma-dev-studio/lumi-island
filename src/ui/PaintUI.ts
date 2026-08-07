// v12 おいてある家具に いろみずを ぬる選択パネル。
//
// 見た目の言語も クリックのしかたも DisplayUI(すいそう・むしかご)と そろえてある:
//   - 委譲リスナー1本だけ(毎描画の onclick 割当てはしない)
//   - パネルの中に「もちかえる」の入口を置く
//     (家具に立つと E が「いろを ぬる」になるので、ここに入口が無いと置きなおせなくなる)
// いろみずは つかっても 無くならない(かべがみと同じ)。何度でも ぬりなおせる。
import type { GameState } from '../game/GameState';
import { ITEMS, PAINT_COLORS, ownedPaints, type ItemId, type PaintId } from '../data/items';
import { icon } from './icons';
import { sfx } from '../audio/AudioSystem';

export class PaintUI {
  private el: HTMLElement;
  open = false;
  private furniture: ItemId = 'f_bench';
  private current: string | undefined;
  /** 色をえらんだ(null=もとの色にもどす)。実処理は PlacementSystem が受けもつ */
  onChoose: ((paint: PaintId | null) => void) | null = null;
  /** この家具を もちかえる */
  onCarry: (() => void) | null = null;

  constructor(private getState: () => GameState) {
    this.el = document.createElement('div');
    this.el.className = 'panel paint-panel hidden';
    document.getElementById('ui-root')!.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest(
        '[data-close], [data-carry], [data-paint], [data-reset]'
      ) as HTMLElement | null;
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
      if (t.hasAttribute('data-reset')) {
        this.close();
        this.onChoose?.(null);
        return;
      }
      const id = t.dataset.paint as PaintId | undefined;
      if (!id) return;
      this.close();
      this.onChoose?.(id);
    });
  }

  /** @param color いま ぬってある色(hex)。無ければ undefined */
  show(furniture: ItemId, color: string | undefined): void {
    this.furniture = furniture;
    this.current = color;
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
    const paints = ownedPaints(s.inventory ?? {});
    const name = ITEMS[this.furniture].name;
    const slots = paints
      .map((id) => {
        const p = PAINT_COLORS[id];
        const on = this.current === p.hex;
        return `<div class="inv-slot" title="${ITEMS[id].desc}">
          <span class="paint-chip" style="background:${p.hex}"></span>
          <span class="inv-name" style="min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.label}</span>
          <span class="inv-count">×${s.inventory[id] ?? 0}</span>
          <button class="craft-btn sub" data-paint="${id}" style="white-space:nowrap" ${on ? 'disabled' : ''}>${on ? 'このいろ' : 'ぬる'}</button>
        </div>`;
      })
      .join('');
    const reset = this.current
      ? '<button class="craft-btn sub" data-reset style="white-space:nowrap;margin-left:8px">もとの色に もどす</button>'
      : '';
    // 1マスの最小幅を決めて列数は画面まかせにする(タッチでは自然に1列になる)
    const grid = 'grid-template-columns:repeat(auto-fill,minmax(12em,1fr))';
    this.el.innerHTML = `
      <div class="panel-title"><span class="inv-ico">${icon(this.furniture)}</span>${name}に いろを ぬる
        <span class="panel-close" data-close>やめる</span>
      </div>
      <div class="inv-grid" style="${grid}">${
        slots || '<div class="inv-empty">いろみずを まだ もっていない。クラフトの「くみあわせ」で さがしてみよう!</div>'
      }</div>
      <div class="panel-sub">いろみずは つかっても なくならないよ。なんども ぬりなおせる。${reset}
        <button class="craft-btn sub" data-carry style="white-space:nowrap;margin-left:8px">${name}を もちかえる</button>
      </div>
    `;
    // クリック処理はコンストラクタの委譲リスナーが担当(ここでは付けない)
  }
}

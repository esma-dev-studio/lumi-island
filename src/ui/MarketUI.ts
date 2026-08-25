// v20 第3章 テンの店(週がわりの品ぞろえ)。ツムギ工房(src/ui/ShopUI.ts)の型をそのまま流用する。
//
// ツムギ工房との ちがいは3つだけ:
//   1. **かうだけ**(うるのは 島のお店の役わり。行商人は「よその島のものを 持ってくる人」)
//   2. 品ぞろえが **週がわり**。中身は MarketStock の純関数が 週番号だけから決める
//   3. 「まきもの」を かうと、その場で くみあわせのレシピを 1つ おぼえる(もちものには 入らない)
import type { GameState } from '../game/GameState';
import { invAddRecorded } from '../game/GameState';
import { ITEMS, RECIPES, type ItemId } from '../data/items';
import {
  MARKET_SCROLL, SCROLL_SOLDOUT_TEXT, daysLeftInWeek, marketRowsFor, marketWeek, openScroll,
  type MarketRow,
} from '../systems/MarketStock';
import { icon } from './icons';
import { byInput } from './inputMode';
import { toast } from './Toast';
import { sfx } from '../audio/AudioSystem';

/** 見出し(グループごと)。ならびは MarketStock.marketStock が返す順のまま */
const GROUP_LABEL: Record<MarketRow['group'], string> = {
  style: 'かべと ゆか',
  furniture: 'よその島の かぐ',
  toy: 'よその島の おもちゃ',
  material: 'よその島の ざいりょう',
  scroll: 'レシピの まきもの',
  // v25 なかよしの しるし。週がわりではないので、いちばん下に ずっと ならぶ
  plush: 'しまの なかまの ぬいぐるみ',
};

export class MarketUI {
  private el: HTMLElement;
  open = false;
  /** 買ったときに 呼ぶ(セーブ・所持金の表示更新は GameScene がする) */
  onTrade: (() => void) | null = null;

  constructor(private getState: () => GameState, private getDay: () => number) {
    this.el = document.createElement('div');
    this.el.className = 'panel shop-panel hidden';
    document.getElementById('ui-root')!.appendChild(this.el);
    // クリックは委譲で1回だけ(ShopUI・CraftUI と同方針)
    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-close], [data-buy]') as HTMLElement | null;
      if (!t) return;
      if (t.hasAttribute('data-close')) {
        sfx('close');
        this.close();
        return;
      }
      const id = t.dataset.buy as ItemId;
      const price = Number(t.dataset.price);
      const s = this.getState();
      if (!id || !Number.isFinite(price)) return;
      if (s.lumina < price || (t as HTMLButtonElement).disabled) return;
      if (id === MARKET_SCROLL) {
        // まきものは「ひらく」= その場で 中身が わかる。もちものには 入れない
        const r = openScroll(s);
        if (!r.ok) {
          toast(SCROLL_SOLDOUT_TEXT, 'scroll');
          this.render();
          return;
        }
        s.lumina -= price;
        const name = RECIPES.find((x) => x.id === r.recipe)?.name ?? '';
        toast(`まきものを ひらいた! 「${name}」の 作りかたが わかった`, 'scroll');
        sfx('quest');
      } else {
        s.lumina -= price;
        invAddRecorded(s, id, 1); // 買ったものも ずかんに記録する(ツムギ工房と同じ)
        toast(`${ITEMS[id].name}を かった!`, id);
        sfx('ui');
      }
      this.onTrade?.();
      this.render();
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

  /** いま ならんでいる品(検証・テストが 画面と同じものを 見られるようにする) */
  rows(): MarketRow[] {
    return marketRowsFor(this.getState(), this.getDay());
  }

  private render(): void {
    const s = this.getState();
    const day = this.getDay();
    const rows = this.rows();
    let body = '';
    let last: MarketRow['group'] | null = null;
    for (const r of rows) {
      if (r.group !== last) {
        last = r.group;
        body += `<div class="market-group">${GROUP_LABEL[r.group]}</div>`;
      }
      const def = ITEMS[r.item];
      const can = s.lumina >= r.price;
      body += `<div class="craft-row">
        <span class="inv-ico">${icon(r.item)}</span>
        <span class="craft-name">${def.name}</span>
        <span class="shop-price">${icon('lumina')}${r.price}</span>
        <button class="craft-btn" data-buy="${r.item}" data-price="${r.price}" ${can ? '' : 'disabled'}>かう</button>
      </div>`;
    }
    const left = daysLeftInWeek(day);
    this.el.innerHTML = `
      <div class="panel-title">テンの店
        <span class="shop-lumina">${icon('lumina')}${s.lumina}</span>
        <span class="panel-close" data-close>${byInput('とじる(Esc)', 'とじる')}</span>
      </div>
      <div class="market-note">${marketWeek(day) + 1}しゅうめの しなもの・あと${left}日で 入れかわる</div>
      <div class="craft-list">${body}</div>
    `;
  }
}

// おくりものの選択パネル(会話中に「おくりものをする」を押すと開く小さなパネル)。
//
// 見た目の言語は他のパネル(もちもの・クラフト)と同じクラスを使い回す。
// クリックは委譲リスナー1本だけ(CraftUI・InventoryUIと同方針。毎描画のonclick割当てだと
// 「ボタンは見えるのに押せない」状態になり得る)。キーボードでもタッチでも同じ経路を通る。
import type { GameState } from '../game/GameState';
import { ITEMS, type ItemId } from '../data/items';
import { NPC_BY_ID } from '../data/npcs';
import { FRIEND_MAX, HEART_MAX, friendshipHearts, friendshipText, giftableItems } from '../systems/GiftSystem';
import { icon } from './icons';
import { sfx } from '../audio/AudioSystem';

export class GiftUI {
  private el: HTMLElement;
  open = false;
  private npcId = '';
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
        sfx('close');
        this.cancel();
        return;
      }
      const id = t.dataset.give as ItemId | undefined;
      if (!id) return;
      this.onChoose?.(id);
    });
  }

  /** NPCのIDで開く(名前・いまのなかよし度は ここで引く。呼び出し側は配線だけ) */
  show(npcId: string): void {
    this.npcId = npcId;
    this.npcName = NPC_BY_ID[npcId]?.name ?? npcId;
    this.open = true;
    this.render();
    this.el.classList.remove('hidden');
    sfx('open');
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
    // いまの なかよし度を ハート+数字で 出す。あげる前と あとを 見くらべられるようにする
    const f = s.npcs[this.npcId]?.friendship ?? 0;
    const filled = friendshipHearts(f);
    const hearts = Array.from({ length: HEART_MAX }, (_, i) => icon(i < filled ? 'heart' : 'heart_off')).join('');
    const maxed = f >= FRIEND_MAX;
    const note = maxed
      ? 'なかよし度は さいこう! おくりものは いつでも よろこんでくれるよ。'
      : 'なんかいでも あげられるよ。すきなものを あげると もっと よろこぶよ。';
    this.el.innerHTML = `
      <div class="panel-title">${this.npcName}に おくりもの
        <span class="panel-close" data-close>やめる</span>
      </div>
      <div class="quest-row" style="display:flex;align-items:center;gap:10px;padding:2px 12px 8px">
        <span class="q-title" style="min-width:5.5em">なかよし度</span>
        <span style="display:inline-flex;gap:2px;font-size:0.95rem;line-height:0">${hearts}</span>
        <span class="q-status" style="margin-top:0;font-weight:900" data-friend-num>${friendshipText(f)}</span>
      </div>
      <div class="inv-grid" style="${grid}">${slots || '<div class="inv-empty">いま あげられるものが ない。島で なにか 見つけてこよう!</div>'}</div>
      <div class="panel-sub">${note}</div>
    `;
    // クリック処理はコンストラクタの委譲リスナーが担当(ここでは付けない)
  }
}

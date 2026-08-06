// 依頼リスト(Q)。下部に「なかよし度」(おくりもので上がる)をハートで小さく出す。
import type { GameState } from '../game/GameState';
import { activeQuests } from '../systems/QuestSystem';
import { NPCS, NPC_BY_ID } from '../data/npcs';
import { QUESTS } from '../data/quests';
import { FRIEND_BEST, HEART_MAX, friendshipHearts, friendshipText } from '../systems/GiftSystem';
import { icon } from './icons';
import { byInput } from './inputMode';

export class QuestLogUI {
  private el: HTMLElement;
  open = false;

  constructor(private getState: () => GameState) {
    this.el = document.createElement('div');
    this.el.className = 'panel quest-panel hidden';
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

  /**
   * なかよし度の1行 × NPC人数。ハートは HEART_MAX 個で、1つ=なかよし度2。
   * 形(ハート)と 数字(7/10)の両方を出す。ハートだけだと 1つ ふえるまで見た目が変わらず、
   * 「あげても 上がっていない」と 見えてしまうため(数字は 1回ごとに かならず動く)。
   * 見た目のクラスは他のパネルと同じものを使い、CSSは足さない(inlineで小さくする)。
   */
  private friendRows(s: GameState): string {
    return NPCS.map((def) => {
      const f = s.npcs[def.id]?.friendship ?? 0;
      const filled = friendshipHearts(f);
      const hearts = Array.from({ length: HEART_MAX }, (_, i) => icon(i < filled ? 'heart' : 'heart_off')).join('');
      const best = f >= FRIEND_BEST ? '<span class="q-done">しんゆう</span>' : '';
      return `<div class="quest-row" style="display:flex;align-items:center;gap:10px;padding:6px 12px">
        <span class="q-title" style="min-width:4.5em">${def.name}</span>
        <span style="display:inline-flex;gap:2px;font-size:0.95rem;line-height:0">${hearts}</span>
        <span class="q-status" style="margin-top:0;font-weight:900;min-width:3.2em" data-friend="${def.id}">${friendshipText(f)}</span>
        <span class="q-status" style="margin-top:0">${best}</span>
      </div>`;
    }).join('');
  }

  private render(): void {
    const s = this.getState();
    const acts = activeQuests(s);
    const doneCount = QUESTS.filter((q) => s.quests[q.id] === 'done').length;
    const rows = acts
      .map(({ def, remaining, accepted }) => {
        const npcName = def.npc === 'any' ? 'みんな' : NPC_BY_ID[def.npc].name;
        let status: string;
        if (!accepted) status = `<span class="q-new">${npcName}の はなしを聞こう</span>`;
        else if (remaining === 0) status = `<span class="q-done">できた! ${npcName}に ほうこくしよう</span>`;
        else status = def.progress.replace('{n}', String(remaining));
        return `<div class="quest-row"><div class="q-title">${def.title} <small>(${npcName})</small></div><div class="q-status">${status}</div></div>`;
      })
      .join('');
    this.el.innerHTML = `
      <div class="panel-title">島のおねがい <span class="panel-close" data-close>${byInput('とじる(Q)', 'とじる')}</span></div>
      <div class="craft-list">${rows || '<div class="inv-empty">いまは おねがいがない。島のみんなと話してみよう!</div>'}</div>
      <div class="panel-sub">たっせい: ${doneCount} / ${QUESTS.length}</div>
      <div class="panel-sub">なかよし度</div>
      <div class="craft-list">${this.friendRows(s)}</div>
    `;
    this.el.querySelector('[data-close]')?.addEventListener('click', () => this.close());
  }
}

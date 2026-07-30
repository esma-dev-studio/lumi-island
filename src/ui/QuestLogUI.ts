// 依頼リスト(Q)
import type { GameState } from '../game/GameState';
import { activeQuests } from '../systems/QuestSystem';
import { NPC_BY_ID } from '../data/npcs';
import { QUESTS } from '../data/quests';

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
      <div class="panel-title">島のおねがい <span class="panel-close" data-close>とじる(Q)</span></div>
      <div class="craft-list">${rows || '<div class="inv-empty">いまは おねがいがない。島のみんなと話してみよう!</div>'}</div>
      <div class="panel-sub">たっせい: ${doneCount} / ${QUESTS.length}</div>
    `;
    this.el.querySelector('[data-close]')?.addEventListener('click', () => this.close());
  }
}

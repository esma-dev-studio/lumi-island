// v15 でんごんばんのパネル(きょうの おてつだいが 2〜3件 はってある)。
//
// 見た目の言語は他のパネル(もちもの・ずかん・てがみ)と同じクラスを使い回す。
// クリックは委譲リスナー1本だけ(CraftUI・LetterUI と同方針)。
//
// 「受ける」ボタンは 置かない: おてつだいは 見た瞬間から 有効で、
// 持ちものを持って その人に話しかければ とどけられる。
// 押さなくてよいものに ボタンを出すと、子どもは「押さないと 始まらない」と思ってしまう。
import type { GameState } from '../game/GameState';
import { ITEMS } from '../data/items';
import { NPC_BY_ID } from '../data/npcs';
import { invCount } from '../game/GameState';
import { errandsOfDay, isErrandDone } from '../systems/BulletinSystem';
import { icon } from './icons';
import { byInput } from './inputMode';
import { sfx } from '../audio/AudioSystem';

export class BulletinUI {
  private el: HTMLElement;
  open = false;

  constructor(
    private getState: () => GameState,
    private getDay: () => number
  ) {
    this.el = document.createElement('div');
    this.el.className = 'panel bulletin-panel hidden';
    document.getElementById('ui-root')!.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-close]')) this.close();
    });
  }

  show(): void {
    this.render();
    this.open = true;
    this.el.classList.remove('hidden');
    sfx('ui');
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.el.classList.add('hidden');
  }

  toggle(): void {
    if (this.open) this.close();
    else this.show();
  }

  private render(): void {
    const s = this.getState();
    const day = this.getDay();
    const list = errandsOfDay(s, day);
    const rows = list
      .map((e) => {
        const done = isErrandDone(s, day, e.id);
        const have = Math.min(invCount(s, e.item), e.count);
        const name = NPC_BY_ID[e.npc]?.name ?? e.npc;
        const status = done
          ? '<span class="q-done">とどけた!</span>'
          : `もっている: ${have} / ${e.count}${have >= e.count ? ` <span class="q-new">${name}に とどけよう</span>` : ''}`;
        return `<div class="quest-row bl-row${done ? ' bl-done' : ''}" data-errand="${e.id}">
          <div class="bl-check">${icon(done ? 'check_on' : 'check_off')}</div>
          <div class="bl-main">
            <div class="q-title"><span class="inv-ico">${icon(e.item)}</span>
              ${ITEMS[e.item]?.name ?? e.item}を ${e.count}こ <small>${name}に</small></div>
            <div class="q-status">${status}</div>
          </div>
          <div class="bl-reward"><span class="t-ico">${icon('lumina')}</span>${e.reward}</div>
        </div>`;
      })
      .join('');
    this.el.innerHTML = `
      <div class="panel-title">でんごんばん
        <span class="panel-close" data-close>${byInput('とじる(Esc)', 'とじる')}</span>
      </div>
      <div class="panel-sub first">きょうの おてつだい</div>
      <div class="craft-list">${rows || '<div class="inv-empty">きょうは はりがみが ないみたい。また あした 見にこよう。</div>'}</div>
      <div class="panel-sub">たのまれたものを もって その人に 話しかけると、とどけられるよ。<br>
      きょうの ぶんは きょうまで。あしたは あたらしい おてつだいが はられるよ。</div>
    `;
  }
}

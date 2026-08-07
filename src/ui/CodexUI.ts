// ずかん(Z): 上段「あつめたもの」(累計入手数)+下段「じっせき」
// 見た目の言語は他のパネル(もちもの・おねがい)と同じものを使い回す。
import type { GameState } from '../game/GameState';
import { ITEMS, RECIPES, type ItemId } from '../data/items';
import { COMBOS, COMBO_GROUPS } from '../data/combos';
import { isDiscovered } from '../systems/ComboSystem';
import { ACHIEVEMENTS, achievedCount, achievementRows } from '../systems/AchievementSystem';
import { icon } from './icons';
import { byInput } from './inputMode';

/** 達成マーク。絵文字は使わずSVG(icons.tsと同じ描き方) */
const CHECK =
  '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" ' +
  'stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5 L9.5 18 L20 6"/></svg>';

/** ずかんに並べる種類(道具は もちもの側の担当なので入れない) */
const CODEX_ITEMS = Object.keys(ITEMS) as ItemId[];

export class CodexUI {
  private el: HTMLElement;
  open = false;

  constructor(private getState: () => GameState) {
    this.el = document.createElement('div');
    this.el.className = 'panel codex-panel hidden';
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
    const codex = (s.codex ?? {}) as Partial<Record<ItemId, number>>;
    let found = 0;
    const cells = CODEX_ITEMS.map((id) => {
      const def = ITEMS[id];
      const n = codex[id] ?? 0;
      if (n > 0) {
        found++;
        return `<div class="codex-cell got" title="${def.desc}">
          <span class="inv-ico">${icon(id)}</span>
          <span class="codex-name">${def.name}</span>
          <span class="codex-n">${n}</span>
        </div>`;
      }
      return `<div class="codex-cell unknown" title="まだ 見つけていない">
        <span class="inv-ico">${icon(id)}</span>
        <span class="codex-name">?</span>
      </div>`;
    }).join('');

    const achRows = achievementRows(s)
      .map(({ def, cur, max, done }) => {
        const state = done
          ? `<span class="ach-state done">${CHECK}たっせい</span>`
          : `<span class="ach-state">${cur}/${max}</span>`;
        return `<div class="ach-row ${done ? 'done' : ''}">
          <span class="inv-ico">${icon(def.icon)}</span>
          <span class="ach-name">${def.name}<small>${def.desc}</small></span>
          ${state}
        </div>`;
      })
      .join('');

    // v12 くみあわせ: 見つけたものは 名前と絵、まだのものは「?」のシルエットわく。
    // 未発見でも「なかま(りょうり/いろ/かざり)」だけは見せる=何を ためせばよいかの
    // 手がかりになり、それでいて 答えは まだ分からない
    let comboFound = 0;
    const comboCells = COMBOS.map((c) => {
      const g = COMBO_GROUPS[c.group];
      if (isDiscovered(s, c)) {
        comboFound++;
        const recipe = RECIPES.find((r) => r.id === c.recipe);
        const out = recipe?.out ?? 'lumina';
        return `<div class="codex-cell got" title="${g.hint}">
          <span class="inv-ico">${icon(out)}</span>
          <span class="codex-name">${recipe?.name ?? '?'}</span>
        </div>`;
      }
      return `<div class="codex-cell unknown combo" title="${g.hint}">
        <span class="inv-ico">${icon('combo_unknown')}</span>
        <span class="codex-name">? <small>${g.label}</small></span>
      </div>`;
    }).join('');

    this.el.innerHTML = `
      <div class="panel-title">ずかん <span class="panel-close" data-close>${byInput('とじる(Z)', 'とじる')}</span></div>
      <div class="panel-sub first">あつめたもの <small>${found} / ${CODEX_ITEMS.length}</small></div>
      <div class="codex-grid">${cells}</div>
      <div class="panel-sub">くみあわせ <small>${comboFound} / ${COMBOS.length}</small></div>
      <div class="codex-grid">${comboCells}</div>
      <div class="panel-sub">じっせき <small>${achievedCount(s)} / ${ACHIEVEMENTS.length}</small></div>
      <div class="ach-list">${achRows}</div>
    `;
    this.el.querySelector('[data-close]')?.addEventListener('click', () => this.close());
  }
}

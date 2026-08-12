// ずかん(Z): タブ2枚。
//   「ずかん」 … あつめたもの(累計入手数)/くみあわせ/てがみ/じっせき
//   「バッジ」 … v14で足した103個のバッジ(カテゴリごとのグリッド)
// 見た目の言語は他のパネル(もちもの・おねがい・お店)と同じものを使い回す。
//
// タブに分けた理由: バッジが103個あるので、じっせきの下に つなげると
// 1本のスクロールが長くなりすぎて「あつめたもの」に戻れなくなる。
// はじめに開くのは いつも「ずかん」タブ(これまでと同じ画面が そのまま出る)。
import type { GameState } from '../game/GameState';
import { ITEMS, RECIPES, type ItemId } from '../data/items';
import { COMBOS, COMBO_GROUPS } from '../data/combos';
import { LETTERS } from '../data/letters';
import { isDiscovered } from '../systems/ComboSystem';
import { ACHIEVEMENTS, achievedCount, achievementRows } from '../systems/AchievementSystem';
import { isRewardGranted, rewardIcon, rewardLabel, rewardOf } from '../systems/AchievementRewards';
import { hasReadLetter, readLetterCount } from '../systems/BottleSystem';
import { festivalMemo } from '../systems/FestivalSystem';
import { badgeCountByCategory, badgeRows, earnedBadgeCount } from '../systems/BadgeSystem';
import {
  BADGES, BADGE_CATEGORIES, BADGE_CATEGORY_ORDER, BADGE_TIERS, type BadgeDef,
} from '../data/badges';
import { badgeIcon, icon } from './icons';
import { byInput } from './inputMode';

/** 達成マーク。絵文字は使わずSVG(icons.tsと同じ描き方) */
const CHECK =
  '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" ' +
  'stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5 L9.5 18 L20 6"/></svg>';

/** ずかんに並べる種類(道具は もちもの側の担当なので入れない) */
const CODEX_ITEMS = Object.keys(ITEMS) as ItemId[];

/** タブの種類。既定は codex(v13までと同じ画面) */
type CodexTab = 'codex' | 'badge';

/** バッジ1つぶんの絵(台座の形・色・段位のふち・中央のピクトを合成する) */
function badgeArt(def: BadgeDef): string {
  const cat = BADGE_CATEGORIES[def.cat];
  return badgeIcon({
    shape: cat.shape,
    face: cat.face,
    edge: cat.edge,
    ring: BADGE_TIERS[def.tier].ring,
    pict: def.pict,
  });
}

export class CodexUI {
  private el: HTMLElement;
  open = false;
  /** いま開いているタブ。閉じても おぼえておく(見ていた続きから開ける) */
  private tab: CodexTab = 'codex';
  /** v13 読んだ手紙を もういちど ひらく(GameSceneが手紙UIへ つなぐ) */
  onReadLetter: ((id: string) => void) | null = null;

  constructor(private getState: () => GameState) {
    this.el = document.createElement('div');
    this.el.className = 'panel codex-panel hidden';
    document.getElementById('ui-root')!.appendChild(this.el);
    // クリックは委譲リスナー1本(毎描画のonclick割り当てだと「見えるのに押せない」が起きる)
    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-close], [data-letter], [data-tab]') as HTMLElement | null;
      if (!t) return;
      if (t.hasAttribute('data-close')) {
        this.close();
        return;
      }
      const tab = t.dataset.tab as CodexTab | undefined;
      if (tab) {
        this.tab = tab;
        this.render();
        this.el.scrollTop = 0; // タブを かえたら いちばん上から見せる
        return;
      }
      const id = t.dataset.letter;
      if (id) this.onReadLetter?.(id);
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

  /** タブの見出し2枚。数は いつも出す(バッジが何こ たまったか ひと目で分かる) */
  private tabsHtml(s: GameState): string {
    const got = earnedBadgeCount(s);
    const btn = (id: CodexTab, label: string): string =>
      `<button class="shop-tab${this.tab === id ? ' on' : ''}" data-tab="${id}">${label}</button>`;
    return `<div class="shop-tabs codex-tabs">
      ${btn('codex', 'ずかん')}
      ${btn('badge', `バッジ ${got}/${BADGES.length}`)}
    </div>`;
  }

  /**
   * バッジのタブ。カテゴリごとに 見出し+グリッドで ならべる。
   * まだ取っていないものは シルエット(CSS)+「32/50」の進捗、
   * 取ったものは 色つき+取った日。
   */
  private renderBadges(s: GameState): void {
    const rows = badgeRows(s);
    const counts = badgeCountByCategory(s);
    const got = earnedBadgeCount(s);
    const sections = BADGE_CATEGORY_ORDER.map((cat, i) => {
      const c = BADGE_CATEGORIES[cat];
      const cells = rows
        .filter((r) => r.def.cat === cat)
        .map((r) => {
          const tier = BADGE_TIERS[r.def.tier];
          const state = r.got
            ? `<small class="badge-day">${r.day}日め</small>`
            : `<small class="badge-progress">${r.cur}/${r.max}</small>`;
          const title = r.got ? `${r.def.name}(${tier.label}) / ${r.def.desc}` : `まだ: ${r.def.desc}`;
          return `<div class="badge-cell ${r.got ? 'got' : 'locked'}" title="${title}">
            <span class="badge-ico">${badgeArt(r.def)}</span>
            <span class="badge-name">${r.def.name}${state}</span>
          </div>`;
        })
        .join('');
      return `<div class="panel-sub${i === 0 ? ' first' : ''}">${c.label} <small>${counts[cat].got} / ${counts[cat].all}</small></div>
        <div class="badge-grid">${cells}</div>`;
    }).join('');

    this.el.innerHTML = `
      <div class="panel-title">ずかん <span class="panel-close" data-close>${byInput('とじる(Z)', 'とじる')}</span></div>
      ${this.tabsHtml(s)}
      <div class="badge-total">あつめたバッジ <b>${got}</b> / ${BADGES.length}</div>
      ${sections}
    `;
  }

  private render(): void {
    const s = this.getState();
    if (this.tab === 'badge') {
      this.renderBadges(s);
      return;
    }
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
        // v13 ごほうび。未達成でも「なにが もらえるか」を見せる=集める理由になる。
        // 受けとりずみは うすくして、受けとる前との ちがいが 一目で分かるようにする
        const r = rewardOf(def.id);
        const reward = r
          ? `<span class="ach-reward ${isRewardGranted(s, def.id) ? 'got' : ''}" title="ごほうび: ${rewardLabel(r)}">
              <span class="inv-ico">${icon(rewardIcon(r))}</span>${rewardLabel(r)}
            </span>`
          : '';
        return `<div class="ach-row ${done ? 'done' : ''}">
          <span class="inv-ico">${icon(def.icon)}</span>
          <span class="ach-name">${def.name}<small>${def.desc}</small></span>
          ${reward}
          ${state}
        </div>`;
      })
      .join('');

    // v13 てがみ(メッセージボトル)。読んだものは 題名が出て、押すと もう一度 読める。
    // まだのものは「?」のわく——ずかんの くみあわせと まったく同じ見せ方にそろえてある
    const letterCells = LETTERS.map((l) => {
      if (hasReadLetter(s, l.id)) {
        return `<button class="codex-cell got letter" data-letter="${l.id}" title="もういちど よむ">
          <span class="inv-ico">${icon(l.icon)}</span>
          <span class="codex-name">${l.title}</span>
        </button>`;
      }
      return `<div class="codex-cell unknown" title="まだ ひろっていない てがみ">
        <span class="inv-ico">${icon('combo_unknown')}</span>
        <span class="codex-name">?</span>
      </div>`;
    }).join('');

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

    // v16 しまの ぎょうじ(ほしまつり)の ひとことメモ。
    // まだ 見ていない子には「いつ・どこ」だけ。見たあとは やりかたと 回数が出る
    const fes = festivalMemo(s);
    const memo = `<div class="codex-note${fes.seen ? ' seen' : ''}">
      <span class="inv-ico">${icon('festival')}</span>
      <span class="codex-note-text"><b>${fes.title}</b><small>${fes.text}</small></span>
    </div>`;

    this.el.innerHTML = `
      <div class="panel-title">ずかん <span class="panel-close" data-close>${byInput('とじる(Z)', 'とじる')}</span></div>
      ${this.tabsHtml(s)}
      <div class="panel-sub first">あつめたもの <small>${found} / ${CODEX_ITEMS.length}</small></div>
      <div class="codex-grid">${cells}</div>
      <div class="panel-sub">くみあわせ <small>${comboFound} / ${COMBOS.length}</small></div>
      <div class="codex-grid">${comboCells}</div>
      <div class="panel-sub">てがみ <small>${readLetterCount(s)} / ${LETTERS.length}</small></div>
      <div class="codex-grid">${letterCells}</div>
      <div class="panel-sub">しまの ぎょうじ</div>
      ${memo}
      <div class="panel-sub">じっせき <small>${achievedCount(s)} / ${ACHIEVEMENTS.length}</small></div>
      <div class="ach-list">${achRows}</div>
    `;
    // クリック処理はコンストラクタの委譲リスナーが担当(ここでは付けない)
  }
}

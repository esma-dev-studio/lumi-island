// @vitest-environment jsdom
// v14 ずかんの「バッジ」タブ(タブの切りかえ・シルエット+進捗・取得日・合成アイコン)。
import { describe, it, expect, beforeEach } from 'vitest';
import { CodexUI } from '../../src/ui/CodexUI';
import { BADGES, BADGE_CATEGORIES, BADGE_CATEGORY_ORDER, BADGE_TIERS } from '../../src/data/badges';
import { evaluateBadges } from '../../src/systems/BadgeSystem';
import { badgeIcon, iconBody, ICONS } from '../../src/ui/icons';
import { newGameState, invAddRecorded, type GameState } from '../../src/game/GameState';

beforeEach(() => {
  document.body.innerHTML = '<div id="ui-root"></div>';
});

const openCodex = (s: GameState): { ui: CodexUI; el: HTMLElement } => {
  const ui = new CodexUI(() => s);
  ui.toggle();
  return { ui, el: document.querySelector('.codex-panel') as HTMLElement };
};
const tabBtn = (el: HTMLElement, name: string): HTMLElement =>
  [...el.querySelectorAll<HTMLElement>('.shop-tab')].find((b) => b.textContent?.includes(name))!;
const badgeCells = (el: HTMLElement): HTMLElement[] => [...el.querySelectorAll<HTMLElement>('.badge-cell')];
const cellOf = (el: HTMLElement, name: string): HTMLElement =>
  badgeCells(el).find((c) => c.querySelector('.badge-name')?.textContent?.startsWith(name))!;

describe('ずかんのタブ', () => {
  it('はじめは「ずかん」タブ(v13までと同じ中身がそのまま出る)', () => {
    const { el } = openCodex(newGameState());
    expect(tabBtn(el, 'ずかん').classList.contains('on')).toBe(true);
    expect(el.querySelector('.codex-grid')).not.toBeNull(); // あつめたもの
    expect(el.querySelector('.ach-row')).not.toBeNull(); // じっせき
    expect(el.querySelector('.badge-cell')).toBeNull(); // バッジは まだ出ていない
  });

  it('タブの見出しに いま何こ取れているかを出す', () => {
    const s = newGameState();
    const { el } = openCodex(s);
    expect(tabBtn(el, 'バッジ').textContent).toContain(`0/${BADGES.length}`);
  });

  it('「バッジ」を押すと バッジのグリッドに切りかわり、戻れる', () => {
    const { el } = openCodex(newGameState());
    tabBtn(el, 'バッジ').click();
    expect(badgeCells(el).length).toBe(BADGES.length);
    expect(el.querySelector('.codex-grid')).toBeNull(); // ずかん側は出さない
    expect(el.textContent).toContain(`あつめたバッジ`);
    tabBtn(el, 'ずかん').click();
    expect(el.querySelector('.badge-cell')).toBeNull();
    expect(el.querySelector('.codex-grid')).not.toBeNull();
  });

  it('とじても タブは おぼえていて、開きなおすと同じタブが出る', () => {
    const s = newGameState();
    const { ui, el } = openCodex(s);
    tabBtn(el, 'バッジ').click();
    ui.close();
    ui.toggle();
    expect(badgeCells(el).length).toBe(BADGES.length);
  });
});

describe('バッジのマス', () => {
  it('未取得はシルエット(locked)+進捗、取得済みは色つき(got)+取得日', () => {
    const s = newGameState();
    s.time.day = 8;
    invAddRecorded(s, 'wood', 12);
    evaluateBadges(s);
    const { el } = openCodex(s);
    tabBtn(el, 'バッジ').click();

    const got = cellOf(el, 'もくざい 10こ');
    expect(got.classList.contains('got')).toBe(true);
    expect(got.classList.contains('locked')).toBe(false);
    expect(got.querySelector('.badge-day')!.textContent).toBe('8日め');

    const locked = cellOf(el, 'もくざい 50こ');
    expect(locked.classList.contains('locked')).toBe(true);
    expect(locked.querySelector('.badge-progress')!.textContent).toBe('12/50');
    expect(locked.querySelector('.badge-day')).toBeNull();
  });

  it('未取得のマスにも 取り方のヒントを持たせる(title)', () => {
    const { el } = openCodex(newGameState());
    tabBtn(el, 'バッジ').click();
    const cell = cellOf(el, 'はじめての つり');
    expect(cell.getAttribute('title')).toContain('サカナを 1ぴき つってみよう');
  });

  it('カテゴリごとの見出しと ◯/◯ が出る', () => {
    const s = newGameState();
    invAddRecorded(s, 'wood', 10);
    evaluateBadges(s);
    const { el } = openCodex(s);
    tabBtn(el, 'バッジ').click();
    const subs = [...el.querySelectorAll<HTMLElement>('.panel-sub')];
    expect(subs.length).toBe(BADGE_CATEGORY_ORDER.length);
    for (const cat of BADGE_CATEGORY_ORDER) {
      expect(el.textContent).toContain(BADGE_CATEGORIES[cat].label);
    }
    const gather = subs.find((x) => x.textContent?.startsWith('さいしゅ'))!;
    expect(gather.textContent).toContain('1 / 12');
    expect(el.textContent).toContain(`/ ${BADGES.length}`);
  });

  it('マスの数が グリッドの合計と合う(取りこぼし・重複がない)', () => {
    const { el } = openCodex(newGameState());
    tabBtn(el, 'バッジ').click();
    const grids = [...el.querySelectorAll<HTMLElement>('.badge-grid')];
    expect(grids.length).toBe(BADGE_CATEGORY_ORDER.length);
    expect(grids.reduce((n, g) => n + g.querySelectorAll('.badge-cell').length, 0)).toBe(BADGES.length);
  });

  it('絵文字ではなくSVGで描く(全マスにsvgが1つ以上)', () => {
    const { el } = openCodex(newGameState());
    tabBtn(el, 'バッジ').click();
    for (const c of badgeCells(el)) expect(c.querySelector('.badge-ico svg')).not.toBeNull();
  });
});

describe('バッジのアイコン合成', () => {
  it('iconBody は もとのピクトの中身だけを返す', () => {
    const body = iconBody('wood');
    expect(body.length).toBeGreaterThan(10);
    expect(body).not.toContain('<svg');
    expect(body).not.toContain('</svg>');
    expect(ICONS.wood).toContain(body);
    expect(iconBody('__no_such_icon__')).toBe('');
  });

  it('台座の色・段位のふち・中央のピクトが1枚のSVGに入る', () => {
    const cat = BADGE_CATEGORIES.fish;
    const svg = badgeIcon({
      shape: cat.shape, face: cat.face, edge: cat.edge,
      ring: BADGE_TIERS.gold.ring, pict: 'fish',
    });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain(cat.face); // 台座の色
    expect(svg).toContain(BADGE_TIERS.gold.ring); // きんのふち
    expect(svg).toContain(iconBody('fish')); // 中央のピクト
    expect(svg).toContain('viewBox="0 0 24 24"'); // ほかのピクトと同じ大きさ
  });

  it('形は4しゅるいとも 別のパスになる(丸・盾・六角・星)', () => {
    const of = (shape: string): string =>
      badgeIcon({ shape, face: '#fff', edge: '#000', ring: '#111', pict: 'wood' });
    const shapes = ['circle', 'shield', 'hex', 'star'].map(of);
    expect(new Set(shapes).size).toBe(4);
    // 知らない形は 丸にフォールバックする(絵の出ないバッジを作らない)
    expect(of('__unknown__')).toBe(of('circle'));
  });
});

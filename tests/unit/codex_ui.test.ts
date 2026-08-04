// @vitest-environment jsdom
// ずかんUI(あつめたもの・じっせき)と、タッチの「ずかん」ボタン・店での記録。
import { describe, it, expect, beforeEach } from 'vitest';
import { CodexUI } from '../../src/ui/CodexUI';
import { ShopUI } from '../../src/ui/ShopUI';
import { TouchControls, type TouchFrame } from '../../src/ui/TouchControls';
import { ACHIEVEMENTS } from '../../src/systems/AchievementSystem';
import { ITEMS } from '../../src/data/items';
import { newGameState, invAddRecorded, statAdd, type GameState } from '../../src/game/GameState';
import type { InputState } from '../../src/systems/PlayerController';

beforeEach(() => {
  document.body.innerHTML = '<div id="ui-root"></div>';
});

const openCodex = (s: GameState): { ui: CodexUI; el: HTMLElement } => {
  const ui = new CodexUI(() => s);
  ui.toggle();
  return { ui, el: document.querySelector('.codex-panel') as HTMLElement };
};
const cells = (el: HTMLElement): HTMLElement[] => [...el.querySelectorAll<HTMLElement>('.codex-cell')];
const cellOf = (el: HTMLElement, name: string): HTMLElement =>
  cells(el).find((c) => c.querySelector('.codex-name')?.textContent === name)!;
/** 上段(あつめたもの)の文字だけ。下段のじっせきの説明文と混ざらないようにする */
const gridText = (el: HTMLElement): string => el.querySelector('.codex-grid')!.textContent ?? '';

describe('CodexUI(あつめたもの)', () => {
  it('道具をのぞく全アイテムをならべる', () => {
    const { el } = openCodex(newGameState());
    expect(cells(el).length).toBe(Object.keys(ITEMS).length);
    expect(el.innerHTML).not.toContain('ツルハシ'); // 道具は もちもの側の担当
  });

  it('未入手はシルエット+「?」で、名前も個数も見せない', () => {
    const { el } = openCodex(newGameState());
    for (const c of cells(el)) {
      expect(c.classList.contains('unknown')).toBe(true);
      expect(c.querySelector('.codex-name')!.textContent).toBe('?');
      expect(c.querySelector('.codex-n')).toBeNull();
    }
    expect(gridText(el)).not.toContain('もくざい');
    expect(el.textContent).toContain(`0 / ${Object.keys(ITEMS).length}`);
  });

  it('入手済みは名前と累計を出す(所持数ではない)', () => {
    const s = newGameState();
    invAddRecorded(s, 'wood', 4);
    invAddRecorded(s, 'wood', 3);
    s.inventory.wood = 0; // 全部売った状態でも、ずかんの累計は残る
    const { el } = openCodex(s);
    const cell = cellOf(el, 'もくざい');
    expect(cell.classList.contains('got')).toBe(true);
    expect(cell.querySelector('.codex-n')!.textContent).toBe('7');
    expect(el.textContent).toContain(`1 / ${Object.keys(ITEMS).length}`);
    // ほかの種類は「?」のまま
    expect(cellOf(el, '?').classList.contains('unknown')).toBe(true);
  });

  it('開くたびに描き直す(採取のあとに開くと増えている)', () => {
    const s = newGameState();
    const { ui, el } = openCodex(s);
    expect(gridText(el)).not.toContain('サカナ');
    ui.close();
    invAddRecorded(s, 'fish', 1);
    ui.toggle();
    expect(gridText(el)).toContain('サカナ');
  });
});

describe('CodexUI(じっせき)', () => {
  it('10種の名前と、未達成の進捗を出す', () => {
    const s = newGameState();
    invAddRecorded(s, 'wood', 3);
    const { el } = openCodex(s);
    const rows = [...el.querySelectorAll<HTMLElement>('.ach-row')];
    expect(rows.length).toBe(ACHIEVEMENTS.length);
    for (const a of ACHIEVEMENTS) expect(el.textContent).toContain(a.name);
    const wood = rows.find((r) => r.textContent?.includes('きこりみならい'))!;
    expect(wood.querySelector('.ach-state')!.textContent).toBe('3/10');
    expect(wood.classList.contains('done')).toBe(false);
  });

  it('達成済みはお祝い色+チェックで見せる', () => {
    const s = newGameState();
    statAdd(s, 'ach_a_wood10', 1);
    const { el } = openCodex(s);
    const wood = [...el.querySelectorAll<HTMLElement>('.ach-row')]
      .find((r) => r.textContent?.includes('きこりみならい'))!;
    expect(wood.classList.contains('done')).toBe(true);
    expect(wood.querySelector('.ach-state')!.textContent).toContain('たっせい');
    expect(wood.querySelector('.ach-state svg')).not.toBeNull(); // 絵文字ではなくSVGのチェック
    expect(el.textContent).toContain(`1 / ${ACHIEVEMENTS.length}`);
  });

  it('未達成には取り方のヒントを見せる', () => {
    const { el } = openCodex(newGameState());
    expect(el.textContent).toContain('もくざいを ぜんぶで 10こ あつめよう');
  });

  it('新素材まちの2つ(おはなばたけ・よふかしのたからもの)も0で安全に出る', () => {
    const { el } = openCodex(newGameState());
    const rows = [...el.querySelectorAll<HTMLElement>('.ach-row')];
    const flower = rows.find((r) => r.textContent?.includes('おはなばたけ'))!;
    const star = rows.find((r) => r.textContent?.includes('よふかしのたからもの'))!;
    expect(flower.querySelector('.ach-state')!.textContent).toBe('0/10');
    expect(star.querySelector('.ach-state')!.textContent).toBe('0/1');
  });
});

describe('CodexUI(開閉)', () => {
  it('toggleで開閉し、とじるボタンでも閉じる', () => {
    const { ui, el } = openCodex(newGameState());
    expect(ui.open).toBe(true);
    expect(el.classList.contains('hidden')).toBe(false);
    (el.querySelector('[data-close]') as HTMLElement).click();
    expect(ui.open).toBe(false);
    expect(el.classList.contains('hidden')).toBe(true);
    ui.toggle();
    expect(ui.open).toBe(true);
    ui.close();
    expect(ui.open).toBe(false);
  });

  it('キーボードのときは「とじる(Z)」と出す', () => {
    const { el } = openCodex(newGameState());
    expect(el.querySelector('[data-close]')!.textContent).toBe('とじる(Z)');
  });
});

describe('店で買ったものもずかんに載る(売ったものは載らない)', () => {
  it('かうとcodexが増え、うるでは増えない', () => {
    const s = newGameState();
    s.lumina = 500;
    invAddRecorded(s, 'wood', 1);
    const shop = new ShopUI(() => s);
    shop.show();
    const buyTab = [...document.querySelectorAll<HTMLElement>('.shop-tab')]
      .find((b) => b.textContent?.includes('かう'))!;
    buyTab.click();
    (document.querySelector('[data-buy="f_chair"]') as HTMLElement).click();
    expect(s.inventory.f_chair).toBe(1);
    expect(s.codex.f_chair).toBe(1);
    // うる側: 売っても累計は動かない
    const sellTab = [...document.querySelectorAll<HTMLElement>('.shop-tab')]
      .find((b) => b.textContent === 'うる')!;
    sellTab.click();
    (document.querySelector('[data-sell="wood"]') as HTMLElement).click();
    expect(s.codex.wood).toBe(1);
  });
});

describe('タッチの「ずかん」ボタン', () => {
  const frame = (o: Partial<TouchFrame> = {}): TouchFrame => ({
    hint: '',
    gates: { inventory: false, craft: false, quest: false },
    placementActive: false,
    dialogueOpen: false,
    questCompleteOpen: false,
    sequenceActive: false,
    panelOpen: false,
    ...o,
  });
  const input = (): InputState => ({ up: false, down: false, left: false, right: false, run: false });
  const evt = (type: string, init: Record<string, unknown> = {}): Event =>
    Object.assign(new Event(type, { bubbles: true, cancelable: true }),
      { pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 }, init);
  const shown = (el: Element): boolean => !el.classList.contains('hidden');

  it('もちものと同じ解放ゲートで出て、押すとonCodexを呼ぶ', () => {
    const calls: string[] = [];
    const tc = new TouchControls({
      root: document.getElementById('ui-root')!,
      input: input(),
      onInteract: () => {}, onInventory: () => {}, onCraft: () => {},
      onQuest: () => {}, onMenu: () => {}, onRotate: () => {},
      onCodex: () => calls.push('codex'),
    });
    tc.attach();
    tc.setVisible(true);
    const btn = document.querySelector('[data-el="codex"]')!;
    expect(btn.textContent).toContain('ずかん');
    tc.sync(frame());
    expect(shown(btn)).toBe(false); // 未解放では出さない
    tc.sync(frame({ gates: { inventory: true, craft: false, quest: false } }));
    expect(shown(btn)).toBe(true);
    btn.dispatchEvent(evt('pointerdown'));
    expect(calls).toEqual(['codex']);
    tc.dispose();
  });

  it('onCodexを渡さない使い方では、機能のないボタンを出さない', () => {
    const tc = new TouchControls({
      root: document.getElementById('ui-root')!,
      input: input(),
      onInteract: () => {}, onInventory: () => {}, onCraft: () => {},
      onQuest: () => {}, onMenu: () => {}, onRotate: () => {},
    });
    tc.attach();
    tc.setVisible(true);
    tc.sync(frame({ gates: { inventory: true, craft: true, quest: true } }));
    expect(shown(document.querySelector('[data-el="codex"]')!)).toBe(false);
    tc.dispose();
  });
});

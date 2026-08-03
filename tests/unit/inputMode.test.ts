// @vitest-environment jsdom
// 操作案内の文言が入力手段で切り替わることのテスト。
// タッチかどうかは TouchControls が出し入れするタッチUI(.touch-root)の表示状態を
// そのまま読む(判定の二重化をしない)ので、ここでも本物の TouchControls で切り替える。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isTouchMode, byInput, hintWithoutKeys, resetInputModeCache } from '../../src/ui/inputMode';
import { TouchControls } from '../../src/ui/TouchControls';
import { Hud } from '../../src/ui/Hud';
import { PauseMenu } from '../../src/ui/PauseMenu';
import { TitleScreen } from '../../src/ui/TitleScreen';
import { DialogueUI } from '../../src/ui/DialogueUI';
import { TutorialSystem } from '../../src/systems/TutorialSystem';
import { currentObjective, type NpcAvailability } from '../../src/systems/ObjectiveSystem';
import { acceptQuest } from '../../src/systems/QuestSystem';
import { QUEST_BY_ID } from '../../src/data/quests';
import { newGameState, invAdd, giveTool } from '../../src/game/GameState';
import { categorizeObjective } from '../../tools/ux_semantic_check.mjs';
import type { InputState } from '../../src/systems/PlayerController';

let tc: TouchControls | null = null;

/** 本物のタッチUIを作って「いまタッチ操作」の状態にする */
function enterTouch(): void {
  const input: InputState = { up: false, down: false, left: false, right: false, run: false };
  tc = new TouchControls({
    root: document.getElementById('ui-root')!,
    input,
    onInteract: () => {},
    onInventory: () => {},
    onCraft: () => {},
    onQuest: () => {},
    onMenu: () => {},
    onRotate: () => {},
  });
  tc.attach();
  tc.setVisible(true);
}

beforeEach(() => {
  // #ui-root と .toast-box は作り直さない(Toast.ts が入れ物を持ち続けるため、
  // 毎回 body を空にすると2回目以降のトーストが画面外の要素に積まれてしまう)
  let root = document.getElementById('ui-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'ui-root';
    document.body.appendChild(root);
  }
  for (const el of root.querySelectorAll(
    '.touch-root, .hud-top, .hud-hint, .pause-panel, .toast, .title-screen, .dialogue'
  )) {
    el.remove();
  }
  document.documentElement.classList.remove('touch-ui'); // フォールバックの印を毎回まっさらに
  resetInputModeCache();
});
afterEach(() => {
  tc?.dispose();
  tc = null;
  document.documentElement.classList.remove('touch-ui');
  resetInputModeCache();
});

describe('isTouchMode(入力手段の判定)', () => {
  it('タッチUIが無いときはキーボード扱い', () => {
    expect(isTouchMode()).toBe(false);
    expect(byInput('キー', 'ゆび')).toBe('キー');
  });

  it('TouchControlsの表示状態と必ず一致する(判定を別に持たない)', () => {
    enterTouch();
    expect(tc!.visible).toBe(true);
    expect(isTouchMode()).toBe(true);
    expect(byInput('キー', 'ゆび')).toBe('ゆび');
    // キーボードに戻る(TouchControls が隠す)と案内もキーボードへ戻る
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    expect(tc!.visible).toBe(false);
    expect(isTouchMode()).toBe(false);
    // 指で触ればまた戻る(起動時に固定しない)
    const e = Object.assign(new Event('pointerdown', { bubbles: true }), { pointerType: 'touch' });
    window.dispatchEvent(e);
    expect(isTouchMode()).toBe(true);
  });

  it('タッチUIを片付けたらキーボード扱いに戻る', () => {
    enterTouch();
    expect(isTouchMode()).toBe(true);
    tc!.dispose();
    tc = null;
    expect(isTouchMode()).toBe(false);
  });
});

describe('isTouchMode のフォールバック(タイトル画面: TouchControls がまだ無い)', () => {
  it('main.tsが付ける <html class="touch-ui"> をタッチ扱いにする', () => {
    expect(isTouchMode()).toBe(false);
    document.documentElement.classList.add('touch-ui');
    expect(isTouchMode()).toBe(true);
    document.documentElement.classList.remove('touch-ui');
    expect(isTouchMode()).toBe(false);
  });

  it('touch-uiが無くても (pointer: coarse) ならタッチ扱い', () => {
    const orig = window.matchMedia;
    window.matchMedia = ((q: string) =>
      ({ matches: /coarse/.test(q) }) as MediaQueryList) as typeof window.matchMedia;
    try {
      expect(isTouchMode()).toBe(true);
    } finally {
      window.matchMedia = orig;
    }
  });

  it('タッチUIがある場面ではフォールバックより TouchControls の状態が優先される', () => {
    document.documentElement.classList.add('touch-ui'); // 端末はタッチ対応
    enterTouch();
    expect(isTouchMode()).toBe(true);
    // キーボードに持ちかえたら、端末がタッチ対応でもキーボード扱いに戻る
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    expect(tc!.visible).toBe(false);
    expect(isTouchMode()).toBe(false);
  });
});

describe('hintWithoutKeys(ヒントからキー表示を外す)', () => {
  it('E/Spaceのキー表示だけ消して、あとの文はそのまま残す', () => {
    expect(hintWithoutKeys('<kbd>E</kbd>木をきる')).toBe('木をきる');
    expect(hintWithoutKeys('<b class="bite">!!</b> <kbd>E</kbd>つりあげる')).toBe(
      '<b class="bite">!!</b> つりあげる'
    );
  });

  it('専用ボタンがあるキー(R・Esc)から後ろは切る', () => {
    expect(hintWithoutKeys('<kbd>E</kbd>おく <kbd>R</kbd>まわす <kbd>Esc</kbd>やめる')).toBe('おく');
    expect(hintWithoutKeys('まってる… <kbd>Esc</kbd>やめる')).toBe('まってる…');
    expect(
      hintWithoutKeys('水の上には おけないよ — うごかして ばしょを さがそう <kbd>R</kbd>まわす')
    ).toBe('水の上には おけないよ — うごかして ばしょを さがそう');
  });

  it('キー表示のないヒントは変えない', () => {
    expect(hintWithoutKeys('つりには ツリザオが ひつよう')).toBe('つりには ツリザオが ひつよう');
    expect(hintWithoutKeys('')).toBe('');
  });
});

describe('TutorialSystem(移動チュートリアルと解放の案内)', () => {
  const toastTexts = (): string[] =>
    [...document.querySelectorAll('.toast')].map((el) => el.innerHTML);

  it('キーボードのときの文言は従来どおり', () => {
    const t = new TutorialSystem(newGameState());
    expect(t.overrideObjective()?.label).toBe(
      '<kbd>WASD</kbd>か<kbd>矢印キー</kbd>で あるいてみよう'
    );
    t.onFirstItem();
    t.onQuestAccepted();
    t.onCraftUnlocked();
    const html = toastTexts().join('\n');
    expect(html).toContain('<kbd>Tab</kbd>で「もちもの」が見られるよ');
    expect(html).toContain('<kbd>Q</kbd>で おねがいを見られるよ');
    expect(html).toContain('<kbd>C</kbd>で クラフトができるよ');
  });

  it('タッチのときはキーの名前もkbdも出さず、画面のボタンの名前で言う', () => {
    enterTouch();
    const t = new TutorialSystem(newGameState());
    const label = t.overrideObjective()!.label;
    expect(label).toBe('がめん左下を ゆびで うごかして あるいてみよう');
    expect(label).not.toContain('kbd');
    t.onFirstItem();
    t.onQuestAccepted();
    t.onCraftUnlocked();
    const html = toastTexts().join('\n');
    expect(html).toContain('右上の「もちもの」ボタンで 見られるよ');
    expect(html).toContain('右上の「おねがい」ボタンで 見られるよ');
    expect(html).toContain('右上の「クラフト」ボタンで クラフトができるよ');
    expect(html).not.toContain('<kbd>');
    // UXボットの目的分類(あるいてみよう=tutorial)を壊さない
    expect(label).toMatch(/あるいてみよう/);
  });

  it('表示のたびに入力手段で決まる(途中で指に持ちかえても切り替わる)', () => {
    const t = new TutorialSystem(newGameState());
    expect(t.overrideObjective()?.label).toContain('<kbd>WASD</kbd>');
    enterTouch();
    expect(t.overrideObjective()?.label).toBe('がめん左下を ゆびで うごかして あるいてみよう');
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    expect(t.overrideObjective()?.label).toContain('<kbd>WASD</kbd>');
  });
});

describe('PauseMenu(そうさほうほう)', () => {
  it('キーボードのときはキーの一覧を出す(従来どおり)', () => {
    const p = new PauseMenu();
    p.show();
    const grid = document.querySelector('.help-grid')!;
    expect(grid.innerHTML).toContain('<kbd>W A S D</kbd></span><span>あるく');
    expect(grid.innerHTML).toContain('<kbd>Shift</kbd></span><span>はしる');
    expect(grid.innerHTML).toContain('<kbd>E</kbd></span><span>しらべる・とる・はなす');
    expect(grid.innerHTML).toContain('<kbd>Tab</kbd></span><span>もちもの');
    expect(grid.innerHTML).toContain('<kbd>C</kbd></span><span>クラフト');
    expect(grid.innerHTML).toContain('<kbd>Q</kbd></span><span>おねがい');
    expect(grid.innerHTML).toContain('<kbd>R</kbd></span><span>(はいち中)まわす');
  });

  it('タッチのときは画面のボタンの一覧を出す(キー名もkbdも出さない)', () => {
    enterTouch();
    const p = new PauseMenu();
    p.show();
    const grid = document.querySelector('.help-grid')!;
    expect(grid.innerHTML).not.toContain('<kbd>');
    const text = grid.textContent ?? '';
    expect(text).toContain('左下を ゆびで うごかす');
    expect(text).toContain('右下の 大きいボタン');
    expect(text).toContain('右上の「もちもの」');
    expect(text).toContain('「まわす」ボタン');
    for (const key of ['W A S D', 'Shift', 'Tab', 'Esc']) expect(text).not.toContain(key);
  });

  it('開くたびに入力手段で決まる', () => {
    const p = new PauseMenu();
    p.show();
    expect(document.querySelector('.help-grid')!.innerHTML).toContain('<kbd>');
    p.close();
    enterTouch();
    p.show();
    expect(document.querySelector('.help-grid')!.innerHTML).not.toContain('<kbd>');
  });
});

describe('TitleScreen(そうさほうほう)', () => {
  const grid = (): HTMLElement => document.querySelector('.title-screen .help-grid')!;
  let title: TitleScreen | null = null;
  afterEach(() => {
    title?.dispose();
    title = null;
  });

  it('キーボードのときはキーの一覧を出す(従来どおり)', () => {
    title = new TitleScreen();
    const html = grid().innerHTML;
    expect(html).toContain('<kbd>W A S D</kbd>/<kbd>矢印</kbd></span><span>あるく');
    expect(html).toContain('<kbd>Shift</kbd></span><span>はしる');
    expect(html).toContain('<kbd>E</kbd>/<kbd>Space</kbd></span><span>しらべる・とる・はなす');
    expect(html).toContain('<kbd>Tab</kbd>/<kbd>I</kbd></span><span>もちもの');
    expect(html).toContain('<kbd>C</kbd></span><span>クラフト');
    expect(html).toContain('<kbd>Q</kbd></span><span>おねがい');
    expect(html).toContain('<kbd>R</kbd></span><span>(はいち中)まわす');
    expect(html).toContain('<kbd>Esc</kbd></span><span>とじる・メニュー');
  });

  it('タッチ端末(TouchControlsはまだ無い)では画面のボタンの一覧を出す', () => {
    document.documentElement.classList.add('touch-ui'); // main.ts がタッチ端末に付ける印
    title = new TitleScreen();
    const g = grid();
    expect(g.innerHTML).not.toContain('<kbd>');
    const text = g.textContent ?? '';
    expect(text).toContain('左下を ゆびで うごかす');
    expect(text).toContain('右下の 大きいボタン');
    expect(text).toContain('右上の「もちもの」');
    expect(text).toContain('右上の「クラフト」');
    expect(text).toContain('右上の「おねがい」');
    expect(text).toContain('「まわす」ボタン');
    expect(text).toContain('右上の「メニュー」');
    for (const key of ['W A S D', 'Shift', 'Space', 'Tab', 'Esc', '矢印']) {
      expect(text).not.toContain(key);
    }
  });
});

describe('DialogueUI(会話パネルの下の案内)', () => {
  const next = (): HTMLElement => document.querySelector('.dialogue .dlg-next')!;

  it('キーボードのときは従来どおり <kbd>E</kbd>つぎへ / おわる', () => {
    const d = new DialogueUI();
    d.show('ツムギ', ['1ぎょうめ', '2ぎょうめ']);
    expect(next().innerHTML).toBe('<kbd>E</kbd>つぎへ');
    d.advance();
    expect(next().innerHTML).toBe('<kbd>E</kbd>おわる');
  });

  it('タッチのときはキーを出さず「タップで つぎへ/おわる」', () => {
    enterTouch();
    const d = new DialogueUI();
    d.show('ツムギ', ['1ぎょうめ', '2ぎょうめ']);
    expect(next().innerHTML).toBe('タップで つぎへ');
    expect(next().innerHTML).not.toContain('kbd');
    d.advance();
    expect(next().innerHTML).toBe('タップで おわる');
    expect(next().innerHTML).not.toContain('kbd');
  });

  it('表示のたびに入力手段で決まる(途中で持ちかえても切り替わる)', () => {
    const d = new DialogueUI();
    d.show('ツムギ', ['ひとこと']);
    expect(next().innerHTML).toBe('<kbd>E</kbd>おわる');
    enterTouch();
    d.show('ツムギ', ['ひとこと']);
    expect(next().innerHTML).toBe('タップで おわる');
  });
});

describe('ObjectiveSystem(いまやること・迷子ヒント)', () => {
  /** ツリザオの素材がそろって「クラフトしよう」になる状態 */
  const readyToCraft = (): ReturnType<typeof newGameState> => {
    const s = newGameState();
    s.quests.q_wood = 'done';
    s.quests.q_fish = 'open';
    acceptQuest(s, QUEST_BY_ID.q_fish);
    giveTool(s, 'sickle');
    invAdd(s, 'wood', 2);
    invAdd(s, 'fiber', 2);
    return s;
  };
  const asleep: Record<string, NpcAvailability> = { tsumugi: { hidden: true } };

  it('キーボードのときの目標文・迷子ヒントは1文字も変わらない(UXボットの意味分類が見る)', () => {
    const o = currentObjective(readyToCraft());
    expect(o.craftRecipe).toBe('r_rod');
    expect(o.label).toBe('ざいりょうが そろったよ! <kbd>C</kbd>で ツリザオを作ろう');
    expect(currentObjective(newGameState()).lostHint).toBe(
      'ツムギに 近づいて <kbd>E</kbd>で話しかけよう。'
    );
    expect(currentObjective(newGameState(), 'tsumugi', asleep).lostHint).toBe(
      'じぶんの家の ドアの前で <kbd>E</kbd>を おすと ねむれるよ。'
    );
  });

  it('タッチのときは画面のボタンの名前で言う(kbdは出さない)', () => {
    enterTouch();
    const o = currentObjective(readyToCraft());
    expect(o.label).toBe('ざいりょうが そろったよ! 右上の「クラフト」ボタンで ツリザオを作ろう');
    expect(o.label).not.toContain('kbd');
    expect(currentObjective(newGameState()).lostHint).toBe(
      'ツムギに 近づいて 右下の 大きいボタンで話しかけよう。'
    );
    expect(currentObjective(newGameState(), 'tsumugi', asleep).lostHint).toBe(
      'じぶんの家の ドアの前で 右下の 大きいボタンを おすと ねむれるよ。'
    );
  });

  it('構造フィールドは入力手段で変えない(回帰ボット・E候補の選別が使う)', () => {
    const s = readyToCraft();
    const keyboard = currentObjective(s);
    enterTouch();
    const touch = currentObjective(s);
    expect(touch.id).toBe(keyboard.id);
    expect(touch.headline).toBe(keyboard.headline);
    expect(touch.craftRecipe).toBe(keyboard.craftRecipe);
    expect(touch.target).toEqual(keyboard.target);
    expect(touch.progress).toEqual(keyboard.progress);
  });

  it('タッチの目標文もUXボットの意味分類でcraftのまま', () => {
    // tools/ux_semantic_check.mjs は画面の日本語だけで分類する。
    // 「ざいりょうが そろった」を残しているので、タッチ文でも分類は変わらない。
    enterTouch();
    expect(categorizeObjective(currentObjective(readyToCraft()).label)).toBe('craft');
  });
});

describe('Hud(画面下のヒント)', () => {
  const hintEl = (): HTMLElement => document.getElementById('hud-hint')!;

  it('キーボードのときはヒントのHTMLをそのまま出す(従来どおり)', () => {
    const hud = new Hud();
    hud.setHint('<kbd>E</kbd>木をきる');
    expect(hintEl().innerHTML).toBe('<kbd>E</kbd>木をきる');
    expect(hintEl().classList.contains('show')).toBe(true);
    hud.setHint('');
    expect(hintEl().classList.contains('show')).toBe(false);
  });

  it('タッチのときはキーの表示を出さない', () => {
    enterTouch();
    const hud = new Hud();
    hud.setHint('<kbd>E</kbd>ツムギと はなす');
    expect(hintEl().innerHTML).toBe('ツムギと はなす');
    hud.setHint('<kbd>E</kbd>おく <kbd>R</kbd>まわす <kbd>Esc</kbd>やめる');
    expect(hintEl().innerHTML).toBe('おく');
    expect(hintEl().innerHTML).not.toContain('kbd');
  });

  it('同じヒントのままでも入力手段が変わったら出しなおす', () => {
    const hud = new Hud();
    hud.setHint('<kbd>E</kbd>木をきる');
    expect(hintEl().innerHTML).toBe('<kbd>E</kbd>木をきる');
    enterTouch();
    hud.setHint('<kbd>E</kbd>木をきる'); // 同じ文字列でも入れ替わる
    expect(hintEl().innerHTML).toBe('木をきる');
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    hud.setHint('<kbd>E</kbd>木をきる');
    expect(hintEl().innerHTML).toBe('<kbd>E</kbd>木をきる');
  });
});

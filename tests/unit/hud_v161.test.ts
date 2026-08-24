// @vitest-environment jsdom
// v16.1 HUDまわりの手当て3つ。
//   P1-4 ルミナの その場フィードバック(浮きの「+368」・数え上がり)
//   P1-7 はいち中の ヒント帯(○/× と 帯の色)
//   P2-9 矢印の m バッジは 目標カードと 同じ数のとき 出さない
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hud, LUMINA_COUNT_MS, LUMINA_POP_MS } from '../../src/ui/Hud';
import { ObjectiveHud, SUB_DIST_MIN } from '../../src/ui/ObjectiveHud';
import { ARROW_ARRIVE_R } from '../../src/scenes/WorldMarkerController';
import type { Objective } from '../../src/systems/ObjectiveSystem';

/**
 * にせの時計。数え上がりは requestAnimationFrame と performance.now で 進むので、
 * その2つも いっしょに にせものにする(vitest の 既定では 本物のまま)。
 */
const fakeFrames = (): void => {
  vi.useFakeTimers({
    toFake: [
      'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
      'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date',
    ],
  });
};

const q = <T extends HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);
const luminaText = (): string => q('#hud-lumina .lumina-n')?.textContent ?? '';
const pop = (): HTMLElement | null => q('#hud-lumina .lumina-pop');

beforeEach(() => {
  document.body.innerHTML = '<div id="ui-root"></div>';
});
afterEach(() => {
  vi.useRealTimers();
});

describe('P1-4 ルミナの その場フィードバック', () => {
  it('読みこみ直後の1回目は 浮きを 出さない(0→4820を お祝いしない)', () => {
    const hud = new Hud();
    hud.setLumina(4820);
    expect(luminaText()).toBe('4820');
    expect(pop(), '1回目は 浮かせない').toBeNull();
  });

  it('ふえたら 金いろの「+368」、へったら 灰いろの「-300」が 浮く', () => {
    fakeFrames();
    const hud = new Hud();
    hud.setLumina(4820);
    hud.setLumina(5188);
    expect(pop()?.textContent).toBe('+368');
    expect(pop()?.className).toContain('gain');
    hud.setLumina(4888);
    expect(pop()?.textContent).toBe('-300');
    expect(pop()?.className).toContain('loss');
    // 0.9秒で 消える
    vi.advanceTimersByTime(LUMINA_POP_MS + 20);
    expect(pop()).toBeNull();
  });

  it('同じ値を 何回セットしても 浮きは 出ない(毎フレーム呼ばれるため)', () => {
    const hud = new Hud();
    hud.setLumina(4820);
    for (let i = 0; i < 10; i++) hud.setLumina(4820);
    expect(pop()).toBeNull();
  });

  it('数字は すぐには 飛ばず、0.4秒かけて 新しい値に とどく', () => {
    fakeFrames();
    const hud = new Hud();
    hud.setLumina(4820);
    hud.setLumina(5188);
    expect(luminaText(), 'その場では まだ 元の値').toBe('4820');
    vi.advanceTimersByTime(LUMINA_COUNT_MS + 60);
    expect(luminaText(), '数え上がりが とどく').toBe('5188');
  });

  it('数え上がりの とちゅうで もう一度 動いても、さいごは 新しい値になる', () => {
    fakeFrames();
    const hud = new Hud();
    hud.setLumina(1000);
    hud.setLumina(2000);
    vi.advanceTimersByTime(Math.round(LUMINA_COUNT_MS / 2));
    hud.setLumina(1500);
    vi.advanceTimersByTime(LUMINA_COUNT_MS + 60);
    expect(luminaText()).toBe('1500');
  });
});

describe('P1-7 はいち中の ヒント帯', () => {
  const hint = (): HTMLElement => q('#hud-hint')!;

  it('おけるときは ○ と みどりの帯(place + ok)', () => {
    const hud = new Hud();
    hud.setHint('<kbd>E</kbd>ここに おく <kbd>R</kbd>まわす', 'ok');
    expect(hint().className).toContain('place');
    expect(hint().className).toContain('ok');
    expect(hint().className).not.toContain('ng');
    expect(hint().querySelector('.ph-mark.ok')?.textContent).toBe('○');
  });

  it('おけないときは × と あかい帯(place + ng)', () => {
    const hud = new Hud();
    hud.setHint('水の上には おけないよ — うごかして ばしょを さがそう <kbd>R</kbd>まわす', 'ng');
    expect(hint().className).toContain('ng');
    expect(hint().querySelector('.ph-mark.ng')?.textContent).toBe('×');
    // 文そのものは 変えない(タッチのラベル・ボットの突きあわせが 読む)
    expect(hint().textContent).toContain('うごかして ばしょを さがそう');
  });

  it('ふつうのヒントは これまでどおり(しるしも 色も 付かない)', () => {
    const hud = new Hud();
    hud.setHint('<kbd>E</kbd>ミナモと はなす');
    expect(hint().className).not.toContain('place');
    expect(hint().querySelector('.ph-mark')).toBeNull();
    expect(hint().innerHTML).toBe('<kbd>E</kbd>ミナモと はなす');
  });

  it('はいちを やめると しるしも 色も 消える', () => {
    const hud = new Hud();
    hud.setHint('<kbd>E</kbd>ここに おく', 'ok');
    hud.setHint('<kbd>E</kbd>ミナモと はなす', null);
    expect(hint().className).not.toContain('place');
    expect(hint().className).not.toContain('ok');
    expect(hint().querySelector('.ph-mark')).toBeNull();
  });

  it('同じ文でも いろが かわれば 描きなおす(○↔×の 取りこぼしを 作らない)', () => {
    const hud = new Hud();
    const text = '<kbd>E</kbd>ここに おく <kbd>R</kbd>まわす';
    hud.setHint(text, 'ok');
    hud.setHint(text, 'ng');
    expect(hint().querySelector('.ph-mark.ng')).not.toBeNull();
    expect(hint().className).toContain('ng');
    expect(hint().className).not.toContain('ok');
  });
});

describe('P2-9 矢印の m バッジ(目標カードと 同じ数のときは 出さない)', () => {
  const obj = (): Objective =>
    ({ id: 'x', headline: 'いまやること', label: 'あるいてみよう', target: { kind: 'poi', id: 'bed' } }) as Objective;

  it('カードが 出している数字を そのまま 読める(shownDistance)', () => {
    const hud = new ObjectiveHud();
    hud.update(obj(), 33.4);
    expect(hud.shownDistance).toBe(33);
    expect(q('.obj-sub')?.textContent).toContain('→ 33m');
  });

  it('数字を 出していないときは null(近すぎ・目的地なし)', () => {
    const hud = new ObjectiveHud();
    hud.update(obj(), null);
    expect(hud.shownDistance).toBeNull();
    hud.update(obj(), SUB_DIST_MIN - 0.1);
    expect(hud.shownDistance).toBeNull();
  });

  /**
   * 矢印が 出ている帯(dist >= ARROW_ARRIVE_R)では、カードも かならず 同じ整数を 出す。
   * = ふつうに 遊んでいるあいだ、m バッジは いつも 消える(同じ数字が 2か所に 出ない)。
   * 数字が ずれるのは カードが 数字を やめたあと(近すぎ)だけで、そのときは 矢印も もう 消えている。
   */
  it('矢印が出る帯では カードの数字と かならず 同じ整数になる', () => {
    const hud = new ObjectiveHud();
    for (let d = ARROW_ARRIVE_R; d <= 80; d += 0.13) {
      hud.update(obj(), d);
      expect(hud.shownDistance, `${d}m`).toBe(Math.round(d));
    }
  });
});

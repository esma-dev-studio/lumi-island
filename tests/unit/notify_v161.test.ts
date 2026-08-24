// @vitest-environment jsdom
// v16.1 お知らせの3レーン(小物 / お祝いバナー / 左上は目標カード専用)。
//
// 何を機械で しばるか:
//   1. 種類 → レーンの 振り分け(laneOf)が 表のとおりであること
//   2. 小物は 右下の .toast-box に つみ、上限4で 古いものから 消えること(=落ちてよい)
//   3. お祝いは .banner-box に **1枚ずつ**しか 出ないこと
//   4. お祝いは **1件も 落ちない**こと(キューで待ち、順番に ぜんぶ 出る)
//   5. 待ちがあるあいだは「+あと N」を そえること
//   6. どのレーンの1枚にも class="toast" が のこること
//      (回帰ボット tools/ux_bot.mjs と E2E が `.toast` で 中身を読む)
//
// v16.0 は ぜんぶが 左上の1か所に積まれ、上限4で **お祝いが だまって落ちて**いた。
// 「絶対に落とさない」は 目で見て 確かめられないので、ここで 数として 固定する。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  BANNER_LIFE_MS, FADE_MS, TOAST_LIFE_MS, TOAST_MAX,
  banner, laneOf, pendingBannerCount, resetNotifications, toast,
} from '../../src/ui/Toast';

const items = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.toast-box .toast')];
const banners = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.banner-box .toast')];
const bannerText = (): string => banners()[0]?.textContent?.trim() ?? '';

/** バナー1枚ぶん(表示2.2秒+消えるアニメ0.3秒)を 進める */
const nextBanner = (): void => {
  vi.advanceTimersByTime(BANNER_LIFE_MS);
  vi.advanceTimersByTime(FADE_MS);
};

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="ui-root"></div>';
  resetNotifications();
});
afterEach(() => {
  resetNotifications();
  vi.useRealTimers();
});

describe('レーンの振り分け', () => {
  it('お祝い(じっせき・バッジ・ごほうび)だけが バナー、のこりは 小物', () => {
    expect(laneOf('item')).toBe('item');
    expect(laneOf('achievement')).toBe('banner');
    expect(laneOf('badge')).toBe('banner');
    expect(laneOf('reward')).toBe('banner');
  });

  it('toast() は 既定で 小物レーン(呼び出し口の 互換をこわさない)', () => {
    toast('+1 もくざい', 'wood');
    expect(items()).toHaveLength(1);
    expect(banners()).toHaveLength(0);
    expect(items()[0].textContent).toContain('+1 もくざい');
  });

  it('banner() は お祝いレーン。小物レーンには 1枚も 入らない', () => {
    banner('じっせき たっせい! はじめての つり', 'fish', 'achievement');
    expect(banners()).toHaveLength(1);
    expect(items()).toHaveLength(0);
  });

  it('どちらのレーンの1枚にも class="toast" が のこる(ボット・E2Eの読み)', () => {
    toast('+1 いし', 'stone');
    banner('バッジ: はじめての つり', 'fish', 'badge');
    expect(document.querySelectorAll('.toast')).toHaveLength(2);
    // 入れものの クラス名も 変えない(tests/e2e/daily.spec.ts が .toast-box を読む)
    expect(document.querySelectorAll('.toast-box')).toHaveLength(1);
    expect(document.querySelectorAll('.banner-box')).toHaveLength(1);
  });
});

describe('小物レーン(右下)', () => {
  it(`同時に ${TOAST_MAX} 枚まで。あふれたら 古いものから 消える`, () => {
    for (let i = 0; i < TOAST_MAX + 3; i++) toast(`+${i} もくざい`, 'wood');
    expect(items()).toHaveLength(TOAST_MAX);
    // のこっているのは 新しいほう(古い +0 は もう いない)
    expect(items()[0].textContent).toContain('+3 もくざい');
    expect(items()[TOAST_MAX - 1].textContent).toContain('+6 もくざい');
  });

  it('寿命(2.1秒)が すぎたら 消える', () => {
    toast('+1 もくざい', 'wood');
    vi.advanceTimersByTime(TOAST_LIFE_MS + FADE_MS + 10);
    expect(items()).toHaveLength(0);
  });
});

describe('お祝いバナー(中央上・キュー)', () => {
  it('同時に 出るのは いつも 1枚だけ', () => {
    banner('じっせき たっせい! A', 'fish', 'achievement');
    banner('バッジ: B', 'fish', 'badge');
    banner('ごほうび: C', 'lumina', 'reward');
    expect(banners()).toHaveLength(1);
    expect(bannerText()).toContain('じっせき たっせい! A');
    expect(pendingBannerCount()).toBe(2);
  });

  it('1件も 落とさない: 5件つづけて出しても 順番に ぜんぶ 出る', () => {
    const texts = ['A', 'B', 'C', 'D', 'E'].map((c) => `バッジ: ${c}`);
    for (const t of texts) banner(t, 'fish', 'badge');
    const seen: string[] = [];
    for (let i = 0; i < texts.length; i++) {
      expect(banners(), `${i}枚めが 出ていない`).toHaveLength(1);
      seen.push(banners()[0].textContent ?? '');
      nextBanner();
    }
    for (const t of texts) {
      expect(seen.some((s) => s.includes(t)), `${t} が 落ちた`).toBe(true);
    }
    expect(pendingBannerCount()).toBe(0);
    expect(banners()).toHaveLength(0);
  });

  it('待ちの数を「+あと N」で そえる(なくなったら 出さない)', () => {
    banner('バッジ: A', 'fish', 'badge');
    banner('バッジ: B', 'fish', 'badge');
    banner('バッジ: C', 'fish', 'badge');
    expect(banners()[0].querySelector('.banner-more')?.textContent).toBe('+あと 2');
    nextBanner();
    expect(banners()[0].querySelector('.banner-more')?.textContent).toBe('+あと 1');
    nextBanner();
    expect(banners()[0].querySelector('.banner-more')).toBeNull();
  });

  it('あとから 足したぶんも 出る(表示ちゅうに 追加しても 待ち行列に つながる)', () => {
    banner('バッジ: A', 'fish', 'badge');
    vi.advanceTimersByTime(500);
    banner('ごほうび: B', 'lumina', 'reward');
    expect(banners()).toHaveLength(1);
    expect(bannerText()).toContain('バッジ: A');
    nextBanner();
    expect(bannerText()).toContain('ごほうび: B');
  });

  it('種類ごとに 見た目のクラスが 付く(バッジ=みどり寄り など)', () => {
    banner('バッジ: A', 'fish', 'badge');
    expect(banners()[0].className).toContain('banner-badge');
    nextBanner();
    banner('ごほうび: B', 'lumina', 'reward');
    expect(banners()[0].className).toContain('banner-reward');
  });
});

describe('左上は 目標カード専用', () => {
  it('お知らせの入れものは どちらも 左上に 置かれていない(CSSの実値で確かめる)', () => {
    const css = readCss();
    const itemRule = ruleOf(css, '.toast-box');
    expect(itemRule, '.toast-box の指定').toBeTruthy();
    expect(itemRule).toContain('right:');
    expect(itemRule).toContain('bottom:');
    expect(itemRule, '左上に もどっている').not.toContain('left:');
    const bannerRule = ruleOf(css, '.banner-box');
    expect(bannerRule).toContain('top:');
    expect(bannerRule, 'まん中よせ').toContain('translateX(-50%)');
  });
});

// --- CSSを読むための小さな道具(見た目の約束を 文字で 固定する) ---
function readCss(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join } = require('node:path') as typeof import('node:path');
  return readFileSync(join(__dirname, '..', '..', 'src', 'ui', 'style.css'), 'utf8');
}
/** セレクタが ちょうど1つだけのルールの中身を返す(コメントは先に落とす) */
function ruleOf(css: string, selector: string): string {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].trim() === selector) return m[2].replace(/\s+/g, '');
  }
  return '';
}

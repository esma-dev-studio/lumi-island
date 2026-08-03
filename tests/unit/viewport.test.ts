// iPad(タッチ)対応の回帰テスト。
// 守りたいのは次の3点:
//   1. 指でのカメラ操作の計算が範囲内に収まる(回しすぎ・寄りすぎでゲームが壊れない)
//   2. iOSで全画面・拡大禁止にするためのmetaがindex.htmlから消えない
//   3. 画面が指で動かない/安全領域を避けるCSSが style.css から消えない
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ZOOM_MIN, ZOOM_MAX, PITCH_MIN, PITCH_MAX,
  clampRange, wrapAngle, nextYaw, nextPitch, nextZoom, followCameraYaw,
} from '../../src/scenes/CameraController';

const read = (rel: string): string => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

describe('タッチのカメラ操作(計算)', () => {
  it('clampRangeは範囲に収める', () => {
    expect(clampRange(5, 0, 1)).toBe(1);
    expect(clampRange(-5, 0, 1)).toBe(0);
    expect(clampRange(0.5, 0, 1)).toBe(0.5);
  });

  it('指を右へ動かすと視点が右を向く', () => {
    expect(nextYaw(0, 50)).toBeGreaterThan(0);
    expect(nextYaw(0, -50)).toBeLessThan(0);
  });

  it('ヨーに制限はなく360度回せる(途中で止まらない)', () => {
    // 90/180/270度のどこも通過できる(±45度で頭打ちにならない)
    const seen: number[] = [];
    let yaw = 0;
    // 1回5px(=0.025rad)。251回でちょうど一周ぶん
    for (let i = 0; i < 251; i++) {
      yaw = nextYaw(yaw, 5); // 指を右へ少しずつ
      seen.push(yaw);
    }
    for (const target of [Math.PI / 2, Math.PI * 0.9, -Math.PI * 0.9, -Math.PI / 2]) {
      expect(seen.some((v) => Math.abs(v - target) < 0.05)).toBe(true);
    }
    // 一周してほぼ元へ戻る(=1周ぶん回せた)
    expect(Math.abs(wrapAngle(seen[seen.length - 1]))).toBeLessThan(0.05);
  });

  it('何周回してもヨーは-180..+180度に畳まれる(値が際限なく大きくならない)', () => {
    let yaw = 0;
    for (let i = 0; i < 5000; i++) yaw = nextYaw(yaw, 40);
    expect(yaw).toBeGreaterThanOrEqual(-Math.PI);
    expect(yaw).toBeLessThanOrEqual(Math.PI);
    expect(wrapAngle(Math.PI * 2 + 0.3)).toBeCloseTo(0.3, 6);
    expect(wrapAngle(-Math.PI * 2 - 0.3)).toBeCloseTo(-0.3, 6);
    expect(wrapAngle(0)).toBe(0);
  });

  it('タッチが無い環境ではヨーの公開値が0のまま(キーボード移動が変わらない前提)', () => {
    expect(followCameraYaw()).toBe(0);
  });

  it('指を下へ動かすと見下ろしになり、上下とも制限がある', () => {
    expect(nextPitch(1, 60)).toBeGreaterThan(1);
    expect(nextPitch(1, -60)).toBeLessThan(1);
    expect(nextPitch(1, 100000)).toBeCloseTo(PITCH_MAX, 6);
    expect(nextPitch(1, -100000)).toBeCloseTo(PITCH_MIN, 6);
  });

  it('ピンチで広げると近づき、縮めると引き、範囲を超えない', () => {
    expect(nextZoom(1, 100, 200)).toBeLessThan(1); // 指を広げた=近づく
    expect(nextZoom(1, 200, 100)).toBeGreaterThan(1); // 指を縮めた=引く
    expect(nextZoom(1, 100, 100000)).toBeCloseTo(ZOOM_MIN, 6);
    expect(nextZoom(1, 100000, 100)).toBeCloseTo(ZOOM_MAX, 6);
    // 指が重なった等の異常値でも既定値のまま壊れない
    expect(nextZoom(1, 0, 0)).toBe(1);
  });

  it('歩いても見回しは正面へ戻らない(自動リセンターを廃止した)', () => {
    const src = read('src/scenes/CameraController.ts');
    expect(src).not.toContain('recenteredYaw');
    expect(src).not.toContain('RECENTER_PER_SEC');
    expect(src).not.toContain('YAW_LIMIT');
  });

  it('既定値(ヨー0・ズーム1・見下ろし1)は従来の構図と同じ範囲にある', () => {
    expect(ZOOM_MIN).toBeLessThan(1);
    expect(ZOOM_MAX).toBeGreaterThan(1);
    expect(PITCH_MIN).toBeLessThan(1);
    expect(PITCH_MAX).toBeGreaterThan(1);
  });
});

describe('index.html のiPad対応', () => {
  const html = read('index.html');
  it('viewport-fit=cover がある(安全領域を使うのに必要)', () => {
    expect(html).toMatch(/name="viewport"[\s\S]*?viewport-fit=cover/);
  });
  it('ホーム画面に追加したときの全画面メタがある', () => {
    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
    expect(html).toContain('name="mobile-web-app-capable" content="yes"');
    expect(html).toContain('name="apple-mobile-web-app-status-bar-style"');
    expect(html).toContain('name="theme-color"');
  });
  it('apple-touch-icon はPNG(SVGはiOSで無視される)', () => {
    const m = html.match(/rel="apple-touch-icon"\s*\n?\s*href="data:image\/png;base64,([^"]+)"/);
    expect(m).not.toBeNull();
    expect((m as RegExpMatchArray)[1].length).toBeGreaterThan(500);
  });
});

describe('style.css のiPad対応', () => {
  const css = read('src/ui/style.css');
  it('ページが指で動かない指定がある', () => {
    expect(css).toMatch(/overscroll-behavior:\s*none/);
    expect(css).toMatch(/#game-canvas[\s\S]*?touch-action:\s*none/);
    expect(css).toMatch(/-webkit-touch-callout:\s*none/);
    expect(css).toMatch(/-webkit-user-select:\s*none/);
  });
  it('安全領域(env safe-area-inset)を使っている', () => {
    for (const v of ['--sa-t', '--sa-r', '--sa-b', '--sa-l']) expect(css).toContain(v);
    expect(css).toMatch(/env\(safe-area-inset-top/);
    expect(css).toMatch(/\.hud-top[\s\S]*?var\(--sa-t\)/);
    expect(css).toMatch(/\.dialogue[\s\S]*?var\(--sa-b\)/);
  });
  it('高さは実寸(--app-h)で決める(iOSのアドレスバーで狂わない)', () => {
    expect(css).toMatch(/#game-canvas[\s\S]*?height:\s*var\(--app-h\)/);
  });
  it('日本語システムフォントのフォールバックがある(CDNが落ちても崩れない)', () => {
    expect(css).toMatch(/--font:[\s\S]*?Hiragino/);
    expect(css).toMatch(/--font:[\s\S]*?Yu Gothic/);
  });
  it('タッチ時は文字とタップ対象を大きくする', () => {
    expect(css).toContain('html.touch-ui');
    expect(css).toMatch(/min-height:\s*44px/);
  });
});

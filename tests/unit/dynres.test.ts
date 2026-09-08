// 動的解像度スケーリング(DRS)の回帰テスト。
// 守りたいのは次の5点:
//   1. 窓p95(直近10秒)の計算が、全フレームを並べ替えた真値と一致する(ヒストグラム化で狂わない)
//   2. 持続的にテールが悪化したときだけ段が進み、クールダウン・上限が効く
//   3. 健全なプレイ(p95が基準25msの内側)では絶対に発火しない
//   4. v27 復帰経路: 一過性ヒッチで落ちない / 継続的な重さで落ちる / 回復で戻る / 振動で固定
//   5. main.ts の配線(毎フレーム供給・既存の安全弁との共存・console証跡)が外れない
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DynamicResolution, percentileOf, DYNRES_DEFAULTS } from '../../src/perf/DynamicResolution';

/** ms のフレームを sec 秒ぶん供給する */
function feedConst(d: DynamicResolution, ms: number, sec: number): void {
  const n = Math.round((sec * 1000) / ms);
  for (let i = 0; i < n; i++) d.addFrame(ms);
}

/** 可変のフレーム時間を sec 秒ぶん供給する */
function feedSeq(d: DynamicResolution, sec: number, next: () => number): void {
  const end = sec * 1000;
  for (let t = 0; t < end; ) {
    const ms = next();
    d.addFrame(ms);
    t += ms;
  }
}

/** 決定的な擬似乱数(0..1) */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 窓p95の参照実装(全サンプルを保持して並べ替える。実装とは別経路) */
class RefWindow {
  private cur: number[] = [];
  private curMs = 0;
  private closed: number[][] = [];
  constructor(
    private readonly bucketMs: number,
    private readonly buckets: number
  ) {}
  /** @returns 区間が閉じたら true */
  add(ms: number): boolean {
    this.cur.push(ms);
    this.curMs += ms;
    if (this.curMs < this.bucketMs) return false;
    this.closed.push(this.cur);
    if (this.closed.length > this.buckets) this.closed.shift();
    this.cur = [];
    this.curMs = 0;
    return true;
  }
  full(): boolean {
    return this.closed.length === this.buckets;
  }
  frames(): number {
    return this.closed.reduce((a, b) => a + b.length, 0);
  }
  p95(): number {
    const all = this.closed.flat().sort((a, b) => a - b);
    return all[Math.min(all.length - 1, Math.floor(all.length * 0.95))];
  }
}

describe('DRSの既定値', () => {
  it('しきい値28ms・10秒窓・クールダウン15秒・3段', () => {
    expect(DYNRES_DEFAULTS.thresholdMs).toBe(28);
    expect(DYNRES_DEFAULTS.bucketMs * DYNRES_DEFAULTS.windowBuckets).toBe(10000);
    expect(DYNRES_DEFAULTS.cooldownMs).toBe(15000);
    expect(DYNRES_DEFAULTS.stepFactors).toEqual([1.15, 1.3, 1.45]);
    // 耐久テストの基準(p95≦25ms)より明確に悪い水準であること(誤発火のマージン)
    expect(DYNRES_DEFAULTS.thresholdMs).toBeGreaterThan(25);
  });

  it('助走は20秒(窓10秒+連続3秒より長い=助走中のヒッチが1つも判定に残らない)', () => {
    expect(DYNRES_DEFAULTS.warmupMs).toBe(20000);
    const judgeSpanMs = DYNRES_DEFAULTS.bucketMs * (DYNRES_DEFAULTS.windowBuckets + DYNRES_DEFAULTS.sustainEvals);
    expect(DYNRES_DEFAULTS.warmupMs).toBeGreaterThan(judgeSpanMs);
  });

  it('復帰の条件は「22ms未満が45秒」かつ「最後の降格から60秒」・往復2回で固定', () => {
    expect(DYNRES_DEFAULTS.recoverThresholdMs).toBe(22);
    expect(DYNRES_DEFAULTS.recoverHoldMs).toBe(45000);
    expect(DYNRES_DEFAULTS.recoverAfterMs).toBe(60000);
    expect(DYNRES_DEFAULTS.oscillationLimit).toBe(2);
    // 復帰のしきい値は「1段戻して画素が増えても 降格しきい値を超えない」水準であること。
    // 1段の倍率は stepFactors[0]=1.15 なので 22 × 1.15 = 25.3ms < 28ms
    const worst = DYNRES_DEFAULTS.recoverThresholdMs * DYNRES_DEFAULTS.stepFactors[0];
    expect(worst).toBeLessThan(DYNRES_DEFAULTS.thresholdMs);
    // 耐久テストの基準(p95 ≦ 25ms)より内側 = 「健全」と呼べる水準
    expect(DYNRES_DEFAULTS.recoverThresholdMs).toBeLessThan(25);
    // 復帰の待ち(45秒)は降格の判定に必要な時間(13秒)よりずっと長い = 戻すほうが慎重
    expect(DYNRES_DEFAULTS.recoverHoldMs).toBeGreaterThan(
      DYNRES_DEFAULTS.bucketMs * (DYNRES_DEFAULTS.windowBuckets + DYNRES_DEFAULTS.sustainEvals) * 3
    );
  });

  it('段のスケールは基準×1.15/1.3/1.45', () => {
    const pc = new DynamicResolution({ baseScale: 1 });
    expect([0, 1, 2, 3].map((s) => pc.scaleForStep(s))).toEqual([1, 1.15, 1.3, 1.45]);
    expect(pc.maxStep).toBe(3);
    // iPad(CSS比1.5倍で描画 = hardwareScalingLevel 1/1.5)でも粗くなる比率は同じ
    const ipad = new DynamicResolution({ baseScale: 1 / 1.5 });
    expect(ipad.scaleForStep(0)).toBeCloseTo(0.6667, 4);
    expect(ipad.scaleForStep(3)).toBeCloseTo(0.9667, 4);
    expect(ipad.scaleForStep(3) / ipad.scaleForStep(0)).toBeCloseTo(1.45, 3);
    // 段を進めきってもネイティブ解像度(1.0)より粗くはならない
    expect(ipad.scaleForStep(3)).toBeLessThan(1);
  });
});

describe('窓p95の計算', () => {
  it('直近10秒ぶんを並べ替えた真値と一致する(誤差は箱1つぶん未満)', () => {
    // しきい値を事実上無効にして、段が動かない状態で計算だけを見る
    const d = new DynamicResolution({ warmupMs: 0, thresholdMs: 1e6 });
    const ref = new RefWindow(1000, 10);
    const rnd = lcg(12345);
    let checks = 0;
    for (let i = 0; i < 4000; i++) {
      const ms = rnd() < 0.9 ? 15 + rnd() * 3 : 25 + rnd() * 25; // 大半は約16ms、たまに重い
      d.addFrame(ms);
      if (ref.add(ms) && ref.full()) {
        const s = d.getState();
        const exact = ref.p95();
        expect(s.windowFrames).toBe(ref.frames());
        expect(s.windowP95).toBeLessThanOrEqual(exact); // 過大に見積もらない(誤発火しない側へ丸める)
        expect(exact - s.windowP95).toBeLessThan(0.25);
        checks++;
      }
    }
    expect(checks).toBeGreaterThan(20);
  });

  it('窓は10秒で入れ替わる(古い遅いフレームは判定から外れる)', () => {
    const d = new DynamicResolution({ warmupMs: 0, thresholdMs: 1e6 });
    feedConst(d, 50, 12);
    expect(d.windowP95).toBeGreaterThan(49);
    feedConst(d, 16, 12);
    expect(d.windowP95).toBeLessThan(17);
  });

  it('窓が成立するまでは判定用のp95を出さない', () => {
    const d = new DynamicResolution({ warmupMs: 0 });
    feedConst(d, 35, 5);
    const s = d.getState();
    expect(s.windowBuckets).toBeLessThan(10);
    expect(s.step).toBe(0);
  });

  it('順位の取り方が perf_probe と同じ(添字 floor(n*0.95))', () => {
    const hist = new Int32Array(513);
    hist[Math.floor(16 / 0.25)] = 95;
    hist[Math.floor(40 / 0.25)] = 5;
    expect(percentileOf(hist, 100, 0.95)).toBe(40);
    expect(percentileOf(hist, 100, 0.5)).toBe(16);
    expect(percentileOf(new Int32Array(513), 0, 0.95)).toBe(-1);
  });
});

describe('段の進み方', () => {
  it('35msが続くと段が進み、クールダウン中は進まず、3段で止まる', () => {
    const d = new DynamicResolution({ baseScale: 1 });
    feedConst(d, 35, 25); // 助走20秒+窓5秒。まだ窓が成立しない
    expect(d.step).toBe(0);

    feedConst(d, 35, 15); // 通算40秒(発火は約33秒)
    expect(d.step).toBe(1);
    expect(d.scale).toBe(1.15);

    feedConst(d, 35, 5); // 通算45秒。クールダウン(15秒)の途中なので進まない
    expect(d.step).toBe(1);
    expect(d.getState().cooldownLeftMs).toBeGreaterThan(0);

    feedConst(d, 35, 20); // 通算65秒
    expect(d.step).toBe(2);
    expect(d.scale).toBe(1.3);

    feedConst(d, 35, 555); // 通算620秒(10分ぶん)
    expect(d.step).toBe(3);
    expect(d.scale).toBe(1.45);

    const s = d.getState();
    expect(s.events).toHaveLength(3); // 上限を超えて発火しない
    expect(s.events.map((e) => e.step)).toEqual([1, 2, 3]);
    expect(s.events.map((e) => e.dir)).toEqual(['down', 'down', 'down']);
    expect(s.events.map((e) => e.toScale)).toEqual([1.15, 1.3, 1.45]);
    for (const e of s.events) {
      expect(e.windowP95).toBeGreaterThan(28);
      expect(e.badBuckets).toBeGreaterThanOrEqual(6);
      expect(e.reason).toMatch(/p95 .* > 28ms/); // ログに出す理由が入っている
    }
    // 発火の間隔はクールダウン(15秒)以上あく
    expect(s.events[1].atMs - s.events[0].atMs).toBeGreaterThanOrEqual(15000);
    expect(s.events[2].atMs - s.events[1].atMs).toBeGreaterThanOrEqual(15000);
    // ずっと重いまま=一度も戻していないので往復は0
    expect(s.roundTrips.every((n) => n === 0)).toBe(true);
    expect(s.pinnedStep).toBe(0);
  });

  it('境界のすぐ上(29ms)なら進み、すぐ下(27ms)では進まない', () => {
    const over = new DynamicResolution();
    feedConst(over, 29, 40);
    expect(over.step).toBe(1);
    const under = new DynamicResolution();
    feedConst(under, 27, 300);
    expect(under.step).toBe(0);
  });
});

describe('v27 復帰経路', () => {
  // 助走20秒+窓10秒+連続3秒 = 起動から約33秒で1回めの降格(実測32.2秒)。
  // 2回め以降は 窓がすでに埋まっているので「悪い区間6つ+連続3回」の約8秒(実測7.5秒)。
  // どちらも 次の降格(+クールダウン15秒)には届かない長さにして、1回で1段だけ動かす。
  const heavyFirst = (d: DynamicResolution): void => feedConst(d, 35, 40);
  const heavyAgain = (d: DynamicResolution): void => feedConst(d, 35, 15);
  const calm = (d: DynamicResolution, sec = 140): void => feedConst(d, 16.6, sec);

  it('起動直後の一過性ヒッチ(実測 fps 10/10/3.5)では落ちない', () => {
    const d = new DynamicResolution({ baseScale: 1 });
    feedConst(d, 16.6, 9); // 0〜9秒 健全
    feedConst(d, 100, 2); // 10〜12秒 fps10相当
    feedConst(d, 285, 1); // 12秒 fps3.5相当
    feedConst(d, 16.6, 200); // 以降ずっと健全
    const s = d.getState();
    expect(s.step).toBe(0);
    expect(s.events).toHaveLength(0);
    expect(s.scale).toBe(1);
  });

  it('助走が明けたあとの一過性ヒッチ(3秒)でも落ちない', () => {
    const d = new DynamicResolution({ baseScale: 1 });
    feedConst(d, 16.6, 40);
    feedConst(d, 45, 3); // 3秒だけ重い
    expect(d.getState().badBuckets).toBeLessThan(6);
    feedConst(d, 16.6, 60);
    expect(d.step).toBe(0);
    expect(d.getState().events).toHaveLength(0);
  });

  it('継続的な重さでは落ち、そのあと軽くなれば1段だけ戻る', () => {
    const d = new DynamicResolution({ baseScale: 1 });
    heavyFirst(d);
    expect(d.step).toBe(1);
    const downAt = d.getState().events[0].atMs;

    calm(d, 50); // 45秒の「良い時間」がたまる前は まだ戻らない
    expect(d.step).toBe(1);

    calm(d, 120);
    const s = d.getState();
    expect(s.step).toBe(0);
    expect(s.scale).toBe(1);
    expect(s.events).toHaveLength(2);
    expect(s.events[1].dir).toBe('up');
    expect(s.events[1].fromScale).toBe(1.15);
    expect(s.events[1].toScale).toBe(1);
    expect(s.events[1].reason).toMatch(/p95 .* < 22ms/);
    // 復帰は「最後の降格から60秒」「良い状態が45秒」の両方を満たしてから
    expect(s.events[1].atMs - downAt).toBeGreaterThanOrEqual(60000);
    // 1回の判定で戻すのは1段だけ(その後さらに軽くても段0より上はない)
    calm(d, 200);
    expect(d.getState().events).toHaveLength(2);
    expect(d.step).toBe(0);
  });

  it('戻したあとの再降格は通常判定のまま(窓も連続回数も短くしない)', () => {
    const d = new DynamicResolution({ baseScale: 1 });
    heavyFirst(d);
    calm(d, 170);
    expect(d.step).toBe(0);
    const upAt = d.getState().events[1].atMs;
    const heavyFrom = d.getState().elapsedMs;
    heavyAgain(d);
    const s = d.getState();
    expect(s.step).toBe(1);
    const reDown = s.events[2];
    // 戻した直後に落とすための近道は作っていない: 再降格にも
    // 「悪い区間6つ以上」+「連続3回」の 通常条件が そのまま要る
    expect(reDown.badBuckets).toBeGreaterThanOrEqual(DYNRES_DEFAULTS.badBucketsMin);
    expect(reDown.atMs - heavyFrom).toBeGreaterThanOrEqual(
      DYNRES_DEFAULTS.bucketMs * DYNRES_DEFAULTS.badBucketsMin
    );
    expect(reDown.atMs).toBeGreaterThan(upAt + DYNRES_DEFAULTS.cooldownMs);
    expect(s.roundTrips[1]).toBe(1);
    expect(s.pinnedStep).toBe(0); // 1往復ではまだ固定しない
  });

  it('往復が2回起きたらその段に固定して、以後は軽くても戻さない', () => {
    const d = new DynamicResolution({ baseScale: 1 });
    heavyFirst(d); // 1回め: 段1へ
    calm(d, 170); // 戻る(段0)
    heavyAgain(d); // 2回め: 段1へ(往復1)
    calm(d, 170); // 戻る(段0)
    heavyAgain(d); // 3回め: 段1へ(往復2 → 固定)
    let s = d.getState();
    expect(s.step).toBe(1);
    expect(s.roundTrips[1]).toBe(2);
    expect(s.pinnedStep).toBe(1);
    const events = s.events.length;

    calm(d, 400); // どれだけ軽くても もう戻さない
    s = d.getState();
    expect(s.step).toBe(1);
    expect(s.scale).toBe(1.15);
    expect(s.events).toHaveLength(events);
    expect(s.events.filter((e) => e.dir === 'up')).toHaveLength(2);
    // 固定の理由がログに残る
    expect(s.events.filter((e) => e.reason.includes('固定'))).toHaveLength(1);
  });

  it('健全なだけのセッションでは 段0のまま up も down も起きない', () => {
    const d = new DynamicResolution({ baseScale: 1 });
    feedConst(d, 16.6, 400);
    const s = d.getState();
    expect(s.step).toBe(0);
    expect(s.events).toHaveLength(0);
    expect(s.goodStreakMs).toBeGreaterThan(45000); // 条件は満たすが、戻す段がない
  });

  it('recoverReady は「45秒の良い時間 + 降格から60秒」で立つ(低fps安全弁が読む)', () => {
    const d = new DynamicResolution({ baseScale: 1 });
    expect(d.recoverReady).toBe(false);
    // 助走20秒+窓10秒 のあとから「良い時間」が積み上がる
    feedConst(d, 16.6, 60);
    expect(d.getState().goodStreakMs).toBeLessThan(45000);
    expect(d.recoverReady).toBe(false); // 良い時間がまだ45秒に足りない
    feedConst(d, 16.6, 30);
    expect(d.recoverReady).toBe(true);
    // 外(低fps安全弁)が段を動かしたら、計測は最初からやり直す
    d.noteExternalScaleChange('down');
    expect(d.recoverReady).toBe(false);
    expect(d.getState().goodStreakMs).toBe(0);
    feedConst(d, 16.6, 50);
    expect(d.getState().sinceLastDownMs).toBeLessThan(60000);
    expect(d.recoverReady).toBe(false); // 降格から60秒たっていない
    feedConst(d, 16.6, 30);
    expect(d.getState().sinceLastDownMs).toBeGreaterThanOrEqual(60000);
    expect(d.recoverReady).toBe(true);
  });

  it('重いあいだは「良い時間」が積み上がらない(0に戻る)', () => {
    const d = new DynamicResolution({ baseScale: 1, thresholdMs: 1e6 });
    feedConst(d, 16.6, 60);
    expect(d.getState().goodStreakMs).toBeGreaterThan(30000);
    feedConst(d, 35, 3);
    expect(d.getState().goodStreakMs).toBe(0);
  });
});

describe('誤発火の防止', () => {
  it('健全な入力(p95≒20ms)では10分流しても段が動かない', () => {
    const d = new DynamicResolution({ baseScale: 1 });
    const rnd = lcg(7);
    feedSeq(d, 600, () => (rnd() < 0.95 ? 16.6 : 19.8));
    const s = d.getState();
    expect(s.step).toBe(0);
    expect(s.events).toHaveLength(0);
    expect(s.scale).toBe(1);
    expect(s.windowP95).toBeLessThan(25);
  });

  it('やや重いが基準内(p95≒21ms)でも発火しない', () => {
    const rnd = lcg(99);
    const d = new DynamicResolution();
    feedSeq(d, 300, () => (rnd() < 0.93 ? 16.7 : 20 + rnd() * 4));
    expect(d.step).toBe(0);
    expect(d.getState().badBuckets).toBe(0);
  });

  it('回復したあとはクールダウン明けに追い打ちをしない(古いデータで進めない)', () => {
    const d = new DynamicResolution();
    feedConst(d, 35, 40); // 段1まで進める(クールダウン中)
    expect(d.step).toBe(1);
    feedConst(d, 16.6, 20); // クールダウンが明ける前後で回復
    const s = d.getState();
    expect(s.step).toBe(1);
    expect(s.cooldownLeftMs).toBe(0);
    expect(s.lastBucketP95).toBeLessThan(28);
  });

  it('起動直後の助走ぶんは判定に入れない', () => {
    const d = new DynamicResolution(); // 助走20秒
    feedConst(d, 100, 18); // 初回シェーダコンパイル相当の重いフレーム
    const s = d.getState();
    expect(s.frames).toBe(0);
    expect(s.windowBuckets).toBe(0);
    expect(s.warmupLeftMs).toBeGreaterThan(0);
    expect(s.step).toBe(0);
  });

  it('異常値と長い停止は計測対象外(時計も進めない)', () => {
    const d = new DynamicResolution({ warmupMs: 0 });
    for (const bad of [NaN, Infinity, 0, -5, 5000]) d.addFrame(bad);
    const s = d.getState();
    expect(s.frames).toBe(0);
    expect(s.ignored).toBe(5);
    expect(s.elapsedMs).toBe(0);
    expect(s.windowP95).toBe(-1);
  });
});

describe('状態の取得とreset', () => {
  it('現在の段・スケール・直近窓p95・発火履歴が読める', () => {
    const d = new DynamicResolution({ baseScale: 1 });
    feedConst(d, 35, 40);
    const s = d.getState();
    expect(s.step).toBe(1);
    expect(s.maxStep).toBe(3);
    expect(s.baseScale).toBe(1);
    expect(s.scale).toBe(1.15);
    expect(s.thresholdMs).toBe(28);
    expect(s.frames).toBeGreaterThan(0);
    expect(s.elapsedMs).toBeGreaterThan(39000);
    expect(s.sinceLastDownMs).toBeGreaterThanOrEqual(0);
    expect(s.events[0]).toMatchObject({ step: 1, dir: 'down', fromScale: 1, toScale: 1.15 });
    // 返す履歴はコピー(外から書き換えても内部が壊れない)
    s.events.length = 0;
    s.roundTrips[1] = 99;
    expect(d.getState().events).toHaveLength(1);
    expect(d.getState().roundTrips[1]).toBe(0);
  });

  it('resetは窓と助走をやり直すが、進んだ段と往復の履歴は保持する', () => {
    const d = new DynamicResolution();
    feedConst(d, 35, 40);
    expect(d.step).toBe(1);
    d.reset();
    const s = d.getState();
    expect(s.step).toBe(1);
    expect(s.windowBuckets).toBe(0);
    expect(s.windowP95).toBe(-1);
    expect(s.warmupLeftMs).toBeGreaterThan(0);
    expect(s.goodStreakMs).toBe(0);
    expect(s.events).toHaveLength(1);
  });
});

describe('main.tsへの組み込み', () => {
  const main = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8');

  it('毎フレームのフレーム時間をDRSへ供給している', () => {
    expect(main).toContain('onEndFrameObservable');
    expect(main).toContain('dynRes.addFrame');
  });

  it('既存の安全弁と共存し、より低解像度側を採用する', () => {
    expect(main).toMatch(/Math\.max\(legacyScale, dynRes\.scale\)/);
    expect(main).toContain('engine.setHardwareScalingLevel(level)');
  });

  it('段が変わったらconsole.infoで1行残す(耐久テストの証跡・上下と理由つき)', () => {
    expect(main).toMatch(/console\.info\(\s*`\[dynres\] \$\{evt\.dir\}/);
    expect(main).toContain('reason=${evt.reason}');
  });

  it('状態を読み取るフックを公開する', () => {
    expect(main).toContain('__lumiDynRes');
    expect(main).toContain('state: () => dynRes.getState()');
  });

  it('低fps安全弁にも助走がある(起動直後のヒッチで落とさない)', () => {
    expect(main).toContain('LEGACY_WARMUP_MS');
    expect(main).toMatch(/performance\.now\(\) - gameReadyAt < LEGACY_WARMUP_MS/);
    expect(main).toContain('gameReadyAt = performance.now()');
  });

  it('低fps安全弁もDRSと同じ計測で段を戻す(復帰経路がある)', () => {
    expect(main).toContain('dynRes.recoverReady');
    expect(main).toContain('LEGACY_TOP_SCALE');
    expect(main).toMatch(/dynRes\.noteExternalScaleChange\(dir\)/);
    // 往復2回で固定する(振動防止)
    expect(main).toMatch(/roundTrips >= 2/);
    expect(main).toMatch(/\[dynres\] \$\{dir\} legacy renderScale/);
  });
});

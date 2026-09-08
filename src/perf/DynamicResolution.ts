// 動的解像度スケーリング(DRS)の判定ロジック。
//
// 目的:
//   持続的にフレーム時間のテール(p95)だけが悪化する状況 — 熱によるGPUスロットリングや、
//   非力なノートPC・iPadでの長時間プレイ — を検知して、3D描画の解像度を自動で一段下げる。
//   中央値(p50)が落ちる端末向けの既存の安全弁(fps<48で1段下げる)では発火しない症状を拾うのが役目。
//
// 設計方針:
//   - Babylon/DOMに一切依存しない純ロジック。時計もframe timeの積算で持つのでテストが決定的になる。
//   - 毎フレームのソートは禁物なので、frame timeを0.25ms刻みのヒストグラムに入れて数える。
//     1秒ごとに区間(バケツ)を閉じ、直近10区間の合計ヒストグラムから窓p95を1回だけ求める。
//   - 誤発火を避けるため、発火条件は3つ全部を満たしたときだけにする(下の judge を参照)。
//
// v27 一方向ラチェットをやめて「復帰経路」を付けた。
//   実測(.logs/screenshots/audit_v17/renderscale_probe.json): 起動10〜12秒の
//   一過性の谷(fps 10/10/3.5)だけで 解像度が 1769x1229 → 1475x1025 に落ち、
//   13秒めに fps が 68 へ戻っても **最後まで 戻らなかった**。
//   iPad でも同じで、最初の数秒の ひっかかりで そのセッションは ずっと低解像度になる。
//   そこで:
//     1. 助走を 5秒 → 20秒 にのばす(読み込み直後の シェーダ初回コンパイル・
//        GC・アセット展開が 判定に まぎれこまない)
//     2. 今の段で 窓p95 が しきい値より **十分低い**(<22ms)状態が 45秒つづき、
//        かつ 最後の降格から 60秒たっていれば **1段だけ** 戻す
//     3. 振動防止: 戻した直後も 降格判定は **通常のまま**(窓を短くしない)。
//        同じ段で 往復が2回起きたら その段に固定して 二度と戻さない
//
// スケールの向き: ここで扱う scale は Babylon の hardwareScalingLevel と同じ意味で、
// 「大きいほど低解像度(1.0=等倍)」。段が進むほど値は大きくなる。

/** ヒストグラムの刻み(ms)。窓p95はこの刻みに量子化され、必ず真値以下の値を返す */
const BIN_MS = 0.25;
/** これ以上のフレームは最後の箱にまとめる(そこまで悪ければ値の精度は問題にならない) */
const BIN_MAX_MS = 128;
const BIN_COUNT = BIN_MAX_MS / BIN_MS + 1;

/** 既定値。しきい値28msは耐久テストの基準25msより明確に悪い水準(誤発火のマージン) */
export const DYNRES_DEFAULTS = {
  /** 基準スケール(呼び出し側が現在の hardwareScalingLevel を渡す) */
  baseScale: 1,
  /** 基準スケールに対する各段の倍率(3段) */
  stepFactors: [1.15, 1.3, 1.45] as readonly number[],
  /** 窓p95がこの値を超えたら「悪い」とみなす(ms) */
  thresholdMs: 28,
  /** 区間の長さ(ms)。この長さごとにp95を判定する */
  bucketMs: 1000,
  /** 窓の区間数(=10秒のローリング窓) */
  windowBuckets: 10,
  /** 窓の中で「区間p95がしきい値超え」の区間がこの数以上あること(一瞬のもたつきで発火させない) */
  badBucketsMin: 6,
  /** 上の条件が連続してこの回数(=秒)成立したら発火 */
  sustainEvals: 3,
  /** 発火後、次の判定までの待ち時間(ms) */
  cooldownMs: 15000,
  /**
   * 起動直後の助走(ms)。読み込み直後は シェーダの初回コンパイル・アセット展開・GCで
   * 数秒だけ フレームが崩れる。ここを判定に混ぜると「一過性のヒッチだけで
   * そのセッションはずっと低解像度」になる(v27で実測)。窓10秒+連続3秒より長くとる。
   */
  warmupMs: 20000,
  /** これを超えるフレームは計測対象外(タブ復帰・シーン読み込みの停止であって描画性能ではない) */
  maxSampleMs: 2000,
  /** 判定に使う分位(perf_probe と同じ定義) */
  percentile: 0.95,
  /**
   * 復帰の条件: 窓p95がこの値を下回っていること(ms)。
   *
   * 決めかた: 1段戻すと 描く画素が stepFactors のぶん(最大1.15倍)増えるので、
   * 戻したあとの p95 は だいたい 今の p95 × 1.15 になる。これが 降格しきい値28msを
   * 超えないためには 28 ÷ 1.15 ≒ 24.3ms より下でなければならない。そこから
   * 余裕を2ms ほど取って 22ms。耐久テストの基準(p95 ≦ 25ms)より内側でもある。
   *
   * これより低くしすぎると **戻る機会が一度も来ない**: 実測(この開発機・ヘッドレス)で
   * 健全なときの窓p95は 15〜21ms、他の作業と並行しているときは 28〜33ms だった。
   * 18ms にすると 健全なときですら 条件を満たさないことがある。
   */
  recoverThresholdMs: 22,
  /** 復帰の条件: 上の状態がこの時間つづくこと(ms) */
  recoverHoldMs: 45000,
  /** 復帰の条件: 最後の降格からこの時間たっていること(ms) */
  recoverAfterMs: 60000,
  /** 同じ段で降格↔復帰の往復がこの回数起きたら、その段に固定して二度と戻さない */
  oscillationLimit: 2,
} as const;

export interface DynamicResolutionOptions {
  baseScale?: number;
  stepFactors?: readonly number[];
  thresholdMs?: number;
  bucketMs?: number;
  windowBuckets?: number;
  badBucketsMin?: number;
  sustainEvals?: number;
  cooldownMs?: number;
  warmupMs?: number;
  maxSampleMs?: number;
  percentile?: number;
  recoverThresholdMs?: number;
  recoverHoldMs?: number;
  recoverAfterMs?: number;
  oscillationLimit?: number;
}

/** 段が1つ動いたときの記録 */
export interface DynamicResolutionEvent {
  /** 動いたあとの段(0..maxStep) */
  step: number;
  /** down=解像度を下げた / up=戻した */
  dir: 'down' | 'up';
  fromScale: number;
  toScale: number;
  /** 発火時の窓p95(ms) */
  windowP95: number;
  /** 発火時、窓の中でしきい値を超えていた区間の数 */
  badBuckets: number;
  /** 発火時の窓内フレーム数 */
  windowFrames: number;
  /** 起動(またはreset)からの描画時間(ms) */
  atMs: number;
  /** ログに出す理由(日本語1行) */
  reason: string;
}

export interface DynamicResolutionState {
  step: number;
  maxStep: number;
  baseScale: number;
  /** 現在の段のスケール(=呼び出し側が engine に渡すべき値) */
  scale: number;
  thresholdMs: number;
  /** 直近の窓p95(ms)。窓がまだ成立していなければ -1 */
  windowP95: number;
  windowFrames: number;
  /** 窓に入っている確定区間の数(windowBuckets に達すると判定が始まる) */
  windowBuckets: number;
  badBuckets: number;
  /** 直近に閉じた区間のp95(ms) */
  lastBucketP95: number;
  /** 連続して条件を満たした判定回数 */
  overStreak: number;
  /** クールダウンの残り(ms) */
  cooldownLeftMs: number;
  /** 助走の残り(ms) */
  warmupLeftMs: number;
  /** 起動(またはreset)からの描画時間(ms) */
  elapsedMs: number;
  /** 取り込んだフレーム数(助走中を除く) */
  frames: number;
  /** 計測対象外として捨てたフレーム数 */
  ignored: number;
  /** 窓p95が復帰しきい値を下回りつづけている時間(ms) */
  goodStreakMs: number;
  /** 復帰までに あと必要な「良い時間」(ms) */
  recoverHoldLeftMs: number;
  /** 最後の降格からの経過(ms)。降格していなければ -1 */
  sinceLastDownMs: number;
  /** ここより上(高解像度側)へは戻さない段。往復2回で固定される */
  pinnedStep: number;
  /** 段ごとの往復回数(添字=段) */
  roundTrips: number[];
  events: DynamicResolutionEvent[];
}

const round4 = (v: number): number => Math.round(v * 10000) / 10000;

/**
 * フレーム時間を受け取り、持続的なテール悪化を見つけたら描画スケールを一段ずつ下げるコントローラ。
 * 実際に engine へ反映するのは呼び出し側(main.ts)の仕事で、ここは値を決めるだけ。
 */
export class DynamicResolution {
  readonly baseScale: number;
  readonly stepFactors: readonly number[];
  readonly thresholdMs: number;
  readonly bucketMs: number;
  readonly windowBuckets: number;
  readonly badBucketsMin: number;
  readonly sustainEvals: number;
  readonly cooldownMs: number;
  readonly warmupMs: number;
  readonly maxSampleMs: number;
  readonly percentile: number;
  readonly recoverThresholdMs: number;
  readonly recoverHoldMs: number;
  readonly recoverAfterMs: number;
  readonly oscillationLimit: number;
  /** 段ごとのスケール(添字0=段0=基準) */
  private readonly scales: number[];

  // ---- 区間(バケツ)のリング。hist は windowBuckets+1 本を使い回す(1本は集計中) ----
  private readonly hist: Int32Array[];
  private readonly bucketCount: number[];
  private readonly bucketP95: number[];
  private head = 0; // 集計中の区間の位置
  private filled = 0; // 窓に入っている確定区間の数
  private curElapsed = 0; // 集計中の区間の経過(ms)

  // ---- 窓(確定区間の合計) ----
  private readonly winHist: Int32Array;
  private winFrames = 0;
  private winP95 = -1;
  private badBuckets = 0;
  private lastBucketP95 = -1;

  private stepIndex = 0;
  private overStreak = 0;
  private clockMs = 0;
  private cooldownUntil = 0;
  private warmupUntil: number;
  private frames = 0;
  private ignored = 0;
  private readonly events: DynamicResolutionEvent[] = [];
  // ---- 復帰(段を戻す)の状態 ----
  /** 窓p95が recoverThresholdMs を下回りつづけている時間(ms) */
  private goodStreakMs = 0;
  /** 最後に降格した時刻(ms)。降格していなければ -1 */
  private lastDownAt = -1;
  /** その段から上へ戻した回数(添字=段) */
  private readonly upFrom: number[];
  /** その段での往復(戻して→また落ちた)回数(添字=段) */
  private readonly roundTrip: number[];
  /** これより上(高解像度側)へは戻さない段 */
  private pinnedStep = 0;

  constructor(opts: DynamicResolutionOptions = {}) {
    const d = DYNRES_DEFAULTS;
    this.baseScale = opts.baseScale ?? d.baseScale;
    this.stepFactors = opts.stepFactors ?? d.stepFactors;
    this.thresholdMs = opts.thresholdMs ?? d.thresholdMs;
    this.bucketMs = opts.bucketMs ?? d.bucketMs;
    this.windowBuckets = opts.windowBuckets ?? d.windowBuckets;
    this.badBucketsMin = opts.badBucketsMin ?? d.badBucketsMin;
    this.sustainEvals = opts.sustainEvals ?? d.sustainEvals;
    this.cooldownMs = opts.cooldownMs ?? d.cooldownMs;
    this.warmupMs = opts.warmupMs ?? d.warmupMs;
    this.maxSampleMs = opts.maxSampleMs ?? d.maxSampleMs;
    this.percentile = opts.percentile ?? d.percentile;
    this.recoverThresholdMs = opts.recoverThresholdMs ?? d.recoverThresholdMs;
    this.recoverHoldMs = opts.recoverHoldMs ?? d.recoverHoldMs;
    this.recoverAfterMs = opts.recoverAfterMs ?? d.recoverAfterMs;
    this.oscillationLimit = opts.oscillationLimit ?? d.oscillationLimit;
    this.warmupUntil = this.warmupMs;

    this.scales = [round4(this.baseScale)];
    for (const f of this.stepFactors) this.scales.push(round4(this.baseScale * f));
    this.upFrom = new Array<number>(this.scales.length).fill(0);
    this.roundTrip = new Array<number>(this.scales.length).fill(0);

    const slots = this.windowBuckets + 1;
    this.hist = Array.from({ length: slots }, () => new Int32Array(BIN_COUNT));
    this.bucketCount = new Array<number>(slots).fill(0);
    this.bucketP95 = new Array<number>(slots).fill(0);
    this.winHist = new Int32Array(BIN_COUNT);
  }

  get step(): number {
    return this.stepIndex;
  }

  get maxStep(): number {
    return this.stepFactors.length;
  }

  /** 現在の段に対応する hardwareScalingLevel(大きいほど低解像度) */
  get scale(): number {
    return this.scales[this.stepIndex];
  }

  /** 直近の窓p95(ms)。窓が成立していなければ -1 */
  get windowP95(): number {
    return this.winP95;
  }

  /** 指定の段のスケール(範囲外は端に丸める) */
  scaleForStep(step: number): number {
    const i = Math.max(0, Math.min(this.scales.length - 1, Math.floor(step)));
    return this.scales[i];
  }

  /**
   * フレーム時間を1つ供給する。
   * @returns 段が進んだフレームでは、その記録。進まなければ null。
   */
  addFrame(frameMs: number): DynamicResolutionEvent | null {
    // 計測対象外: 異常値・タブ復帰やシーン読み込みによる長い停止。時計も進めない。
    if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs > this.maxSampleMs) {
      this.ignored++;
      return null;
    }
    this.clockMs += frameMs;
    // 助走中は時計だけ進めて、判定用のデータには入れない
    if (this.clockMs <= this.warmupUntil) return null;

    this.frames++;
    this.hist[this.head][binOf(frameMs)]++;
    this.bucketCount[this.head]++;
    this.curElapsed += frameMs;
    if (this.curElapsed < this.bucketMs) return null;
    return this.closeBucket();
  }

  /** 区間を閉じて窓を更新し、必要なら判定する */
  private closeBucket(): DynamicResolutionEvent | null {
    const i = this.head;
    const h = this.hist[i];
    const n = this.bucketCount[i];
    const spanMs = this.curElapsed;
    this.bucketP95[i] = percentileOf(h, n, this.percentile);
    this.lastBucketP95 = this.bucketP95[i];
    addHist(this.winHist, h);
    this.winFrames += n;
    this.curElapsed = 0;

    const slots = this.windowBuckets + 1;
    this.head = (this.head + 1) % slots;
    if (this.filled === this.windowBuckets) {
      // 新しい head の位置は最古の確定区間。窓から外して空にし、集計用に再利用する
      const old = this.head;
      subHist(this.winHist, this.hist[old]);
      this.winFrames -= this.bucketCount[old];
      this.hist[old].fill(0);
      this.bucketCount[old] = 0;
      this.bucketP95[old] = 0;
    } else {
      this.filled++;
    }

    this.winP95 = this.filled > 0 ? percentileOf(this.winHist, this.winFrames, this.percentile) : -1;
    this.badBuckets = this.countBadBuckets();
    // 「十分に軽い」状態が どれだけ続いたか。窓が成立してからだけ数える
    // (窓が埋まる前のp95は 部分的な標本なので、復帰の根拠にしない)
    if (this.filled >= this.windowBuckets && this.winP95 >= 0 && this.winP95 < this.recoverThresholdMs) {
      this.goodStreakMs += spanMs;
    } else {
      this.goodStreakMs = 0;
    }
    return this.judge();
  }

  /** 窓の中で「区間p95 > しきい値」の区間がいくつあるか */
  private countBadBuckets(): number {
    const slots = this.windowBuckets + 1;
    let bad = 0;
    for (let k = 1; k <= this.filled; k++) {
      const i = (this.head - k + slots * 2) % slots;
      if (this.bucketP95[i] > this.thresholdMs) bad++;
    }
    return bad;
  }

  /**
   * 判定。降格を先に見て、降格しないときだけ復帰を見る。
   *
   * 降格(1段下げる)は 次の4つを全部満たしたときだけ:
   *   1. 窓(10秒)が成立していて、クールダウン中でなく、助走も終わっている
   *   2. 窓p95 > しきい値
   *   3. しきい値超えの区間が badBucketsMin 個以上(一瞬のもたつきでは発火させない)
   *   4. 直近の区間も悪い(すでに回復しているのに古いデータで追い打ちをかけない)
   * さらに 2〜4 が sustainEvals 回(=秒)連続していることを求める。
   *
   * 復帰(1段戻す)は 次を全部満たしたとき:
   *   a. いま段が1以上で、固定された段より上にいる
   *   b. 窓p95 < recoverThresholdMs が recoverHoldMs つづいている
   *   c. 最後の降格から recoverAfterMs たっている
   * 戻したあとの降格判定は **通常のまま**(窓も連続回数も短くしない)。
   */
  private judge(): DynamicResolutionEvent | null {
    if (this.filled < this.windowBuckets) return null;
    if (this.clockMs < this.cooldownUntil) {
      this.overStreak = 0;
      return null;
    }
    const bad =
      this.winP95 > this.thresholdMs &&
      this.badBuckets >= this.badBucketsMin &&
      this.lastBucketP95 > this.thresholdMs;
    this.overStreak = bad ? this.overStreak + 1 : 0;
    if (this.overStreak >= this.sustainEvals && this.stepIndex < this.maxStep) return this.stepDown();
    if (bad) return null;
    if (this.stepIndex <= this.pinnedStep) return null;
    if (this.goodStreakMs < this.recoverHoldMs) return null;
    if (this.lastDownAt >= 0 && this.clockMs - this.lastDownAt < this.recoverAfterMs) return null;
    return this.stepUp();
  }

  /** 1段下げる。往復が oscillationLimit 回に達したら その段に固定する */
  private stepDown(): DynamicResolutionEvent {
    const fromScale = this.scale;
    this.stepIndex++;
    let pinNote = '';
    if (this.upFrom[this.stepIndex] > 0) {
      this.roundTrip[this.stepIndex]++;
      if (this.roundTrip[this.stepIndex] >= this.oscillationLimit) {
        this.pinnedStep = Math.max(this.pinnedStep, this.stepIndex);
        pinNote = ` / 往復${this.roundTrip[this.stepIndex]}回のため段${this.stepIndex}に固定`;
      }
    }
    this.lastDownAt = this.clockMs;
    return this.pushEvent(
      'down',
      fromScale,
      `p95 ${this.winP95.toFixed(2)}ms > ${this.thresholdMs}ms が${this.sustainEvals}回連続` +
        ` (悪い区間 ${this.badBuckets}/${this.windowBuckets})${pinNote}`
    );
  }

  /** 1段戻す */
  private stepUp(): DynamicResolutionEvent {
    const fromScale = this.scale;
    this.upFrom[this.stepIndex]++;
    this.stepIndex--;
    return this.pushEvent(
      'up',
      fromScale,
      `p95 ${this.winP95.toFixed(2)}ms < ${this.recoverThresholdMs}ms が` +
        `${Math.round(this.goodStreakMs / 1000)}秒つづいた` +
        ` (最後の降格から${this.lastDownAt >= 0 ? Math.round((this.clockMs - this.lastDownAt) / 1000) : '-'}秒)`
    );
  }

  private pushEvent(dir: 'down' | 'up', fromScale: number, reason: string): DynamicResolutionEvent {
    const evt: DynamicResolutionEvent = {
      step: this.stepIndex,
      dir,
      fromScale,
      toScale: this.scale,
      windowP95: this.winP95,
      badBuckets: this.badBuckets,
      windowFrames: this.winFrames,
      atMs: Math.round(this.clockMs),
      reason,
    };
    this.events.push(evt);
    // 段を変えた直後の窓には変更前のフレームが残っている。捨てて測り直す。
    this.clearWindow();
    this.overStreak = 0;
    this.goodStreakMs = 0;
    this.cooldownUntil = this.clockMs + this.cooldownMs;
    return evt;
  }

  /**
   * 外(main.ts の 低fps安全弁)が解像度を変えたことを知らせる。
   * 変更前のフレームで判定しないよう 窓と「良い時間」を捨て、
   * 降格のときは 復帰までの60秒も その時点から数え直す。
   */
  noteExternalScaleChange(dir: 'down' | 'up'): void {
    this.clearWindow();
    this.overStreak = 0;
    this.goodStreakMs = 0;
    this.cooldownUntil = this.clockMs + this.cooldownMs;
    if (dir === 'down') this.lastDownAt = this.clockMs;
  }

  /**
   * いま「十分に軽い状態が45秒つづいている」か(=1段戻してよい状態か)。
   * main.ts の低fps安全弁も この1つの計測を根拠に段を戻す
   * (fpsの瞬間値で数えると ヘッドレスや実機の ゆらぎで 永遠に戻らない)。
   */
  get recoverReady(): boolean {
    return (
      this.filled >= this.windowBuckets &&
      this.winP95 >= 0 &&
      this.winP95 < this.recoverThresholdMs &&
      this.goodStreakMs >= this.recoverHoldMs &&
      this.clockMs >= this.cooldownUntil &&
      (this.lastDownAt < 0 || this.clockMs - this.lastDownAt >= this.recoverAfterMs)
    );
  }

  /** 窓と集計中の区間を空にする(段の変更後・reset時) */
  private clearWindow(): void {
    for (const h of this.hist) h.fill(0);
    this.bucketCount.fill(0);
    this.bucketP95.fill(0);
    this.winHist.fill(0);
    this.winFrames = 0;
    this.winP95 = -1;
    this.badBuckets = 0;
    this.lastBucketP95 = -1;
    this.filled = 0;
    this.head = 0;
    this.curElapsed = 0;
  }

  /**
   * 計測をやり直す(タイトル→ゲーム開始のように、測る対象が変わったとき)。
   * すでに進んだ段・往復の履歴・固定された段は残す(そこは セッションの記憶)。
   */
  reset(): void {
    this.clearWindow();
    this.overStreak = 0;
    this.goodStreakMs = 0;
    this.warmupUntil = this.clockMs + this.warmupMs;
    this.cooldownUntil = Math.max(this.cooldownUntil, this.clockMs);
  }

  getState(): DynamicResolutionState {
    return {
      step: this.stepIndex,
      maxStep: this.maxStep,
      baseScale: round4(this.baseScale),
      scale: this.scale,
      thresholdMs: this.thresholdMs,
      windowP95: this.winP95,
      windowFrames: this.winFrames,
      windowBuckets: this.filled,
      badBuckets: this.badBuckets,
      lastBucketP95: this.lastBucketP95,
      overStreak: this.overStreak,
      cooldownLeftMs: Math.max(0, Math.round(this.cooldownUntil - this.clockMs)),
      warmupLeftMs: Math.max(0, Math.round(this.warmupUntil - this.clockMs)),
      elapsedMs: Math.round(this.clockMs),
      frames: this.frames,
      ignored: this.ignored,
      goodStreakMs: Math.round(this.goodStreakMs),
      recoverHoldLeftMs: Math.max(0, Math.round(this.recoverHoldMs - this.goodStreakMs)),
      sinceLastDownMs: this.lastDownAt < 0 ? -1 : Math.round(this.clockMs - this.lastDownAt),
      pinnedStep: this.pinnedStep,
      roundTrips: this.roundTrip.slice(),
      events: this.events.map((e) => ({ ...e })),
    };
  }
}

/** frame time(ms) → ヒストグラムの箱の番号 */
function binOf(ms: number): number {
  if (ms >= BIN_MAX_MS) return BIN_COUNT - 1;
  const b = Math.floor(ms / BIN_MS);
  return b < 0 ? 0 : b;
}

function addHist(dst: Int32Array, src: Int32Array): void {
  for (let i = 0; i < dst.length; i++) dst[i] += src[i];
}

function subHist(dst: Int32Array, src: Int32Array): void {
  for (let i = 0; i < dst.length; i++) dst[i] -= src[i];
}

/**
 * ヒストグラムから分位を求める。順位の取り方は perf_probe.mjs と同じ
 * (昇順に並べた配列の添字 min(n-1, floor(n*p)) の値)。
 * 返す値は箱の下端なので、真値との差は必ず0以上 BIN_MS 未満(=しきい値超えを過大に見積もらない)。
 */
export function percentileOf(hist: Int32Array, count: number, p: number): number {
  if (count <= 0) return -1;
  const idx = Math.min(count - 1, Math.floor(count * p));
  let cum = 0;
  for (let b = 0; b < hist.length; b++) {
    cum += hist[b];
    if (cum > idx) return b * BIN_MS;
  }
  return (hist.length - 1) * BIN_MS;
}

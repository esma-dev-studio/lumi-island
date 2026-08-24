// 常時表示HUD: 時計・ルミナ・操作ヒント(最小限に保つ)+ りょうりの効果のしるし
import type { ActiveEffect } from '../systems/CookingEffects';
import { icon } from './icons';
import { isTouchMode, hintWithoutKeys } from './inputMode';

/** ルミナの数字が 新しい値まで 数え上がる時間(ms) */
export const LUMINA_COUNT_MS = 400;
/** 「+368」の浮きが 消えるまでの時間(ms)。CSSの lumina-pop と そろえる */
export const LUMINA_POP_MS = 900;

/** はいち中のヒント帯の いろ(○=おける / ×=おけない)。null なら ふつうの帯 */
export type HintTone = 'ok' | 'ng' | null;

export class Hud {
  private clockEl: HTMLElement;
  private luminaEl: HTMLElement;
  private luminaChip: HTMLElement;
  private hintEl: HTMLElement;
  private fxEl: HTMLElement;

  constructor() {
    const root = document.getElementById('ui-root')!;
    const bar = document.createElement('div');
    bar.className = 'hud-top';
    bar.innerHTML = `
      <div class="hud-chip" id="hud-clock">あさ 6:00</div>
      <div class="hud-chip" id="hud-lumina"><svg viewBox="0 0 16 16" width="13" height="13"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="8" r="2.2" fill="currentColor"/></svg><span class="lumina-n">0</span></div>
    `;
    root.appendChild(bar);
    // v12 りょうりの効果(かかっているあいだだけ 時計の下に出る)
    const fx = document.createElement('div');
    fx.className = 'hud-fx';
    fx.id = 'hud-fx';
    root.appendChild(fx);
    const hint = document.createElement('div');
    hint.className = 'hud-hint';
    hint.id = 'hud-hint';
    root.appendChild(hint);
    this.clockEl = bar.querySelector('#hud-clock')!;
    this.luminaChip = bar.querySelector('#hud-lumina')!;
    this.luminaEl = bar.querySelector('#hud-lumina .lumina-n')!;
    this.hintEl = hint;
    this.fxEl = fx;
  }

  private lastClock = '';
  setClock(label: string, day: number): void {
    const s = `${day}日め ${label}`;
    if (s !== this.lastClock) {
      this.lastClock = s;
      this.clockEl.textContent = s;
    }
  }
  /**
   * v16.1 ルミナの その場フィードバック。
   *
   * ・右上の数字は 0.4秒かけて 新しい値まで 数え上がる/下がる
   * ・そのすぐ下に「+368」「-300」が 0.9秒 浮いて消える(ふえた=金 / へった=灰)
   *
   * なぜ要るか: v16.0 は 売った・買った ことを 左上のトーストでしか 言っておらず、
   * 右上のカウンタは いつのまにか 数字が 変わっていた(UI総ざらいの写真 39)。
   * 「どこで いくら 動いたか」を、目を動かさずに 読めるようにする。
   *
   * いちばん最初の1回(読みこみ直後のセット)は 浮きも 数え上がりも 出さない
   * ——0 から 4820 へ「+4820」と 祝ってしまうため。
   */
  private luminaTarget = 0;
  private luminaShown = 0;
  private luminaPrimed = false;
  private luminaRaf = 0;
  private luminaPop: HTMLElement | null = null;
  private luminaPopTimer = 0;

  setLumina(n: number): void {
    if (n === this.luminaTarget) return;
    const prev = this.luminaTarget;
    this.luminaTarget = n;
    if (!this.luminaPrimed) {
      // 読みこみ直後の1回目: だまって その数字にする
      this.luminaPrimed = true;
      this.luminaShown = n;
      this.luminaEl.textContent = String(n);
      return;
    }
    this.showLuminaPop(n - prev);
    this.countLumina(this.luminaShown, n);
  }

  /** 「+368」/「-300」を カウンタの すぐ下に 浮かせる(同時に出るのは 1つだけ) */
  private showLuminaPop(delta: number): void {
    if (delta === 0) return;
    this.luminaPop?.remove();
    if (this.luminaPopTimer) clearTimeout(this.luminaPopTimer);
    const el = document.createElement('span');
    el.className = `lumina-pop ${delta > 0 ? 'gain' : 'loss'}`;
    el.textContent = `${delta > 0 ? '+' : '-'}${Math.abs(delta)}`;
    this.luminaChip.appendChild(el);
    this.luminaPop = el;
    this.luminaPopTimer = window.setTimeout(() => {
      el.remove();
      if (this.luminaPop === el) this.luminaPop = null;
      this.luminaPopTimer = 0;
    }, LUMINA_POP_MS);
  }

  /** 数字を from → to へ 0.4秒で 動かす(毎フレームの setLumina では 走らない) */
  private countLumina(from: number, to: number): void {
    if (this.luminaRaf) cancelAnimationFrame(this.luminaRaf);
    const t0 = performance.now();
    const step = (): void => {
      const k = Math.min(1, (performance.now() - t0) / LUMINA_COUNT_MS);
      const e = 1 - (1 - k) * (1 - k); // さいごに ゆっくり止まる
      this.luminaShown = Math.round(from + (to - from) * e);
      this.luminaEl.textContent = String(this.luminaShown);
      if (k < 1) {
        this.luminaRaf = requestAnimationFrame(step);
      } else {
        this.luminaRaf = 0;
        this.luminaShown = to;
        this.luminaEl.textContent = String(to);
      }
    };
    step(); // 1フレーム目は すぐ書く(押した手ごたえを 遅らせない)
  }
  /**
   * v12 りょうりの効果のしるし。
   * 中身が変わったときだけ描きなおす(1秒ごとに のこり秒が変わるので、
   * キーは「効果のID+のこり秒(整数)」にして 毎フレームの書きかえを防ぐ)。
   */
  private lastFx = '';
  setEffects(list: ActiveEffect[]): void {
    const key = list.map((e) => `${e.def.id}:${Math.ceil(e.left)}`).join(',');
    if (key === this.lastFx) return;
    this.lastFx = key;
    this.fxEl.innerHTML = list
      .map((e) => {
        const sec = Math.ceil(e.left);
        const label = sec >= 60 ? `あと ${Math.ceil(sec / 60)}ふん` : `あと ${sec}びょう`;
        return `<div class="fx-chip" title="${e.def.desc}">
          <span class="inv-ico">${icon(e.def.icon)}</span>
          <span class="fx-name">${e.def.name}<small>${label}</small></span>
          <span class="fx-bar"><i style="width:${Math.round(e.ratio * 100)}%"></i></span>
        </div>`;
      })
      .join('');
    this.fxEl.classList.toggle('show', list.length > 0);
  }

  private lastHint = '';
  private lastTouch = false;
  private lastTone: HintTone = null;
  /**
   * 画面下の 操作ヒント。
   * @param tone v16.1 はいち中だけ 'ok'(おける)/'ng'(おけない)。
   *   帯のあたまに ○/× を出し、帯の色を みどり/あかに かえ、
   *   地面の 配置リングに かぶらない高さへ 上げる。
   *   ふつうの ヒントでは null(見た目も 高さも v16.0 と同じ)。
   *
   *   ○/× は **ここで足す**(ヒントの文字列そのものには 入れない):
   *   同じ文字列を タッチの行動ボタンのラベル(hintToLabel)や 回帰ボットの
   *   突きあわせが 読むので、見た目のしるしを 混ぜない。
   */
  setHint(html: string, tone: HintTone = null): void {
    // タッチのときはキーの表示を出さない(押す場所は画面のボタンなので)。
    // 入力手段は毎回見る: 途中で指に切り替わっても次の更新で入れ替わる。
    const touch = isTouchMode();
    if (this.lastHint !== html || this.lastTouch !== touch || this.lastTone !== tone) {
      this.lastHint = html;
      this.lastTouch = touch;
      this.lastTone = tone;
      const shown = touch ? hintWithoutKeys(html) : html;
      const mark = shown && tone ? `<span class="ph-mark ${tone}">${tone === 'ok' ? '○' : '×'}</span>` : '';
      this.hintEl.innerHTML = mark + shown;
      this.hintEl.classList.toggle('show', !!shown);
      this.hintEl.classList.toggle('place', !!shown && tone !== null);
      this.hintEl.classList.toggle('ok', !!shown && tone === 'ok');
      this.hintEl.classList.toggle('ng', !!shown && tone === 'ng');
    }
  }
}

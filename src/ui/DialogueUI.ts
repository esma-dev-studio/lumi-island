// 会話ボックス(画面下)。Eかクリックで進む。
import { sfx } from '../audio/AudioSystem';
import { byInput } from './inputMode';

/**
 * 「つぎへ/おわる」の案内。押す場所は入力手段で違うので、出すたびに選び直す。
 * タッチではこのパネル自体のタップでも、右下の大きいボタン(「つぎへ」)でも進む。
 */
function nextLabel(last: boolean): string {
  const word = last ? 'おわる' : 'つぎへ';
  return byInput(`<kbd>E</kbd>${word}`, `タップで ${word}`);
}

export class DialogueUI {
  private el: HTMLElement;
  private lines: string[] = [];
  private idx = 0;
  private speaker = '';
  open = false;
  onEnd: (() => void) | null = null;
  /**
   * 上に小さなパネル(おくりもの)が出ているあいだ true。
   * このあいだは会話パネルのクリックでもEでも進まない(裏の会話だけ先に終わって
   * 選択パネルが取り残される事故を防ぐ)。Escは InputRouter が両方まとめて閉じる。
   */
  blockAdvance = false;
  /**
   * blockAdvance 中に「つぎへ」(E・タッチの丸ボタン)が押されたときの逃げ道。
   * 何も起きないボタンを画面に残さないため、上のパネル側が「やめる」を割りあてる。
   */
  onBlockedAdvance: (() => void) | null = null;
  /**
   * 最終行にだけ出す任意ボタン(「おくりものをする」「こうじを たのむ」「はい/やめる」)。
   * 押しても会話は進まない。複数出せるが、横1列に並ぶので2つまでにする
   * (タッチの丸ボタンと合わせて3つ以上は画面の下がふさがる)。
   */
  private extras: { label: string; handler: () => void }[] = [];

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'dialogue hidden';
    this.el.innerHTML = `
      <div class="dlg-name"></div>
      <div class="dlg-text"></div>
      <div class="dlg-next">${nextLabel(false)}</div>
    `;
    document.getElementById('ui-root')!.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      // 任意ボタンは「会話を進めない」ので、advanceより先に見る
      const btn = (e.target as HTMLElement).closest('[data-dlg-extra]') as HTMLElement | null;
      if (btn) {
        const i = Number(btn.getAttribute('data-dlg-extra'));
        this.extras[i]?.handler();
        return;
      }
      this.advance();
    });
  }

  show(speaker: string, lines: string[], onEnd?: () => void): void {
    this.speaker = speaker;
    this.lines = lines;
    this.idx = 0;
    this.onEnd = onEnd ?? null;
    this.open = true;
    this.blockAdvance = false;
    this.onBlockedAdvance = null;
    // 前の会話のボタンを持ちこさない(出す側が show のあとに setExtraAction で付け直す)
    this.extras = [];
    this.el.classList.remove('hidden');
    this.renderLine();
  }

  /**
   * 最終行に出す任意ボタンを差しかえる(null で消す)。
   * 押さなければ何も起きない追加要素なので、Eだけで会話を送る自動テスト・ボットには影響しない。
   */
  setExtraAction(label: string | null, handler: (() => void) | null): void {
    this.extras = label && handler ? [{ label, handler }] : [];
    if (this.open) this.renderLine();
  }

  /** 任意ボタンを1つ足す(先に足したものが左に出る) */
  addExtraAction(label: string, handler: () => void): void {
    this.extras.push({ label, handler });
    if (this.open) this.renderLine();
  }

  /** 任意ボタンをまとめて差しかえる(確認の「はい/やめる」のように2つ出すとき) */
  setExtraActions(list: { label: string; handler: () => void }[]): void {
    this.extras = [...list];
    if (this.open) this.renderLine();
  }

  /** いま出ている任意ボタンの文言(検証・テスト用) */
  get extraLabels(): string[] {
    return this.extras.map((e) => e.label);
  }

  /**
   * いま画面に出ている任意ボタンだけを数える(最終行でなければ 0)。
   * ボタンは最終行にしか出さないので、キーの1・2もそのときだけ効く。
   */
  private get extrasShown(): boolean {
    return this.open && this.idx >= this.lines.length - 1 && this.extras.length > 0;
  }

  /**
   * 数字キー(1・2)で任意ボタンをえらぶ。押せる状態でなければ何もしない(false)。
   *
   * クリックの保険。マウスが何かの拍子に効かなくても、キーボードだけで
   * 「こうじを たのむ」「おくりものをする」まで たどりつけるようにしてある
   * (v14.1で 透明なオーバーレイが クリックを吸い、進めなくなった実害への備え)。
   * ボタンの左肩に出る小さな数字(.dlg-key)が、そのまま この番号。
   */
  chooseExtra(i: number): boolean {
    if (!this.extrasShown) return false;
    const e = this.extras[i];
    if (!e) return false;
    e.handler();
    return true;
  }

  advance(): void {
    if (!this.open) return;
    if (this.blockAdvance) {
      this.onBlockedAdvance?.(); // 上のパネルを閉じて会話にもどす(押して無反応にしない)
      return;
    }
    sfx('talk');
    this.idx++;
    if (this.idx >= this.lines.length) {
      this.close();
    } else {
      this.renderLine();
    }
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.blockAdvance = false;
    this.onBlockedAdvance = null;
    this.extras = [];
    this.el.classList.add('hidden');
    const cb = this.onEnd;
    this.onEnd = null;
    cb?.();
  }

  private renderLine(): void {
    const last = this.idx >= this.lines.length - 1;
    (this.el.querySelector('.dlg-name') as HTMLElement).textContent = this.speaker;
    (this.el.querySelector('.dlg-text') as HTMLElement).textContent = this.lines[this.idx];
    // ボタンの左肩の小さな数字は、そのまま押せるキー(1・2)。
    // 指の画面では意味がないので、CSS(html.touch-ui .dlg-key)で消してある。
    const extra = last
      ? this.extras
          .map(
            (e, i) =>
              `<button class="craft-btn sub" data-dlg-extra="${i}" style="margin-right:10px">` +
              `<span class="dlg-key">${i + 1}</span>${e.label}</button>`
          )
          .join('')
      : '';
    (this.el.querySelector('.dlg-next') as HTMLElement).innerHTML = extra + nextLabel(last);
  }
}

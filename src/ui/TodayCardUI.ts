// v15 朝の「きょうの島」カード(1日1回・3秒で消える お知らせ)。
//
// 依頼達成バナー(QuestCompleteUI)と同じ見た目の格・同じ置き場所にしてある。
// ちがうのは3つ:
//   1. 世界を止めない(WorldPauseController の uiOpen/frozen に入れない)。
//      朝のお知らせで 時計まで止めると、遊んでいる感じが とぎれる。
//   2. Eを食べない(src/scenes/InteractionRouting.ts)。Eで早送りできるが、
//      同じフレームの ふつうのE操作も そのまま通る = 押した操作が1回きかない事故を作らない。
//   3. 会話・モーダル・見せ場が開いているあいだは そもそも出さない(GameScene が見る)。
import { QUIET_TEXT, type TodayCardData } from '../systems/TodayCard';
import { icon } from './icons';

/** 出しっぱなしにしない(実秒)。読みきれる長さで、遊びを止めない長さ */
export const CARD_SHOW_MS = 3000;

export class TodayCardUI {
  private el: HTMLElement;
  private timer: number | null = null;
  open = false;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'today-card hidden';
    document.getElementById('ui-root')!.appendChild(this.el);
    this.el.addEventListener('click', () => this.hide());
  }

  show(card: TodayCardData): void {
    // しずかな日の絵は ベンチ(のんびり すわる)。丸い印だと「なにかの合図」に見えてしまう
    const rows = card.quiet
      ? `<div class="tc-row tc-quiet"><span class="tc-ico">${icon('f_bench')}</span><span>${QUIET_TEXT}</span></div>`
      : card.events
          .map((e) => `<div class="tc-row"><span class="tc-ico">${icon(e.icon)}</span><span>${e.text}</span></div>`)
          .join('');
    // 「きょうの おすすめ」のラベルは 1行めに置き、絵と文は そのつぎの行にまとめる。
    // 横1列に ならべると、文が おりかえしたときに 絵だけが ラベルのとなりに 取りのこされる
    this.el.innerHTML = `
      <div class="tc-band">きょうの島</div>
      <div class="tc-day">${card.day}日め</div>
      ${rows}
      <div class="tc-pick">
        <div class="tc-pick-label">きょうの おすすめ</div>
        <div class="tc-pick-text"><span class="tc-ico">${icon(card.suggestion.icon)}</span><span>${card.suggestion.text}</span></div>
      </div>
    `;
    this.el.classList.remove('hidden');
    this.open = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.hide(), CARD_SHOW_MS);
  }

  /** E・クリック・時間切れのどれでも同じ道すじで消す */
  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.el.classList.add('hidden');
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

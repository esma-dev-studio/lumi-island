// ポーズメニュー(Esc): つづける/おと/そうさ/タイトルへ
import { loadOpts, saveOpts } from '../save/SaveSystem';
import { setSoundEnabled, sfx } from '../audio/AudioSystem';
import { byInput } from './inputMode';

/** そうさほうほうの一覧(左=なにをするか / 右=どうなるか) */
const HELP_KEYBOARD = `
          <span><kbd>W A S D</kbd></span><span>あるく</span>
          <span><kbd>Shift</kbd></span><span>はしる</span>
          <span><kbd>E</kbd></span><span>しらべる・とる・はなす</span>
          <span><kbd>Tab</kbd></span><span>もちもの</span>
          <span><kbd>C</kbd></span><span>クラフト</span>
          <span><kbd>Q</kbd></span><span>おねがい</span>
          <span><kbd>Z</kbd></span><span>ずかん</span>
          <span><kbd>R</kbd></span><span>(はいち中)まわす</span>`;

const HELP_TOUCH = `
          <span>左下を ゆびで うごかす</span><span>あるく</span>
          <span>おおきく うごかす</span><span>はしる</span>
          <span>右下の 大きいボタン</span><span>しらべる・とる・はなす</span>
          <span>右上の「もちもの」</span><span>もちもの</span>
          <span>右上の「クラフト」</span><span>クラフト</span>
          <span>右上の「おねがい」</span><span>おねがい</span>
          <span>右上の「ずかん」</span><span>ずかん</span>
          <span>「まわす」ボタン</span><span>(はいち中)まわす</span>`;

export class PauseMenu {
  private el: HTMLElement;
  open = false;
  onBackToTitle: (() => void) | null = null;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'panel pause-panel hidden';
    document.getElementById('ui-root')!.appendChild(this.el);
  }

  show(): void {
    this.open = true;
    this.render();
    this.el.classList.remove('hidden');
  }
  close(): void {
    this.open = false;
    this.el.classList.add('hidden');
  }

  private render(): void {
    const opts = loadOpts();
    this.el.innerHTML = `
      <div class="panel-title">メニュー</div>
      <div class="pause-list">
        <button class="title-btn" data-act="resume">つづける</button>
        <button class="title-btn sub" data-act="sound">おと: ${opts.sound ? 'オン' : 'オフ'}</button>
        <button class="title-btn sub" data-act="help">そうさほうほう</button>
        <button class="title-btn sub" data-act="title">セーブしてタイトルへ</button>
      </div>
      <div class="title-extra hidden" data-panel="help">
        <div class="help-grid">${byInput(HELP_KEYBOARD, HELP_TOUCH)}
        </div>
      </div>
    `;
    this.el.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) => {
      b.onclick = () => {
        sfx('ui');
        const act = b.dataset.act!;
        if (act === 'resume') this.close();
        else if (act === 'sound') {
          const o = loadOpts();
          o.sound = !o.sound;
          saveOpts(o);
          setSoundEnabled(o.sound);
          b.textContent = `おと: ${o.sound ? 'オン' : 'オフ'}`;
        } else if (act === 'help') {
          this.el.querySelector('[data-panel="help"]')?.classList.toggle('hidden');
        } else if (act === 'title') {
          this.close();
          this.onBackToTitle?.();
        }
      };
    });
  }
}

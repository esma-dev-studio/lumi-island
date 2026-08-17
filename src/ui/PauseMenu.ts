// ポーズメニュー(Esc): つづける/おと/そうさ/タイトルへ
import { loadOpts, saveOpts } from '../save/SaveSystem';
import { setSoundEnabled, sfx } from '../audio/AudioSystem';
import { byInput } from './inputMode';
// そうさほうほうの中身は helpText.ts が唯一の情報源(タイトル画面と同じものを出す)
import { HELP_KEYBOARD, HELP_TOUCH } from './helpText';

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

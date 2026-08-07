// タイトル画面(新規/つづき/せってい/そうさ)
import { hasSave, clearSave, loadOpts, saveOpts } from '../save/SaveSystem';
import { setSoundEnabled } from '../audio/AudioSystem';
import { sfx } from '../audio/AudioSystem';
import { byInput } from './inputMode';

/** そうさほうほうの一覧(左=なにをするか / 右=どうなるか)。PauseMenuと同じ並び */
const HELP_KEYBOARD = `
            <span><kbd>W A S D</kbd>/<kbd>矢印</kbd></span><span>あるく</span>
            <span><kbd>Shift</kbd></span><span>はしる</span>
            <span><kbd>マウス</kbd>ドラッグ</span><span>カメラを まわす</span>
            <span><kbd>ホイール</kbd></span><span>ズーム(よる・ひく)</span>
            <span><kbd>E</kbd>/<kbd>Space</kbd></span><span>しらべる・とる・はなす</span>
            <span><kbd>Tab</kbd>/<kbd>I</kbd></span><span>もちもの</span>
            <span><kbd>C</kbd></span><span>クラフト</span>
            <span><kbd>Q</kbd></span><span>おねがい</span>
            <span><kbd>Z</kbd></span><span>ずかん</span>
            <span><kbd>R</kbd></span><span>(はいち中)まわす</span>
            <span><kbd>Esc</kbd></span><span>とじる・メニュー</span>`;

const HELP_TOUCH = `
            <span>左下を ゆびで うごかす</span><span>あるく</span>
            <span>おおきく うごかす</span><span>はしる</span>
            <span>がめんを ゆびで なぞる</span><span>カメラを まわす</span>
            <span>ゆび2本で ひろげる・ちぢめる</span><span>ズーム(よる・ひく)</span>
            <span>右下の 大きいボタン</span><span>しらべる・とる・はなす</span>
            <span>右上の「もちもの」</span><span>もちもの</span>
            <span>右上の「クラフト」</span><span>クラフト</span>
            <span>右上の「おねがい」</span><span>おねがい</span>
            <span>右上の「ずかん」</span><span>ずかん</span>
            <span>「まわす」ボタン</span><span>(はいち中)まわす</span>
            <span>右上の「メニュー」</span><span>とじる・メニュー</span>`;

export class TitleScreen {
  private el: HTMLElement;
  onStart: ((mode: 'new' | 'continue') => void) | null = null;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'title-screen';
    document.getElementById('ui-root')!.appendChild(this.el);
    this.render();
  }

  private render(): void {
    const saved = hasSave();
    const opts = loadOpts();
    this.el.innerHTML = `
      <div class="title-inner">
        <div class="title-logo">
          <div class="title-jp">ルミ島のくらし</div>
          <div class="title-en">Lumi Island</div>
          <div class="title-sub">夜になると、島がひかる。</div>
        </div>
        <div class="title-menu">
          <button class="title-btn" data-act="new">はじめから</button>
          <button class="title-btn" data-act="continue" ${saved ? '' : 'disabled'}>つづきから</button>
          <button class="title-btn sub" data-act="settings">せってい</button>
          <button class="title-btn sub" data-act="help">そうさほうほう</button>
        </div>
        <div class="title-extra hidden" data-panel="settings">
          <div class="tx-row"><span>おと</span><button class="title-btn sub" data-act="sound">${opts.sound ? 'オン' : 'オフ'}</button></div>
          <div class="tx-row"><span>セーブデータ</span><button class="title-btn danger" data-act="wipe" ${saved ? '' : 'disabled'}>けす</button></div>
        </div>
        <div class="title-extra hidden" data-panel="help">
          <div class="help-grid">${byInput(HELP_KEYBOARD, HELP_TOUCH)}
          </div>
        </div>
        <div class="title-credit">オリジナル作品 / 3Dモデル・音はすべてプログラム生成 <span class="title-ver">v11.1</span></div>
      </div>
    `;
    this.el.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) => {
      b.onclick = async () => {
        sfx('ui');
        const act = b.dataset.act!;
        if (act === 'new') {
          if (saved && !(await this.confirmModal('セーブデータがあります。<br>はじめからにすると消えますが、いいですか?'))) return;
          clearSave();
          this.onStart?.('new');
        } else if (act === 'continue') {
          this.onStart?.('continue');
        } else if (act === 'settings' || act === 'help') {
          this.el.querySelectorAll<HTMLElement>('.title-extra').forEach((p) => {
            p.classList.toggle('hidden', p.dataset.panel !== act || !p.classList.contains('hidden'));
          });
        } else if (act === 'sound') {
          const o = loadOpts();
          o.sound = !o.sound;
          saveOpts(o);
          setSoundEnabled(o.sound);
          b.textContent = o.sound ? 'オン' : 'オフ';
        } else if (act === 'wipe') {
          if (await this.confirmModal('セーブデータを完全に消します。いいですか?')) {
            clearSave();
            this.render();
          }
        }
      };
    });
  }

  /** ネイティブconfirm()の代わりのゲーム内モーダル */
  private confirmModal(msgHtml: string): Promise<boolean> {
    return new Promise((resolve) => {
      const m = document.createElement('div');
      m.className = 'title-confirm';
      m.innerHTML = `
        <div class="tc-box">
          <div class="tc-msg">${msgHtml}</div>
          <div class="tc-btns">
            <button class="title-btn danger" data-a="ok">はい</button>
            <button class="title-btn" data-a="no">やめる</button>
          </div>
        </div>`;
      this.el.appendChild(m);
      m.querySelectorAll<HTMLButtonElement>('button').forEach((btn) => {
        btn.onclick = () => {
          sfx('ui');
          m.remove();
          resolve(btn.dataset.a === 'ok');
        };
      });
    });
  }

  setLoading(): void {
    const menu = this.el.querySelector('.title-menu');
    if (menu) menu.innerHTML = '<div class="title-loading">島をじゅんびしています…</div>';
  }

  dispose(): void {
    this.el.remove();
  }
}

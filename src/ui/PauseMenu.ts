// ポーズメニュー(Esc): つづける/おと/そうさ/タイトルへ
import { loadOpts, saveOpts } from '../save/SaveSystem';
import { setSoundEnabled, sfx } from '../audio/AudioSystem';
import { byInput } from './inputMode';
import { PAINT_COLORS, ownedPaints, type ItemId, type PaintId } from '../data/items';
// そうさほうほうの中身は helpText.ts が唯一の情報源(タイトル画面と同じものを出す)
import { HELP_KEYBOARD, HELP_TOUCH } from './helpText';

export class PauseMenu {
  private el: HTMLElement;
  open = false;
  onBackToTitle: (() => void) | null = null;
  /**
   * v24 ふくを そめる。
   * getOutfit は「いま持っている いろみず」と「いまの ふくの色」を 返す
   * (もちものを ここへ 写さないための 問い合わせ口)。
   * いろみずを 1つも 持っていなければ、ボタンそのものを 出さない
   * (機能のないボタンは 置かない = AGENTS.md の 約束)。
   */
  getOutfit: (() => { inventory: Partial<Record<string, number>>; current?: string }) | null = null;
  onOutfit: ((paint: PaintId | null) => void) | null = null;

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

  /**
   * v24 ふくの いろがえ。もっている いろみずの色ぶんだけ ボタンが ならぶ。
   * いろみずを 1つも 持っていなければ、この かたまりごと 出さない。
   */
  private outfitHtml(): string {
    const o = this.getOutfit?.();
    if (!o) return '';
    const owned = ownedPaints(o.inventory as Partial<Record<ItemId, number>>);
    if (owned.length === 0) return '';
    const chips = owned
      .map((id) => {
        const p = PAINT_COLORS[id];
        const on = o.current === id;
        return `<button class="title-btn sub outfit-chip${on ? ' on' : ''}" data-outfit="${id}">
          <span class="paint-chip" style="background:${p.hex}"></span>${p.label}${on ? '(いま)' : ''}
        </button>`;
      })
      .join('');
    const reset = o.current
      ? '<button class="title-btn sub" data-outfit="none">もとの ふくに もどす</button>'
      : '';
    return `<div class="title-extra hidden" data-panel="outfit">
      <div class="pause-list">${chips}${reset}</div>
    </div>`;
  }

  private render(): void {
    const opts = loadOpts();
    const outfit = this.outfitHtml();
    this.el.innerHTML = `
      <div class="panel-title">メニュー</div>
      <div class="pause-list">
        <button class="title-btn" data-act="resume">つづける</button>
        <button class="title-btn sub" data-act="sound">おと: ${opts.sound ? 'オン' : 'オフ'}</button>
        ${outfit ? '<button class="title-btn sub" data-act="outfit">ふくの いろを かえる</button>' : ''}
        <button class="title-btn sub" data-act="help">そうさほうほう</button>
        <button class="title-btn sub" data-act="title">セーブしてタイトルへ</button>
      </div>
      ${outfit}
      <div class="title-extra hidden" data-panel="help">
        <div class="help-grid">${byInput(HELP_KEYBOARD, HELP_TOUCH)}
        </div>
      </div>
    `;
    this.el.querySelectorAll<HTMLButtonElement>('[data-outfit]').forEach((b) => {
      b.onclick = () => {
        sfx('ui');
        const id = b.dataset.outfit!;
        this.onOutfit?.(id === 'none' ? null : (id as PaintId));
        this.render(); // えらんだ色に 目じるしを 付けなおす
        this.el.querySelector('[data-panel="outfit"]')?.classList.remove('hidden');
      };
    });
    this.el.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) => {
      b.onclick = () => {
        sfx('ui');
        const act = b.dataset.act!;
        if (act === 'resume') this.close();
        else if (act === 'outfit') {
          this.el.querySelector('[data-panel="outfit"]')?.classList.toggle('hidden');
        } else if (act === 'sound') {
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

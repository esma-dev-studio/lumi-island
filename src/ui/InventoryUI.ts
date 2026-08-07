// インベントリ画面(Tab/I)。もちもの+道具。家具は「おく」で配置モードへ、
// かべがみ・ゆかいたは(室内にいるときだけ)「つかう」で模様替えする。
import type { GameState } from '../game/GameState';
import { ITEMS, TOOLS, isCookedFood, isDecor, isPlaceable, type ItemId } from '../data/items';
import { DISH_EFFECT, EFFECTS } from '../systems/CookingEffects';
import { icon } from './icons';
import { byInput } from './inputMode';

export class InventoryUI {
  private el: HTMLElement;
  open = false;
  onPlace: ((item: ItemId) => void) | null = null;
  /** かべがみ・ゆかいたの「つかう」。室内にいるときだけ押せる */
  onUse: ((item: ItemId) => void) | null = null;
  /** v12 りょうりの「たべる」。効果が しばらくつづく(セーブしない) */
  onEat: ((item: ItemId) => void) | null = null;

  /**
   * @param getState いまのゲーム状態
   * @param isIndoor いま家の中にいるか。屋外では「つかう」を出さない
   *   (貼る相手の壁・床がその場に無いので、押せても何も起きないボタンになってしまう)
   */
  constructor(
    private getState: () => GameState,
    private isIndoor: () => boolean = () => false
  ) {
    this.el = document.createElement('div');
    this.el.className = 'panel inv-panel hidden';
    document.getElementById('ui-root')!.appendChild(this.el);
    // クリックは委譲で1回だけ(描画途中の例外・再描画競合への免疫。CraftUIと同方針)
    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest(
        '[data-close], [data-place], [data-use], [data-eat]'
      ) as HTMLElement | null;
      if (!t) return;
      if (t.hasAttribute('data-close')) {
        this.close();
      } else if (t.dataset.place) {
        this.close();
        this.onPlace?.(t.dataset.place as ItemId);
      } else if (t.dataset.use) {
        this.onUse?.(t.dataset.use as ItemId);
        this.render();
      } else if (t.dataset.eat) {
        // たべても もちものは閉じない(効果を見ながら つづけて えらべる)
        this.onEat?.(t.dataset.eat as ItemId);
        this.render();
      }
    });
  }

  toggle(): void {
    this.open = !this.open;
    if (this.open) this.render();
    this.el.classList.toggle('hidden', !this.open);
  }
  close(): void {
    this.open = false;
    this.el.classList.add('hidden');
  }

  private render(): void {
    const s = this.getState();
    const indoor = this.isIndoor();
    const entries = Object.entries(s.inventory) as [ItemId, number][];
    const slots = entries
      .map(([id, n]) => {
        const def = ITEMS[id];
        let btn = '';
        // v12 りょうりは「たべる」と「おく(かざる)」の両方を出す。
        // 食べる=効果がつく / おく=テーブルの上の小物になる。おくりものは会話から
        if (isCookedFood(id)) {
          const eff = EFFECTS[DISH_EFFECT[id]];
          btn =
            `<button class="craft-btn sub" data-eat="${id}" title="${eff.name}: ${eff.desc}">たべる</button>` +
            `<button class="craft-btn sub" data-place="${id}">おく</button>`;
        } else if (isPlaceable(id)) {
          btn = `<button class="craft-btn sub" data-place="${id}">おく</button>`;
        } else if (isDecor(id) && indoor) {
          // 模様替えは室内だけ。使っても無くならないので、個数がいくつでもボタンは1つ
          btn = `<button class="craft-btn sub" data-use="${id}">つかう</button>`;
        }
        // りょうりは「どんな効果か」をマスの説明(ツールチップ)にも入れる
        const tip = isCookedFood(id)
          ? `${def.desc} / たべると: ${EFFECTS[DISH_EFFECT[id]].desc}`
          : def.desc;
        // ボタンが2つ入るマス(りょうり)は2列ぶんの幅をとる。
        // 1列のままだと 名前もボタンも1文字ずつ縦に割れて読めない(実機のスクショで確認)。
        // v14: ふつうの1列のマスでも「すいそう」が「すいそ/う」に割れていたので、
        // 名前の折り返し規則を style.css の .inv-name(word-break: keep-all)で直した
        const wide = isCookedFood(id) ? ' wide' : '';
        return `<div class="inv-slot${wide}" title="${tip}">
          <span class="inv-ico">${icon(id)}</span>
          <span class="inv-name">${def.name}</span>
          <span class="inv-count">×${n}</span>
          ${btn}
        </div>`;
      })
      .join('');
    const tools = s.tools
      .map((t) => `<div class="inv-tool" title="${TOOLS[t].desc}"><span class="inv-ico">${icon(t)}</span><span>${TOOLS[t].name}</span></div>`)
      .join('');
    this.el.innerHTML = `
      <div class="panel-title">もちもの <span class="panel-close" data-close>${byInput('とじる(Tab)', 'とじる')}</span></div>
      <div class="inv-grid">${slots || '<div class="inv-empty">まだ何ももっていない。島で木をきったり、実をつんだりしてみよう!</div>'}</div>
      <div class="panel-sub">どうぐ</div>
      <div class="inv-tools">${tools}</div>
    `;
    // クリック処理はコンストラクタの委譲リスナーが担当(ここでは付けない)。
    // 模様替えはその場で切り替わり、もちものは閉じない(3種を見くらべながら選べるように)
  }
}

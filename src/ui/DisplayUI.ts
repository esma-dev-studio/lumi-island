// 展示家具(すいそう・むしかご の大小)に いきものを入れる/とりだす パネル。
//
// 見た目の言語は他のパネル(もちもの・クラフト・おくりもの)と同じクラスを使い回す。
// クリックは委譲リスナー1本だけ(GiftUI・CraftUI・InventoryUIと同方針。毎描画のonclick割当てだと
// 「ボタンは見えるのに押せない」状態になり得る)。キーボードでもタッチでも同じ経路を通る。
//
// このパネルは「置いてある家具そのもののメニュー」でもある:
//   - いま入っている いきものを 1匹ずつ とりだす
//   - もちものの いきものを 1匹ずつ いれる(あき が あるあいだ)
//   - この家具を もちかえる(中身があれば いっしょに もちものへ戻る)
//   - やめる
// もちかえるをここに置いているのは、家具に立つと E が この パネルになるため。
// パネルにも入口が無いと、水そう・むしかごだけ 置きなおせなくなってしまう。
//
// v13: 中身が複数になったので、押しても パネルを閉じない(入れた・出したの結果が
// その場で見える)。1匹ずつ 何回も押して 6ぴき入れる、が いちばん多い遊びかたなので、
// そのたびに閉じると 3回 開きなおすことになる。
import type { GameState } from '../game/GameState';
import { DISPLAY_FURNITURE, ITEMS, type DisplayFurnitureId, type ItemId } from '../data/items';
import { icon } from './icons';
import { sfx } from '../audio/AudioSystem';

/** そのケースに いま入れられる もちもの(所持数1以上のものだけ・表の順) */
export function displayableItems(state: GameState, furniture: DisplayFurnitureId): ItemId[] {
  return DISPLAY_FURNITURE[furniture].accepts.filter((id) => (state.inventory[id] ?? 0) > 0);
}

export class DisplayUI {
  private el: HTMLElement;
  open = false;
  private furniture: DisplayFurnitureId = 'f_aquarium';
  /** いま入っている いきものを読む(呼び出し側が 最新の中身を返す) */
  private getContents: () => readonly ItemId[] = () => [];
  /** いきものを えらんだ(呼び出し側が 消費・保存・見た目の作り直しを受けもつ) */
  onChoose: ((item: ItemId) => void) | null = null;
  /** 入っている いきものを1匹とりだす(番号は入っている順) */
  onTake: ((slot: number) => void) | null = null;
  /** この家具を もちかえる */
  onCarry: (() => void) | null = null;
  /** v24 この家具を その場で うごかす(中身ごと 置き直す) */
  onMove: (() => void) | null = null;

  constructor(private getState: () => GameState) {
    this.el = document.createElement('div');
    this.el.className = 'panel display-panel hidden';
    document.getElementById('ui-root')!.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest(
        '[data-close], [data-carry], [data-move], [data-put], [data-take]'
      ) as HTMLElement | null;
      if (!t) return;
      if (t.hasAttribute('data-close')) {
        this.close();
        return;
      }
      if (t.hasAttribute('data-carry')) {
        this.close();
        this.onCarry?.();
        return;
      }
      if (t.hasAttribute('data-move')) {
        this.close();
        this.onMove?.();
        return;
      }
      const take = t.dataset.take;
      if (take !== undefined) {
        const slot = Number(take);
        if (Number.isInteger(slot)) this.onTake?.(slot);
        this.render(); // 中身が減ったので すぐ描きなおす(閉じない)
        return;
      }
      const id = t.dataset.put as ItemId | undefined;
      if (!id) return;
      this.onChoose?.(id);
      this.render(); // 中身が増えたので すぐ描きなおす(閉じない)
    });
  }

  /**
   * パネルを開く。getContents は「いま入っている いきもの」を返す関数
   * (中身は PlacementSystem が持つので、UIは毎回読みにいく=データと表示がずれない)。
   */
  show(furniture: DisplayFurnitureId, getContents: () => readonly ItemId[] = () => []): void {
    this.furniture = furniture;
    this.getContents = getContents;
    this.open = true;
    this.render();
    this.el.classList.remove('hidden');
    sfx('ui');
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.el.classList.add('hidden');
  }

  private render(): void {
    const s = this.getState();
    const def = DISPLAY_FURNITURE[this.furniture];
    const contents = [...this.getContents()];
    const cap = def.capacity;
    const full = contents.length >= cap;
    // 1マスの最小幅を決めて列数は画面まかせにする(タッチでは自然に1列になる)
    const grid = 'grid-template-columns:repeat(auto-fill,minmax(12em,1fr))';
    const nameStyle = 'min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    // ---- いま入っている いきもの(1匹ずつ とりだせる) ----
    const inside = contents
      .map((id, slot) => {
        const item = ITEMS[id];
        return `<div class="inv-slot" title="${item.desc}">
          <span class="inv-ico">${icon(id)}</span>
          <span class="inv-name" style="${nameStyle}">${item.name}</span>
          <button class="craft-btn sub" data-take="${slot}" style="white-space:nowrap">とりだす</button>
        </div>`;
      })
      .join('');
    // ---- もちものから いれる(いっぱいのときは 出さない) ----
    const items = displayableItems(s, this.furniture);
    const slots = items
      .map((id) => {
        const item = ITEMS[id];
        // 名前・ボタンは折り返さない(もちもの3列の幅だと「サカ/ナ」のように1文字ずつ縦に割れる)
        return `<div class="inv-slot" title="${item.desc}">
          <span class="inv-ico">${icon(id)}</span>
          <span class="inv-name" style="${nameStyle}">${item.name}</span>
          <span class="inv-count">×${s.inventory[id] ?? 0}</span>
          <button class="craft-btn sub" data-put="${id}" style="white-space:nowrap">${def.putLabel}</button>
        </div>`;
      })
      .join('');
    // v16.1 いちばん下の2つのボタンは「うごかす」「もちかえる」だけにする。
    // 何を うごかすのかは すぐ上の 見出し(「おおきな すいそうに 魚を いれる」)が
    // もう言っている。家具の名前を くりかえすと 1行に 入りきらず 2行に 折れていた
    // (UI総ざらいの写真 16)。動きの名前だけ 残すほうが 目で 追いやすい。
    // 「あと何こ入るか」を数で見せる(たくさん入る家具で いま何こか いつでも分かる)
    //
    // v25 文言は ぜんぶ DISPLAY_FURNITURE から とる(「いきもの」「ひき」を ここに
    // じか書きしていたので、ぬいぐるみだなを 足したとたんに 文が うそになるところだった)。
    const count = cap > 1 ? ` <span class="panel-count">${contents.length} / ${cap}${def.unit}</span>` : '';
    const insideBlock =
      contents.length > 0
        ? `<div class="panel-sub first">${def.insideLabel}</div>
           <div class="inv-grid" style="${grid}">${inside}</div>`
        : '';
    const putBlock = full
      ? `<div class="inv-empty">${def.full}</div>`
      : `<div class="inv-grid" style="${grid}">${slots || `<div class="inv-empty">${def.empty}</div>`}</div>`;
    this.el.innerHTML = `
      <div class="panel-title"><span>${def.label}に ${def.contentLabel}を ${def.putLabel}${count}</span>
        <span class="panel-close" data-close>やめる</span>
      </div>
      ${insideBlock}
      ${contents.length > 0 ? `<div class="panel-sub">${def.putLabel}</div>` : ''}
      ${putBlock}
      <div class="panel-sub">とりだすと もちものに もどるよ。
        <button class="craft-btn sub" data-move style="white-space:nowrap;margin-left:8px">うごかす</button>
        <button class="craft-btn sub" data-carry style="white-space:nowrap;margin-left:8px">もちかえる</button>
      </div>
    `;
    // クリック処理はコンストラクタの委譲リスナーが担当(ここでは付けない)
  }
}

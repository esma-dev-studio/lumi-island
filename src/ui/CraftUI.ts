// クラフト画面(C)。タブは2つ:
//   「レシピ」    : おぼえたレシピの一覧(v11までと まったく同じ中身・同じクラス名)
//   「くみあわせ」: もちものを2〜3こ えらんで「ためす」→ かくしレシピの発見(v12)
//
// タブを足しても「レシピ」がわのDOM(.craft-list / .craft-row / .craft-name / .craft-btn)は
// 1つも変えていない。回帰ボット・UXボットは この形で作る手順を読むので、
// 見出しやクラスを変えると 自動テストが いっせいに動かなくなる。
//
// v24 いちばん下に「まだ しらない レシピ」の節(?行)を足した。
// こちらは **別のクラス craft-q-***(ボタンなし)にしてあるので、
// .craft-row / .craft-btn を読む ボット・E2Eの みちには 1つも入らない。
import type { GameState } from '../game/GameState';
import { knownRecipes, canCraft, craft, craftList } from '../systems/CraftingSystem';
import { ITEMS, TOOLS, type ItemId, type RecipeDef, type ToolId } from '../data/items';
import { COMBO_MAX, COMBO_MIN } from '../data/combos';
import {
  COMBO_LOCKED_TEXT, canOffer, discoveredCount, previewCombo, tryCombo,
} from '../systems/ComboSystem';
import { unknownRecipeHints } from '../systems/DiscoverySystem';
import { COMBOS } from '../data/combos';
import { icon } from './icons';
import { byInput } from './inputMode';
import { sfx } from '../audio/AudioSystem';

type CraftTab = 'recipe' | 'combo';

/** レシピ一覧の節。並ぶ順もこの配列のとおり(道具→家具→料理→いろみず→かざり→そのほか) */
type CraftSection = 'tool' | 'furniture' | 'dish' | 'paint' | 'decor' | 'other';
const CRAFT_SECTIONS: { id: CraftSection; title: string }[] = [
  { id: 'tool', title: 'どうぐ' },
  { id: 'furniture', title: 'かぐ' },
  { id: 'dish', title: 'りょうり' },
  { id: 'paint', title: 'いろみず' },
  { id: 'decor', title: 'かざり(かべ・ゆか)' },
  { id: 'other', title: 'そのほか' },
];

/**
 * レシピが どの節に入るかを、産出するもの1つから決める(節の一覧をデータに二重持ちしない)。
 * いろみず(paint_*)だけは ITEMS の kind が 'material' なのでIDで見分ける。
 */
export function craftSectionOf(r: RecipeDef): CraftSection {
  if (r.outKind === 'tool') return 'tool';
  const def = ITEMS[r.out as ItemId];
  if (!def) return 'other';
  if (String(r.out).startsWith('paint_')) return 'paint';
  if (def.kind === 'furniture') return 'furniture';
  if (def.kind === 'food') return 'dish';
  if (def.kind === 'decor') return 'decor';
  return 'other'; // ひかりのレンズのような だいじなもの
}

/**
 * くみあわせに ならべる もちもの。
 * 家具・かべがみ/ゆかいた・だいじなものは のぞく(手のひらにのる「ざいりょう」だけ)。
 * りょうりは のこす: りょうりを つかう くみあわせが 将来できても そのまま乗る。
 */
export function comboMaterials(s: GameState): ItemId[] {
  return (Object.keys(s.inventory ?? {}) as ItemId[]).filter((id) => {
    const def = ITEMS[id];
    if (!def || (s.inventory[id] ?? 0) <= 0) return false;
    return def.kind !== 'furniture' && def.kind !== 'decor' && !def.keyItem;
  });
}

export class CraftUI {
  private el: HTMLElement;
  open = false;
  onCrafted: (() => void) | null = null;
  /** はじめて開いたときの案内(TutorialSystemが1回だけ出す) */
  onOpened: (() => void) | null = null;
  /** くみあわせで発見したとき(セーブ・音を呼び出し側が受けもつ) */
  onDiscovered: (() => void) | null = null;

  private tab: CraftTab = 'recipe';
  /** えらんでいる材料(同じものを2つえらべるので配列で持つ) */
  private picked: ItemId[] = [];
  /** 「ためす」の結果の1行(えらび直すと消える) */
  private message = '';
  private messageOk = false;

  constructor(private getState: () => GameState) {
    this.el = document.createElement('div');
    this.el.className = 'panel craft-panel hidden';
    document.getElementById('ui-root')!.appendChild(this.el);
    // クリックは委譲で1回だけ付ける(毎描画のonclick割当てだと、描画途中の例外や
    // 再描画競合で「ボタンは見えるのに押せない」状態になり得る。実地報告あり)
    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest(
        '[data-close], [data-tab], [data-add], [data-del], [data-try], [data-clear], .craft-btn'
      ) as HTMLElement | null;
      if (!t) return;
      if (t.hasAttribute('data-close')) {
        sfx('close'); // v18 とじる操作は どのパネルでも無音だった
        this.close();
        return;
      }
      if (t.dataset.tab) {
        this.tab = t.dataset.tab as CraftTab;
        this.message = '';
        sfx('page'); // v18 タブ切替は 紙をめくる音(ボタンの ui と区別する)
        this.render();
        return;
      }
      if (t.dataset.add) {
        sfx('ui'); // v18 材料を えらぶ手ごたえ
        this.pick(t.dataset.add as ItemId);
        return;
      }
      if (t.dataset.del !== undefined) {
        sfx('close'); // v18 材料を もどす(えらぶ音の逆向き)
        this.picked.splice(Number(t.dataset.del), 1);
        this.message = '';
        this.render();
        return;
      }
      if (t.hasAttribute('data-clear')) {
        this.picked = [];
        this.message = '';
        this.render();
        return;
      }
      if (t.hasAttribute('data-try')) {
        this.runTry();
        return;
      }
      // ---- 「レシピ」タブの つくるボタン(v11までと同じ) ----
      const id = (t as HTMLButtonElement).dataset.id;
      if (!id || (t as HTMLButtonElement).disabled) return;
      const s = this.getState();
      const r = knownRecipes(s).find((x) => x.id === id);
      if (r && craft(s, r)) {
        sfx('craft');
        const outName = r.outKind === 'tool' ? TOOLS[r.out as ToolId].name : ITEMS[r.out as ItemId].name;
        this.showPop(outName, r.out);
        this.onCrafted?.();
        this.render();
      }
    });
  }

  toggle(): void {
    this.open = !this.open;
    if (this.open) {
      this.syncPicked();
      this.render();
      this.onOpened?.();
    }
    this.el.classList.toggle('hidden', !this.open);
  }
  close(): void {
    this.open = false;
    this.el.classList.add('hidden');
  }

  /** テスト・検証用: いまえらんでいる材料 */
  get selection(): ItemId[] {
    return [...this.picked];
  }

  /** 材料を1つえらぶ(上限3個・持っている数まで) */
  private pick(item: ItemId): void {
    if (this.picked.length >= COMBO_MAX) return;
    const s = this.getState();
    const used = this.picked.filter((x) => x === item).length;
    if ((s.inventory[item] ?? 0) <= used) return;
    this.picked.push(item);
    this.message = '';
    this.render();
  }

  /**
   * 持っていない材料を えらんだままにしない(売った・おくった あとに開いたとき)。
   * 開くたびに1回だけ そろえる。
   */
  private syncPicked(): void {
    const s = this.getState();
    const used: Partial<Record<ItemId, number>> = {};
    this.picked = this.picked.filter((id) => {
      const n = (used[id] ?? 0) + 1;
      used[id] = n;
      return (s.inventory[id] ?? 0) >= n;
    });
  }

  /** 「ためす」を押した(状態が変わるのは当たったときだけ) */
  private runTry(): void {
    const s = this.getState();
    if (this.picked.length < COMBO_MIN || !canOffer(s, this.picked)) return;
    const r = tryCombo(s, this.picked);
    this.message = r.message;
    this.messageOk = r.outcome === 'discover';
    if (r.outcome === 'discover' && r.item) {
      this.picked = [];
      sfx('combo'); // v18 くみあわせの発見は「ひらめき」の音(お祝いの quest とは分ける)
      this.showFound(ITEMS[r.item].name, r.item);
      this.onDiscovered?.();
    } else {
      sfx('ui');
    }
    this.render();
  }

  /** 完成の短いポップ(0.7秒・中央上) */
  private showPop(name: string, iconId: string): void {
    const pop = document.createElement('div');
    pop.className = 'craft-pop';
    pop.innerHTML = `<span class="inv-ico">${icon(iconId)}</span> ${name}を つくった!`;
    document.getElementById('ui-root')!.appendChild(pop);
    requestAnimationFrame(() => pop.classList.add('show'));
    setTimeout(() => {
      pop.classList.remove('show');
      setTimeout(() => pop.remove(), 250);
    }, 720);
  }

  /**
   * 発見の演出(2.2秒・画面のまん中)。
   * クラフト完成の craft-pop より 大きく・長く・光の線つきにして、
   * 「いつもの作成」と「はじめての発見」を ひと目で区別できるようにする。
   * 光の線の角度は 決め打ち(乱数なし)なので、スクショが毎回おなじ画になる。
   */
  private showFound(name: string, iconId: string): void {
    const rays = [0, 45, 90, 135, 180, 225, 270, 315]
      .map((deg) => `<i class="cf-ray" style="transform:rotate(${deg}deg)"></i>`)
      .join('');
    const pop = document.createElement('div');
    pop.className = 'combo-found';
    pop.innerHTML = `
      <div class="cf-rays">${rays}</div>
      <div class="cf-band">はっけん!</div>
      <div class="cf-ico">${icon(iconId)}</div>
      <div class="cf-name">${name}</div>
      <div class="cf-sub">あたらしい レシピを おぼえた! 「レシピ」タブを 見てみよう</div>
    `;
    document.getElementById('ui-root')!.appendChild(pop);
    requestAnimationFrame(() => pop.classList.add('show'));
    setTimeout(() => {
      pop.classList.remove('show');
      setTimeout(() => pop.remove(), 320);
    }, 2200);
  }

  // ---------------- 描画 ----------------

  /** レシピ1行(節に分けても中身とクラス名は v11 から1文字も変えない) */
  private recipeRow(s: GameState, r: RecipeDef, isNew: boolean): string {
    const check = canCraft(s, r);
    const outName = r.outKind === 'tool' ? TOOLS[r.out as ToolId].name : ITEMS[r.out as ItemId].name;
    const cost = (Object.entries(r.cost) as [ItemId, number][])
      .map(([item, need]) => {
        const have = s.inventory[item] ?? 0;
        return `<span class="cost ${have >= need ? 'ok' : 'lack'}">${icon(item)}${have}/${need}</span>`;
      })
      .join('');
    const btn = check.alreadyOwned
      ? '<span class="crafted-label">もってる</span>'
      : `<button class="craft-btn" data-id="${r.id}" ${check.ok ? '' : 'disabled'}>つくる</button>`;
    // 目じるしは丸い塗りつぶしのピル(左の色ボーダー+角丸は「(」に見えるので使わない)
    const badge = isNew ? '<span class="craft-new">あたらしい!</span>' : '';
    return `<div class="craft-row${isNew ? ' is-new' : ''}">
          <span class="inv-ico">${icon(r.out)}</span>
          <span class="craft-name">${outName}</span>
          ${badge}
          <span class="craft-costs">${cost}</span>
          ${btn}
        </div>`;
  }

  /**
   * v24 まだ しらないレシピの「?」行。
   *
   * ボタンを **1つも 置かない**のが 大事なところ:
   * 回帰ボット・UXボット・E2Eは `.craft-row` と `.craft-btn` で 作る手順を 読むので、
   * 別のクラス(craft-q-*)にして ボタンも持たせないことで、
   * 「?」行が ボットの クラフト操作に まざる みちを 構造的に なくしてある
   * (一覧の いちばん下に 置くのも 同じ理由——`.craft-row` の1つめは いままでどおり)。
   * シルエットは 本物のアイコンを CSSで まっ黒に 落としたもの。
   * 絵を もう1セット 描かないので、家具を足しても シルエットが 遅れない。
   */
  private unknownRow(text: string, out: string): string {
    return `<div class="craft-q-row">
          <span class="inv-ico craft-q-ico">${icon(out)}</span>
          <span class="craft-q-name">???</span>
          <span class="craft-q-hint">${text}</span>
        </div>`;
  }

  private renderRecipeTab(s: GameState): string {
    // 並びは craftList にまかせる(おぼえたばかりのレシピが上に来る)。
    // v19: レシピが40を超えて一覧が長くなり、スクロールの現在地が分からなくなったので
    // 節見出しを付ける。「あたらしい!」は今までどおり いちばん上のまとまりに置く
    // ——ひらめいた直後に どこに増えたか分かる、という v12 からの約束を そのまま残す
    // (E2E tests/e2e/combo.spec.ts が「最初の .craft-row = おぼえたばかり」を見ている)。
    const list = craftList(s);
    const fresh = list.filter((e) => e.isNew);
    const groups = CRAFT_SECTIONS.map((sec) => ({
      title: sec.title,
      entries: list.filter((e) => !e.isNew && craftSectionOf(e.recipe) === sec.id),
    })).filter((g) => g.entries.length > 0);

    const section = (title: string, body: string): string =>
      `<div class="craft-sec">${title}</div>${body}`;
    let rows = '';
    if (fresh.length) {
      rows += section(
        'あたらしい!',
        fresh.map((e) => this.recipeRow(s, e.recipe, true)).join('')
      );
    }
    for (const g of groups) {
      rows += section(g.title, g.entries.map((e) => this.recipeRow(s, e.recipe, false)).join(''));
    }
    // v24 いちばん下に「まだ しらない レシピ」。ひらめく きっかけを 1行ずつ 書く
    const unknown = unknownRecipeHints(s);
    if (unknown.length) {
      rows += section(
        'まだ しらない レシピ',
        `<div class="craft-q-lead">つぎの ことを すると、作りかたを ひらめくよ。</div>` +
          unknown.map((u) => this.unknownRow(u.text, String(u.recipe.out))).join('')
      );
    }
    return `<div class="craft-list">${rows || '<div class="inv-empty">まだレシピを知らない。島のみんなに聞いてみよう!</div>'}</div>`;
  }

  private renderComboTab(s: GameState): string {
    const mats = comboMaterials(s);
    const cells = mats
      .map((id) => {
        const have = s.inventory[id] ?? 0;
        const used = this.picked.filter((x) => x === id).length;
        const full = used >= have || this.picked.length >= COMBO_MAX;
        return `<button class="combo-cell${full ? ' off' : ''}" data-add="${id}" ${full ? 'disabled' : ''} title="${ITEMS[id].desc}">
          <span class="inv-ico">${icon(id)}</span>
          <span class="combo-cell-name">${ITEMS[id].name}</span>
          <span class="inv-count">${have - used}</span>
        </button>`;
      })
      .join('');

    const slots = Array.from({ length: COMBO_MAX }, (_, i) => {
      const id = this.picked[i];
      if (!id) return '<span class="combo-slot empty">?</span>';
      return `<button class="combo-slot" data-del="${i}" title="はずす">
        <span class="inv-ico">${icon(id)}</span><span>${ITEMS[id].name}</span>
      </button>`;
    }).join('<span class="combo-plus">+</span>');

    const preview = previewCombo(s, this.picked);
    const note =
      preview === 'known'
        ? '<span class="combo-tag known">はっけんずみ</span>'
        : preview === 'locked'
          ? `<span class="combo-tag locked">${COMBO_LOCKED_TEXT}</span>`
          : '';
    const canTry = this.picked.length >= COMBO_MIN;
    const msg = this.message
      ? `<div class="combo-msg${this.messageOk ? ' ok' : ''}">${this.message}</div>`
      : '';
    const found = discoveredCount(s);

    return `
      <div class="combo-lead">もちものを ${COMBO_MIN}〜${COMBO_MAX}こ えらんで「ためす」。
        <b>はずれても なにも なくならない</b>から、どんどん ためしてみよう!
        <small>みつけた くみあわせ ${found} / ${COMBOS.length}</small>
      </div>
      <div class="combo-tray">
        ${slots}
        <button class="craft-btn" data-try ${canTry ? '' : 'disabled'}>ためす</button>
        <button class="craft-btn sub" data-clear>えらび直す</button>
      </div>
      ${note}
      ${msg}
      <div class="panel-sub">もちもの</div>
      <div class="combo-grid">${cells || '<div class="inv-empty">えらべる ざいりょうが まだ ない。島で あつめてこよう!</div>'}</div>
    `;
  }

  private render(): void {
    const s = this.getState();
    const tabs = (
      [
        ['recipe', 'レシピ'],
        ['combo', 'くみあわせ'],
      ] as [CraftTab, string][]
    )
      .map(([id, label]) => `<button class="shop-tab${this.tab === id ? ' on' : ''}" data-tab="${id}">${label}</button>`)
      .join('');
    this.el.innerHTML = `
      <div class="panel-title">クラフト <span class="panel-close" data-close>${byInput('とじる(C)', 'とじる')}</span></div>
      <div class="shop-tabs">${tabs}</div>
      ${this.tab === 'recipe' ? this.renderRecipeTab(s) : this.renderComboTab(s)}
    `;
    // クリック処理はコンストラクタの委譲リスナーが担当(ここでは付けない)
  }
}

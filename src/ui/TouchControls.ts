// タッチ操作UI(iPad向け): 左下の仮想スティック・右下の行動ボタン・右上のメニューボタン。
// 方針: キーボード操作には一切干渉しない。スティックを触っている間だけ InputState の
// ax/az を書き込み、離したら undefined に戻す(未定義ならPlayerControllerは従来どおり)。
// 出現判定にUA(ユーザーエージェント)は使わず、pointerType==='touch' の観測で切り替える。
import './touch.css';
import { sfx } from '../audio/AudioSystem';
import type { InputState } from '../systems/PlayerController';
import type { KeyGates } from '../systems/TutorialSystem';

/** スティックの遊び(この傾き以下は動かさない) */
export const STICK_DEADZONE = 0.16;
/** スティックの有効半径(px)。つまみはこの円の中に収まる */
export const STICK_RADIUS = 58;
/** 行動ボタンのラベルの上限文字数(超えたら省略) */
export const LABEL_MAX = 18;

export interface StickVector {
  /** PlayerControllerの ix と同じ向き(+が画面左) */
  ax: number;
  /** PlayerControllerの iz と同じ向き(+が画面下) */
  az: number;
  /** 倒し量 0..1(デッドゾーン内は0) */
  mag: number;
  /** つまみの表示位置(中心からのpx) */
  kx: number;
  ky: number;
}

/**
 * 中心からのドラッグ量(px)を InputState のアナログ値へ変換する。
 * このカメラは北向き固定で、画面右が -x。PlayerControllerの
 * 「左キー=ix+1」「下キー=iz+1」と同じ向きにそろえる。
 */
export function stickVector(dx: number, dy: number, radius: number = STICK_RADIUS): StickVector {
  const d = Math.hypot(dx, dy);
  const shrink = d > radius ? radius / d : 1; // つまみは円の外へ出さない
  const kx = dx * shrink;
  const ky = dy * shrink;
  const mag = Math.min(1, d / radius);
  if (d === 0 || mag < STICK_DEADZONE) return { ax: 0, az: 0, mag: 0, kx, ky };
  return { ax: (-dx / d) * mag, az: (dy / d) * mag, mag, kx, ky };
}

const TAG_RE = /<[^>]*>/g;
const E_KBD_RE = /<kbd>\s*(?:E|Space)\s*<\/kbd>/gi;

/**
 * HUDのヒント(HTML)を行動ボタンのラベルへ変換する。
 * ・E/Space のキー表示はボタン自体が代わりなので消す
 * ・R/Esc は専用ボタンがあるので、そこから後ろは切り落とす
 * ・「理由 — うごかして…」のような長い案内は前半だけ出す
 */
export function hintToLabel(hint: string): string {
  if (!hint) return '';
  let s = hint.replace(E_KBD_RE, '');
  const other = s.search(/<kbd>/i);
  if (other >= 0) s = s.slice(0, other);
  s = s.replace(/<br\s*\/?>/gi, ' ').replace(TAG_RE, ' ').replace(/&nbsp;/g, ' ');
  s = s.split('—')[0]; // em dash より前だけ
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > LABEL_MAX) s = s.slice(0, LABEL_MAX - 1) + '…';
  return s;
}

/** 毎フレームGameSceneから渡す表示条件 */
export interface TouchFrame {
  /** HUDに出ているヒント(HTML) */
  hint: string;
  gates: KeyGates;
  placementActive: boolean;
  dialogueOpen: boolean;
  questCompleteOpen: boolean;
  sequenceActive: boolean;
  /** もちもの・クラフト・店・おねがい・ポーズのどれかが開いている */
  panelOpen: boolean;
}

export interface TouchControlsOptions {
  root: HTMLElement;
  /** スティックの値を書き込む先(GameScene.input と同一オブジェクト) */
  input: InputState;
  onInteract: () => void;
  onInventory: () => void;
  onCraft: () => void;
  onQuest: () => void;
  onMenu: () => void;
  onRotate: () => void;
}

const SVG = (body: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const GLYPH = {
  bag: SVG('<path d="M5 8h14l-1.2 12H6.2Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>'),
  craft: SVG('<path d="M14 4l6 6-3 3-6-6Z"/><path d="M11 7L4 14v6h6l7-7"/>'),
  quest: SVG('<path d="M6 3h9l4 4v14H6Z"/><path d="M9 9h7M9 13h7M9 17h4"/>'),
  menu: SVG('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  rotate: SVG('<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/>'),
  cancel: SVG('<path d="M6 6l12 12M18 6L6 18"/>'),
};

/** ボタンの押し込み表示(タップ中だけ) */
function pressable(el: HTMLElement, run: () => void): Array<() => void> {
  const down = (e: PointerEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.add('press');
    if (!el.classList.contains('dim')) {
      sfx('ui');
      run();
    }
  };
  const clear = (): void => el.classList.remove('press');
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', clear);
  el.addEventListener('pointercancel', clear);
  el.addEventListener('pointerleave', clear);
  return [
    () => el.removeEventListener('pointerdown', down),
    () => el.removeEventListener('pointerup', clear),
    () => el.removeEventListener('pointercancel', clear),
    () => el.removeEventListener('pointerleave', clear),
  ];
}

export class TouchControls {
  private el: HTMLElement;
  private zone: HTMLElement;
  private stick: HTMLElement;
  private knob: HTMLElement;
  private action: HTMLElement;
  private btnInv: HTMLElement;
  private btnCraft: HTMLElement;
  private btnQuest: HTMLElement;
  private placeBar: HTMLElement;
  private detachFns: Array<() => void> = [];
  private stickId: number | null = null;
  private origin = { x: 0, y: 0 };
  private lastLabel = '';
  private lastDim = true;
  /** タッチUIを出しているか(UA判定はしない) */
  visible = false;

  constructor(private opts: TouchControlsOptions) {
    const el = document.createElement('div');
    el.className = 'touch-root hidden';
    el.innerHTML = `
      <div class="touch-stick-zone" data-el="zone">
        <div class="touch-stick" data-el="stick"><div class="touch-knob" data-el="knob"></div></div>
      </div>
      <div class="touch-menu">
        <button class="touch-btn hidden" data-el="inv" type="button">${GLYPH.bag}<span>もちもの</span></button>
        <button class="touch-btn hidden" data-el="craft" type="button">${GLYPH.craft}<span>クラフト</span></button>
        <button class="touch-btn hidden" data-el="quest" type="button">${GLYPH.quest}<span>おねがい</span></button>
        <button class="touch-btn" data-el="menu" type="button">${GLYPH.menu}<span>メニュー</span></button>
      </div>
      <div class="touch-place hidden" data-el="place">
        <button class="touch-btn" data-el="rotate" type="button">${GLYPH.rotate}<span>まわす</span></button>
        <button class="touch-btn" data-el="cancel" type="button">${GLYPH.cancel}<span>やめる</span></button>
      </div>
      <button class="touch-action dim" data-el="action" type="button">しらべる</button>
    `;
    const pick = (name: string): HTMLElement => el.querySelector(`[data-el="${name}"]`) as HTMLElement;
    this.el = el;
    this.zone = pick('zone');
    this.stick = pick('stick');
    this.knob = pick('knob');
    this.action = pick('action');
    this.btnInv = pick('inv');
    this.btnCraft = pick('craft');
    this.btnQuest = pick('quest');
    this.placeBar = pick('place');
    opts.root.appendChild(el);
  }

  attach(): void {
    const o = this.opts;
    this.detachFns.push(...pressable(this.action, () => o.onInteract()));
    this.detachFns.push(...pressable(this.btnInv, () => o.onInventory()));
    this.detachFns.push(...pressable(this.btnCraft, () => o.onCraft()));
    this.detachFns.push(...pressable(this.btnQuest, () => o.onQuest()));
    this.detachFns.push(...pressable(this.el.querySelector('[data-el="menu"]') as HTMLElement, () => o.onMenu()));
    this.detachFns.push(...pressable(this.el.querySelector('[data-el="rotate"]') as HTMLElement, () => o.onRotate()));
    this.detachFns.push(...pressable(this.el.querySelector('[data-el="cancel"]') as HTMLElement, () => o.onMenu()));

    const down = (e: PointerEvent): void => this.onStickDown(e);
    const move = (e: PointerEvent): void => this.onStickMove(e);
    const up = (e: PointerEvent): void => this.onStickUp(e);
    this.zone.addEventListener('pointerdown', down);
    this.zone.addEventListener('pointermove', move);
    this.zone.addEventListener('pointerup', up);
    this.zone.addEventListener('pointercancel', up);
    this.detachFns.push(
      () => this.zone.removeEventListener('pointerdown', down),
      () => this.zone.removeEventListener('pointermove', move),
      () => this.zone.removeEventListener('pointerup', up),
      () => this.zone.removeEventListener('pointercancel', up)
    );

    // 入力手段の観測(UA判定はしない)。タッチを見たら出し、キーを押したら隠す。
    const sniff = (e: PointerEvent): void => {
      if (e.pointerType === 'touch') this.setVisible(true);
    };
    const key = (): void => this.setVisible(false);
    window.addEventListener('pointerdown', sniff, true);
    window.addEventListener('keydown', key);
    this.detachFns.push(
      () => window.removeEventListener('pointerdown', sniff, true),
      () => window.removeEventListener('keydown', key)
    );

    const coarse =
      typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    this.setVisible(coarse);
  }

  /** タッチUIの表示/非表示。隠すときはスティックの入力も必ず戻す */
  setVisible(on: boolean): void {
    if (this.visible === on) return;
    this.visible = on;
    this.el.classList.toggle('hidden', !on);
    if (!on) this.releaseStick();
  }

  // ---------- 仮想スティック ----------
  private onStickDown(e: PointerEvent): void {
    if (this.stickId !== null) return; // 1本目の指だけがスティック(2本目は右手のボタン用)
    if (e.pointerType === 'touch') this.setVisible(true);
    this.stickId = e.pointerId;
    this.origin = { x: e.clientX, y: e.clientY };
    const r = this.zone.getBoundingClientRect();
    this.stick.style.left = `${e.clientX - r.left}px`;
    this.stick.style.top = `${e.clientY - r.top}px`;
    this.stick.classList.add('on');
    this.knob.style.transform = 'translate(0px, 0px)';
    try {
      this.zone.setPointerCapture(e.pointerId);
    } catch {
      /* 未対応環境では無視 */
    }
    e.preventDefault();
  }

  private onStickMove(e: PointerEvent): void {
    if (this.stickId !== e.pointerId) return;
    const v = stickVector(e.clientX - this.origin.x, e.clientY - this.origin.y);
    this.knob.style.transform = `translate(${v.kx}px, ${v.ky}px)`;
    this.stick.classList.toggle('run', v.mag > 0.7);
    this.opts.input.ax = v.ax;
    this.opts.input.az = v.az;
    e.preventDefault();
  }

  private onStickUp(e: PointerEvent): void {
    if (this.stickId !== e.pointerId) return;
    this.releaseStick();
    e.preventDefault();
  }

  private releaseStick(): void {
    if (this.stickId !== null) {
      try {
        this.zone.releasePointerCapture(this.stickId);
      } catch {
        /* 既に解放済みなら無視 */
      }
    }
    this.stickId = null;
    this.stick.classList.remove('on', 'run');
    this.knob.style.transform = 'translate(0px, 0px)';
    // キーボード側の値を壊さないよう、書き込んだアナログ値は消して未定義に戻す
    delete this.opts.input.ax;
    delete this.opts.input.az;
  }

  // ---------- 毎フレームの反映 ----------
  sync(f: TouchFrame): void {
    if (!this.visible) return;
    // 行動ボタン: HUDのヒントと同じ内容。会話・演出中は「つぎへ」等の専用表示。
    let label: string;
    if (f.dialogueOpen) label = 'つぎへ';
    else if (f.questCompleteOpen) label = 'とじる';
    else if (f.sequenceActive) label = 'すすむ';
    else label = hintToLabel(f.hint);
    const dim = label === '';
    if (dim) label = 'しらべる'; // 位置を動かさないため、文字は残して淡くする
    if (label !== this.lastLabel) {
      this.lastLabel = label;
      this.action.textContent = label;
      this.action.classList.toggle('long', label.length > 8);
    }
    if (dim !== this.lastDim) {
      this.lastDim = dim;
      this.action.classList.toggle('dim', dim);
    }
    // パネルを開いている間は移動も行動もできないので、指の置き場だけ消す。
    // 会話・達成表示・見せ場の間も移動はできないので、スティックは消して
    // 会話パネル(画面下)を指でじかに触れるようにする。
    const hideWorld = f.panelOpen;
    const hideStick =
      hideWorld || f.dialogueOpen || f.questCompleteOpen || f.sequenceActive;
    this.action.classList.toggle('hidden', hideWorld);
    this.zone.classList.toggle('hidden', hideStick);
    if (hideStick && this.stickId !== null) this.releaseStick();
    // 未解放のメニューは出さない(キーボードと同じ段階解放)
    this.btnInv.classList.toggle('hidden', !f.gates.inventory);
    this.btnCraft.classList.toggle('hidden', !f.gates.craft);
    this.btnQuest.classList.toggle('hidden', !f.gates.quest);
    this.placeBar.classList.toggle('hidden', !f.placementActive || hideWorld);
  }

  dispose(): void {
    this.setVisible(false); // アナログ値を必ず戻してから片付ける
    this.releaseStick();
    for (const fn of this.detachFns) fn();
    this.detachFns = [];
    this.el.remove();
  }
}

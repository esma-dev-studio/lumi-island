// v29 物語の「入口」と「出口」の見せ場に かぶせる うすい膜(字幕・帯・暗転・「▶ とばす」)。
//
// なにを解くか:
//   これまで ゲームは タイトルの「はじめから」を押すと **いきなり広場に立って** いた。
//   ミオが だれで、なぜ この島へ来たのかを、どこも 語っていない。
//   同じように 第3章の さいごの依頼にも 見せ場が なく、物語が しずかに 消えていた。
//   ここは その2つ(オープニング / フィナーレ)に かぶせる **表示だけ** の層。
//   時間の進みかた・カメラ・立ち位置は SequenceDirector が すべて持つ。
//
// 作りの約束(過去の実害からの決めごと):
//   - 根は **インラインで pointer-events:none**。`#ui-root > *{pointer-events:auto}` は
//     idを1つ ふくむので クラスの none では 勝てない(教訓2)。インラインなら かならず勝つ。
//     tests/unit/overlay_hit.test.ts は インラインの none を 見て この層を 見のがす。
//   - 「▶ とばす」は **押しボタンではなく 目じるし**。とばす操作は
//     画面の どこを さわっても・どのキーを おしても 効く(listen は window の捕そう段)。
//     押せる場所を 1点にすると、小さい子は そこを さがすことになる。
//   - HUD(いまやること・時計・ヒント)は 見せ場のあいだ `visibility:hidden` で かくす。
//     `display:none` にすると 中の文字が DOM から 読めなくなり、
//     画面の文字だけで動く UXボットが 「ゲーム画面が消えた」と 誤判定する
//     ——文字は のこして 目にだけ 見せない、が ここの答え。
//   - style.css は さわらない(ほかの担当のファイル)。この見せ場ぶんの CSS は
//     このファイルが <style> を1枚 head へ入れて まかなう。
//
// 字幕の文は TextStyleCheck の core(許可漢字40字・分かち書き・行の長さ)を通す。

/** 「とばせる」ことを知らせる 小さな目じるし(押しボタンではない) */
export const CINEMATIC_SKIP_LABEL = '▶ とばす';

/**
 * オープニングの字幕(3行)。
 *
 * 1日目 19:24 の intro(トースト「夜になると、島の光が めをさます。」)とは
 * **役わりを分けてある**:
 *   ここ  … ミオが 島へ来た理由と、**まだ 見ていない うわさ**(「……らしい。」)
 *   intro … その夜、うわさが ほんとうだったと **目で見て 分かる** 瞬間
 * 同じことを 2回 言わないので、19:24 の トーストは これまでどおりで よい。
 */
export const OPENING_CAPTIONS: readonly string[] = [
  'ミオは、ちいさな しまへ ひっこして きた。',
  'よるに なると、しまが ひかる……らしい。',
  'まだ ねむって いる ルミの木と、ちいさな こうぼう。',
];

/** 第3章フィナーレの字幕(3行)。さいごの1行は「島じゅうが ともった」瞬間に出す */
export const FINALE_CAPTIONS: readonly string[] = [
  'みんなが ひろばに あつまった。',
  // 「島」は 許可漢字40字に入っていない(TextStyleCheck の core)。かなで書く
  'テンが はじめて この しまに 来た。',
  'しまは、あかりで いっぱいに なった。',
];

/** 上下の黒帯の高さ(画面の高さに対する割合) */
const BAR_RATIO = 0.085;

/** この層ぶんの CSS(style.css には1行も足さない) */
const CINEMATIC_CSS = `
#ui-root.cine-on > *:not(.cine-layer) { visibility: hidden !important; }
.cine-layer .cine-bar {
  position: absolute; left: 0; right: 0; height: ${(BAR_RATIO * 100).toFixed(1)}%;
  background: #0e1626; opacity: 0; transition: opacity 0.5s ease;
}
.cine-layer.on .cine-bar { opacity: 1; }
.cine-layer .cine-bar-top { top: 0; }
.cine-layer .cine-bar-bottom { bottom: 0; }
.cine-layer .cine-cap {
  position: absolute; left: 50%; transform: translateX(-50%);
  bottom: calc(${(BAR_RATIO * 100).toFixed(1)}% + 22px);
  max-width: min(680px, 84vw); padding: 10px 22px;
  background: rgba(246, 241, 230, 0.92);
  border: 1px solid rgba(216, 205, 185, 0.9); border-radius: 8px;
  box-shadow: 0 6px 20px rgba(30, 24, 12, 0.22);
  color: #4a3b2c; font-weight: 700; font-size: 0.98rem; line-height: 1.75;
  text-align: center;
  opacity: 0; transition: opacity 0.42s ease;
}
.cine-layer .cine-cap.on { opacity: 1; }
.cine-layer .cine-skip {
  position: absolute; right: calc(var(--sa-r) + 16px);
  bottom: calc(var(--sa-b) + 10px);
  padding: 5px 15px; border-radius: 999px;
  background: rgba(246, 241, 230, 0.72);
  border: 1px solid rgba(216, 205, 185, 0.75);
  color: #4a3b2c; font-size: 0.78rem; font-weight: 700; letter-spacing: 0.04em;
}
.cine-layer .cine-fade { position: absolute; inset: 0; background: #0e1626; }
html.touch-ui .cine-layer .cine-cap { font-size: 1.04rem; padding: 12px 24px; }
html.touch-ui .cine-layer .cine-skip { font-size: 0.86rem; padding: 8px 18px; }
@media (max-width: 560px) { .cine-layer .cine-cap { font-size: 0.86rem; white-space: normal; } }
`;

const STYLE_ID = 'cine-style';

/** <style> を1枚だけ head へ入れる(2回目からは何もしない) */
function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = CINEMATIC_CSS;
  document.head.appendChild(st);
}

/** 移動キー(このキーだけは スキップに使っても そのまま下へ通す) */
const MOVE_CODES = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'ShiftLeft', 'ShiftRight',
]);

export class CinematicUI {
  private layer: HTMLElement | null = null;
  private capEl: HTMLElement | null = null;
  private fadeEl: HTMLElement | null = null;
  private onSkip: (() => void) | null = null;
  private caption = '';
  open = false;

  /** 見せ場をはじめる。暗転しきった状態(まっ黒)から始まる */
  show(onSkip: () => void): void {
    ensureStyle();
    this.onSkip = onSkip;
    if (!this.layer) this.build();
    const layer = this.layer!;
    layer.style.display = '';
    layer.classList.add('on'); // 帯は まっ黒の暗転の下で出るので、じわりと出す必要はない
    this.setCaption('');
    this.setFade(1);
    document.getElementById('ui-root')?.classList.add('cine-on');
    this.attach();
    this.open = true;
  }

  /** 字幕を出す/消す(同じ文なら 何もしない=ちらつかせない) */
  setCaption(text: string): void {
    if (text === this.caption) return;
    this.caption = text;
    const el = this.capEl;
    if (!el) return;
    if (text) {
      el.textContent = text;
      el.classList.add('on');
    } else {
      el.classList.remove('on');
    }
  }

  /** いま出ている字幕(検証・撮影用) */
  get shownCaption(): string {
    return this.caption;
  }

  /** 暗転のこさ。0=すきとおる / 1=まっ黒 */
  setFade(v: number): void {
    if (this.fadeEl) this.fadeEl.style.opacity = String(Math.min(1, Math.max(0, v)));
  }

  /** 見せ場をおわる(とばしたときも かならずここを通る) */
  hide(): void {
    this.detach();
    this.onSkip = null;
    this.caption = '';
    this.open = false;
    document.getElementById('ui-root')?.classList.remove('cine-on');
    if (!this.layer) return;
    this.layer.classList.remove('on');
    this.capEl?.classList.remove('on');
    this.setFade(0);
    this.layer.style.display = 'none';
  }

  private build(): void {
    const layer = document.createElement('div');
    // CSS(src/ui/style.css)は触らずに、この層ぶんだけ要素へ直接書く。
    // pointer-events:none は **インライン**でないと `#ui-root > *{auto}` に負ける(教訓2)
    layer.style.cssText =
      'position:absolute;inset:0;pointer-events:none;display:none;' +
      'z-index:30';
    layer.className = 'cine-layer';
    document.getElementById('ui-root')!.appendChild(layer);
    layer.innerHTML =
      '<div class="cine-bar cine-bar-top"></div>' +
      '<div class="cine-bar cine-bar-bottom"></div>' +
      '<div class="cine-fade"></div>' +
      '<div class="cine-cap"></div>' +
      `<div class="cine-skip">${CINEMATIC_SKIP_LABEL}</div>`;
    this.layer = layer;
    this.capEl = layer.querySelector('.cine-cap');
    this.fadeEl = layer.querySelector('.cine-fade');
  }

  // ---- とばす(どのキーでも・どこを さわっても) ----
  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    this.fire();
    // 移動キーだけは **食べずに そのまま通す**。
    // ボットも子どもも「Wを押しっぱなしにして歩きだす」ので、
    // その1回を とばすために 食べてしまうと、キーを はなすまで 1歩も歩けない
    // ——とばした その入力から すぐ ふつうの操作になる、を こわさない。
    if (MOVE_CODES.has(e.code)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  private onPointerDown = (e: Event): void => {
    this.fire();
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  private fire(): void {
    const cb = this.onSkip;
    this.onSkip = null; // 連打しても1回ぶん
    cb?.();
  }

  private attach(): void {
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('pointerdown', this.onPointerDown, true);
  }

  private detach(): void {
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('pointerdown', this.onPointerDown, true);
  }
}

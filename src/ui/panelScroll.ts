// パネルの「まだ 下に あるよ」の手がかりと、パネル内スクロールの小さな道具。
//
// なぜ要るか(touch_audit_v17 F-01 / F-02):
//   iPad はスクロールバーを ふだん 隠すので、クラフト(見えているのは 21%)・
//   ずかん(9%)は「下に まだ ある」ことが 画面から 1つも 分からなかった。
//   目標カードが 名ざしした「いしのランプ」が 画面の外にあっても、
//   子どもには「言われたものが 無い」としか 見えない。
//
// 約束ごと(ここを ふみ外すと 事故になる):
//   ・**ページ全体の scrollIntoView は 使わない**。#ui-root ごと ずれて
//     ボタンの当たり判定が 全部 ずれる(既知の事故)。動かすのは
//     かならず パネル要素の scrollTop だけ。
//   ・手がかりの帯は **パネルの いちばん後ろの子** として 足すだけ。
//     既存の DOM・クラス名・文言は 1つも 変えない
//     (回帰ボット・UXボットが .craft-row / .panel-title などで 動いている)。
//   ・帯は 押すものではないので pointer-events: none(style.css の .panel-more)。
//     #ui-root の直下ではないので、id を含む強さで 打ちなおす必要はない。

/** 手がかりの帯の文言(スクショの検証・テストが読む唯一の出どころ) */
export const PANEL_MORE_TEXT = '▼ まだ あるよ';
/** 帯を出しはじめる「まだ残っている高さ」(px)。1〜2pxの誤差では出さない */
const MORE_EPS = 12;
/** 目当ての行を、パネルの上から このくらいの所に出す(px) */
const FOCUS_HEADROOM = 56;
/** 目当ての行を 光らせておく時間(ms) */
const FLASH_MS = 1800;

/** 二重に付けないための覚え(DOMに印を残さない=ボットの読む形を変えない) */
const attached = new WeakSet<HTMLElement>();

/**
 * パネルの下端に「▼ まだ あるよ」の帯を足し、
 * 中身が下に残っているあいだだけ 出す(最下部まで スクロールしたら 消える)。
 *
 * パネルは innerHTML を まるごと 書きかえるので、
 * MutationObserver で 帯を いちばん後ろへ 付けなおす。
 */
export function attachPanelScrollCue(panel: HTMLElement): void {
  if (attached.has(panel)) return;
  attached.add(panel);
  const cue = document.createElement('div');
  cue.className = 'panel-more';
  cue.setAttribute('aria-hidden', 'true');
  cue.textContent = PANEL_MORE_TEXT;

  const update = (): void => {
    // 帯そのものは いちばん後ろ(= 中身の いちばん下)に 置きつづける
    if (panel.lastElementChild !== cue) panel.appendChild(cue);
    const rest = panel.scrollHeight - panel.clientHeight - panel.scrollTop;
    const shown = !panel.classList.contains('hidden') && rest > MORE_EPS;
    cue.classList.toggle('on', shown);
  };

  panel.addEventListener('scroll', update, { passive: true });
  // 中身の入れかえ(innerHTML)と、開け閉め(.hidden)の両方で 見なおす
  new MutationObserver(update).observe(panel, {
    childList: true,
    attributes: true,
    attributeFilter: ['class'],
  });
  // 画面の むきが 変わって パネルの高さが 変わったときも 見なおす
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(update).observe(panel);
  update();
}

/**
 * パネルの中だけを スクロールして、その行を 上のほうに 出す。
 * ページ(window)は 1pxも 動かさない。
 */
export function scrollPanelToRow(panel: HTMLElement, row: HTMLElement, headroom = FOCUS_HEADROOM): void {
  const max = Math.max(0, panel.scrollHeight - panel.clientHeight);
  if (max <= 0) return; // スクロールできないパネルでは 何もしない
  const delta = row.getBoundingClientRect().top - panel.getBoundingClientRect().top;
  panel.scrollTop = Math.min(max, Math.max(0, panel.scrollTop + delta - headroom));
}

/** その行を しばらく 光らせる(「これだよ」を 目で 伝える) */
export function flashPanelRow(row: HTMLElement, ms = FLASH_MS): void {
  row.classList.remove('panel-focus');
  void row.offsetWidth; // アニメーションを かならず 出しなおす
  row.classList.add('panel-focus');
  window.setTimeout(() => row.classList.remove('panel-focus'), ms);
}

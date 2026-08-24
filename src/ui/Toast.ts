// お知らせの3レーン(v16.1)。
//
// なぜ3つに分けたか(v16.0 の UI総ざらいで出た問題):
//   トーストが ぜんぶ 左上の1か所に積まれ、「いまやること」カードの すぐ下に
//   4枚まで 重なっていた(写真 27/41)。左上は 目標カードの場所なのに、
//   収穫の「+1 もくざい」も 実績の お祝いも 同じ見た目で 同じ所に出るので、
//   ① 目標が 読めなくなる ② お祝いが 小物にうもれる ③ 上限4で **落ちる**、の3つが同時に起きる。
//
// レーンの決めかた:
//   ① 小物(item)   … 収穫・売り買い・置いた・案内など。**右下**に 下から積む。
//                      上限4・寿命2.1秒(v16.0と同じ)。数が多いので 落ちてよい。
//   ② バナー(banner)… じっせき・バッジ・ごほうび。**中央上**に 1枚ずつ 順番に。
//                      2.2秒ずつ・**絶対に 落とさない**(キューで待つ)。
//                      待ちが あるあいだは「+あと N」を そえて、まだ 続くことを見せる。
//   ③ 左上          … 「いまやること」カード(ObjectiveHud)**専用**。ここには 何も積まない。
//
// 呼び出し口は これまでどおり toast(text, icon)。第3引数の kind だけで レーンが決まるので、
// 既存の呼び出しは 1文字も 変えずに ①へ流れる(お祝いだけを banner() に付けかえた)。
//
// クラス名の約束: どのレーンの1枚も class に **toast を残す**。
//   回帰ボット(tools/ux_bot.mjs)と E2E(tests/e2e/badge.spec.ts など)が
//   `.toast` で お知らせの中身を読むため、レーンを分けても その道は 切らない。
//   小物レーンの入れものは `.toast-box` のまま(tests/e2e/daily.spec.ts が読む)。
import { icon } from './icons';

/** お知らせの種類(呼ぶ側が「何の知らせか」だけを言う。置き場所は laneOf が決める) */
export type ToastKind = 'item' | 'achievement' | 'badge' | 'reward';
/** 実際の置き場所 */
export type ToastLane = 'item' | 'banner';

/** 小物レーンに同時に置ける枚数(これを超えたら古いものから消える) */
export const TOAST_MAX = 4;
/** 小物レーンの寿命(ms)。v16.0 と同じ */
export const TOAST_LIFE_MS = 2100;
/** バナー1枚の表示時間(ms) */
export const BANNER_LIFE_MS = 2200;
/** 消えるアニメの時間(ms)。次の1枚は これを待ってから出す */
export const FADE_MS = 300;

/**
 * 種類 → レーン。**唯一の振り分け表**(UIもテストも ここだけを見る)。
 * お祝い(じっせき・バッジ・ごほうび)は バナー、それ以外は 小物。
 */
export function laneOf(kind: ToastKind): ToastLane {
  return kind === 'item' ? 'item' : 'banner';
}

interface BannerItem {
  text: string;
  iconId?: string;
  kind: ToastKind;
}

let itemBox: HTMLElement | null = null;
let bannerBox: HTMLElement | null = null;
/** まだ出していないバナー。**ここから 1件も 捨てない**(捨てると お祝いが 消える) */
const bannerQueue: BannerItem[] = [];
let bannerBusy = false;

/**
 * レーンの入れものを1つだけ作って使いまわす。
 *
 * 下の2か所は「getElementById で ui-root を引いて、そのまま appendChild する」形の まま
 * 残すこと: tests/unit/overlay_hit.test.ts が src を 全数走査して
 * 「#ui-root の直下に足した要素が 押す/見せるだけの どちらに分類されているか」を
 * この書きかたで 見つけている(書きかたを 変えると 検査から こぼれる)。
 * 走査は TS のコメントも 読むので、ここに その形の コードを 書き写さないこと
 * (書き写すと「クラスの分からない要素」として 検査が 落ちる)。
 */
function boxOf(lane: ToastLane): HTMLElement {
  if (lane === 'item') {
    if (!itemBox || !itemBox.isConnected) {
      const box = document.createElement('div');
      box.className = 'toast-box';
      document.getElementById('ui-root')!.appendChild(box);
      itemBox = box;
    }
    return itemBox;
  }
  if (!bannerBox || !bannerBox.isConnected) {
    const bar = document.createElement('div');
    bar.className = 'banner-box';
    document.getElementById('ui-root')!.appendChild(bar);
    bannerBox = bar;
  }
  return bannerBox;
}

const iconHtml = (iconId?: string): string =>
  iconId ? `<span class="t-ico">${icon(iconId)}</span>` : '';

/** 小物レーン(右下・下から積む)に1枚置く */
function pushItem(text: string, iconId?: string): void {
  const box = boxOf('item');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `${iconHtml(iconId)}<span>${text}</span>`;
  box.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), FADE_MS);
  }, TOAST_LIFE_MS);
  while (box.children.length > TOAST_MAX) box.firstElementChild?.remove();
}

/**
 * いま出している1枚。「+あと N」を 出したあとに 足された ぶんも 数えなおすので、
 * キューが 動くたびに この要素を 書きかえる。
 */
let currentBanner: HTMLElement | null = null;

/** いま出している1枚の「+あと N」を いまのキューの長さに 合わせる */
function refreshMore(): void {
  const el = currentBanner;
  if (!el) return;
  let more = el.querySelector<HTMLElement>('.banner-more');
  if (bannerQueue.length === 0) {
    more?.remove();
    return;
  }
  if (!more) {
    more = document.createElement('span');
    more.className = 'banner-more';
    el.appendChild(more);
  }
  more.textContent = `+あと ${bannerQueue.length}`;
}

/**
 * バナーを1枚ずつ 順番に出す。
 * 出している1枚が 消えきってから 次を出すので、同時に2枚は 出ない。
 * 待ちが N件あれば「+あと N」を そえる(いくつ続くのかが 分かる)。
 */
function pumpBanner(): void {
  if (bannerBusy) {
    refreshMore(); // 出しているとちゅうに 足された ぶんも すぐ 数に出す
    return;
  }
  const next = bannerQueue.shift();
  if (!next) return;
  bannerBusy = true;
  const box = boxOf('banner');
  const el = document.createElement('div');
  el.className = `toast banner banner-${next.kind}`;
  el.innerHTML = `${iconHtml(next.iconId)}<span class="banner-text">${next.text}</span>`;
  box.appendChild(el);
  currentBanner = el;
  refreshMore();
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => {
      el.remove();
      if (currentBanner === el) currentBanner = null;
      bannerBusy = false;
      pumpBanner(); // 待っている ぶんを 続けて出す(キューが空になるまで 止まらない)
    }, FADE_MS);
  }, BANNER_LIFE_MS);
}

/**
 * お知らせを1件出す。
 * kind を 省くと これまでどおり 小物レーン(右下)。
 */
export function toast(text: string, iconId?: string, kind: ToastKind = 'item'): void {
  if (laneOf(kind) === 'item') {
    pushItem(text, iconId);
    return;
  }
  bannerQueue.push({ text, iconId, kind });
  pumpBanner();
}

/** お祝い(じっせき・バッジ・ごほうび)。中央上のバナーに 順番に出る */
export function banner(text: string, iconId: string | undefined, kind: 'achievement' | 'badge' | 'reward'): void {
  toast(text, iconId, kind);
}

/** まだ出していないバナーの数(テスト・検証用) */
export function pendingBannerCount(): number {
  return bannerQueue.length;
}

/** テスト用: レーンの状態を まっさらに もどす(入れものは 作りなおす) */
export function resetNotifications(): void {
  bannerQueue.length = 0;
  bannerBusy = false;
  currentBanner = null;
  itemBox?.remove();
  bannerBox?.remove();
  itemBox = null;
  bannerBox = null;
}

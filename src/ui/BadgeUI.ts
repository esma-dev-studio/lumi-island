// v17.1 しょうごう(称号)の見せかた。**ここが しょうごうの 表示の 唯一の情報源**。
//
// なにを解くか:
//   バッジは 114個 あるのに、集めても 呼ばれかたも 見た目も 変わらなかった。
//   「いまの よび名」と「つぎまで あと何こ」を 3か所(バッジ画面・ポーズ・タイトルの
//   つづきから)に 同じ言葉で 出すことで、1こ取るたびに 階段を のぼる感じにする。
//
// この画面まわりの 大事な約束:
//   1. **文言は ここ1本**。バッジ画面・ポーズ・タイトルが 同じ関数を よぶので、
//      言いかたが 3か所で ずれない(教訓4「文言の二重持ちは 必ず片方が 腐る」)。
//   2. **DOM・音の 無いところでは 何もしない**。数を数える側(BadgeSystem)は
//      node のユニットテストからも よばれるので、ここの入口は ぜんぶ 番人つき。
//   3. **ずかんの バッジタブへは 外から 見出しを 差しこむ**(下の installBadgeTitleHead)。
//      ずかん(src/ui/CodexUI.ts)は 別の担当が 持っているファイルなので、
//      そちらを 1文字も 書きかえずに 足せる形にしてある。
//      —— つなぎ目は `.codex-panel` の中の `.badge-total` ただ1つ。
//         そこが 変わったら 気づけるように、tests/unit/title_v171.test.ts が
//         **本物の CodexUI を jsdom で ひらいて** 見出しが 出ることを 機械検査する。
import { BADGES, nextTitleOf, titleOf, titleRemain, type TitleDef } from '../data/badges';
import { banner } from './Toast';
import { musicStinger } from '../audio/AudioSystem';
import { icon } from './icons';

/** しょうごうの 見出しに使う しるし(バッジの ピクトを 流用する) */
const TITLE_PICT = 'starshard';

/** まだ 1つも とどいていないときの よび名(画面には いつも 1行 出す) */
export const TITLE_NONE_LABEL = 'まだ ないよ';

/** 見出しにつける ラベル(3か所で 同じ言葉をつかう) */
export const TITLE_LABEL = 'しょうごう';

/**
 * いま画面に出すべき しょうごうの中身(純関数)。
 * 数(count)だけを もらう = GameState にも DOM にも よらない。
 */
export interface TitleView {
  /** とどいている しょうごう(まだなら null) */
  title: TitleDef | null;
  /** つぎに とどく しょうごう(ぜんぶ とどいていれば null) */
  next: TitleDef | null;
  /** つぎまで あと何こ(ぜんぶ とどいていれば 0) */
  remain: number;
  /** いま あつめている数 */
  count: number;
  /** ぜんぶで何こ */
  total: number;
}

export function titleView(count: number): TitleView {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return {
    title: titleOf(n),
    next: nextTitleOf(n),
    remain: titleRemain(n),
    count: n,
    total: BADGES.length,
  };
}

/** いまの よび名(まだなら「まだ ないよ」) */
export function titleNameOf(count: number): string {
  return titleView(count).title?.name ?? TITLE_NONE_LABEL;
}

/** 「つぎの『◯◯』まで あと N こ」の1行(ぜんぶ とどいていれば おめでとうの1行) */
export function titleNextText(count: number): string {
  const v = titleView(count);
  if (!v.next) return `ぜんぶの しょうごうに とどいたよ。おめでとう!`;
  return `つぎの「${v.next.name}」まで あと ${v.remain}こ`;
}

/** ポーズ画面・タイトルの要約に出す 1行(文字だけ。タグを ふくまない) */
export function titleLineText(count: number): string {
  return `${TITLE_LABEL}: ${titleNameOf(count)}`;
}

/**
 * 見出し1枚ぶんの HTML。バッジ画面(大きい)と ポーズ画面(小さい)で 同じ形をつかう。
 * `compact` は 絵を出さない ちいさい版。
 */
export function titleHeadHtml(count: number, compact = false): string {
  const v = titleView(count);
  const name = v.title?.name ?? TITLE_NONE_LABEL;
  const pict = compact ? '' : `<span class="bt-ico">${icon(TITLE_PICT)}</span>`;
  // data-n = この見出しが 何このときの ものか。
  // 差しこみ(syncBadgeTitleHead)は これを見て「もう おなじものが 出ている」を 判じる。
  // **outerHTML の 文字くらべは つかわない**——ブラウザが 書きなおした形は
  // ここで 組みたてた文字列と 一致しないので、見張りが 自分の差しこみに 反応して
  // 差しこみ直しを 無限に くりかえす(実機で 画面が 固まった)。
  return `<div class="badge-title${compact ? ' compact' : ''}" data-n="${v.count}">
      ${pict}
      <span class="bt-body">
        <span class="bt-head">${TITLE_LABEL} <b>${name}</b></span>
        <span class="bt-next">${titleNextText(v.count)}</span>
      </span>
    </div>`;
}

// ---------------------------------------------------------------------------
// いまの バッジの数(BadgeSystem が 1秒ごとに 書きこむ)。
//
// ポーズ画面と ずかんの見出しは 「開いた その瞬間」に 数が いる。
// GameState を UI へ 配りなおすと 3つのファイルに 引き数が ふえるので、
// **数だけ**を ここに 置いておく(読むのは この1か所)。
// ---------------------------------------------------------------------------
let badgeCount = 0;

/** いまの数を 書きこむ(BadgeSystem.evaluateBadges が 毎回 よぶ) */
export function setBadgeCount(n: number): void {
  badgeCount = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  syncBadgeTitleHead();
}

/** いまの数(ポーズ画面が 読む) */
export function badgeCountNow(): number {
  return badgeCount;
}

/** テスト用: 数と 差しこみの状態を まっさらに もどす */
export function resetTitleUi(): void {
  badgeCount = 0;
  observer?.disconnect();
  observer = null;
  observerRoot = null;
  if (typeof document === 'undefined') return;
  document.getElementById(CSS_ID)?.remove();
  for (const el of [...document.querySelectorAll('.badge-title')]) el.remove();
}

// ---------------------------------------------------------------------------
// とどいた瞬間の お知らせ
// ---------------------------------------------------------------------------
/**
 * しょうごうに とどいた お知らせ(バナー+音楽の しめ)。
 *
 * じっせき・バッジと まったく同じ流儀:バナーは 落とさないレーンへ、
 * 音は 音楽の しめ(スティンガー)を 1回。
 * **DOM も 音も 無いところ(node のテスト)では 何もしない**。
 */
export function announceTitles(titles: readonly TitleDef[]): void {
  if (titles.length === 0) return;
  // 画面が まだ 無い(node のテスト・起動まえ)ときは 何もしない。
  // お知らせの置き場は #ui-root なので、そこが 無いなら 出す先も 無い
  if (typeof document === 'undefined' || !document.getElementById('ui-root')) return;
  // しょうごうは 階段なので、いちどに いくつ とどいても **いちばん上の1つ**だけ 出す。
  // よく あそんだセーブを 読みこんだ 直後に 5枚 つみあがるのを ふせぐ
  // (バッジの さかのぼり一括が トースト1枚に まとめてあるのと 同じ考えかた)。
  const top = titles[titles.length - 1];
  banner(`${TITLE_LABEL}「${top.name}」に なった!`, TITLE_PICT, 'badge');
  // 音楽の しめ。MusicBox 側に 間かくの きまり(stingerGapSec)が あるので、
  // 同じ瞬間の バッジの音(sfx('badge'))と 二重には 鳴らない
  musicStinger('badge');
}

// ---------------------------------------------------------------------------
// ずかんの「バッジ」タブへ 見出しを 差しこむ
// ---------------------------------------------------------------------------
const CSS_ID = 'lumi-title-css';
const TITLE_CSS = `
.badge-title {
  display: flex; align-items: center; gap: 10px;
  background: #fffaf0; border: 1px solid var(--line); border-radius: 6px;
  padding: 9px 11px; margin-bottom: 8px;
}
.badge-title .bt-ico { flex: 0 0 auto; font-size: 1.6rem; color: var(--amber); line-height: 1; }
.badge-title .bt-body { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.badge-title .bt-head { font-size: 0.86rem; font-weight: 700; color: var(--ink-soft); }
.badge-title .bt-head b {
  font-size: 1.1rem; font-weight: 900; color: var(--amber);
  word-break: keep-all; overflow-wrap: break-word;
}
.badge-title .bt-next { font-size: 0.76rem; color: var(--ink-soft); line-height: 1.7; }
.badge-title.compact { margin: 0 0 10px; padding: 7px 10px; align-self: stretch; }
.badge-title.compact .bt-head b { font-size: 1rem; }
/* ポーズ画面は「パネル自体は 流れない」たて1列(v16.1)。
   直下の子は のびちぢみさせない=ここも 0 0 auto にそろえる */
.pause-panel > .badge-title { flex: 0 0 auto; }
`;

/** しょうごうの見た目を 1回だけ 用意する(style.css は 別の担当のもちぶんなので さわらない) */
export function ensureTitleCss(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(CSS_ID)) return;
  const st = document.createElement('style');
  st.id = CSS_ID;
  st.textContent = TITLE_CSS;
  document.head.appendChild(st);
}

let observer: MutationObserver | null = null;
/** 見張っている入れもの。つなぎ直されたら(テストの作りなおし・画面の入れかえ)付けなおす */
let observerRoot: HTMLElement | null = null;

/**
 * ずかんの「バッジ」タブが 描かれるたびに、見出しを 1枚 差しこむ。
 *
 * ずかん(CodexUI)は 開くたびに innerHTML を まるごと 書きかえるので、
 * `#ui-root` の 中の 変化を 見張って、そのつど 差しこみ直す。
 * 差しこむ先は `.codex-panel` の中の `.badge-total`(あつめたバッジ N / 114)の すぐ上。
 * バッジタブ以外(ずかん・アルバム)には `.badge-total` が 無いので 何も起きない。
 */
export function installBadgeTitleHead(): void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  ensureTitleCss();
  syncBadgeTitleHead();
  const root = document.getElementById('ui-root') ?? document.body;
  if (!root) return;
  // 入れものが すげかわっていたら 付けなおす(古い入れものを 見張ったままにしない)
  if (observer && observerRoot === root && root.isConnected) return;
  observer?.disconnect();
  observer = new MutationObserver(() => syncBadgeTitleHead());
  observer.observe(root, { childList: true, subtree: true });
  observerRoot = root;
}

/**
 * いま出ている バッジ画面に 見出しを 合わせる。
 * すでに 同じ中身が 出ていれば 何もしない(見張りが 自分の差しこみで
 * また 呼ばれるので、ここで 止めないと ぐるぐる まわる)。
 */
export function syncBadgeTitleHead(): void {
  if (typeof document === 'undefined') return;
  for (const panel of [...document.querySelectorAll<HTMLElement>('.codex-panel')]) {
    const total = panel.querySelector<HTMLElement>('.badge-total');
    if (!total) continue;
    const prev = panel.querySelector<HTMLElement>('.badge-title');
    // もう おなじ数の 見出しが 出ていれば 何もしない。
    // ここで 止めないと 見張りが 自分の差しこみに 反応して ぐるぐる まわる
    if (prev && prev.getAttribute('data-n') === String(badgeCount)) continue;
    prev?.remove();
    ensureTitleCss();
    total.insertAdjacentHTML('beforebegin', titleHeadHtml(badgeCount));
  }
}

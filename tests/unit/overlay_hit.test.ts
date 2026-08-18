// #ui-root に置くオーバーレイの「クリックを吸わないこと」の全数検査。
//
// なぜ要るか(v14.1の実害):
//   style.css の `#ui-root > * { pointer-events: auto }` は **idを1つ含む** ので、
//   クラスに書いた `pointer-events: none` より 強い。
//   つまり #ui-root の直下では `.sleep-fade { pointer-events: none }` は だまって効かない。
//   実際に「一度ねると .sleep-fade(画面ぜんたい・透明・消えない)が残り、
//   会話の『こうじを たのむ』『おくりものをする』が 押せなくなる」進行不能バグになった。
//   キーボードのEだけが効くので、E主体の自動テストは 最後まで気づけなかった。
//
// この検査がやること:
//   1. src を全数走査して「#ui-root の直下に足している要素」を すべて集める
//   2. 集めた要素は かならず 下の2つの表のどちらかに載っていること
//      (新しいオーバーレイを足したら ここで落ちる = 人が どちらか決める)
//   3. 「見せるだけ」の要素は、id を含む強さで pointer-events:none が
//      打ちなおされていること(= 実際にクリックを吸わない)
//
// 実ブラウザでの当たり判定そのものは tests/e2e/dialogue_click.spec.ts が
// 実マウスのクリックと elementFromPoint で確かめる(こちらは静的な全数検査)。
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', '..', 'src');
const STYLE = readFileSync(join(SRC, 'ui', 'style.css'), 'utf8');
const TOUCH_CSS = readFileSync(join(SRC, 'ui', 'touch.css'), 'utf8');
/** コメントは先に落とす(注記の中の「#ui-root」「.sleep-fade」をセレクタと読みちがえないため) */
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');
const CSS = stripComments(`${STYLE}\n${TOUCH_CSS}`);

/**
 * 押すためにある要素(pointer-events: auto のままでよい)。
 * ここに載せるのは「中のボタン・行をクリックする」UIだけ。
 */
const INTERACTIVE = new Set([
  'panel', // もちもの・クラフト・お店・ずかん・おねがい・ポーズ・おくりもの・手紙 など共通パネル
  'dialogue', // 会話ボックス(本体クリックで送る+任意ボタン)
  'quest-complete', // 依頼達成バナー(クリックで閉じる)
  'today-card', // 朝の「きょうの島」カード(クリックで閉じる)
  'title-screen', // タイトル
  'sc-panel', // ショーケース(開発用)
]);

/**
 * 見せるだけの要素(クリックを1つも受けとってはいけない)。
 * ここに載せたものは、下の checkNoHit で「idを含む強さの none」を機械確認する。
 */
const DISPLAY_ONLY = new Set([
  'sleep-fade', // ねむりの暗転(透明のまま画面ぜんたいに残りつづける)
  'chat-bubble', // NPCどうしの立ち話のふきだし
  'dir-arrow', // 目的地の方向矢印
  'npc-marker', // NPC頭上の「!」
  'craft-pop', // つくった!の小さなポップ
  'combo-found', // くみあわせ発見の演出
  'toast-box', // トーストの積み場
  'hud-top', // 時計・ルミナのチップ
  'hud-fx', // りょうりの効果チップ
  'hud-hint', // 画面下のEヒント
  'obj-hud', // 「いまやること」
  'touch-root', // タッチUIの根(中のボタンだけが auto に戻る)
]);

/** 演出の暗転など、要素に直接 style を書いているもの(インラインは id より強いので安全) */
const INLINE_NONE = 'pointer-events:none';

interface Found {
  file: string;
  cls: string | null;
  inlineNone: boolean;
  varName: string;
}

function tsFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) tsFiles(p, out);
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/**
 * #ui-root の直下に足している要素を 1ファイルぶん集める。
 *
 * 見るのは次の3つの形(いま src にある書きかたを すべて拾う):
 *   document.getElementById('ui-root')!.appendChild(x)
 *   root.appendChild(x)          // const root = document.getElementById('ui-root')!
 *   opts.root.appendChild(x)     // TouchControls(GameSceneが #ui-root を渡している)
 * 見つけた x について、同じファイルの `x.className = '…'` / `x.style.cssText = '…'` を引く。
 */
function scanFile(path: string): Found[] {
  const src = readFileSync(path, 'utf8');
  const file = path.slice(path.indexOf('src')).replace(/\\/g, '/');
  const out: Found[] = [];
  const appendRe =
    /(?:document\.getElementById\('ui-root'\)!?|(?:\w+\.)?root)\s*\.appendChild\(\s*([\w.]+)\s*\)/g;
  for (const m of src.matchAll(appendRe)) {
    const varName = m[1];
    const at = m.index ?? 0;
    const esc = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // 同じ変数名(el など)を何度も使いまわすファイルがあるので、
    // 「その appendChild より前で いちばん近い代入」を採る
    const nearestBefore = (re: RegExp): string | null => {
      let best: string | null = null;
      for (const g of src.matchAll(re)) {
        if ((g.index ?? 0) > at) break;
        best = g[1];
      }
      return best;
    };
    const cls = nearestBefore(new RegExp(`${esc}\\.className\\s*=\\s*'([^']*)'`, 'g'));
    // cssText の中身にも「;」が入るので、行末の「;」までを1文とみなす
    const css = nearestBefore(
      new RegExp(`${esc}\\.style\\.cssText\\s*=\\s*([\\s\\S]{0,400}?);\\s*[\\r\\n]`, 'g')
    );
    out.push({
      file,
      varName,
      cls: cls ? cls.trim().split(/\s+/)[0] : null,
      inlineNone: !!css && css.replace(/\s/g, '').includes(INLINE_NONE),
    });
  }
  return out;
}

const found: Found[] = tsFiles(SRC).flatMap(scanFile);

/** `#ui-root … .cls` の形で pointer-events:none を宣言しているか(= idを含む強さ) */
function hasIdStrengthNone(cls: string): boolean {
  // ルールを { セレクタ, 中身 } に割って、セレクタに #ui-root と .cls が両方あるものを探す
  for (const m of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1];
    const body = m[2].replace(/\s/g, '');
    if (!/pointer-events:none/.test(body)) continue;
    for (const one of sel.split(',')) {
      if (one.includes('#ui-root') && new RegExp(`\\.${cls}(?![\\w-])`).test(one)) return true;
    }
  }
  return false;
}

describe('#ui-root のオーバーレイ(表示専用はクリックを吸わない)', () => {
  it('走査そのものが動いている(既知のオーバーレイを取りこぼしていない)', () => {
    const classes = new Set(found.map((f) => f.cls));
    // 実害の出た .sleep-fade と、いちばん数の多い .panel は かならず拾えること
    expect(classes.has('sleep-fade'), '.sleep-fade を見つけられない=走査が壊れている').toBe(true);
    expect(classes.has('panel')).toBe(true);
    expect(found.length).toBeGreaterThanOrEqual(20);
  });

  it('#ui-root の直下に足す要素は、すべて「押す」か「見せるだけ」に分類されている', () => {
    const unknown = found
      .filter((f) => !f.inlineNone)
      .filter((f) => !(f.cls && (INTERACTIVE.has(f.cls) || DISPLAY_ONLY.has(f.cls))))
      .map((f) => `${f.file}: ${f.varName} → ${f.cls ?? '(クラス不明)'}`);
    expect(
      unknown,
      '新しいオーバーレイは INTERACTIVE か DISPLAY_ONLY のどちらかに足すこと' +
        '(見せるだけなら style.css の「#ui-root > .…{pointer-events:none}」にも足す)'
    ).toEqual([]);
  });

  it('「見せるだけ」の要素は、#ui-root を含む強さで pointer-events:none が打ちなおされている', () => {
    const missing = [...DISPLAY_ONLY].filter((cls) => !hasIdStrengthNone(cls));
    expect(
      missing,
      '`#ui-root > *{pointer-events:auto}` は id を含むので、クラスだけの none は効かない。' +
        'style.css の「表示専用のオーバーレイ」の並びに足すこと'
    ).toEqual([]);
  });

  it('クラスだけの pointer-events:none に頼っている #ui-root 直下の要素が1つも無い', () => {
    // 走査で見つかった「見せるだけ」の全クラスについて、クラス単独の宣言だけで
    // 済ませていないかを確かめる(= 上のルールの言いかえだが、
    //  新しく DISPLAY_ONLY に足した人が CSS を忘れた場合にも同じ所で落ちる)
    const displayFound = found
      .map((f) => f.cls)
      .filter((c): c is string => !!c && DISPLAY_ONLY.has(c));
    for (const cls of new Set(displayFound)) {
      expect(hasIdStrengthNone(cls), `${cls} は #ui-root を含む強さで none にすること`).toBe(true);
    }
  });

  it('#ui-root > * の pointer-events:auto は そのまま残っている(消すとUI全体が押せなくなる)', () => {
    expect(STYLE.replace(/\s/g, '')).toContain('#ui-root>*{pointer-events:auto;}');
  });
});

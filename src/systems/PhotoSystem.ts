// v24 しゃしん(フォトモード)の 入れもの。描画・Babylon には依存しない。
//
// なにを解くか:
//   島で見た「いちばん いい場面」を のこす手だてが1つも無かった。
//   P(タッチは 右上のボタン)で UIを 消して 少し引き、シャッターで 額縁つきの
//   1枚を のこす。ずかんの「アルバム」で見返せて、家具「しゃしんたて」に かざれる。
//
// 保存の約束(セーブ本体を まもるための ならべ):
//   1. **セーブ本体(lumi_save)とは 別のキー**に書く。しゃしんが いっぱいでも
//      ぼうけんの記録は 1バイトも 押し出されない。
//   2. 上限は 枚数(PHOTO_MAX)と 文字数(PHOTO_BUDGET)の 両方。どちらかを こえたら
//      **古いものから** 捨てる(捨てる前に 確認を出すのは 表示側の受けもち)。
//   3. 読みこみは sanitizePhotos 1本を通す。知らない形・こわれた値は そこで落とす
//      (SaveSystem と まったく同じ「外から来たデータは1つの入口で検証する」流儀)。
//   4. localStorage が いっぱいのときは、古いものを 捨てながら 3回まで やり直す。
//      それでも入らなければ false を返す(呼び出し側が 子どもに 伝える)。

/** しゃしんを しまう localStorage のキー(セーブ本体 lumi_save とは べつ) */
export const PHOTO_KEY = 'lumi_photos';

/** アルバムに のこせる まい数 */
export const PHOTO_MAX = 24;

/**
 * 1枚の絵の大きさ(px)。額のわくは この外がわに つく。
 * 320x180 は 画面(16:9)を そのまま 縮めた形。
 */
export const PHOTO_W = 320;
export const PHOTO_H = 180;
/** 額のわくの太さ(px) */
export const PHOTO_FRAME = 20;
/** JPEG の しつ(0〜1)。0.72 で 1枚 およそ 12〜20KB */
export const PHOTO_QUALITY = 0.72;

/**
 * ぜんぶの しゃしんに つかってよい 文字数の上限。
 *
 * localStorage は 1文字=2バイトで数える ブラウザが多いので、70万文字 ≒ 1.4MB。
 *
 * **実測**(島の10か所 × 5つの時こくで 60回 シャッターを おした 走行):
 *   1枚 … 最小 9,807 / 中央 12,067 / 最大 14,967 文字
 *   24枚 … 合計 288,668 文字(キー全体で 290,015 文字 ≒ 0.55MB)= この上限の 41%
 *   まい数は きっかり 24 で 止まり、セーブ本体(lumi_save)は 1,389 文字のまま 動かない
 * つまり ふつうは 先に まい数(24)で 切れる。文字数の 上限は
 * 「まれに 明るくて こまかい絵ばかり」のときだけ 効く 安全弁。
 */
export const PHOTO_BUDGET = 700_000;

export interface Photo {
  /** 通し番号(とった順)。しゃしんたてが これで 1枚を えらぶ */
  id: string;
  /** とった日(ゲーム内) */
  day: number;
  /** とった時こく(ゲーム内・0〜24) */
  hour: number;
  /** 額縁つきの絵(data:image/jpeg;base64,...) */
  data: string;
}

/** しゃしん1枚ぶんの 文字数 */
export function photoSize(p: Photo): number {
  return p.data.length;
}

/** ぜんぶで 何文字 つかっているか(容量の実測に使う) */
export function photoBytes(list: readonly Photo[]): number {
  let n = 0;
  for (const p of list) n += photoSize(p);
  return n;
}

/**
 * 上限に おさまるように 古いものから 落とす(純関数)。
 * ならびは「古い→新しい」。新しい1枚を 足したあとに 通す。
 */
export function fitPhotos(
  list: readonly Photo[],
  max: number = PHOTO_MAX,
  budget: number = PHOTO_BUDGET
): Photo[] {
  const out = [...list];
  if (max >= 1) while (out.length > max) out.shift();
  while (out.length > 1 && photoBytes(out) > budget) out.shift();
  return out;
}

/**
 * 足したときに 何枚 消えるか(まだ 消さずに 数だけ 返す)。
 * 「古いものから 消えるよ、いい?」の 確認を 出すために 使う。
 */
export function photosToDrop(
  list: readonly Photo[],
  next: Photo,
  max: number = PHOTO_MAX,
  budget: number = PHOTO_BUDGET
): number {
  return list.length + 1 - fitPhotos([...list, next], max, budget).length;
}

const ID_RE = /^p[0-9]{1,15}$/;
const DATA_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]{16,}$/;

/** 1枚ぶんが しゃしんとして 通せる形か(外から来た値を ここで 落とす) */
export function isPhoto(v: unknown): v is Photo {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Partial<Photo>;
  if (typeof p.id !== 'string' || !ID_RE.test(p.id)) return false;
  if (typeof p.data !== 'string' || !DATA_RE.test(p.data)) return false;
  if (typeof p.day !== 'number' || !Number.isFinite(p.day) || p.day < 1 || p.day > 100000) return false;
  if (typeof p.hour !== 'number' || !Number.isFinite(p.hour) || p.hour < 0 || p.hour >= 24) return false;
  return true;
}

/** 生データ(JSON.parse ずみ)を しゃしんの ならびにする。**復元の ただ1つの入口** */
export function sanitizePhotos(parsed: unknown): Photo[] {
  if (!Array.isArray(parsed)) return [];
  const out: Photo[] = [];
  const seen = new Set<string>();
  for (const v of parsed) {
    if (!isPhoto(v) || seen.has(v.id)) continue;
    seen.add(v.id);
    out.push({ id: v.id, day: v.day, hour: v.hour, data: v.data });
  }
  return fitPhotos(out);
}

/** アルバムの中身(古い→新しい)。読めなければ 空 */
export function loadPhotos(): Photo[] {
  try {
    const text = localStorage.getItem(PHOTO_KEY);
    if (!text) return [];
    return sanitizePhotos(JSON.parse(text));
  } catch (e) {
    console.warn('[photo] アルバムが 読めないので 空にします', e);
    return [];
  }
}

/**
 * アルバムを 書きこむ。いっぱいで 書けないときは 古いものを 捨てながら やり直す。
 * @returns 書けたか
 */
export function savePhotos(list: readonly Photo[]): boolean {
  let out = fitPhotos(list);
  for (let i = 0; i < 4; i++) {
    try {
      localStorage.setItem(PHOTO_KEY, JSON.stringify(out));
      return true;
    } catch {
      if (out.length <= 1) break;
      out = out.slice(1); // 古いものから 捨てて もういちど
      console.warn('[photo] 入りきらないので 古い しゃしんを 1枚 捨てました');
    }
  }
  try {
    localStorage.removeItem(PHOTO_KEY);
  } catch {
    /* 消せなくても これ以上できることはない */
  }
  return false;
}

/** つぎの しゃしんの 通し番号(いまの中身から みちびく=かぶらない) */
export function nextPhotoId(list: readonly Photo[]): string {
  let max = 0;
  for (const p of list) {
    const n = Number(p.id.slice(1));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `p${max + 1}`;
}

/** その番号の しゃしん(無ければ null) */
export function photoById(list: readonly Photo[], id: string | undefined): Photo | null {
  if (!id) return null;
  return list.find((p) => p.id === id) ?? null;
}

/** 1枚 消す(番号で) */
export function removePhoto(list: readonly Photo[], id: string): Photo[] {
  return list.filter((p) => p.id !== id);
}

/** 「3にちめ の 15じ」の言いかた(かな書き。Canvas と ずかんの両方で使う) */
export function photoLabel(p: Photo): string {
  const h = Math.floor(p.hour);
  const m = Math.floor((p.hour - h) * 60);
  return `${p.day}にちめ ${h}じ${String(m).padStart(2, '0')}ふん`;
}

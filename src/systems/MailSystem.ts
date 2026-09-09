// v30 住民からの手紙の受信箱。描画・Babylon・DOMに依存しない純ロジック。
//
// なにを解くか:
//   なかよし度5の お礼(thanksLetter)は トーストで 1回 出して 消えていた。
//   「ふたりの じかん」の あと味も、章を おえた よろこびも、その場かぎり。
//   ——読み返せない手紙は、子どもにとって「無かった」のと おなじ。
//   とどいた手紙を 記録して、ずかんの「てがみ」欄で いつでも 読み返せるようにする。
//
// 大事な約束:
//   1. **セーブに 新しいフィールドを 1つも ふやさない**。
//        とどいた   → flags の `letter_◯◯`(びんの手紙の「読んだ」と おなじ入れもの)
//        とどいた日 → stats の `letterday_◯◯`
//        ひらいた   → flags の `letterread_◯◯`(未読バッジを 消すため)
//      キーの形は SaveSystem の STAT_KEY_RE([A-Za-z0-9_]・40文字以内)を通る。
//      手紙のIDが その形かは validateLetterData が 起動時に見る。
//   2. **とどく場所は 出どころ1か所ずつ**。
//        お礼   … GiftSystem.applyGift(なかよし度5になった その瞬間)
//        見せ場 … BondEventSystem.completeBond(「ふたりの じかん」を おえた瞬間)
//        章     … QuestDialogueController.finishQuest(章の さいごの依頼を おえた瞬間)
//      どれも「もらった瞬間」に 記録するので、トーストを 見のがしても 手紙は のこる。
//   3. びんの手紙(LETTERS)の 数えかたは 1ミリも 変えない。
//      ずかんの「N / 8」は これまでどおり BottleSystem.readLetterCount が出す。
import type { GameState } from '../game/GameState';
import { CHAPTER_LETTER_BY_QUEST, LETTER_BY_ID, MAIL, type LetterDef } from '../data/letters';
import { letterReadFlag } from './BottleSystem';

/**
 * とどいた記録の flags キー。
 * びんの手紙の「読んだ」記録(BottleSystem.letterReadFlag)と **同じ関数**を つかう:
 * ずかんから見れば どちらも「手に入れた手紙」で、入れものを 2つに 分ける理由が無い。
 */
export const mailGotFlag = letterReadFlag;
/** ひらいた記録の flags キー(未読バッジを 消すのに つかう) */
export const mailOpenFlag = (id: string): string => `letterread_${id}`;
/** とどいた日の stats キー */
export const mailDayKey = (id: string): string => `letterday_${id}`;

/** その手紙が もう とどいているか */
export function hasMail(s: GameState, id: string): boolean {
  return s.flags?.[mailGotFlag(id)] === true;
}

/** その手紙を もう ひらいたか(とどいていなければ false) */
export function isMailOpened(s: GameState, id: string): boolean {
  return s.flags?.[mailOpenFlag(id)] === true;
}

/** とどいているのに まだ ひらいていない = 未読 */
export function isMailUnread(s: GameState, id: string): boolean {
  return hasMail(s, id) && !isMailOpened(s, id);
}

/** とどいた日(まだ とどいていなければ null) */
export function mailDay(s: GameState, id: string): number | null {
  const n = s.stats?.[mailDayKey(id)];
  return typeof n === 'number' && Number.isFinite(n) && n >= 1 ? Math.floor(n) : null;
}

/**
 * 手紙を うけとる。はじめて とどいたときだけ その手紙を返す(2回目以降は null)。
 * 返り値を 見て トーストを出すので、**お祝いが 二重に 出ることが 構造的に無い**
 * (実績の evaluate・おくりものの stats の印と まったく同じ考え方)。
 */
export function receiveMail(s: GameState, id: string, day: number): LetterDef | null {
  const def = LETTER_BY_ID[id];
  if (!def || def.kind === 'diary' || def.kind === 'warm' || def.kind === 'hint') return null;
  if (!s.flags) s.flags = {};
  if (!s.stats) s.stats = {};
  if (s.flags[mailGotFlag(id)] === true) return null;
  s.flags[mailGotFlag(id)] = true;
  s.stats[mailDayKey(id)] = Math.max(1, Math.floor(Number.isFinite(day) ? day : 1));
  return def;
}

/** ひらいた印をつける。はじめて ひらいたときだけ true(未読の数が 1つ へる) */
export function openMail(s: GameState, id: string): boolean {
  if (!hasMail(s, id)) return false;
  if (!s.flags) s.flags = {};
  if (s.flags[mailOpenFlag(id)] === true) return false;
  s.flags[mailOpenFlag(id)] = true;
  return true;
}

/**
 * とどいた しらせ(トースト)の文。出どころ3つ(お礼・見せ場・章)で 同じ形にする
 * ——「どこから とどいたか」だけが ちがって、あとは 同じ しらせに見えるように。
 * 「ずかんで よめる」ことは 手紙UI(LetterUI)の 下の1行が 受けもつので ここでは 言わない。
 */
export function mailToastText(def: LetterDef): string {
  return `${def.from}から てがみ「${def.title}」が とどいた`;
}

/** その人の お礼の手紙(なかよし度5)。無ければ null */
export function thanksMailOf(npcId: string): LetterDef | null {
  return MAIL.find((l) => l.kind === 'thanks' && l.npc === npcId) ?? null;
}

/** その人の「ふたりの じかん」の手紙。無ければ null */
export function bondMailOf(npcId: string): LetterDef | null {
  return MAIL.find((l) => l.kind === 'bond' && l.npc === npcId) ?? null;
}

/** その依頼を おえた日に とどく 章の手紙。無ければ null */
export function chapterMailOf(questId: string): LetterDef | null {
  const id = CHAPTER_LETTER_BY_QUEST[questId];
  return id ? (LETTER_BY_ID[id] ?? null) : null;
}

/** とどいている 住民の手紙の数 */
export function receivedMailCount(s: GameState): number {
  return MAIL.filter((l) => hasMail(s, l.id)).length;
}

/** 未読の 住民の手紙の数(ずかんのタブに出す バッジの数) */
export function unreadMailCount(s: GameState): number {
  return MAIL.filter((l) => isMailUnread(s, l.id)).length;
}

/**
 * きょう とどいた手紙で、まだ ひらいていないものが あるか。
 * 目標カードの3行め(src/systems/TodayCard.ts MAIL_TIP_TEXT)が
 * 「とどいた その日だけ」ずかんへ 案内するのに つかう
 * ——読まないまま 何日も 出しつづけると せかす表示になるので、日づけで しぼる。
 */
export function unreadMailArrivedOn(s: GameState, day: number): boolean {
  const d = Math.max(1, Math.floor(Number.isFinite(day) ? day : 1));
  return MAIL.some((l) => isMailUnread(s, l.id) && mailDay(s, l.id) === d);
}

/** ずかんに ならべる順(とどいた手紙が 先・その中は とどいた日の 古い順) */
export function mailRows(s: GameState): { def: LetterDef; got: boolean; unread: boolean; day: number | null }[] {
  return MAIL.map((def) => ({
    def,
    got: hasMail(s, def.id),
    unread: isMailUnread(s, def.id),
    day: mailDay(s, def.id),
  }));
}

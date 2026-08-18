// v21 NPCどうしの「立ち話」。描画・Babylon・DOMに依存しない純ロジック。
//
// なにを解くか:
//   島の人は よく できているのに、**たがいに 一度も 口を きかなかった**。
//   プレイヤーが 話しかけたときだけ 動く人形に 見えてしまう。
//   ふたりが 向かいあって しゃべっている場に「通りかかれる」ようにする。
//
// 大事な約束(ここを外すと ほかの遊びを こわす):
//   1. **やっていることは ほしまつりと同じ「立ち位置の差しかえ」だけ**。
//      スケジュールの状態機械にも 会話・依頼・店の道すじにも 1行も 手を入れていない。
//   2. **依頼が1つでも動いている日は 立ち話を 出さない**(朝の来訪 visitorOfDay と同じ規則)。
//      誘導(いまやること)が指すNPCが いつもの場所から いなくなると 子どもが迷うため。
//      これは 回帰ボット・UXボットの走行に 一切 影響しないという保証でもある。
//   3. **プレイヤーが 話しかけたら ふつうの会話が かならず 勝つ**。
//      立ち話は Eの候補を 1つも 作らない(NPCの talk 候補は これまでのまま)。
//      話しかけられた瞬間に 立ち話は だまり、会話が おわれば また 立っている。
//   4. 乱数を1つも使わない。日づけと時刻と座標だけで ぜんぶ決まる。
//
// 時間帯と立ち位置の決め方(実データから):
//   スケジュール(src/data/npcs.ts)を つき合わせて、**ふたりが 同時に 外にいる帯**を
//   さがし、そのうち **二人の立ち位置が いちばん近い帯**を えらんである。
//     ツムギ×ミナモ … 12〜14時。ツムギ=ベンチ(12〜13.5)/ミナモ=ひろば(10〜13)。
//                      もともと 3.6mしか はなれていない = ほんとうに 出あう二人
//     ノクト×ツムギ … 19〜21時。ノクト=林(17〜20)→高台/ツムギ=ルミの木(19〜21)。
//                      ルミの木の下は ノクトの spot('tree')でもあるので、そこで 落ちあう
//     ミナモ×ノクト … 17〜20時。ミナモ=さんばし(13〜18)→池(18〜20)/ノクト=林(17〜20)。
//                      二人とも 外にいるのは この帯だけ。池のほとりで 落ちあう
//   立ち位置は ぜんぶ 実測ずみ(tests/unit/chat_event.test.ts が機械検査する):
//   歩ける・まわり8方向も歩ける・採取などの「talkより強いE」から3.2m以上はなれている。
import type { GameState } from '../game/GameState';
import { NPC_BY_ID } from '../data/npcs';
import { questFor } from './QuestSystem';

/** だれが しゃべっている行か */
export type ChatSide = 'a' | 'b';

export interface ChatLine {
  who: ChatSide;
  text: string;
}

export interface ChatScript {
  id: string;
  /** 掛け合い(かならず a と b が 交互に 出る。validateChatData が機械検査する) */
  lines: ChatLine[];
}

export interface ChatStand {
  x: number;
  z: number;
}

export interface ChatPairDef {
  id: string;
  /** 話す二人(a が 先に 口を ひらく) */
  a: string;
  b: string;
  /** 立ち話の時間帯(from <= hour < to) */
  from: number;
  to: number;
  /** 立ち位置(実測ずみ)。向きは たがいの相手のほうへ 自動でむく */
  standA: ChatStand;
  standB: ChatStand;
  /** 日づけで1本 えらぶ(3本)。中身は「たがいの 性格が 出る」雑談だけ */
  scripts: ChatScript[];
}

/** 立ち話が「聞こえる」きょり(m)。会話の輪(1.8m)より外なので、近づくだけで聞ける */
export const CHAT_HEAR_R = 5.0;
/** 1行が 出ている時間(秒) */
export const CHAT_LINE_SEC = 3.2;
/** 話しはじめるまでの ため(秒)。近づいた とたんに しゃべりだすと おどろく */
export const CHAT_START_DELAY = 0.8;
/** 1本 おわったあとの 余韻(秒)。この間も 吹き出しは 出したままにする */
export const CHAT_TAIL_SEC = 1.6;
/** 立ち話を「聞いた」回数(バッジが読む stats のキー) */
export const CHAT_HEARD_KEY = 'chat_heard';
/** 何日に1度 その組が 立ち話を しない日にするか(4日に1度は 出あわない) */
export const CHAT_SKIP_MOD = 4;

/** 日付ハッシュ(同じ日・同じsaltなら必ず同じ値。乱数は使わない) */
function dayHash(day: number, salt: number): number {
  let h = Math.imul((day | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ salt;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

// ---------------------------------------------------------------------------
// 立ち話 9本(3組 × 3本)
// ---------------------------------------------------------------------------
export const CHAT_PAIRS: ChatPairDef[] = [
  {
    // ツムギ(ベンチ 12:00-13:30)× ミナモ(ひろば 10:00-13:00)
    id: 'tsumugi_minamo',
    a: 'tsumugi',
    b: 'minamo',
    from: 12,
    to: 14,
    standA: { x: 2.1, z: -1.5 }, // ツムギの bench スポットそのもの
    standB: { x: 2.7, z: 0.8 }, // ひろばがわ 2.38m。実測して えらんだ点
    scripts: [
      {
        id: 'rod_care',
        lines: [
          { who: 'a', text: 'ミナモ、その さおの にぎるところ、すりへってるわよ。' },
          { who: 'b', text: 'あ、ほんとだ。まいにち にぎってるからなあ。' },
          { who: 'a', text: 'こんど かりくさを まいて あげる。手に なじむように ね。' },
          { who: 'b', text: 'ありがとう! ツムギの まいたのは、ぬれても すべらないんだ。' },
        ],
      },
      {
        id: 'good_wood',
        lines: [
          { who: 'b', text: 'ツムギは どうやって いい木を えらぶの?' },
          { who: 'a', text: 'たたくのよ。こーん、って なる木は しんが とおってるの。' },
          { who: 'b', text: 'さかなも おなじだ! いい日は うきの おとが ちがうんだよ。' },
          { who: 'a', text: 'ふふ。わたしたち、にてるわね。' },
        ],
      },
      {
        id: 'noon_bench',
        lines: [
          { who: 'a', text: 'おひるの ベンチ、日なたで あったかいでしょう。' },
          { who: 'b', text: 'うん。ここ、ぼくの さおを ほしてる ばしょなんだ。' },
          { who: 'a', text: 'あら。じゃあ この ベンチ、あなたの ためにも つくったのね。' },
          { who: 'b', text: 'そう おもうと、すわるのが ちょっと てれるなあ。' },
        ],
      },
    ],
  },
  {
    // ノクト(林 17:00-20:00 → 高台 20:00-)× ツムギ(ルミの木 19:00-21:00)
    id: 'nokto_tsumugi',
    a: 'nokto',
    b: 'tsumugi',
    // ノクトは 17時に 家を出るまで うごけない。3組の時間帯は 1ミリも かさねられないので、
    // ノクトが 出る2組を 17〜19 / 19〜21 に わけてある(validateChatData が 機械検査する)
    from: 19,
    to: 21,
    standA: { x: 1.3, z: -5.5 }, // ノクトの tree スポットの すぐ そば
    standB: { x: -1.3, z: -5.5 }, // ツムギの lumi スポットの すぐ そば。2.6m
    scripts: [
      {
        id: 'book_mend',
        lines: [
          { who: 'a', text: 'ツムギや。この本の せなかが われてしもうた。' },
          { who: 'b', text: 'まあ、ずいぶん よんだのね。……なおせるわ、まかせて。' },
          { who: 'a', text: 'たのむ。40年 まえの 星の きろくじゃ。' },
          { who: 'b', text: 'それなら じょうぶな 糸で かがるわね。あと 40年 もつように。' },
        ],
      },
      {
        id: 'book_tower',
        lines: [
          { who: 'b', text: 'ノクトさん、本を つみあげるの、たおれないの?' },
          { who: 'a', text: 'たおれる。じゃが、たおれた ところに さがしものが あるのじゃ。' },
          { who: 'b', text: 'それ、かたづけない いいわけに きこえるわ。' },
          { who: 'a', text: 'ふぉっふぉ。……そうとも いうのう。' },
        ],
      },
      {
        id: 'lumi_light',
        lines: [
          { who: 'a', text: 'この木の下は 紙が しめらん。かみを ほすには もってこいじゃ。' },
          { who: 'b', text: 'ルミの木は、ひかりも やわらかいものね。' },
          { who: 'a', text: 'うむ。文字が おどらん あかりじゃ。' },
          { who: 'b', text: 'こんど ここに 小さな だいを つくりましょうか。' },
        ],
      },
    ],
  },
  {
    // ミナモ(さんばし 13:00-18:00 → 池 18:00-20:00)× ノクト(林 17:00-20:00)
    id: 'minamo_nokto',
    a: 'nokto',
    b: 'minamo',
    // 17時=ノクトが 家を出る時刻。二人は 40mずつ 歩いてくるので、
    // そろうのは 18時20分ごろ。**始まった1本は 時間帯が おわっても 最後まで 流す**
    // (下の update を参照)ので、19時ちょうどに 話が 切れることは ない
    from: 17,
    to: 19,
    standA: { x: 24.4, z: 9.6 }, // 池の西岸。実測して えらんだ点
    standB: { x: 25.6, z: 11.6 }, // 2.33m。ミナモの pond スポットの すぐ そば
    scripts: [
      {
        id: 'star_water',
        lines: [
          { who: 'a', text: 'ミナモや、池の みずに 星が うつっておるぞ。' },
          { who: 'b', text: 'ほんとだ! 空が ふたつ あるみたいだね。' },
          { who: 'a', text: 'よるの うみは もっと すごい。ぜんぶが 星の いれものに なる。' },
          { who: 'b', text: 'いつか つれてって! ……ぼくの ふねで、だけどね。' },
        ],
      },
      {
        id: 'night_fish',
        lines: [
          { who: 'b', text: 'ノクトさん、よるの うみで つれる魚、しってる?' },
          { who: 'a', text: 'ヨザカナじゃな。あれは 星の かけらを たべておる、と ワシは 思うておる。' },
          { who: 'b', text: 'えっ、ほんとに?' },
          { who: 'a', text: 'しらん。じゃが そう おもうと、はなすのが すこし おしくなるじゃろ。' },
        ],
      },
      {
        id: 'quiet_sky',
        lines: [
          { who: 'a', text: 'きょうの 空は しずかじゃ。かぜが ないと 星が またたかん。' },
          { who: 'b', text: 'かぜが ないと、うきも うごかないんだ。' },
          { who: 'a', text: 'おなじ空を、おぬしは 下から 見ておるのじゃな。' },
          { who: 'b', text: 'うん。ぼくは 水に うつった 空の ほうが すきかも。' },
        ],
      },
    ],
  },
];

export const CHAT_PAIR_BY_ID: Record<string, ChatPairDef> = Object.fromEntries(
  CHAT_PAIRS.map((p) => [p.id, p])
);

/** その組が その日 立ち話を する日か(4日に1度は 出あわない)。乱数は使わない */
export function chatHappensOn(pairId: string, day: number): boolean {
  if (!Number.isFinite(day)) return false;
  const i = CHAT_PAIRS.findIndex((p) => p.id === pairId);
  if (i < 0) return false;
  return dayHash(Math.floor(day), 101 + i) % CHAT_SKIP_MOD !== 0;
}

/** その日 その組が 話す1本(しない日は null)。同じ日は 何度読んでも 同じ */
export function chatScriptOf(pairId: string, day: number): ChatScript | null {
  const pair = CHAT_PAIR_BY_ID[pairId];
  if (!pair || !chatHappensOn(pairId, day)) return null;
  const i = CHAT_PAIRS.findIndex((p) => p.id === pairId);
  return pair.scripts[dayHash(Math.floor(day), 211 + i) % pair.scripts.length];
}

/** いま その組の時間帯か */
export function chatTimeActive(pair: ChatPairDef, hour: number): boolean {
  return Number.isFinite(hour) && hour >= pair.from && hour < pair.to;
}

/**
 * 依頼が1つでも 動いている日か(朝の来訪 visitorOfDay と まったく同じ規則)。
 * 動いている日は 立ち話を いっさい 出さない = 誘導が 指す人は いつもの場所にいる。
 */
export function chatBlockedByQuest(s: GameState): boolean {
  for (const id of Object.keys(s.npcs ?? {})) {
    if (questFor(s, id) !== null) return true;
  }
  return false;
}

/**
 * いま 立ち話をしている組(していなければ null)。純関数。
 * 島にいる人だけを見る(入り江・いちば島の人は 立ち話に 出てこない)。
 */
export function activeChatPair(s: GameState, day: number, hour: number): ChatPairDef | null {
  if (chatBlockedByQuest(s)) return null;
  for (const pair of CHAT_PAIRS) {
    if (!chatTimeActive(pair, hour)) continue;
    if (!chatHappensOn(pair.id, day)) continue;
    // まだ 出会っていない人は 立たせない(セーブに記録の無い人)
    if (!s.npcs?.[pair.a] || !s.npcs?.[pair.b]) continue;
    return pair;
  }
  return null;
}

/** 立ち話の立ち位置(NPCSystem が spotFor から引く)。相手のほうを向く */
export function chatStandOf(pair: ChatPairDef, npcId: string): { x: number; z: number; rotY: number; wanderR: number } | null {
  const me = npcId === pair.a ? pair.standA : npcId === pair.b ? pair.standB : null;
  const you = npcId === pair.a ? pair.standB : npcId === pair.b ? pair.standA : null;
  if (!me || !you) return null;
  // 描画は+π回転なので atan2+π で 相手に 顔が向く(NPCSystem のほかの向きと同じ式)
  return { x: me.x, z: me.z, rotY: Math.atan2(you.x - me.x, you.z - me.z) + Math.PI, wanderR: 0 };
}

/** いま 出ている 吹き出し(表示側が読む) */
export interface ChatBubble {
  pairId: string;
  /** しゃべっている人 */
  speaker: string;
  /** だまって 聞いている人 */
  listener: string;
  /** 何行めか(0はじまり) */
  index: number;
  /** ぜんぶで何行か */
  total: number;
  /** 本文。聞こえるきょりの外では null(吹き出しの形だけ 出す) */
  text: string | null;
  /** 聞こえるきょりの中にいるか */
  heard: boolean;
}

/** 立ち話のすすみぐあい(GameScene が毎フレーム わたす) */
export interface ChatTick {
  day: number;
  hour: number;
  px: number;
  pz: number;
  /** いま 立ち話を 止めるべきか(会話中・見せ場・別の場所にいる など) */
  suspended: boolean;
}

/**
 * 立ち話の進行(runtime)。描画にもDOMにも さわらない。
 *
 * 流れ:
 *   時間帯に入る → ふたりが 立ち位置へ 歩いてくる(NPCSystem がやる)
 *   → プレイヤーが CHAT_HEAR_R まで 近づくと 1本 流れる
 *   → 流れきったら その日は もう 流さない(吹き出しだけ ときどき 出す)
 * 近づくまで 待つのは、「気づかないうちに おわっていた」を なくすため。
 */
export class ChatEventSystem {
  /** いま 立ち話をしている組(していなければ null) */
  private pair: ChatPairDef | null = null;
  private script: ChatScript | null = null;
  private idx = -1;
  private t = 0;
  private started = false;
  private finished = false;
  /** その日 もう 流した組(day が かわると 空にする) */
  private doneDay = -1;
  private done = new Set<string>();

  /** いま 出ている 吹き出し(出ていなければ null) */
  bubble: ChatBubble | null = null;
  /** 1本 流れきった瞬間に 1度だけ true(GameScene が stats に足す) */
  justHeard = false;

  /** いま立ち話をしている組のid(検証・撮影用) */
  get activePairId(): string | null {
    return this.pair?.id ?? null;
  }

  /** いま 流れている本のid(検証・撮影用) */
  get activeScriptId(): string | null {
    return this.script?.id ?? null;
  }

  /** その日 もう 聞いたか(検証用) */
  heardToday(pairId: string): boolean {
    return this.done.has(pairId);
  }

  /** 立ち話をやめる(会話に 入られたとき・場所が かわったとき) */
  private silence(): void {
    this.bubble = null;
    this.idx = -1;
    this.t = 0;
    this.started = false;
  }

  /**
   * 1フレーム すすめる。
   * @param s     いまの状態(依頼が動いている日は 立ち話を 出さない)
   * @param dt    経過秒
   * @param tick  日づけ・時刻・プレイヤーの位置・止めるかどうか
   */
  update(s: GameState, dt: number, tick: ChatTick): void {
    this.justHeard = false;
    const day = Math.floor(tick.day);
    if (this.doneDay !== day) {
      this.doneDay = day;
      this.done.clear();
    }
    // 始まった1本は 時間帯が おわっても 最後まで 流す。
    // 二人は スケジュールへ 帰りはじめるが、話の とちゅうで 吹き出しが 消えるほうが
    // ずっと 気もちわるい(時間帯の おわりぎわに 近づいた子が いちばん 損をする)。
    const running = this.pair !== null && this.started && !this.finished;
    const pair = running ? this.pair : activeChatPair(s, day, tick.hour);
    if (pair?.id !== this.pair?.id) {
      this.pair = pair;
      this.script = pair ? chatScriptOf(pair.id, day) : null;
      this.finished = pair ? this.done.has(pair.id) : false;
      this.silence();
    }
    if (!this.pair || !this.script || tick.suspended) {
      this.bubble = null;
      if (tick.suspended) this.silence();
      return;
    }
    const near =
      Math.hypot(tick.px - this.pair.standA.x, tick.pz - this.pair.standA.z) <= CHAT_HEAR_R ||
      Math.hypot(tick.px - this.pair.standB.x, tick.pz - this.pair.standB.z) <= CHAT_HEAR_R;
    if (this.finished) {
      // もう 聞いた組: 吹き出しの形だけ 出しつづける(まだ 立ち話は つづいている)
      this.bubble = this.idleBubble(near);
      return;
    }
    if (!this.started) {
      if (!near) {
        this.bubble = this.idleBubble(false);
        return;
      }
      this.started = true;
      this.t = -CHAT_START_DELAY;
      this.idx = 0;
    }
    this.t += dt;
    while (this.t >= CHAT_LINE_SEC && this.idx < this.script.lines.length) {
      this.t -= CHAT_LINE_SEC;
      this.idx++;
    }
    if (this.idx >= this.script.lines.length) {
      this.finished = true;
      this.done.add(this.pair.id);
      this.justHeard = true;
      this.bubble = this.idleBubble(near);
      return;
    }
    const line = this.script.lines[Math.max(0, this.idx)];
    const speaker = line.who === 'a' ? this.pair.a : this.pair.b;
    const listener = line.who === 'a' ? this.pair.b : this.pair.a;
    this.bubble = {
      pairId: this.pair.id,
      speaker,
      listener,
      index: Math.max(0, this.idx),
      total: this.script.lines.length,
      // ため(t<0)のあいだは 吹き出しの形だけ
      text: this.t >= 0 && near ? line.text : null,
      heard: near,
    };
  }

  /** 本文の出ない 吹き出し(遠くから見たとき・聞きおわったあと) */
  private idleBubble(near: boolean): ChatBubble | null {
    if (!this.pair || !this.script) return null;
    // だれの頭の上に出すかも 決定論(時間で 交互に 入れかわる)
    const a = Math.floor(this.doneDay * 2 + this.t) % 2 === 0;
    return {
      pairId: this.pair.id,
      speaker: a ? this.pair.a : this.pair.b,
      listener: a ? this.pair.b : this.pair.a,
      index: 0,
      total: this.script.lines.length,
      text: null,
      heard: near,
    };
  }
}

/** データ整合性チェック(起動時に呼ぶ) */
export function validateChatData(): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const p of CHAT_PAIRS) {
    if (seen.has(p.id)) problems.push(`立ち話${p.id}のIDが重複`);
    seen.add(p.id);
    if (!NPC_BY_ID[p.a]) problems.push(`立ち話${p.id}のNPC${p.a}が存在しない`);
    if (!NPC_BY_ID[p.b]) problems.push(`立ち話${p.id}のNPC${p.b}が存在しない`);
    if (p.a === p.b) problems.push(`立ち話${p.id}が同じ人どうし`);
    if ((NPC_BY_ID[p.a]?.area ?? 'island') !== 'island') problems.push(`立ち話${p.id}の${p.a}が島の人でない`);
    if ((NPC_BY_ID[p.b]?.area ?? 'island') !== 'island') problems.push(`立ち話${p.id}の${p.b}が島の人でない`);
    if (!(p.from < p.to)) problems.push(`立ち話${p.id}の時間帯が さかさま`);
    const d = Math.hypot(p.standA.x - p.standB.x, p.standA.z - p.standB.z);
    if (d < 1.6 || d > 3.2) problems.push(`立ち話${p.id}の二人のきょり${d.toFixed(2)}mが 立ち話らしくない`);
    if (p.scripts.length !== 3) problems.push(`立ち話${p.id}の本数が3本でない`);
    const sids = new Set<string>();
    for (const sc of p.scripts) {
      if (sids.has(sc.id)) problems.push(`立ち話${p.id}の本${sc.id}が重複`);
      sids.add(sc.id);
      if (sc.lines.length < 3) problems.push(`立ち話${p.id}/${sc.id}が みじかすぎる`);
      for (let i = 1; i < sc.lines.length; i++) {
        if (sc.lines[i].who === sc.lines[i - 1].who) {
          problems.push(`立ち話${p.id}/${sc.id}の${i}行めが 交互になっていない`);
        }
      }
      for (const l of sc.lines) {
        if (l.text.trim().length < 4) problems.push(`立ち話${p.id}/${sc.id}に からの行がある`);
      }
    }
  }
  // 時間帯が かさならないこと(同じ時刻に 2組が 立ち話をしない = 人が 足りなくなる)
  for (let i = 0; i < CHAT_PAIRS.length; i++) {
    for (let j = i + 1; j < CHAT_PAIRS.length; j++) {
      const p = CHAT_PAIRS[i];
      const q = CHAT_PAIRS[j];
      if (p.from < q.to && q.from < p.to) {
        problems.push(`立ち話${p.id}と${q.id}の時間帯が かさなっている`);
      }
    }
  }
  return problems;
}

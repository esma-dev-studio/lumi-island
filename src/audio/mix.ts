// 音のバランス(ミックス)の設計値と、バスのつなぎ方。**音量の数字はここにしか書かない**。
//
// バスは4本(BGM / 環境 / 効果音 / UI)。効果音バスの中だけ、性格ごとに3つに分けてある:
//
//   master ── music    … 夜のオルゴール(MusicBox)
//          ├─ ambient  … 雨・波・風・葉ずれ・鳥・虫・まつりのざわめき
//          ├─ sfx ──┬─ sfx    … 手ごたえのある操作音(採取・釣り・クラフト)
//          │        ├─ notify … お知らせ・お祝い(依頼・じっせき・くみあわせ)
//          │        └─ foot   … 足音(連続で鳴るので いちばん静か)
//          └─ ui       … ボタン・パネル・ページ送り
//
// この形を **実機と計測ツールで まったく同じコードから作る**(buildBusGraph)。
// tools/audio_measure.mjs は OfflineAudioContext に同じ木を組んで測るので、
// 「表に出ている数字」と「実際に耳へ届く音」が ずれようがない。
import { SFX_BUS, type SfxBus, type SfxName } from './synth';

export const MIX = {
  /** いちばん外の音量。すべての音がここを通る */
  master: 0.32,
  /** 4本のバス */
  bus: {
    music: 1.0,
    ambient: 0.9,
    sfx: 0.8,
    ui: 0.45,
  },
  /**
   * 効果音バスの中の3つ(性格ごとの下げしろ)。
   * foot は「UIバス(master×0.45)より小さい」ことを 設計値の段階で守る
   * ——足音は歩いているあいだ ずっと鳴るので、いちばん静かでなければならない
   * (tests/unit/audio_mix.test.ts が バスの上下関係を固定する)。
   */
  sub: {
    sfx: 1.0,
    notify: 0.8,
    foot: 0.45,
  },
  /**
   * 本降りの雨の高さ(ambientバスの中)。
   * 実測(tools/audio_measure.mjs)で RMS -40.1dBFS。効果音のいちばん大きいもの(-22dBFS)より
   * じゅうぶん下、環境音3層(-44dBFS)より 4dB 上=「雨のときは雨が主役」になる。
   */
  rainPeak: 0.075,
  /** 雨の強さが変わるときの なめらかさ(秒)。降りはじめ・上がりぎわがぶつ切りにならない */
  rainRampSec: 1.2,
  /**
   * 環境音3層の全体の強さ。
   * 最初 0.55 で作ったところ、実測で RMS -26dBFS(どの効果音よりも大きい)になり、
   * 「島を歩いているだけで うるさい」状態だった。ピークが -30dBFS 前後に収まる値へ下げてある
   * (計測の帯は tools/audio_measure.mjs の LOOP_BANDS)。
   */
  bed: {
    day: 0.13,
    night: 0.09,
    /** 室内・よその家(屋根の下) */
    sheltered: 0.06,
    /** 雨のときは 環境音を下げて、雨に主役をゆずる(1=そのまま) */
    rainDuck: 0.45,
    /** 場所が変わるときの クロスフェード秒数 */
    rampSec: 1.6,
    /**
     * ゆきの日の かすかな風の層の高さ(3層とは別の4本目)。
     * 雪は「音を吸う」ので、風だけが低く残る。
     * 実測(tools/audio_measure.mjs)で 風だけのとき RMS -56dBFS 前後
     * ——3層(-44〜-50dBFS)より ずっと下の「かすかな層」。
     */
    snowWind: 0.2,
    /** ゆきが いちばん強いときの ローパス(Hz)。雪に吸われて 高い音が減る */
    snowCutoff: 1800,
    /**
     * ゆきのときは 3層を下げる(雨の rainDuck と同じ流儀)。
     * 下げないと「風の層を足したぶん 雪の日だけ うるさい」になる
     * ——実測で ふつうの日より 2.3dB 大きくなっていた。
     * いまは 雪の日のほうが 静か(実測 -51dBFS / ふつうの日 -49.7dBFS)。
     */
    snowDuck: 0.75,
  },
  /** ときどき鳴る1粒の音 */
  oneShot: {
    chirp: 0.05,
    cricket: 0.03,
    murmur: 0.04,
    /** 抽選の間かく(ミリ秒) */
    intervalMs: 2600,
  },
  /**
   * NPCの足音。プレイヤーの足音と **同じ音(step_*)を 小さく鳴らす**。
   * 島に5人ぶんの足音がいちどに鳴ると うるさいので、
   *   ・6mより遠い人は 鳴らさない(距離で だんだん小さく)
   *   ・プレイヤーの足音より 6dB 小さい(level=0.5)
   *   ・全員あわせて 0.13秒に1歩までに 間引く
   * の3つで しぼる。バスは足音バス(いちばん静か)のまま。
   */
  npcFoot: {
    /** これより遠い足音は鳴らさない(m) */
    radius: 6,
    /** すぐ近くでも プレイヤーの何倍の高さか(0.5 = -6dB) */
    level: 0.5,
    /** 全NPCあわせた 最短の間かく(秒) */
    minGapSec: 0.13,
    /** 1歩ぶんの歩幅(m)。プレイヤー(0.85m)より すこし広く=歩数が少ない */
    strideM: 0.95,
  },
} as const;

/** 4本+3つのバスをまとめたもの(効果音は名前からバスを引く) */
export interface BusGraph {
  master: GainNode;
  music: GainNode;
  ambient: GainNode;
  sfx: GainNode;
  /** 効果音バスの中の3つ */
  sub: Record<SfxBus, GainNode>;
  ui: GainNode;
}

/**
 * バスの木を組む。実機の AudioContext でも OfflineAudioContext でも同じ形になる。
 * @param dest つなぎ先(ふつうは ctx.destination)
 */
export function buildBusGraph(ctx: BaseAudioContext, dest: AudioNode): BusGraph {
  const g = (v: number): GainNode => {
    const n = ctx.createGain();
    n.gain.value = v;
    return n;
  };
  const master = g(MIX.master);
  master.connect(dest);
  const music = g(MIX.bus.music);
  music.connect(master);
  const ambient = g(MIX.bus.ambient);
  ambient.connect(master);
  const sfx = g(MIX.bus.sfx);
  sfx.connect(master);
  const ui = g(MIX.bus.ui);
  ui.connect(master);
  const subSfx = g(MIX.sub.sfx);
  subSfx.connect(sfx);
  const subNotify = g(MIX.sub.notify);
  subNotify.connect(sfx);
  const subFoot = g(MIX.sub.foot);
  subFoot.connect(sfx);
  return {
    master, music, ambient, sfx, ui,
    sub: { sfx: subSfx, notify: subNotify, foot: subFoot, ui },
  };
}

/** その効果音を流すノード(名前 → バス) */
export function sfxDestination(graph: BusGraph, name: SfxName): GainNode {
  return graph.sub[SFX_BUS[name]];
}

/** 効果音1つが通るゲインの総積(計測ツールと単体テストが期待値に使う) */
export function sfxChainGain(name: SfxName): number {
  const bus = SFX_BUS[name];
  if (bus === 'ui') return MIX.master * MIX.bus.ui;
  return MIX.master * MIX.bus.sfx * MIX.sub[bus];
}

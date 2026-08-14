// v18 「すわる」と「エモート」の機械検査。
//
// 守りたい性質:
//   1. エモートの順番が決定的(1回目=てをふる / つづけて=よろこぶ / 間をあけると戻る)
//   2. こたえてくれるNPCの選びかたが決定的(乱数なし・同距離なら一覧の先)
//   3. すわる場所の向き=背もたれの反対。すわる高さは 面の高さから引いて決まる
//   4. すわる候補が **既存の誘導・会話・採取の E を奪わない**(優先度と kind)
//   5. ひろばのベンチの座標が「見た目」と「すわる場所」で1つの情報源から来ている
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  EMOTES, EMOTE_CHAIN_SEC, EMOTE_COOLDOWN_SEC, EMOTE_REPLY_R, EmoteState, replyingNpc,
} from '../../src/systems/EmoteSystem';
import {
  PLAZA_BENCH_SEAT_H, SIT_REACH, SIT_ROOT_BELOW_SEAT, isSeatFurniture, nearestSeat,
  seatOfFurniture, seatOfPlazaBench, sitPose, type Seat,
} from '../../src/systems/SitSystem';
import { PRIORITY } from '../../src/systems/InteractionResolver';
import { matchesObjective } from '../../src/systems/ObjectiveInteractionPolicy';
import { hasMoveInput } from '../../src/systems/PlayerController';
import { BULLETIN_BOARD, PLAZA_BENCHES } from '../../src/data/island';
import { BULLETIN_REACH } from '../../src/systems/BulletinSystem';
import { ANIMS } from '../../src/data/characters';
import { SIT_BLEND_SEC, SIT_PITCH, SIT_ZOOM, ZOOM_MAX, PITCH_MIN } from '../../src/scenes/CameraController';

describe('エモートの順番(決定的)', () => {
  it('1回目は てをふる、つづけて もう一度で よろこぶ、その次は また てをふる', () => {
    const e = new EmoteState();
    expect(e.trigger(0)).toBe('wave');
    expect(e.trigger(1.5)).toBe('happy');
    expect(e.trigger(3)).toBe('wave');
  });

  it('連打はクールダウンで捨てる(押した回数ぶん出しっぱなしにしない)', () => {
    const e = new EmoteState();
    expect(e.trigger(0)).toBe('wave');
    expect(e.trigger(EMOTE_COOLDOWN_SEC - 0.01)).toBeNull();
    expect(e.trigger(EMOTE_COOLDOWN_SEC + 0.01)).toBe('happy');
  });

  it('間をあけると また「てをふる」から(あいさつが既定)', () => {
    const e = new EmoteState();
    expect(e.trigger(0)).toBe('wave');
    expect(e.trigger(EMOTE_CHAIN_SEC + 0.01)).toBe('wave');
  });

  it('reset で次はかならず てをふる', () => {
    const e = new EmoteState();
    e.trigger(0);
    e.reset();
    expect(e.trigger(0.1)).toBe('wave');
  });

  it('同じ押しかたなら 何度やっても 同じ列になる(乱数を使っていない)', () => {
    const run = (): string[] => {
      const e = new EmoteState();
      const out: string[] = [];
      for (const t of [0, 1, 2, 3, 20, 21]) {
        const r = e.trigger(t);
        if (r) out.push(r);
      }
      return out;
    };
    expect(run()).toEqual(run());
    expect(run()).toEqual(['wave', 'happy', 'wave', 'happy', 'wave', 'happy']);
  });

  it('エモート名は GLB に入っているクリップ名と一致する', () => {
    for (const name of EMOTES) expect(ANIMS).toContain(name);
  });
});

describe('エモートに こたえてくれる人', () => {
  const npcs = [
    { id: 'tsumugi', x: 0, z: 0 },
    { id: 'minamo', x: 2, z: 0 },
    { id: 'nokto', x: 10, z: 0 },
  ];

  it('とどく範囲(3m)の いちばん近い1人だけ', () => {
    expect(replyingNpc(2.4, 0, npcs)?.id).toBe('minamo');
    expect(replyingNpc(0.4, 0, npcs)?.id).toBe('tsumugi');
  });

  it('とどかなければ だれも こたえない', () => {
    expect(replyingNpc(6, 0, npcs)).toBeNull();
    expect(replyingNpc(0, 0, [])).toBeNull();
  });

  it('ちょうど 3m は とどかない(境界)', () => {
    expect(replyingNpc(EMOTE_REPLY_R, 0, [{ id: 'a', x: 0, z: 0 }])).toBeNull();
    expect(replyingNpc(EMOTE_REPLY_R - 0.001, 0, [{ id: 'a', x: 0, z: 0 }])?.id).toBe('a');
  });

  it('同じ距離なら 一覧の先の人(何度呼んでも同じ)', () => {
    const tie = [
      { id: 'a', x: -1, z: 0 },
      { id: 'b', x: 1, z: 0 },
    ];
    for (let i = 0; i < 5; i++) expect(replyingNpc(0, 0, tie)?.id).toBe('a');
  });
});

describe('すわる場所(向きと高さ)', () => {
  it('ひろばのベンチは 背もたれの反対を向く', () => {
    // makeBench は 背もたれを (sin(rot), cos(rot)) に置くので、すわる人は その逆
    for (const rot of [0, 0.6, -1.2, 2.5]) {
      const s = seatOfPlazaBench(0, 1, 2, rot);
      expect(s.dirX).toBeCloseTo(-Math.sin(rot), 10);
      expect(s.dirZ).toBeCloseTo(-Math.cos(rot), 10);
      expect(Math.hypot(s.dirX, s.dirZ)).toBeCloseTo(1, 10);
    }
  });

  it('ウッドベンチ(背もたれ +Z)と チェア(背もたれ -Z)は 正反対を向く', () => {
    const bench = seatOfFurniture(1, 'f_bench', 0, 0, 0)!;
    const chair = seatOfFurniture(2, 'f_chair', 0, 0, 0)!;
    expect(bench.dirZ).toBeCloseTo(-1, 10);
    expect(chair.dirZ).toBeCloseTo(1, 10);
  });

  it('家具を回すと 向く先も 同じだけ回る', () => {
    const r = Math.PI / 2;
    const chair = seatOfFurniture(2, 'f_chair', 0, 0, r)!;
    expect(chair.dirX).toBeCloseTo(Math.sin(r), 10);
    expect(chair.dirZ).toBeCloseTo(Math.cos(r), 10);
  });

  it('すわれない家具では 候補を作らない', () => {
    expect(isSeatFurniture('f_bench')).toBe(true);
    expect(isSeatFurniture('f_chair')).toBe(true);
    expect(isSeatFurniture('f_table')).toBe(false);
    expect(seatOfFurniture(3, 'f_table', 0, 0, 0)).toBeNull();
  });

  it('体の原点は すわる面より SIT_ROOT_BELOW_SEAT だけ下(地面の高さに追従する)', () => {
    const s = seatOfPlazaBench(0, 4, 5, 0);
    const p = sitPose(s, 1.2);
    expect(p.x).toBe(4);
    expect(p.z).toBe(5);
    expect(p.y).toBeCloseTo(1.2 + PLAZA_BENCH_SEAT_H - SIT_ROOT_BELOW_SEAT, 10);
    // 向く先は すわる向きの延長線上(PlayerController.face にそのまま渡せる)
    expect(p.faceZ).toBeLessThan(5); // rot=0 なら -Z を向く
  });

  it('いちばん近い席をえらぶ / とどかなければ null(境界も見る)', () => {
    const seats: Seat[] = [
      seatOfPlazaBench(0, 0, 0, 0),
      seatOfPlazaBench(1, 0.5, 0, 0),
    ];
    expect(nearestSeat(0.45, 0, seats)?.seat.id).toBe('sit_bench_1');
    expect(nearestSeat(0.1, 0, seats)?.seat.id).toBe('sit_bench_0');
    expect(nearestSeat(SIT_REACH + 0.01, 0, [seats[0]])).toBeNull();
    expect(nearestSeat(SIT_REACH - 0.01, 0, [seats[0]])?.distance).toBeCloseTo(SIT_REACH - 0.01, 6);
  });
});

describe('すわる候補が ほかの遊びを 奪わない', () => {
  it('会話・採取・ドア・庭・店・釣り より弱い(誘導も会話も 横取りしない)', () => {
    expect(PRIORITY.sit).toBeGreaterThan(PRIORITY.npcQuest);
    expect(PRIORITY.sit).toBeGreaterThan(PRIORITY.npc);
    expect(PRIORITY.sit).toBeGreaterThan(PRIORITY.gather);
    expect(PRIORITY.sit).toBeGreaterThan(PRIORITY.garden);
    expect(PRIORITY.sit).toBeGreaterThan(PRIORITY.door);
    expect(PRIORITY.sit).toBeGreaterThan(PRIORITY.shop);
    expect(PRIORITY.sit).toBeGreaterThan(PRIORITY.fishing);
  });

  it('家具の操作(もちかえる・いろをぬる・いれる/とりだす)より弱い', () => {
    // すわるは いつでも立てる・何も減らない操作なので、ほかにやることがあれば ゆずる。
    // 58 にしていたとき ベンチのよこの家具の「いろを ぬる」を奪い、combo.spec が落ちた
    expect(PRIORITY.sit).toBeGreaterThan(PRIORITY.furniture); // もちかえる 60
    expect(PRIORITY.sit).toBeGreaterThan(PRIORITY.furniture - 1); // いろを ぬる 59
    expect(PRIORITY.sit).toBeGreaterThan(PRIORITY.gather + 1); // すいそう・むしかご 31
    // それでも いちばん弱い予告(catchNear 70)よりは強い
    expect(PRIORITY.sit).toBeLessThan(PRIORITY.catchNear);
  });

  it("kind='place' なので、依頼の誘導中(guided)は そもそも出ない", () => {
    const cand = {
      id: 'sit_bench_0', kind: 'place' as const, priority: PRIORITY.sit,
      distance: 0.4, enabled: true, hint: '', run: () => {},
    };
    // 誘導中の代表的な文脈(採取・会話・ねる)には place が入らない
    for (const preferred of [['gather'], ['talk'], ['sleep'], ['gather', 'talk']] as const) {
      expect(
        matchesObjective(cand, { guided: true, preferredKinds: [...preferred] as never })
      ).toBe(false);
    }
  });

  it('すわる輪(1.0m)は でんごんばんの輪と重ならない', () => {
    for (const [bx, bz] of PLAZA_BENCHES) {
      const d = Math.hypot(bx - BULLETIN_BOARD.x, bz - BULLETIN_BOARD.z);
      expect(d).toBeGreaterThan(SIT_REACH + BULLETIN_REACH);
    }
  });

  it('すわる輪は 家具の判定圏(1.6m)より せまい', () => {
    // 置いた家具のそばでは もちかえる(60)が勝つので、すわれるのは
    // ほかの候補が1つも無い ひろばのベンチ。輪を せまくしてあるのは
    // 「ベンチの上に立ったときだけ」出すため(遠くから すわらせない)
    expect(SIT_REACH).toBeLessThan(1.6);
  });
});

describe('動かしたら立つ(入力の判定)', () => {
  const base = { up: false, down: false, left: false, right: false, run: false };
  it('キーボード: 移動キーを押していれば true', () => {
    expect(hasMoveInput(base)).toBe(false);
    expect(hasMoveInput({ ...base, up: true })).toBe(true);
    expect(hasMoveInput({ ...base, right: true })).toBe(true);
    expect(hasMoveInput({ ...base, run: true })).toBe(false); // Shiftだけでは立たない
  });
  it('タッチ: スティックを倒していれば true(遊びの内なら false)', () => {
    expect(hasMoveInput({ ...base, ax: 0, az: 0 })).toBe(false);
    expect(hasMoveInput({ ...base, ax: 0.4, az: 0 })).toBe(true);
    expect(hasMoveInput({ ...base, ax: 0, az: -0.5 })).toBe(true);
  });
});

describe('すわりカメラ', () => {
  it('引く側・低い側へ寄せる値になっている(範囲の内がわ)', () => {
    expect(SIT_ZOOM).toBeGreaterThan(1);
    expect(SIT_ZOOM).toBeLessThanOrEqual(ZOOM_MAX);
    expect(SIT_PITCH).toBeLessThan(1);
    expect(SIT_PITCH).toBeGreaterThanOrEqual(PITCH_MIN);
  });
  it('「ゆっくり」引く(2秒以上かける)', () => {
    expect(SIT_BLEND_SEC).toBeGreaterThanOrEqual(2);
  });
});

describe('配線(コードの形を固定する)', () => {
  const read = (p: string): string => readFileSync(p, 'utf8');

  it('ひろばのベンチの座標は data/island.ts の1か所だけ(見た目とすわる場所が ずれない)', () => {
    const island = read('src/scenes/IslandScene.ts');
    expect(island).toMatch(/for \(const \[bx, bz, rot\] of PLAZA_BENCHES\)/);
    expect(island).not.toMatch(/benchDefs/);
    expect(PLAZA_BENCHES.length).toBe(2);
  });

  it('すわっているあいだ E は「たつ」だけ(隠れ候補が動かない)', () => {
    const routing = read('src/scenes/InteractionRouting.ts');
    expect(routing).toMatch(/if \(gs\.player\.sitting\) \{[\s\S]*gs\.standUp\(\);[\s\S]*たつ/);
  });

  it('動かしたら立つ配線が GameScene にある', () => {
    expect(read('src/scenes/GameScene.ts')).toMatch(/this\.player\.sitting && !frozen && hasMoveInput\(this\.input\)/);
  });

  it('Xキーと タッチのボタンは 同じ InputRouter.emote() を通る', () => {
    expect(read('src/scenes/InputRouter.ts')).toMatch(/e\.code === 'KeyX'[\s\S]*this\.emote\(\)/);
    expect(read('src/scenes/GameScene.ts')).toMatch(/onEmote: \(\) => this\.inputRouter\.emote\(\)/);
  });

  it('エモートで なかよし度を動かしていない(演出だけのごほうび)', () => {
    const gs = read('src/scenes/GameScene.ts');
    const body = gs.slice(gs.indexOf('playEmote()'), gs.indexOf('// ---------- カメラ遮蔽'));
    expect(body).not.toMatch(/friendship/);
    expect(body).not.toMatch(/statAdd/);
    const npcs = read('src/systems/NPCSystem.ts');
    const reply = npcs.slice(npcs.indexOf('replyToEmote('), npcs.indexOf('/** 開花の見せ場'));
    expect(reply).not.toMatch(/friendship/);
  });
});

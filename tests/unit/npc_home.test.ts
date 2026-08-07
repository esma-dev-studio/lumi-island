// v12 島の3人の家に おじゃまする。
// 描画のないところで「在宅の導出・おみやげの決定論・3軒の間取り・ドア候補のガード」を固める。
import { describe, it, expect, beforeEach } from 'vitest';
import {
  NPCS, NPC_BY_ID, HOME_GIFT_CYCLE, HOME_GIFT_FRIENDSHIP,
  homeGiftFor, homeTalkLine, isHomeGiftDay, isHomeHour, scheduleEntryAt,
} from '../../src/data/npcs';
import {
  NPC_HOMES, NPC_HOME_ACT_R, NPC_HOME_BODY_R, NPC_HOME_BY_ID, NPC_HOME_DOOR_R, NPC_HOME_EDGE_IN,
  canStandInNpcHome, insideNpcHomeFloor, measureDoorStand, npcHomeAt, npcHomeDoorWorld,
  npcHomeFlag, npcHomeFloorY, npcHomeHostWorld, npcHomeShot, npcHomeSpawnWorld, npcHomeVisitStat,
} from '../../src/scenes/NpcInteriors';
import { HOME_ROOM } from '../../src/scenes/HomeInterior';
import { HOME_POINT, HOME_EXIT, SHOP_POINT } from '../../src/scenes/InteractionRouting';
import {
  BUG_SPOTS, BUILDINGS, DIG_SPOTS, ENTRANCES, GATHER_NODES, NPC_SPOTS, POIS, STAR_SPOTS,
} from '../../src/data/island';
import { COVE, insideCoveArea, terrainHeight, walkableGround } from '../../src/entities/terrain';
import { BUG_CATCH_R } from '../../src/systems/BugSystem';
import { QUESTS } from '../../src/data/quests';
import {
  ACHIEVEMENTS, HOME_VISIT_PREFIX, evaluate, isAchieved, npcHomeVisitCount,
} from '../../src/systems/AchievementSystem';
import { newGameState, statAdd } from '../../src/game/GameState';
import { save, load } from '../../src/save/SaveSystem';
import { isBoxedIn, findEscapePoint, PLAYER_R } from '../../src/systems/PlayerController';

/** 島の上でのE候補のとどく距離(それぞれの持ち主のコードから写した値) */
const GATHER_HINT_R = 1.9; // InteractionSystem.update の bestD
const DIG_R = 1.9; // IslandScene.nearestDig の既定
const SHOP_R = 2.0; // InteractionRouting の店カウンター
const DOOR_R = 2.0; // マイホームのドア
const NPC_NEAR_R = 1.8; // NPCSystem.nearest の既定 range
/** 虫の ただよう はば(BugSystem の hoverR のいちばん大きい値=ホタル) */
const BUG_HOVER_R = 0.6;

const dist = (a: { x: number; z: number }, b: { x: number; z: number }): number =>
  Math.hypot(a.x - b.x, a.z - b.z);

// ---------------------------------------------------------------------------
// 在宅の導出
// ---------------------------------------------------------------------------
describe('在宅の時間帯', () => {
  it('島の3人には家にいる時間帯があり、入り江のロカには無い', () => {
    for (const id of ['minamo', 'nokto', 'tsumugi']) {
      const def = NPC_BY_ID[id];
      const hours: number[] = [];
      for (let h = 0; h < 24; h += 0.5) if (isHomeHour(def, h)) hours.push(h);
      expect(hours.length, `${id} の在宅時間`).toBeGreaterThan(0);
    }
    const roka = NPC_BY_ID.roka;
    for (let h = 0; h < 24; h += 0.5) expect(isHomeHour(roka, h), `roka ${h}時`).toBe(false);
  });

  it('在宅の時間帯は スケジュールの activity==="home" とぴったり同じ(写経していない)', () => {
    for (const def of NPCS) {
      for (let h = 0; h < 24; h += 0.25) {
        expect(isHomeHour(def, h), `${def.id} ${h}時`).toBe(
          scheduleEntryAt(def.schedule, h).activity === 'home'
        );
      }
    }
  });

  it('3人の在宅時間は その人らしくちがう(いつ行けばよいかが 性格で決まる)', () => {
    // ミナモ: 20時〜翌6時。夕方まで池と桟橋で釣っている
    for (const h of [21, 23, 3, 5]) expect(isHomeHour(NPC_BY_ID.minamo, h), `minamo ${h}時`).toBe(true);
    for (const h of [8, 14, 19]) expect(isHomeHour(NPC_BY_ID.minamo, h), `minamo ${h}時`).toBe(false);
    // ノクト: 昼(6〜17時)と 明けがた(2〜6時)。夜ふかしのぶん 昼にねている
    for (const h of [8, 14, 16, 3]) expect(isHomeHour(NPC_BY_ID.nokto, h), `nokto ${h}時`).toBe(true);
    for (const h of [18, 21, 23, 0]) expect(isHomeHour(NPC_BY_ID.nokto, h), `nokto ${h}時`).toBe(false);
    // ツムギ: 21時〜翌6時。夜は少しだけ ルミの木のまわりを歩いてから帰る
    for (const h of [22, 3, 5]) expect(isHomeHour(NPC_BY_ID.tsumugi, h), `tsumugi ${h}時`).toBe(true);
    for (const h of [8, 14, 20]) expect(isHomeHour(NPC_BY_ID.tsumugi, h), `tsumugi ${h}時`).toBe(false);
    // 3軒とも るすなのは 夕方の17〜19時だけ(ノクトが林へ出て、ミナモは池、ツムギは
    // ルミの木のまわり——島がいちばん にぎやかな時間帯)。
    // るすの家は 朝6時〜深夜2時のあいだ かならずある(明けがた2〜6時だけは3軒とも在宅)。
    // この2つを固定しておくと、スケジュールを触ったときに
    // 「どこにも入れない時間帯が広がった」ことに気づける
    const allOut: number[] = [];
    for (let h = 0; h < 24; h++) {
      const at = ['minamo', 'nokto', 'tsumugi'].map((id) => isHomeHour(NPC_BY_ID[id], h));
      if (!at.some(Boolean)) allOut.push(h);
      if (h >= 6 || h < 2) expect(at.some((v) => !v), `${h}時に るすの家`).toBe(true);
    }
    expect(allOut).toEqual([17, 18, 19]);
  });

  it('依頼の受注・報告相手になっているあいだの枠(questEntry)は 家ではない', () => {
    // NPCSystem.resolveEntry は home の枠を questEntry に差しかえる。
    // つまり「依頼が動いているNPCの家は かならず るす」= 依頼の相手を家に閉じこめない
    for (const def of NPCS) {
      expect(def.questEntry.activity, `${def.id}`).not.toBe('home');
    }
  });
});

// ---------------------------------------------------------------------------
// 家の中の話 と おみやげ
// ---------------------------------------------------------------------------
describe('家の中の話', () => {
  it('島の3人は4本ずつ持っていて、ロカは持っていない', () => {
    for (const id of ['minamo', 'nokto', 'tsumugi']) {
      expect(NPC_BY_ID[id].homeLines?.length, id).toBe(4);
    }
    expect(NPC_BY_ID.roka.homeLines).toBeUndefined();
    expect(homeTalkLine(NPC_BY_ID.roka, 3)).toBeNull();
  });

  it('既存のあいさつ・ひとこと・家をほめることばと1文も重ならない', () => {
    const homeAll = NPCS.flatMap((d) => d.homeLines ?? []);
    expect(new Set(homeAll).size, '家の中の話どうしも重ならない').toBe(homeAll.length);
    const others = new Set(
      NPCS.flatMap((d) => [
        ...d.greetings.flat(),
        ...(d.dailyLines ?? []),
        ...d.visitPraise.base, ...d.visitPraise.display, ...d.visitPraise.many, ...d.visitPraise.bloom,
        ...d.giftLines.love, ...d.giftLines.like, ...d.giftLines.ok,
      ])
    );
    for (const line of homeAll) expect(others.has(line), line).toBe(false);
  });

  it('日づけで1本えらぶ(同じ日は同じ・4日で1周・負の日でも落ちない)', () => {
    const def = NPC_BY_ID.minamo;
    for (let day = 1; day <= 40; day++) {
      expect(homeTalkLine(def, day)).toBe(homeTalkLine(def, day));
      expect(homeTalkLine(def, day)).toBe(homeTalkLine(def, day + 4));
    }
    const seen = new Set([1, 2, 3, 4].map((d) => homeTalkLine(def, d)));
    expect(seen.size).toBe(4); // 4日で4本ぜんぶ出る
    expect(homeTalkLine(def, -3)).not.toBeNull();
    expect(homeTalkLine(def, NaN)).not.toBeNull();
  });
});

describe('家の おみやげ', () => {
  const houses = ['minamo', 'nokto', 'tsumugi'].map((id) => NPC_BY_ID[id]);

  it('3軒とも おみやげを持ち、くれる日はずれている', () => {
    const phases = houses.map((d) => d.homeGift!.phase);
    expect(new Set(phases).size).toBe(3);
    for (const p of phases) expect(p).toBeGreaterThanOrEqual(0);
    for (const p of phases) expect(p).toBeLessThan(HOME_GIFT_CYCLE);
    expect(NPC_BY_ID.roka.homeGift).toBeUndefined();
  });

  it('どの依頼の必要素材でもないものだけを くれる(依頼の近道を作らない)', () => {
    const questItems = new Set(QUESTS.map((q) => q.item).filter(Boolean));
    for (const d of houses) expect(questItems.has(d.homeGift!.item), d.id).toBe(false);
  });

  it('もらえる日は日づけだけで決まる(乱数を使わない=同じ日は何度でも同じ答え)', () => {
    for (let day = 1; day <= 60; day++) {
      const givers = houses.filter((d) => isHomeGiftDay(d, day));
      expect(givers.length, `${day}日め`).toBeLessThanOrEqual(1); // 1日に くれるのは多くて1軒
      for (const d of houses) expect(isHomeGiftDay(d, day)).toBe(isHomeGiftDay(d, day + HOME_GIFT_CYCLE));
    }
    // 4日のうち3日は だれかがくれる(phaseは0,1,2で、3は だれもくれない日)
    const days = [1, 2, 3, 4].filter((day) => houses.some((d) => isHomeGiftDay(d, day)));
    expect(days.length).toBe(3);
  });

  it('なかよし度3みまん・もらった日は もらえない', () => {
    const def = NPC_BY_ID.minamo;
    const giftDay = [1, 2, 3, 4].find((d) => isHomeGiftDay(def, d))!;
    expect(homeGiftFor(def, giftDay, HOME_GIFT_FRIENDSHIP - 1, undefined)).toBeNull();
    expect(homeGiftFor(def, giftDay, HOME_GIFT_FRIENDSHIP, undefined)).not.toBeNull();
    // 同じ日にもう一度おじゃましても もらえない
    expect(homeGiftFor(def, giftDay, 10, giftDay)).toBeNull();
    // 前の日にもらっていても、きょうが おみやげの日なら もらえる
    expect(homeGiftFor(def, giftDay, 10, giftDay - HOME_GIFT_CYCLE)).not.toBeNull();
    // おみやげの日でなければ もらえない
    const otherDay = [1, 2, 3, 4].find((d) => !isHomeGiftDay(def, d))!;
    expect(homeGiftFor(def, otherDay, 10, undefined)).toBeNull();
    // 壊れた値でも落ちない
    expect(homeGiftFor(def, giftDay, NaN, undefined)).toBeNull();
    expect(homeGiftFor(NPC_BY_ID.roka, giftDay, 10, undefined)).toBeNull();
  });

  it('おみやげの一言には {item} が入っていて、名前に置きかえられる', () => {
    for (const d of houses) expect(d.homeGift!.line).toContain('{item}');
  });
});

// ---------------------------------------------------------------------------
// 3軒の間取り
// ---------------------------------------------------------------------------
describe('NPCの家の間取り', () => {
  it('3軒あり、idは島にくらすNPCと1対1', () => {
    expect(NPC_HOMES.length).toBe(3);
    expect(NPC_HOMES.map((h) => h.id).sort()).toEqual(['minamo', 'nokto', 'tsumugi']);
    for (const h of NPC_HOMES) expect(NPC_BY_ID[h.id], h.id).toBeDefined();
  });

  it('セーブのロード時クランプ(±70)の内がわにある(カメラの引き先もふくむ)', () => {
    for (const h of NPC_HOMES) {
      const shot = npcHomeShot(h);
      const pts = [
        { x: h.x + h.dims.minX, z: h.z + h.dims.minZ },
        { x: h.x + h.dims.maxX, z: h.z + h.dims.maxZ },
        npcHomeDoorWorld(h), npcHomeSpawnWorld(h), npcHomeHostWorld(h),
        { x: shot.cx, z: shot.cz + shot.dist },
      ];
      for (const p of pts) {
        expect(Math.abs(p.x), `${h.id} x=${p.x}`).toBeLessThanOrEqual(70);
        expect(Math.abs(p.z), `${h.id} z=${p.z}`).toBeLessThanOrEqual(70);
      }
    }
  });

  it('島・よるの入り江・マイホームの部屋・たがいから じゅうぶん離れている', () => {
    for (const h of NPC_HOMES) {
      // 島(半径46m)の外
      expect(Math.hypot(h.x, h.z), h.id).toBeGreaterThan(46 + 8);
      // 入り江のはたらく範囲の外
      expect(insideCoveArea(h.x, h.z), h.id).toBe(false);
      expect(Math.hypot(h.x - COVE.x, h.z - COVE.z), h.id).toBeGreaterThan(20);
      // マイホームの部屋(いちばん広い12×9mの角まで見る)から離れている
      expect(Math.hypot(h.x - HOME_ROOM.x, h.z - HOME_ROOM.z), h.id).toBeGreaterThan(40);
      // たがいに離れている(自動脱出の探索半径3mが原理的にまたげない)
      for (const o of NPC_HOMES) {
        if (o.id === h.id) continue;
        expect(Math.hypot(h.x - o.x, h.z - o.z), `${h.id}-${o.id}`).toBeGreaterThan(40);
      }
    }
  });

  it('部屋のまわりは島の規則で「海の中」=歩けない(壁の外へ抜けられない)', () => {
    for (const h of NPC_HOMES) {
      for (let a = 0; a < 12; a++) {
        const th = (a / 12) * Math.PI * 2;
        const x = h.x + Math.cos(th) * 8;
        const z = h.z + Math.sin(th) * 8;
        expect(insideNpcHomeFloor(x, z), h.id).toBe(false);
        expect(terrainHeight(x, z), `${h.id} ${Math.round(x)},${Math.round(z)}`).toBeLessThan(0.33);
      }
    }
  });

  it('島の主要地点は「家の中」あつかいにならない(床の高さを横取りしない)', () => {
    const island = [
      POIS.plaza, POIS.playerHouse, POIS.pier, POIS.hill, POIS.beach, POIS.bed, POIS.shop,
      POIS.minamoHouse, POIS.noktoHouse, { x: HOME_ROOM.x, z: HOME_ROOM.z }, { x: COVE.x, z: COVE.z },
    ];
    for (const p of island) {
      expect(npcHomeFloorY(p.x, p.z), `${p.x},${p.z}`).toBeNull();
      expect(npcHomeAt(p.x, p.z), `${p.x},${p.z}`).toBeNull();
    }
  });

  it('ドアの前・入口・家主の立ち位置には ぜんぶ立てる', () => {
    for (const h of NPC_HOMES) {
      for (const [name, p] of [
        ['ドアの前', npcHomeDoorWorld(h)],
        ['入口', npcHomeSpawnWorld(h)],
        ['家主', npcHomeHostWorld(h)],
      ] as [string, { x: number; z: number }][]) {
        expect(canStandInNpcHome(h, p.x, p.z), `${h.id} の${name}`).toBe(true);
      }
    }
  });

  it('ドアのEの輪と 家主との会話の輪は重ならない(押した先が入れかわらない)', () => {
    for (const h of NPC_HOMES) {
      const d = dist(npcHomeDoorWorld(h), npcHomeHostWorld(h));
      expect(d, `${h.id}`).toBeGreaterThan(NPC_HOME_ACT_R + NPC_NEAR_R);
    }
  });

  it('入った瞬間は ドアも会話も反応しない(出戻らない・いきなり話しはじめない)', () => {
    for (const h of NPC_HOMES) {
      const sp = npcHomeSpawnWorld(h);
      expect(dist(sp, npcHomeDoorWorld(h)), `${h.id} 入口とドア`).toBeGreaterThan(NPC_HOME_ACT_R);
      expect(dist(sp, npcHomeHostWorld(h)), `${h.id} 入口と家主`).toBeGreaterThan(NPC_NEAR_R);
    }
  });

  it('立てる床はひとつながりで、入口からドアにも家主にも歩いて行ける', () => {
    for (const h of NPC_HOMES) {
      const step = 0.1;
      const key = (ix: number, iz: number): string => `${ix},${iz}`;
      const cells = new Map<string, { x: number; z: number }>();
      for (const p of gridPoints(h, step)) {
        if (canStandInNpcHome(h, p.x, p.z)) cells.set(key(Math.round(p.x / step), Math.round(p.z / step)), p);
      }
      expect(cells.size, h.id).toBeGreaterThan(400);
      const sp = npcHomeSpawnWorld(h);
      const start = key(Math.round(sp.x / step), Math.round(sp.z / step));
      expect(cells.has(start), `${h.id} 入口が立てるマス`).toBe(true);
      const seen = new Set([start]);
      const queue = [start];
      while (queue.length) {
        const [ix, iz] = queue.pop()!.split(',').map(Number);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const k = key(ix + dx, iz + dz);
          if (cells.has(k) && !seen.has(k)) {
            seen.add(k);
            queue.push(k);
          }
        }
      }
      expect(seen.size, `${h.id} 孤立した床`).toBe(cells.size);
      // ドアのEの輪・会話の輪の中に、立てるマスが実際にある
      const door = npcHomeDoorWorld(h);
      const host = npcHomeHostWorld(h);
      const reach = [...cells.values()];
      expect(reach.some((p) => dist(p, door) < NPC_HOME_ACT_R), `${h.id} ドアに近づける`).toBe(true);
      expect(reach.some((p) => dist(p, host) < NPC_NEAR_R), `${h.id} 家主に近づける`).toBe(true);
    }
  });

  it('部屋のどこにいても「四方ふさがり」にならず、自動脱出の行き先も部屋の中', () => {
    for (const h of NPC_HOMES) {
      const canStand = (x: number, z: number): boolean => canStandInNpcHome(h, x, z);
      for (const p of gridPoints(h, 0.15)) {
        if (!canStand(p.x, p.z)) continue;
        expect(isBoxedIn(p.x, p.z, canStand), `${h.id} ${p.x},${p.z}`).toBe(false);
      }
      // 家具の中・壁の外から脱出させても、行き先は部屋の中に収まる
      const stuck = [
        ...h.rects.map((r) => ({ x: h.x + r.x, z: h.z + r.z })),
        ...h.circles.map((c) => ({ x: h.x + c.x, z: h.z + c.z })),
        { x: h.x + h.dims.maxX - 0.05, z: h.z + h.dims.minZ + 0.05 },
      ];
      for (const s of stuck) {
        const p = findEscapePoint(s.x, s.z, canStand);
        expect(p, `${h.id} ${s.x},${s.z}`).not.toBeNull();
        expect(insideNpcHomeFloor(p!.x, p!.z), `${h.id} 脱出先`).toBe(true);
        expect(npcHomeAt(p!.x, p!.z)?.id, `${h.id} 脱出先の家`).toBe(h.id);
      }
    }
  });

  it('体の半径・壁ぎわの余白は PlayerController と そろっている', () => {
    expect(NPC_HOME_BODY_R).toBe(PLAYER_R);
    expect(NPC_HOME_EDGE_IN).toBeGreaterThan(PLAYER_R);
  });

  it('室内カメラは部屋の南(+Z)から床より上を見る', () => {
    for (const h of NPC_HOMES) {
      const shot = npcHomeShot(h);
      expect(shot.cy, h.id).toBe(h.floorY);
      expect(shot.dist, h.id).toBeGreaterThan(0);
      expect(shot.height, h.id).toBeGreaterThan(h.dims.wallH * 0.9);
    }
  });
});

// ---------------------------------------------------------------------------
// 島がわのドア候補のガード
// ---------------------------------------------------------------------------
describe('島がわのドア候補', () => {
  const doors = NPC_HOMES.map((h) => ({ id: h.id, ...h.outDoor }));

  it('ドアの前は歩ける地面(海や池のなかに ドアを置いていない)', () => {
    // ドアの点そのものが「立てる点」であることは要求しない。
    // 建物の当たり判定+体半径の内がわに入っていることがあるため(実測: ノクトの家がそう)で、
    // これは自宅のドア(HOME_POINT)とまったく同じ事情。教訓4「POIは目印であって立てる点とは限らない」。
    // 実際に立つ点は measureDoorStand が実測する(下のテスト)。
    for (const d of doors) {
      expect(walkableGround(d.x, d.z), `${d.id} のドア前`).toBe(true);
    }
  });

  it('外へ出たときに立つ点が見つかり、ドアのEの輪の中にある(出たら もう一度入れる)', () => {
    const pad = 0.125;
    const rects = BUILDINGS.map((b) => {
      const p = POIS[b.id];
      return { x: p.x, z: p.z, w: b.w + pad * 2, d: b.d + pad * 2, rot: p.rotY ?? 0 };
    });
    const canStand = (x: number, z: number): boolean => {
      if (!walkableGround(x, z)) return false;
      for (const r of rects) {
        const cos = Math.cos(-r.rot), sin = Math.sin(-r.rot);
        const lx = (x - r.x) * cos - (z - r.z) * sin;
        const lz = (x - r.x) * sin + (z - r.z) * cos;
        if (Math.abs(lx) < r.w / 2 + PLAYER_R && Math.abs(lz) < r.d / 2 + PLAYER_R) return false;
      }
      return true;
    };
    for (const h of NPC_HOMES) {
      const p = measureDoorStand(h, canStand);
      expect(canStand(p.x, p.z), `${h.id} の出口`).toBe(true);
      expect(dist(p, h.outDoor), `${h.id} の出口とドアの距離`).toBeLessThan(NPC_HOME_DOOR_R);
    }
  });

  it('ほかのE候補(採取・ほりあと・虫・店・自宅のドア)と 取り合いにならない', () => {
    for (const d of doors) {
      for (const n of GATHER_NODES) {
        expect(dist(d, n), `${d.id} と ${n.id}`).toBeGreaterThan(NPC_HOME_DOOR_R + GATHER_HINT_R);
      }
      for (const p of DIG_SPOTS) {
        expect(dist(d, p), `${d.id} と ほりあと(${p.x},${p.z})`).toBeGreaterThan(NPC_HOME_DOOR_R + DIG_R);
      }
      // 虫はドアの上に立ったときに捕獲圏へ入らない(ただよう はば BUG_HOVER_R もふくめる)
      for (const p of BUG_SPOTS) {
        expect(dist(d, p), `${d.id} と むし(${p.x},${p.z})`).toBeGreaterThan(BUG_CATCH_R + BUG_HOVER_R);
      }
      expect(dist(d, SHOP_POINT), `${d.id} と 店`).toBeGreaterThan(NPC_HOME_DOOR_R + SHOP_R);
      for (const p of [HOME_POINT, HOME_EXIT, POIS.bed]) {
        expect(dist(d, p), `${d.id} と 自宅のドア`).toBeGreaterThan(NPC_HOME_DOOR_R + DOOR_R);
      }
      for (const p of STAR_SPOTS) {
        expect(dist(d, p), `${d.id} と ほしのかけら`).toBeGreaterThan(NPC_HOME_DOOR_R + GATHER_HINT_R);
      }
      for (const o of doors) {
        if (o.id === d.id) continue;
        expect(dist(d, o), `${d.id} と ${o.id} のドア`).toBeGreaterThan(NPC_HOME_DOOR_R * 4);
      }
    }
  });

  it('NPCの立ち位置とも取り合わない(自分の家の「家にいる枠」の点だけは同じでよい)', () => {
    for (const d of doors) {
      for (const [npcId, spots] of Object.entries(NPC_SPOTS)) {
        for (const [key, p] of Object.entries(spots)) {
          // 自分の家の home スポット=ドアの前そのもの。
          // そこに立っているあいだは「まだ家に入っていない」ので、会話(優先度35)が
          // ドア(36)より強い=帰り道のところで まず話しかけられる、という設計
          if (key === 'home' && npcId === d.id) continue;
          // ツムギの「ルミの木のまわりを ぶらぶらする枠(stroll・半径4m)」だけは
          // 工房の うらぐちまで 3.6m ほどに近づくことがある。会話(35)がドア(36)より
          // 強いので、そのときは会話が勝つ(ドアが会話を横取りすることはない)
          if (key === 'lumi') continue;
          expect(dist(d, p), `${d.id} と ${npcId}.${key}`).toBeGreaterThan(NPC_HOME_DOOR_R + NPC_NEAR_R);
        }
      }
    }
  });

  it('家具でふさげない入口(ENTRANCES)に3軒ぶん入っている', () => {
    for (const d of doors) {
      expect(ENTRANCES.some((e) => dist(e, d) < 0.01), `${d.id} のドアが ENTRANCES にある`).toBe(true);
    }
    expect(ENTRANCES.length).toBe(5);
    expect(ENTRANCES[3]).toEqual({ x: -4.6, z: 0.6 }); // 店の入口の位置は変えない
  });
});

// ---------------------------------------------------------------------------
// セーブと じっせき
// ---------------------------------------------------------------------------
describe('セーブと じっせき', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as unknown as Storage;
  });

  it('家の中にいる印は1軒1キーのフラグで、名まえは重ならない', () => {
    const keys = NPC_HOMES.map((h) => npcHomeFlag(h.id));
    expect(new Set(keys).size).toBe(3);
    for (const k of keys) expect(k).toMatch(/^npchome_[a-z]+$/);
  });

  it('家の中で保存すると、読み直しても同じ家の中から始まる', () => {
    const s = newGameState();
    const h = NPC_HOME_BY_ID.nokto;
    const sp = npcHomeSpawnWorld(h);
    s.flags[npcHomeFlag('nokto')] = true;
    s.player = { x: sp.x, z: sp.z, rotY: 0 };
    expect(save(s)).toBe(true);
    const back = load()!;
    expect(back.flags[npcHomeFlag('nokto')]).toBe(true);
    // 位置がクランプで丸められていない(=部屋の中に復帰できる)
    expect(back.player.x).toBeCloseTo(sp.x, 5);
    expect(back.player.z).toBeCloseTo(sp.z, 5);
    expect(canStandInNpcHome(h, back.player.x, back.player.z)).toBe(true);
  });

  it('おみやげをもらった日は 保存・読み直しでも残る(壊れた値は捨てる)', () => {
    const s = newGameState();
    s.npcs.minamo.homeGiftedDay = 12;
    s.npcs.nokto.homeGiftedDay = -1 as number; // 壊れた値
    save(s);
    const back = load()!;
    expect(back.npcs.minamo.homeGiftedDay).toBe(12);
    expect(back.npcs.nokto.homeGiftedDay).toBeUndefined();
  });

  it('項目の無い旧セーブは「まだ もらっていない」あつかいで読める', () => {
    store.set('lumi_save', JSON.stringify({ npcs: { minamo: { friendship: 4, talkedToday: false } } }));
    const back = load()!;
    expect(back.npcs.minamo.friendship).toBe(4);
    expect(back.npcs.minamo.homeGiftedDay).toBeUndefined();
    expect(back.flags[npcHomeFlag('minamo')]).toBeUndefined(); // 島から始まる
  });

  it('じっせきは「はじめて おじゃました」と「みんなの おうち」の2つ', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(ids).toContain('a_home_visit1');
    expect(ids).toContain('a_home_visit3');
    expect(ids[ids.length - 1]).toBe('a_all_quests'); // いちばん最後は変えない
    const s = newGameState();
    evaluate(s);
    expect(isAchieved(s, 'a_home_visit1')).toBe(false);
    statAdd(s, npcHomeVisitStat('minamo'));
    evaluate(s);
    expect(isAchieved(s, 'a_home_visit1')).toBe(true);
    expect(isAchieved(s, 'a_home_visit3')).toBe(false);
    statAdd(s, npcHomeVisitStat('nokto'));
    statAdd(s, npcHomeVisitStat('tsumugi'));
    expect(npcHomeVisitCount(s)).toBe(3);
    evaluate(s);
    expect(isAchieved(s, 'a_home_visit3')).toBe(true);
  });

  it('じっせきのキーは 家の側と同じ接頭辞を使い、セーブの検証も通る', () => {
    for (const h of NPC_HOMES) {
      const key = npcHomeVisitStat(h.id);
      expect(key.startsWith(HOME_VISIT_PREFIX)).toBe(true);
      expect(key).toMatch(/^[A-Za-z0-9_]{1,40}$/); // SaveSystem の STAT_KEY_RE
    }
    const s = newGameState();
    statAdd(s, npcHomeVisitStat('tsumugi'));
    save(s);
    expect(npcHomeVisitCount(load()!)).toBe(1);
  });
});

/** 部屋の内側を格子状に走査する */
function* gridPoints(
  h: (typeof NPC_HOMES)[number],
  step: number
): Generator<{ x: number; z: number }> {
  for (let x = h.x + h.dims.minX; x <= h.x + h.dims.maxX + 1e-9; x += step) {
    for (let z = h.z + h.dims.minZ; z <= h.z + h.dims.maxZ + 1e-9; z += step) {
      yield { x: Math.round(x * 1e6) / 1e6, z: Math.round(z * 1e6) / 1e6 };
    }
  }
}

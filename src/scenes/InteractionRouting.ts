// E入力のルーティング: その場で実行できる候補を集め、
// いまの目的との突き合わせ(ObjectiveInteractionPolicy)→優先度・距離(InteractionResolver)で1つに決める。
import { BULLETIN_BOARD, PLAZA_BENCHES, POIS } from '../data/island';
import {
  SIT_REACH, nearestSeat, seatOfFurniture, seatOfPlazaBench, type Seat,
} from '../systems/SitSystem';
import { ITEMS, displayCapacity } from '../data/items';
import { BULLETIN_REACH } from '../systems/BulletinSystem';
import { BUG_CATCH_R, BUG_HINT_R } from '../systems/BugSystem';
import { hasTool } from '../game/GameState';
import { questFor } from '../systems/QuestSystem';
import { GATHER_RULES, toolReason } from '../systems/GatherSystem';
import { PRIORITY, type InteractionCandidate } from '../systems/InteractionResolver';
import { COVE_LIGHTHOUSE_POI, objectiveActionContext } from '../systems/ObjectiveSystem';
import { selectInteraction } from '../systems/ObjectiveInteractionPolicy';
import { canPlant, nearestPlot, stageOf } from '../systems/GardenSystem';
import {
  FESTIVAL_FLY_HINT, FESTIVAL_FLY_POINT, FESTIVAL_FLY_REACH, FESTIVAL_PLAZA,
  FESTIVAL_STAND_REACH, FESTIVAL_TAKE_HINT, canFlyLantern, canTakeLantern, hasLantern, isFestivalTime,
} from '../systems/FestivalSystem';
import type { PlacedRuntime } from '../systems/PlacementSystem';
import { HOME_DOOR, HOME_BED, HOME_ACT_R } from './HomeInterior';
import {
  NPC_HOMES, NPC_HOME_ACT_R, NPC_HOME_BY_ID, NPC_HOME_DOOR_R, npcHomeDoorWorld,
} from './NpcInteriors';
import {
  BOAT_ACT_R, COVE_ACT_R, COVE_DOOR, COVE_RETURN, ISLAND_BOAT_POINT,
  boatPrompt, canBoardReturn, lighthousePrompt,
} from './CoveArea';
import { STATION_BENCH, STATION_POINT, canBoardStation } from '../entities/station';
import {
  MARKET_BENCH, MARKET_SHOP_POINT, MARKET_SHOP_R, MARKET_TRAIN_POINT, canBoardMarketTrain,
} from '../entities/marketTerrain';
import { MARKET_RIDE_HINT, isTrainAtStation, stationPrompt } from '../systems/TrainRideSystem';
import { isStationBuilt } from '../systems/StationBuild';
import type { GameScene } from './GameScene';

export const SHOP_POINT = { x: POIS.shop.x + 4.6, z: POIS.shop.z }; // 店カウンター(工房の正面)
/** ミオの家のドア前。ここでEを押すと室内へ入る(ねるのは室内のベッド) */
export const HOME_POINT = { x: -30.9, z: 6.7 };
/**
 * 家から出たときに立つ場所。ドア前(HOME_POINT)そのものは家のコライダー+体半径の内側で
 * 「立てない・四方ふさがり」の点なので、そこへ出すと壁にめりこんだ状態から始まってしまう
 * (実測: canStand=false / isBoxedIn=true)。1mだけ島がわへずらした、実際に立てる点へ出す。
 * HOME_POINTから1.0mなので「<kbd>E</kbd>家に はいる」のヒント(2.0m)はそのまま出る。
 */
export const HOME_EXIT = { x: -29.9, z: 6.7 };

/**
 * v10 展示家具(すいそう・むしかご)のE候補。中身が無ければ「いれる」(選択パネル)、
 * 入っていれば「とりだす」。もちかえるはパネルの中に入口を用意してある。
 *
 * 優先度は採取(30)のすぐ下=31。「自分で置いた家具に わざわざ近づいた」ので、
 * たまたま近くにある虫(32)・ほりあと(33)・ドア(35)・雑談(35)より強くする。
 * ——実測で「かごのそばに ほりあとが出た日は ずっと『ほるには シャベルが ひつよう』が出て
 * かごが使えない」ことが起きた(道具が無いと ほりあとも消せないので自力で直せない)。
 * 採取ノードには最初から重ねて置けない(PlacementSystem.checkPlacement)ので、
 * 採取(30)より弱いままでも「見えているのに使えない」は起きない。
 *
 * kind は既存の 'pickup'(家具まわりの操作)を使う。ObjectiveSystem の preferredKinds には
 * pickup が入らないので、依頼の誘導中(guided)は自動で隠れる=依頼の進行を横取りしない。
 */
function displayCandidate(gs: GameScene, near: PlacedRuntime, px: number, pz: number): InteractionCandidate | null {
  const kind = gs.placement.displayKindOf(near);
  if (kind === null) return null;
  const contents = gs.placement.contentsOf(near);
  const cap = displayCapacity(kind);
  // 1匹だけ入る すいそう・むしかご(v10からのふるまい): 入っていれば Eで そのまま とりだす。
  // たくさん入る おおきい版: Eは いつでもパネルを開く(1匹ずつ 入れる/とりだす をその場でくり返せる)。
  const takeNow = cap === 1 && contents.length > 0;
  const hint = takeNow
    ? `<kbd>E</kbd>${ITEMS[contents[0]].name}を とりだす`
    : contents.length >= cap
      ? '<kbd>E</kbd>いきものを とりだす'
      : '<kbd>E</kbd>いきものを いれる';
  return {
    id: `disp_${near.data.id}`,
    kind: 'pickup',
    targetId: String(near.data.id),
    itemId: near.data.item,
    priority: PRIORITY.gather + 1,
    distance: Math.hypot(px - near.data.x, pz - near.data.z),
    enabled: true,
    hint,
    run: () => {
      if (takeNow) gs.placement.takeOut(near);
      else gs.openDisplay(near);
    },
  };
}

/**
 * v12 いろみずで「いろを ぬる」E候補。
 *
 * 出る条件は「いろみずを1つでも持っている」ことだけ。持っていない子には
 * これまでどおり「◯◯を もちかえる」が出る=既存の遊びは1ミリも変わらない。
 *
 * 優先度は もちかえる(60)より1つだけ強い59。ぬれるのは「わざわざ家具に近づいた」ときだけなので、
 * 採取・会話・ドアなど ほかの候補を横取りすることはない。
 * もちかえる が消えてしまわないよう、PaintUI のパネルの中に「もちかえる」を置いてある
 * (すいそう・むしかご(DisplayUI)と まったく同じ考え方)。
 *
 * kind は 'pickup'。ObjectiveSystem の preferredKinds に pickup は入らないので、
 * 依頼の誘導中(guided)は自動で隠れる。
 */
function paintCandidate(gs: GameScene, near: PlacedRuntime, px: number, pz: number): InteractionCandidate | null {
  if (!gs.placement.canPaint()) return null;
  if (gs.placement.displayKindOf(near) !== null) return null; // 展示家具は「いれる/とりだす」が主役
  return {
    id: `paint_${near.data.id}`,
    kind: 'pickup',
    targetId: String(near.data.id),
    itemId: near.data.item,
    priority: PRIORITY.furniture - 1,
    distance: Math.hypot(px - near.data.x, pz - near.data.z),
    enabled: true,
    hint: '<kbd>E</kbd>いろを ぬる',
    run: () => gs.openPaint(near),
  };
}

/**
 * v18 「すわる」のE候補。
 *
 * すわれるのは ひろばのベンチ2つ(島にある)と、自分で置いた ウッドベンチ・チェア。
 * 判定は SIT_REACH(1.0m)と せまくしてある——家具の「もちかえる」の輪(1.6m)の
 * 内がわだけを取るので、1歩さがれば これまでどおり もちかえれる。
 *
 * kind は 'place'。ObjectiveSystem の preferredKinds に 'place' は入らないので、
 * **依頼の誘導中は 自動的に かくれる**(でんごんばん・庭の花だん・るすの家と同じ流儀)。
 * = すわる候補が 会話や採取の E を 奪うことは 構造的に起きない。
 */
function pushSitCandidates(
  gs: GameScene, cands: InteractionCandidate[], px: number, pz: number
): void {
  const seats: Seat[] = [];
  // ひろばのベンチは島の上だけ(室内・よその家・入り江・いちば島には無い)
  if (!gs.indoor && !gs.inCove && !gs.inMarket && gs.npcHome === null) {
    for (let i = 0; i < PLAZA_BENCHES.length; i++) {
      const [bx, bz, rot] = PLAZA_BENCHES[i];
      if (Math.hypot(px - bx, pz - bz) < SIT_REACH) seats.push(seatOfPlazaBench(i, bx, bz, rot));
    }
    // v20 よるの えきの ホームのベンチ(えきが できてから)。
    // ならぶ番号は ひろばのベンチの つづきにして、id が かぶらないようにする
    if (isStationBuilt(gs.state)) {
      const [sx, sz, srot] = STATION_BENCH;
      if (Math.hypot(px - sx, pz - sz) < SIT_REACH) {
        seats.push(seatOfPlazaBench(PLAZA_BENCHES.length, sx, sz, srot));
      }
    }
  }
  // v20 いちば島の 見はらしの丘のベンチ
  if (gs.inMarket) {
    const [mx, mz, mrot] = MARKET_BENCH;
    if (Math.hypot(px - mx, pz - mz) < SIT_REACH) {
      seats.push(seatOfPlazaBench(PLAZA_BENCHES.length + 1, mx, mz, mrot));
    }
  }
  // 自分で置いた家具(よその家の中では配置そのものができないので、ここには出ない)
  if (gs.npcHome === null) {
    const near = gs.placement.nearest(px, pz);
    if (near) {
      const s = seatOfFurniture(near.data.id, near.data.item, near.data.x, near.data.z, near.data.rotY);
      if (s) seats.push(s);
    }
  }
  const best = nearestSeat(px, pz, seats);
  if (!best) return;
  cands.push({
    id: best.seat.id,
    kind: 'place',
    targetId: best.seat.id,
    priority: PRIORITY.sit,
    distance: best.distance,
    enabled: true,
    hint: `<kbd>E</kbd>${best.seat.label}に すわる`,
    run: () => gs.sitDown(best.seat),
  });
}

/**
 * 採取ノードのE候補(島でも入り江でもまったく同じ規則)。
 * 道具が足りないときは「表示だけの理由」も足す(押しても何も起きない)。
 */
function pushGatherCandidates(gs: GameScene, cands: InteractionCandidate[], px: number, pz: number): void {
  if (!gs.inter.currentNode || !gs.inter.hint) return;
  const n = gs.inter.currentNode;
  const nodeItem = GATHER_RULES[n.def.kind].item; // このノードから採れる素材(目的との一致判定に使う)
  cands.push({
    id: `node_${n.def.id}`,
    kind: 'gather',
    targetId: n.def.id,
    itemId: nodeItem,
    priority: PRIORITY.gather,
    distance: Math.hypot(px - n.def.x, pz - n.def.z),
    enabled: gs.inter.hint.ok,
    hint: gs.inter.hint.text,
    run: () => void gs.inter.tryGather(gs.player, gs.playerView),
  });
  if (!gs.inter.hint.ok) {
    // 道具不足の理由も候補として表示だけする(実行不可)
    cands.push({
      id: `node_reason`, kind: 'gather', targetId: n.def.id, itemId: nodeItem,
      priority: PRIORITY.gather + 5,
      distance: Math.hypot(px - n.def.x, pz - n.def.z),
      enabled: true, hint: gs.inter.hint.text, run: () => {},
    });
  }
}

/**
 * いちばん近いNPCとの会話候補(島でも入り江でもまったく同じ規則)。
 *
 * 受注できる/報告できるときだけ最優先。進行中(話しても進まない)は採取より下げる。
 * ※これを最優先のままにすると、鉱石のそばに立つノクトが採取のEを毎回横取りして
 *   依頼が進まない(実測399秒の主因)。
 */
function pushNpcCandidate(gs: GameScene, cands: InteractionCandidate[], px: number, pz: number): void {
  const npc = gs.npcs.nearest(px, pz);
  if (!npc) return;
  const rt = npc as unknown as { def: { id: string; name: string }; x: number; z: number };
  const q = questFor(gs.state, rt.def.id);
  const actionable = q !== null && (q.mode === 'offer' || q.mode === 'done');
  // v10 朝の来訪中(依頼が1つも動いていない日にしか起きない)は「家をほめる」会話にする。
  // ヒントの文言はふつうの会話と同じ「◯◯と はなす」のまま
  // (押す前から中身を分ける必要はなく、意味カテゴリの表も増やさずに済む)
  const visiting = q === null && gs.npcs.isVisiting(rt.def.id, gs.island.time.day, gs.island.time.hour);
  cands.push({
    id: `npc_${rt.def.id}`,
    kind: 'talk',
    targetId: rt.def.id,
    questActionable: actionable,
    priority: actionable ? PRIORITY.npcQuest : PRIORITY.gather + 5,
    distance: Math.hypot(px - rt.x, pz - rt.z),
    enabled: true,
    hint: `<kbd>E</kbd>${rt.def.name}と はなす`,
    run: () => (visiting ? gs.startVisitTalk(rt.def.id) : gs.questDlg.talkTo(rt.def.id)),
  });
}

/**
 * v16 ほしまつりのE候補2つ(まつりの時間だけ 出る)。
 *
 *   ランタンの台   … <kbd>E</kbd>ほしランタンを もらう(無料・1回の まつりにつき1こ)
 *   桟橋の先       … <kbd>E</kbd>ランタンを とばす(見せ場がはじまる)
 *
 * どちらも kind='place' にしてある。ObjectiveSystem の preferredKinds に 'place' は
 * ふつう入らないので、**依頼の誘導中は 自動的に かくれる**——まつりは 依頼の じゃまを
 * 1ミリも しない、という設計を 構造で保証する(でんごんばん・庭の花だん・るすの家と同じ流儀)。
 *
 * 優先度:
 *   台     = 自宅のドアと同じ35。会話(35)とは 距離で決まるので、輪(半径1.7m)の上に立てば
 *            会話が、台のそば(1.2m)まで入れば 台が出る = 「話しかけられない」は起きない。
 *   とばす = 34(ドアより1つだけ強い)。桟橋の先は 釣り場(50)でもあるので、
 *            ランタンを持っているあいだだけ こちらを勝たせる。ふだんの よるの桟橋の釣りは
 *            候補そのものが 出ないので 1ミリも 変わらない。
 */
function pushFestivalCandidates(
  gs: GameScene, cands: InteractionCandidate[], px: number, pz: number
): void {
  const day = gs.island.time.day;
  const hour = gs.island.time.hour;
  if (!isFestivalTime(day, hour)) return;
  const standD = Math.hypot(px - FESTIVAL_PLAZA.x, pz - FESTIVAL_PLAZA.z);
  if (standD < FESTIVAL_STAND_REACH) {
    const canTake = canTakeLantern(gs.state, day, hour);
    const holding = hasLantern(gs.state, day);
    cands.push({
      id: canTake ? 'festival_take' : 'festival_stand',
      kind: 'place',
      targetId: 'festival_stand',
      priority: PRIORITY.door,
      distance: standD,
      enabled: true,
      hint: canTake
        ? FESTIVAL_TAKE_HINT
        : holding
          ? 'さんばしの先で とばしてみよう'
          : 'また つぎの ほしまつりでね',
      run: () => {
        if (canTake) gs.takeFestivalLantern();
      },
    });
  }
  if (!canFlyLantern(gs.state, day, hour)) return;
  const flyD = Math.hypot(px - FESTIVAL_FLY_POINT.x, pz - FESTIVAL_FLY_POINT.z);
  if (flyD >= FESTIVAL_FLY_REACH) return;
  cands.push({
    id: 'festival_fly',
    kind: 'place',
    targetId: 'festival_fly',
    priority: PRIORITY.door - 1,
    distance: flyD,
    enabled: true,
    hint: FESTIVAL_FLY_HINT,
    run: () => gs.flyFestivalLantern(),
  });
}

// 戻り値はホットヒント(1行)。E押下(gs.wantInteract)はここで消費する。
export function routeInteraction(gs: GameScene, uiOpen: boolean): string {
  const want = gs.wantInteract;
  gs.wantInteract = false;
  // v15 朝の「きょうの島」カードは Eで早送りできるが、Eを食べない(returnしない)。
  // 3秒で勝手に消える お知らせなので、ここで return すると
  // 「カードが出ているあいだに押したEが1回きかない」という取りこぼしになる
  // ——押した操作は そのまま通し、ついでにカードを閉じる、が いちばん おどろきが少ない。
  if (gs.todayCardUI.open && want) gs.todayCardUI.hide();
  if (gs.questComplete.open && want) {
    gs.questComplete.hide();
    return '';
  }
  if (gs.seq.active) {
    if (want) gs.seq.skip(); // intro/bloomは早送り可。就寝はスキップ不可
    return '';
  }
  if (gs.dialogue.open) {
    if (want) gs.dialogue.advance();
    return '';
  }
  if (uiOpen) return '';
  // v18 すわっているあいだは「たつ」しか出さない。
  // ほかの候補を出さないので「表示=Eで動くもの」が1つに保たれる(隠れ候補が動かない)。
  if (gs.player.sitting) {
    if (want) gs.standUp();
    return '<kbd>E</kbd>たつ';
  }
  if (gs.placement.active) {
    if (want) gs.placement.place();
    return gs.placement.hint;
  }
  // クールダウン中は動けるので通常の候補解決へ流す(canFishがfalseなので再釣り候補は出ない)
  if (gs.fishing.locksPlayer) {
    if (want) gs.fishing.action(gs.player, gs.playerView);
    return gs.fishing.hint ?? '';
  }
  if (gs.inter.busy) return '';

  const cands: InteractionCandidate[] = [];
  const px = gs.player.x, pz = gs.player.z;

  // ---- 室内(マイホーム)にいるときは、ベッド・ドアと、室内に置いた家具の持ち帰りだけ ----
  // 島の候補(NPC・採取・店・釣り)はどれも80m以上はなれていて距離条件に入らないが、
  // 「室内では室内のことだけ」を構造で保証するために早く返す。
  if (gs.indoor) {
    const bedD = Math.hypot(px - HOME_BED.x, pz - HOME_BED.z);
    if (bedD < HOME_ACT_R) {
      cands.push({
        id: 'sleep', kind: 'sleep', targetId: 'bed',
        priority: PRIORITY.door, distance: bedD, enabled: true,
        hint: '<kbd>E</kbd>ねる(あさまで)',
        run: () => gs.seq.sleep(),
      });
    }
    const doorD = Math.hypot(px - HOME_DOOR.x, pz - HOME_DOOR.z);
    if (doorD < HOME_ACT_R) {
      cands.push({
        id: 'exit_home', kind: 'exit', targetId: 'home',
        priority: PRIORITY.door, distance: doorD, enabled: true,
        hint: '<kbd>E</kbd>そとへ でる',
        run: () => gs.seq.leaveHome(),
      });
    }
    // 室内に置いた家具の持ち帰り。ドア・ベッドより優先度が低い(PRIORITY.furniture=60 > door=35)ので、
    // 判定圏に重ねて置けないルール(HomeInterior.checkHomePlacement)と合わせて、
    // 「そとへ でる」「ねる」が家具に横取りされることはない。
    // 誘導中(ベッドで待つ等)は preferredKinds に pickup が入っていないので、そもそも出ない
    pushSitCandidates(gs, cands, px, pz); // v18 室内に置いた ベンチ・いすにも すわれる
    const inNear = gs.placement.nearest(px, pz);
    if (inNear) {
      const disp = displayCandidate(gs, inNear, px, pz);
      if (disp) cands.push(disp);
      const inPaint = paintCandidate(gs, inNear, px, pz);
      if (inPaint) cands.push(inPaint);
      cands.push({
        id: `furn_${inNear.data.id}`, kind: 'pickup',
        targetId: String(inNear.data.id), itemId: inNear.data.item,
        priority: PRIORITY.furniture,
        distance: Math.hypot(px - inNear.data.x, pz - inNear.data.z), enabled: true,
        hint: `<kbd>E</kbd>${ITEMS[inNear.data.item].name}を もちかえる`,
        run: () => gs.placement.pickUp(inNear),
      });
    }
    const inBest = selectInteraction(cands, objectiveActionContext(gs.lastObjective));
    if (!inBest) return '';
    if (want) inBest.run();
    return inBest.hint;
  }

  // ---- v12 NPCの家の中にいるときは、その家のことだけ ----
  // 島の候補(採取・店・釣り・自宅)はどれも60m以上はなれていて距離条件に入らないが、
  // 「よその家では、家主と話すことと 外へ出ることだけ」を構造で保証するために早く返す。
  // 家具の持ち帰り・配置はここには無い(よその家の物には手を出さない)。
  if (gs.npcHome) {
    const def = NPC_HOME_BY_ID[gs.npcHome];
    if (def) {
      const door = npcHomeDoorWorld(def);
      const doorD = Math.hypot(px - door.x, pz - door.z);
      if (doorD < NPC_HOME_ACT_R) {
        cands.push({
          id: 'exit_npc_home', kind: 'exit', targetId: def.id,
          priority: PRIORITY.door, distance: doorD, enabled: true,
          hint: '<kbd>E</kbd>そとへ でる',
          run: () => gs.seq.leaveNpcHome(),
        });
      }
      // 家主との会話。ドアのEの輪(1.4m)と 会話の輪(1.8m)は 3.2m以上はなれた
      // 立ち位置に置いてあるので、どちらか一方しか射程に入らない
      // (tests/unit/npc_home.test.ts が機械検査する)
      const host = gs.npcs.nearest(px, pz);
      if (host) {
        const rt = host as unknown as { def: { id: string; name: string }; x: number; z: number };
        cands.push({
          id: `npc_${rt.def.id}`, kind: 'talk', targetId: rt.def.id,
          priority: PRIORITY.gather + 5,
          distance: Math.hypot(px - rt.x, pz - rt.z), enabled: true,
          hint: `<kbd>E</kbd>${rt.def.name}と はなす`,
          run: () => gs.startHomeTalk(rt.def.id),
        });
      }
    }
    const homeBest = selectInteraction(cands, objectiveActionContext(gs.lastObjective));
    if (!homeBest) return '';
    if (want) homeBest.run();
    return homeBest.hint;
  }

  // ---- v11 よるの入り江にいるときは、入り江のことだけ ----
  // 島の候補(NPC・採取・店・釣り・自宅)はどれも80m以上はなれていて距離条件に入らないが、
  // 「入り江では入り江のことだけ」を構造で保証するために早く返す。
  //
  // 候補の絞りこみは島とまったく同じ規則(objectiveActionContext)にしてある。
  // v11第2章で入り江の中にも目的(ひかりの貝・ほしくさ・ロカ・灯台)ができたので、
  // 島だけ厳格で入り江だけ自由、という二重の規則を持たないようにするため。
  //
  // 「入り江まで来たのに何も採れない」は起きない: 目的が島にあるあいだは
  // ObjectiveSystem.withAreaTravel が「ふねで しまへ もどろう」に差しかえ、
  // その段階は guided:false(自由探索)なので、寄り道の採取はこれまでどおり全部出る。
  // 帰りの桟橋は ALWAYS_ALLOWED の 'exit' なので、どの段階でも必ず押せる。
  if (gs.inCove) {
    pushGatherCandidates(gs, cands, px, pz);
    // 入り江の住人(ロカ)との会話。島の候補づくりとまったく同じ規則にする
    // ——ここを忘れると「目の前に立っているのに話しかけられない」になる(実機で発生した)。
    // NPCSystem.nearest は場所ちがいのNPCを返さないので、島の3人がここに出てくることはない
    pushNpcCandidate(gs, cands, px, pz);
    // 帰りの桟橋: ふねで島へ帰る。
    // のれる場所は canBoardReturn(CoveArea.ts)が1か所で決める——
    // 「桟橋のデッキの上なら どこでも」+「デッキの外の水ぎわ(2.6mの輪)」。
    // v18.1 まで輪だけだったせいで、**ふねを降りたその場所**(COVE_SPAWN)が
    // 輪の外=無言になり、入り江から出られない進行不能バグになっていた
    // (理由と実測は CoveArea.ts の canBoardReturn のコメント)。
    // kind='exit' は ObjectiveSystem の ALWAYS_ALLOWED なので、どの誘導中でも隠れない
    // ——島へ帰る唯一の手段なので、ここを絞ると第2章のとちゅうで詰む。
    const backD = Math.hypot(px - COVE_RETURN.x, pz - COVE_RETURN.z);
    if (canBoardReturn(px, pz)) {
      cands.push({
        id: 'cove_return', kind: 'exit', targetId: 'cove',
        priority: PRIORITY.door, distance: backD, enabled: true,
        hint: '<kbd>E</kbd>ふねで しまへ かえる',
        run: () => gs.seq.sail('island'),
      });
    }
    // こわれた灯台のとびら。
    // ふだんは「しまっている」の表示だけ。第2章の最後の依頼(q2_light)を引き受けていて
    // ひかりのレンズを持っているときだけ、Eで点灯の見せ場がはじまる。
    // kind='place' は ObjectiveSystem の preferredKinds に ふつうは入らない種類なので、
    // 入り江で素材をあつめている最中に この案内が誘導を横取りすることはない
    // (レンズを つける段階だけ、objectiveActionContext が 'place' を通す)。
    const doorD = Math.hypot(px - COVE_DOOR.x, pz - COVE_DOOR.z);
    if (doorD < COVE_ACT_R) {
      const flags = gs.state.flags ?? {};
      const quests = gs.state.quests ?? {};
      const inv = (gs.state.inventory ?? {}) as Partial<Record<string, number>>;
      const onQuest = quests.q2_light === 'open' && flags.q2_light_accepted === true;
      const prompt = lighthousePrompt(flags.lighthouse_lit === true, onQuest, (inv.lens ?? 0) > 0);
      cands.push({
        id: prompt.attach ? 'cove_lighthouse_attach' : 'cove_lighthouse',
        kind: 'place', targetId: COVE_LIGHTHOUSE_POI,
        priority: PRIORITY.door + 2, distance: doorD, enabled: true,
        hint: prompt.hint,
        run: () => {
          if (prompt.attach) gs.attachLighthouseLens();
        },
      });
    }
    // v21 帰りの桟橋の 先での 釣り(よるの入り江の ぬし「ヨルノヌシ」の釣り場)。
    //
    // 島の釣り場と まったく同じ候補づくり。**ふねの のりばより かならず 弱い**
    // (釣り=50 / のりば=door 35)ので、のりばに 重なるところでは 島へ帰るほうが 勝つ
    // = 入り江から 出られなくなる、は 構造的に 起きない。
    // どこが釣り場かは FishingCast.fishingGate(帰りの桟橋の 先がわだけ)が1か所で決める。
    const coveFish = gs.fishing.canFish(px, pz);
    if (coveFish.zone) {
      cands.push({
        id: 'fishing', kind: 'fish', targetId: coveFish.zone,
        priority: PRIORITY.fishing, distance: 1.0, enabled: coveFish.ok,
        hint: coveFish.ok ? '<kbd>E</kbd>つりをする' : `つりには ${coveFish.reason}`,
        run: () => gs.fishing.start(gs.player, gs.playerView),
      });
    }
    const coveBest = selectInteraction(cands, objectiveActionContext(gs.lastObjective));
    if (!coveBest) return '';
    if (want) coveBest.run();
    return coveBest.hint;
  }

  // ---- v20第3章 いちば島にいるときは、いちば島のことだけ ----
  // 入り江のブロックと まったく同じ組み立て(候補の絞りこみも 同じ規則)。
  // いちば島には 採取ノードが1つも無いので、あるのは
  //   テンとの会話 / テンの店 / すわる / かえりの でんしゃ の4つだけ。
  if (gs.inMarket) {
    pushNpcCandidate(gs, cands, px, pz);
    pushSitCandidates(gs, cands, px, pz);
    // かえりの でんしゃ。**いつでも のれる**(時間の しばりは 行きだけ)。
    // のれる場所は canBoardMarketTrain(marketTerrain.ts)が1か所で決める——
    // 「ホームの板の上なら どこでも」+「のりしろの輪」。
    // kind='exit' は ObjectiveSystem の ALWAYS_ALLOWED なので どの誘導中でも隠れない
    // ——島へ帰る唯一の手段なので、ここを絞ると 第3章のとちゅうで詰む。
    if (canBoardMarketTrain(px, pz)) {
      cands.push({
        id: 'market_return', kind: 'exit', targetId: 'market',
        priority: PRIORITY.door,
        distance: Math.hypot(px - MARKET_TRAIN_POINT.x, pz - MARKET_TRAIN_POINT.z),
        enabled: true,
        hint: MARKET_RIDE_HINT,
        run: () => gs.seq.rideTrain('island'),
      });
    }
    // テンの店(週がわり)。ツムギ工房と同じ kind='shop' なので、
    // 依頼の誘導中(guided)は 自動で隠れる=買いものが 進行を横取りしない
    const shopD = Math.hypot(px - MARKET_SHOP_POINT.x, pz - MARKET_SHOP_POINT.z);
    if (shopD < MARKET_SHOP_R) {
      cands.push({
        id: 'market_shop', kind: 'shop', targetId: 'market_shop',
        priority: PRIORITY.shop, distance: shopD, enabled: true,
        hint: '<kbd>E</kbd>テンの店を みる(しゅうがわり)',
        run: () => gs.marketUI.show(),
      });
    }
    const marketBest = selectInteraction(cands, objectiveActionContext(gs.lastObjective));
    if (!marketBest) return '';
    if (want) marketBest.run();
    return marketBest.hint;
  }

  // NPC(島の3人)
  pushNpcCandidate(gs, cands, px, pz);
  // 採取ノード
  pushGatherCandidates(gs, cands, px, pz);
  // v9 虫(虫あみが要る)。捕まえられるのは BugSystem の BUG_CATCH_R(2.6m)の内がわ。
  //
  // v11: 虫あみを持っているのに とどかないときは、BUG_HINT_R(5m)から
  // 「むしが いる! ちかづいて つかまえよう」を先に出す。
  // ——v9は捕獲圏に入らないとヒントが出ず、しかも走って近づくと捕獲圏の手前で
  //   逃げられたので、「Eで捕れる」ことを知る手がかりが1度も画面に出なかった
  //   (子どもが「ぜんぜんつかまえられない」と言った直接の原因のひとつ)。
  // 予告ヒントは PRIORITY.catchNear(いちばん弱い)なので、採取・釣り・店・家具など
  // ほかにやることがある場面では出ない。
  const bug = gs.island.nearestBug(px, pz, BUG_HINT_R);
  if (bug) {
    const hasNet = hasTool(gs.state, 'net');
    const inRange = bug.distance < BUG_CATCH_R;
    if (inRange) {
      cands.push({
        id: `bug_${bug.bug.key}`, kind: 'catch', targetId: String(bug.bug.key), itemId: bug.bug.bug,
        priority: PRIORITY.catch, distance: bug.distance, enabled: hasNet,
        hint: hasNet ? '<kbd>E</kbd>むしあみでつかまえる' : `つかまえるには ${toolReason('net')}`,
        run: () => void gs.inter.tryCatchBug(gs.player, gs.playerView, bug.bug, bug.x, bug.z),
      });
      if (!hasNet) {
        // 道具不足の理由も候補として表示だけする(実行不可)。採取ノードと同じ流儀
        cands.push({
          id: 'bug_reason', kind: 'catch', targetId: String(bug.bug.key), itemId: bug.bug.bug,
          priority: PRIORITY.catch + 5, distance: bug.distance, enabled: true,
          hint: `つかまえるには ${toolReason('net')}`, run: () => {},
        });
      }
    } else if (hasNet) {
      // まだ とどかない。表示だけの予告(押しても何も起きない=採取ノードの理由表示と同じ流儀)。
      // <kbd>E</kbd>を入れないのは、タッチでキー表示が消えても文がそのまま読めるようにするため
      cands.push({
        id: 'bug_near', kind: 'catch', targetId: String(bug.bug.key), itemId: bug.bug.bug,
        priority: PRIORITY.catchNear, distance: bug.distance, enabled: true,
        hint: 'むしが いる! ちかづいて つかまえよう', run: () => {},
      });
    }
  }
  // v9 ほりあと(シャベルが要る)。
  // v11.1: kind='dig' は ObjectiveSystem の ALWAYS_ALLOWED に入ったので、依頼の誘導中でも出る。
  // ほりあとは日付が変わると別の場所へ移ってしまう「その日かぎり」のものなので、
  // 依頼のあいだ ずっと ほれないと取り逃しになる(理由は ObjectiveSystem のコメント)。
  // 優先度 dig=33 は 採取(30)・庭(29)・報告相手のNPC(10)より弱いままなので誘導は横取りしない。
  const dig = gs.island.nearestDig(px, pz);
  if (dig) {
    const hasShovel = hasTool(gs.state, 'shovel');
    cands.push({
      id: `dig_${dig.spot}`, kind: 'dig', targetId: String(dig.spot),
      priority: PRIORITY.dig, distance: dig.distance, enabled: hasShovel,
      hint: hasShovel ? '<kbd>E</kbd>ほる' : `ほるには ${toolReason('shovel')}`,
      run: () => void gs.inter.tryDig(gs.player, gs.playerView, dig.spot, dig.x, dig.z),
    });
    if (!hasShovel) {
      cands.push({
        id: 'dig_reason', kind: 'dig', targetId: String(dig.spot),
        priority: PRIORITY.dig + 5, distance: dig.distance, enabled: true,
        hint: `ほるには ${toolReason('shovel')}`, run: () => {},
      });
    }
  }
  // 店
  const shopD = Math.hypot(px - SHOP_POINT.x, pz - SHOP_POINT.z);
  if (shopD < 2.0) {
    cands.push({
      id: 'shop', kind: 'shop', targetId: 'shop',
      priority: PRIORITY.shop, distance: shopD, enabled: true,
      hint: '<kbd>E</kbd>お店をみる(うる・かう)',
      run: () => gs.shopUI.show(),
    });
  }
  // 釣り場
  const fish = gs.fishing.canFish(px, pz);
  if (fish.zone) {
    cands.push({
      id: 'fishing', kind: 'fish', targetId: fish.zone,
      priority: PRIORITY.fishing, distance: 1.0, enabled: fish.ok,
      hint: fish.ok ? '<kbd>E</kbd>つりをする' : `つりには ${fish.reason}`,
      run: () => gs.fishing.start(gs.player, gs.playerView),
    });
    if (!fish.ok) {
      cands.push({
        id: 'fishing_reason', kind: 'fish', targetId: fish.zone,
        priority: PRIORITY.fishing + 5, distance: 1.0, enabled: true,
        hint: `つりには ${fish.reason}`, run: () => {},
      });
    }
  }
  // v11 ミナモの桟橋のよこの小舟。
  //   boat_repaired が立っていない(=いまのプレイヤー全員)ときは、表示だけの候補。
  //   採取ノードの「道具がない理由」とまったく同じ流儀で、押しても何も起きない。
  //   kind='place' は誘導中(guided)の preferredKinds に決して入らないので、
  //   依頼のとちゅうで桟橋を通っても案内が横取りされることはない。
  //   立ち位置は釣り場のはじまり(z>45.5)から3.9mはなしてあるので、釣りとも競合しない。
  const boatD = Math.hypot(px - ISLAND_BOAT_POINT.x, pz - ISLAND_BOAT_POINT.z);
  if (boatD < BOAT_ACT_R) {
    const prompt = boatPrompt(gs.state.flags.boat_repaired === true);
    cands.push({
      id: prompt.ride ? 'boat_ride' : 'boat_broken',
      kind: prompt.ride ? 'enter' : 'place',
      targetId: prompt.ride ? 'cove' : 'boat',
      priority: prompt.ride ? PRIORITY.door : PRIORITY.door + 2,
      distance: boatD,
      enabled: true,
      hint: prompt.hint,
      run: () => {
        if (prompt.ride) gs.seq.sail('cove');
      },
    });
  }
  // v20第3章 さんばしのよこの「よるの えき」。
  //   えきが できていない あいだは 候補そのものを 作らない(ホームが 存在しない)。
  //   でんしゃが 来ている夜だけ kind='enter' で のれる。それ以外は **いつ来るかを言う**
  //   表示だけの候補(しゅうりちゅうの船・るすの家と まったく同じ流儀)。
  //   のれる場所は canBoardStation(entities/station.ts)が1か所で決める。
  if (isStationBuilt(gs.state) && canBoardStation(px, pz)) {
    const here = isTrainAtStation(gs.state, gs.island.time.day, gs.island.time.hour);
    const prompt = stationPrompt(gs.island.time.day, gs.island.time.hour, true);
    cands.push({
      id: prompt.ride ? 'station_ride' : 'station_wait',
      kind: prompt.ride ? 'enter' : 'place',
      targetId: prompt.ride ? 'market' : 'station',
      priority: prompt.ride ? PRIORITY.door : PRIORITY.door + 2,
      distance: Math.hypot(px - STATION_POINT.x, pz - STATION_POINT.z),
      enabled: true,
      hint: prompt.hint,
      run: () => {
        if (prompt.ride && here) gs.seq.rideTrain('market');
      },
    });
  }
  // v12 島の3人の家のドア: 住人が在宅のときだけ おじゃまできる。
  //
  //   在宅  : <kbd>E</kbd>おじゃまする(kind='enter'。自宅の出入りと同じ「常時許可」なので、
  //           どの目的の最中でも押せる=家に入って会う道すじを ふさがない)
  //   るす  : 「るすみたい。また こよう」の表示だけ(kind='place' なので、依頼の誘導中は
  //           自動で隠れる。押しても何も起きない=灯台のとびら・しゅうりちゅうの船と同じ流儀)
  //
  // 優先度はどちらも自宅のドア(35)より弱くしてある。会話(35)と同じ点に立つことがある
  // ——ミナモとノクトの「家にいる時間帯の立ち位置」はドアの前そのもの——ので、
  // 弱くしておくと「家に帰るところを見かけたら まず話しかけられる」が保たれる。
  //
  // Eのとどく距離(NPC_HOME_DOOR_R=1.5m)は、まわりの採取ノード・ほりあと・虫・店の
  // 判定圏と重ならない値。根拠と実測値は tests/unit/npc_home.test.ts にある。
  for (const home of NPC_HOMES) {
    const d = Math.hypot(px - home.outDoor.x, pz - home.outDoor.z);
    if (d >= NPC_HOME_DOOR_R) continue;
    const atHome = gs.npcs.isAtHome(home.id, gs.island.time.hour);
    cands.push(
      atHome
        ? {
            id: `enter_home_${home.id}`, kind: 'enter', targetId: home.id,
            priority: PRIORITY.door + 1, distance: d, enabled: true,
            hint: '<kbd>E</kbd>おじゃまする',
            run: () => gs.seq.enterNpcHome(home.id),
          }
        : {
            id: `away_home_${home.id}`, kind: 'place', targetId: home.id,
            priority: PRIORITY.door + 2, distance: d, enabled: true,
            hint: 'るすみたい。また こよう',
            run: () => {},
          }
    );
  }
  // v16 ほしまつり(まつりの時間だけ)。ランタンの台と 桟橋の先
  pushFestivalCandidates(gs, cands, px, pz);
  // v15 広場の でんごんばん(きょうの おてつだいを 読む)。
  //
  // kind='place' にしてある。ObjectiveSystem の preferredKinds に 'place' は
  // ふつう入らないので、依頼の誘導中は 自動的に かくれる
  // ——おてつだいは 依頼の じゃまを 1ミリも しない、という設計を 構造で保証する
  // (庭の花だん・るすの家・こわれた ふね と まったく同じ流儀)。
  //
  // 優先度は自宅のドア(35)と同じ。ちかくを 通りかかった人(会話も35)とは
  // 距離で決まるので、板の真ん前に立てば 板が、人の真ん前に立てば 会話が出る。
  const boardD = Math.hypot(px - BULLETIN_BOARD.x, pz - BULLETIN_BOARD.z);
  if (boardD < BULLETIN_REACH) {
    cands.push({
      id: 'bulletin', kind: 'place', targetId: 'bulletin',
      priority: PRIORITY.door, distance: boardD, enabled: true,
      hint: '<kbd>E</kbd>でんごんばんを 見る',
      run: () => gs.bulletinUI.show(),
    });
  }
  // 自宅のドア: 家の中へ入る(ねるのは室内のベッド)
  const homeD = Math.hypot(px - HOME_POINT.x, pz - HOME_POINT.z);
  if (homeD < 2.0) {
    cands.push({
      id: 'enter_home', kind: 'enter', targetId: 'home',
      priority: PRIORITY.door, distance: homeD, enabled: true,
      hint: '<kbd>E</kbd>家に はいる',
      run: () => gs.seq.enterHome(),
    });
  }
  // v10 庭の花だん(自宅のお庭)。
  //   空き    : のばなを1つ うえる(持っていなければ理由だけ出す)
  //   芽/つぼみ: まだ つみとれない理由を出す(押しても何も起きない表示専用)
  //   満開    : つみとる(のばな×2)
  // 「うえる」「まだ育っていない」は kind='place' にしてある。ObjectiveSystem の
  // preferredKinds に 'place' は決して入らないので、依頼の誘導中は自動的に隠れる
  // (虫あみ・シャベルと同じ考え方)。つみとりだけは kind='gather'/itemId='flower' なので、
  // 「のばなを あつめよう」の誘導中に出てよい(実際にのばなが2つ手に入る)。
  const plot = nearestPlot(px, pz);
  if (plot) {
    const stage = stageOf(gs.state.garden, plot.slot, gs.island.time.day);
    if (stage === 'empty') {
      const ok = canPlant(gs.state);
      cands.push({
        id: `garden_plant_${plot.slot}`, kind: 'place', targetId: `plot${plot.slot}`,
        priority: PRIORITY.garden, distance: plot.distance, enabled: true,
        hint: ok ? '<kbd>E</kbd>はなを うえる' : `うえるには ${ITEMS.flower.name}が ひつよう`,
        run: () => {
          if (ok) gs.plantGardenFlower(plot.slot);
        },
      });
    } else if (stage === 'bloom') {
      cands.push({
        id: `garden_pick_${plot.slot}`, kind: 'gather', targetId: `plot${plot.slot}`, itemId: 'flower',
        priority: PRIORITY.garden, distance: plot.distance, enabled: true,
        hint: '<kbd>E</kbd>つみとる',
        run: () => gs.harvestGardenPlot(plot.slot),
      });
    } else {
      cands.push({
        id: `garden_wait_${plot.slot}`, kind: 'place', targetId: `plot${plot.slot}`,
        priority: PRIORITY.garden, distance: plot.distance, enabled: true,
        hint: 'つみとるには もうすこし まってから', run: () => {},
      });
    }
  }
  // v18 すわる(ひろばのベンチ・置いた ベンチ/いす)
  pushSitCandidates(gs, cands, px, pz);
  // 設置家具の持ち帰り(展示家具なら「いれる/とりだす」を先に出す)
  const near = gs.placement.nearest(px, pz);
  if (near) {
    const disp = displayCandidate(gs, near, px, pz);
    if (disp) cands.push(disp);
    const paint = paintCandidate(gs, near, px, pz);
    if (paint) cands.push(paint);
    cands.push({
      id: `furn_${near.data.id}`, kind: 'pickup',
      targetId: String(near.data.id), itemId: near.data.item,
      priority: PRIORITY.furniture,
      distance: Math.hypot(px - near.data.x, pz - near.data.z), enabled: true,
      hint: `<kbd>E</kbd>${ITEMS[near.data.item].name}を もちかえる`,
      run: () => gs.placement.pickUp(near),
    });
  }
  // いまの目的(前フレームに確定したもの)と突き合わせて、表示=実行の1つに絞る
  const best = selectInteraction(cands, objectiveActionContext(gs.lastObjective));
  if (!best) return '';
  if (want) best.run();
  return best.hint;
}

// E入力のルーティング: その場で実行できる候補を集め、
// いまの目的との突き合わせ(ObjectiveInteractionPolicy)→優先度・距離(InteractionResolver)で1つに決める。
import { POIS } from '../data/island';
import { ITEMS } from '../data/items';
import { hasTool } from '../game/GameState';
import { questFor } from '../systems/QuestSystem';
import { GATHER_RULES, toolReason } from '../systems/GatherSystem';
import { PRIORITY, type InteractionCandidate } from '../systems/InteractionResolver';
import { objectiveActionContext } from '../systems/ObjectiveSystem';
import { selectInteraction } from '../systems/ObjectiveInteractionPolicy';
import { canPlant, nearestPlot, stageOf } from '../systems/GardenSystem';
import type { PlacedRuntime } from '../systems/PlacementSystem';
import { HOME_DOOR, HOME_BED, HOME_ACT_R } from './HomeInterior';
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
  const content = near.data.content;
  return {
    id: `disp_${near.data.id}`,
    kind: 'pickup',
    targetId: String(near.data.id),
    itemId: near.data.item,
    priority: PRIORITY.gather + 1,
    distance: Math.hypot(px - near.data.x, pz - near.data.z),
    enabled: true,
    hint: content
      ? `<kbd>E</kbd>${ITEMS[content].name}を とりだす`
      : '<kbd>E</kbd>いきものを いれる',
    run: () => {
      if (content) gs.placement.takeOut(near);
      else gs.openDisplay(near);
    },
  };
}

// 戻り値はホットヒント(1行)。E押下(gs.wantInteract)はここで消費する。
export function routeInteraction(gs: GameScene, uiOpen: boolean): string {
  const want = gs.wantInteract;
  gs.wantInteract = false;
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
    const inNear = gs.placement.nearest(px, pz);
    if (inNear) {
      const disp = displayCandidate(gs, inNear, px, pz);
      if (disp) cands.push(disp);
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

  // NPC: 受注できる/報告できるときだけ最優先。進行中(話しても進まない)は採取より下げる。
  // ※これを最優先のままにすると、鉱石のそばに立つノクトが採取のEを毎回横取りして
  //   依頼が進まない(実測399秒の主因)
  const npc = gs.npcs.nearest(px, pz);
  if (npc) {
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
  // 採取ノード
  if (gs.inter.currentNode && gs.inter.hint) {
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
  // v9 虫(虫あみが要る)。判定はBugSystemのBUG_CATCH_R(1.6m)。
  // 走って近づくと逃げるので、そもそも候補にならない = ヒントも出ない
  const bug = gs.island.nearestBug(px, pz);
  if (bug) {
    const hasNet = hasTool(gs.state, 'net');
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
  }
  // v9 ほりあと(シャベルが要る)
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
  // 設置家具の持ち帰り(展示家具なら「いれる/とりだす」を先に出す)
  const near = gs.placement.nearest(px, pz);
  if (near) {
    const disp = displayCandidate(gs, near, px, pz);
    if (disp) cands.push(disp);
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

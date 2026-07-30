// E入力のルーティング: その場で実行できる候補を集め、優先度と距離の解決はInteractionResolverが担う
import { POIS } from '../data/island';
import { ITEMS } from '../data/items';
import { questFor } from '../systems/QuestSystem';
import { resolveCandidate, PRIORITY, type InteractionCandidate } from '../systems/InteractionResolver';
import type { GameScene } from './GameScene';

export const SHOP_POINT = { x: POIS.shop.x + 4.6, z: POIS.shop.z }; // 店カウンター(工房の正面)
export const SLEEP_POINT = { x: -30.9, z: 6.7 }; // ミオの家のドア前

// 戻り値はホットヒント(1行)。E押下(gs.wantInteract)はここで消費する。
export function routeInteraction(gs: GameScene, uiOpen: boolean): string {
  const want = gs.wantInteract;
  gs.wantInteract = false;
  if (gs.questComplete.open && want) {
    gs.questComplete.hide();
    return '';
  }
  if (gs.seq.active) {
    if (want) gs.seq.end();
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
  if (gs.fishing.state !== 'idle') {
    if (want) gs.fishing.action(gs.player, gs.playerView);
    return gs.fishing.hint ?? '';
  }
  if (gs.inter.busy) return '';

  const cands: InteractionCandidate[] = [];
  const px = gs.player.x, pz = gs.player.z;
  // NPC(依頼が進むNPCは優先度を上げる)
  const npc = gs.npcs.nearest(px, pz);
  if (npc) {
    const rt = npc as unknown as { def: { id: string; name: string }; x: number; z: number };
    const hasQuest = questFor(gs.state, rt.def.id) !== null;
    cands.push({
      id: `npc_${rt.def.id}`,
      priority: hasQuest ? PRIORITY.npcQuest : PRIORITY.npc,
      distance: Math.hypot(px - rt.x, pz - rt.z),
      enabled: true,
      hint: `<kbd>E</kbd>${rt.def.name}と はなす`,
      run: () => gs.questDlg.talkTo(rt.def.id),
    });
  }
  // 採取ノード
  if (gs.inter.currentNode && gs.inter.hint) {
    const n = gs.inter.currentNode;
    cands.push({
      id: `node_${n.def.id}`,
      priority: PRIORITY.gather,
      distance: Math.hypot(px - n.def.x, pz - n.def.z),
      enabled: gs.inter.hint.ok,
      hint: gs.inter.hint.text,
      run: () => void gs.inter.tryGather(gs.player, gs.playerView),
    });
    if (!gs.inter.hint.ok) {
      // 道具不足の理由も候補として表示だけする(実行不可)
      cands.push({
        id: `node_reason`, priority: PRIORITY.gather + 5,
        distance: Math.hypot(px - n.def.x, pz - n.def.z),
        enabled: true, hint: gs.inter.hint.text, run: () => {},
      });
    }
  }
  // 店
  const shopD = Math.hypot(px - SHOP_POINT.x, pz - SHOP_POINT.z);
  if (shopD < 2.0) {
    cands.push({
      id: 'shop', priority: PRIORITY.shop, distance: shopD, enabled: true,
      hint: '<kbd>E</kbd>お店をみる(うる・かう)',
      run: () => gs.shopUI.show(),
    });
  }
  // 釣り場
  const fish = gs.fishing.canFish(px, pz);
  if (fish.zone) {
    cands.push({
      id: 'fishing', priority: PRIORITY.fishing, distance: 1.0, enabled: fish.ok,
      hint: fish.ok ? '<kbd>E</kbd>つりをする' : `つりには ${fish.reason}`,
      run: () => gs.fishing.start(gs.player, gs.playerView),
    });
    if (!fish.ok) {
      cands.push({ id: 'fishing_reason', priority: PRIORITY.fishing + 5, distance: 1.0, enabled: true, hint: `つりには ${fish.reason}`, run: () => {} });
    }
  }
  // ねる(自宅のドア)
  const sleepD = Math.hypot(px - SLEEP_POINT.x, pz - SLEEP_POINT.z);
  if (sleepD < 2.0) {
    cands.push({
      id: 'sleep', priority: PRIORITY.shop, distance: sleepD, enabled: true,
      hint: '<kbd>E</kbd>ねる(あさまで)',
      run: () => gs.seq.sleep(),
    });
  }
  // 設置家具の持ち帰り
  const near = gs.placement.nearest(px, pz);
  if (near) {
    cands.push({
      id: `furn_${near.data.id}`, priority: PRIORITY.furniture,
      distance: Math.hypot(px - near.data.x, pz - near.data.z), enabled: true,
      hint: `<kbd>E</kbd>${ITEMS[near.data.item].name}を もちかえる`,
      run: () => gs.placement.pickUp(near),
    });
  }
  const best = resolveCandidate(cands);
  if (!best) return '';
  if (want) best.run();
  return best.hint;
}

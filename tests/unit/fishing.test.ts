// @vitest-environment jsdom
// 釣りの状態機械(v5 P0-2): 巻き上げ演出が終わるまで次の釣りを始めさせない
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import { FishingSystem } from '../../src/systems/FishingSystem';
import { newGameState, giveTool, invCount } from '../../src/game/GameState';
import type { PlayerController } from '../../src/systems/PlayerController';
import type { CharacterView } from '../../src/characters/CharacterView';

const PIER = { x: 4, z: 47.5 }; // 桟橋の先(e2e・回帰ボットと同じ釣り場)
const CAST = 0.25; // debug時の着水まで
const WAIT = 1.0; // debug時の当たりまで
const REEL = 1.1; // fish_reelの長さ

/** アニメグループのスタブ(長さだけ分かればよい) */
const anim = (len: number): AnimationGroup => ({ getLength: () => len }) as unknown as AnimationGroup;

function setup(debug = true) {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const state = newGameState();
  giveTool(state, 'rod');
  const fishing = new FishingSystem(scene, state, debug);
  const player = { x: PIER.x, z: PIER.z, locked: false, face: () => {} };
  const hand = new TransformNode('handR', scene);
  const played: string[] = [];
  const ends: (() => void)[] = []; // アニメ終了コールバック(登録順)
  const view = {
    groups: new Map<string, AnimationGroup>([
      ['idle', anim(1)], ['happy', anim(1)], ['surprised', anim(1)],
      ['fish_idle', anim(3.2)], ['fish_cast', anim(1.1)], ['fish_reel', anim(REEL)],
    ]),
    getJoint: (n: string) => (n === 'handR' ? hand : null),
    play: (name: string, opts?: { onEnd?: () => void }) => {
      played.push(name);
      if (opts?.onEnd) ends.push(opts.onEnd);
    },
  };
  const p = player as unknown as PlayerController;
  const v = view as unknown as CharacterView;
  /** dtを刻んで時間を進める(0.125秒は2進数で誤差なく足し込める) */
  const advance = (seconds: number, dt = 0.125): void => {
    const steps = Math.round(seconds / dt);
    for (let i = 0; i < steps; i++) fishing.update(dt, p, v);
  };
  /** 投げ→着水→当たりまで進めて bite にする */
  const toBite = (): void => {
    fishing.start(p, v);
    advance(CAST + WAIT + 0.125);
  };
  /** 最後に登録されたアニメ終了コールバックを呼ぶ(演出完了の相当) */
  const finishAnim = (): void => ends[ends.length - 1]?.();
  const bobberOn = (): boolean => scene.getMeshByName('bobber')?.isEnabled(false) ?? false;
  const rodOn = (): boolean => scene.getMeshByName('rodProp')?.isEnabled(false) ?? false;
  const lineExists = (): boolean => scene.getMeshByName('fline') !== null;
  return { fishing, state, player, view: v, p, advance, toBite, finishAnim, ends, played, bobberOn, rodOn, lineExists };
}

describe('釣りの状態機械', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="ui-root"></div>';
  });

  it('投げ(casting)→着水(waiting)→当たり(bite)と進む', () => {
    const { fishing, advance, p, view, bobberOn, lineExists } = setup();
    expect(fishing.state).toBe('idle');
    fishing.start(p, view);
    expect(fishing.state).toBe('casting');
    expect(p.locked).toBe(true);
    expect(bobberOn()).toBe(false); // 着水するまでウキも糸も出さない
    expect(lineExists()).toBe(false);
    advance(0.125);
    expect(fishing.state).toBe('casting');
    advance(0.25);
    expect(fishing.state).toBe('waiting'); // 着水
    expect(bobberOn()).toBe(true);
    advance(WAIT);
    expect(fishing.state).toBe('bite');
  });

  it('キャッチでreelingになり、魚は1匹だけ増える', () => {
    const { fishing, state, toBite, p, view } = setup();
    toBite();
    fishing.action(p, view);
    expect(fishing.state).toBe('reeling');
    expect(invCount(state, 'fish')).toBe(1);
  });

  it('reeling中はplayer.lockedがtrueのまま', () => {
    const { fishing, toBite, advance, p, view } = setup();
    toBite();
    fishing.action(p, view);
    expect(p.locked).toBe(true);
    advance(0.5); // 演出の途中
    expect(fishing.state).toBe('reeling');
    expect(p.locked).toBe(true);
  });

  it('reeling中にstart()を呼んでも2回目は始まらない', () => {
    const { fishing, state, toBite, advance, p, view } = setup();
    toBite();
    fishing.action(p, view);
    for (let i = 0; i < 3; i++) fishing.start(p, view); // E連打相当
    expect(fishing.state).toBe('reeling');
    expect(fishing.canFish(p.x, p.z).ok).toBe(false);
    advance(0.25);
    expect(fishing.state).toBe('reeling'); // waitingに戻らない
    expect(invCount(state, 'fish')).toBe(1);
  });

  it('reeling中のE連打(action)でも魚は増えない', () => {
    const { fishing, state, toBite, p, view } = setup();
    toBite();
    fishing.action(p, view);
    for (let i = 0; i < 5; i++) fishing.action(p, view);
    expect(invCount(state, 'fish')).toBe(1);
    expect(fishing.state).toBe('reeling');
  });

  it('アニメ完了(onEnd)でcooldownへ移り、そこで初めて片付けとlocked解除が起きる', () => {
    const { fishing, toBite, finishAnim, p, view, bobberOn, rodOn, lineExists } = setup();
    toBite();
    fishing.action(p, view);
    expect(rodOn()).toBe(true);
    expect(lineExists()).toBe(true);
    finishAnim(); // fish_reelの終了
    expect(fishing.state).toBe('cooldown');
    expect(p.locked).toBe(false);
    expect(bobberOn()).toBe(false);
    expect(rodOn()).toBe(false);
    expect(lineExists()).toBe(false);
  });

  it('onEndが来なくてもdt進行でcooldownへ抜ける(安全網)', () => {
    const { fishing, toBite, advance, p, view } = setup();
    toBite();
    fishing.action(p, view);
    advance(REEL + 0.25); // onEndを呼ばずにアニメ長を超えて進める
    expect(fishing.state).toBe('cooldown');
    expect(p.locked).toBe(false);
  });

  it('cooldown中はcanFishがok:false、時間経過でidleに戻る', () => {
    const { fishing, toBite, finishAnim, advance, p, view } = setup();
    toBite();
    fishing.action(p, view);
    finishAnim();
    expect(fishing.canFish(p.x, p.z).ok).toBe(false);
    advance(1.0);
    expect(fishing.state).toBe('cooldown'); // まだ明けない
    expect(fishing.canFish(p.x, p.z).ok).toBe(false);
    advance(0.375); // 合計1.375秒 > 1.2秒
    expect(fishing.state).toBe('idle');
    expect(fishing.canFish(p.x, p.z).ok).toBe(true);
  });

  it('cooldown中にstart()を連打しても始まらず、明けたら再び釣れる', () => {
    const { fishing, state, toBite, finishAnim, advance, p, view } = setup();
    toBite();
    fishing.action(p, view);
    finishAnim();
    for (let i = 0; i < 3; i++) {
      fishing.start(p, view); // E連打相当
      expect(fishing.state).toBe('cooldown');
      advance(0.125);
    }
    expect(invCount(state, 'fish')).toBe(1); // 2匹目は始まってすらいない
    advance(1.2);
    expect(fishing.state).toBe('idle');
    fishing.start(p, view);
    expect(fishing.state).toBe('casting'); // 明ければ再開できる
  });

  it('cooldown中に釣り場から1.5m以上離れたらすぐidleになる', () => {
    const { fishing, toBite, finishAnim, advance, p, view } = setup();
    toBite();
    fishing.action(p, view);
    finishAnim();
    p.z = PIER.z - 1.4;
    advance(0.125);
    expect(fishing.state).toBe('cooldown'); // まだ近い
    p.z = PIER.z - 1.6;
    advance(0.125);
    expect(fishing.state).toBe('idle');
  });

  it('cancel()は待機中の竿・糸・ウキを消してidleに戻す', () => {
    const { fishing, advance, p, view, bobberOn, rodOn, lineExists } = setup();
    fishing.start(p, view);
    advance(CAST + 0.25); // 着水して糸が出た状態
    expect(lineExists()).toBe(true);
    fishing.cancel(p, view);
    expect(fishing.state).toBe('idle');
    expect(p.locked).toBe(false);
    expect(bobberOn()).toBe(false);
    expect(rodOn()).toBe(false);
    expect(lineExists()).toBe(false);
  });

  it('reeling中のEscでも安全に片付いてidleに戻る(遅れて届くonEndでも壊れない)', () => {
    const { fishing, toBite, finishAnim, advance, p, view, bobberOn, rodOn, lineExists } = setup();
    toBite();
    fishing.action(p, view);
    fishing.cancel(p, view);
    expect(fishing.state).toBe('idle');
    expect(p.locked).toBe(false);
    expect(bobberOn()).toBe(false);
    expect(rodOn()).toBe(false);
    expect(lineExists()).toBe(false);
    finishAnim(); // 中断した演出のonEndが遅れて届いてもcooldownに入らない
    expect(fishing.state).toBe('idle');
    advance(1.0);
    expect(fishing.state).toBe('idle');
    fishing.start(p, view); // すぐ次を始められる
    expect(fishing.state).toBe('casting');
  });

  it('にげられた場合はidleに戻り、すぐ次を始められる(従来どおり)', () => {
    const { fishing, state, toBite, advance, p, view, bobberOn, lineExists } = setup();
    toBite();
    advance(1.375); // bite(1.25秒)を放置
    expect(fishing.state).toBe('idle');
    expect(p.locked).toBe(false);
    expect(bobberOn()).toBe(false);
    expect(lineExists()).toBe(false);
    expect(invCount(state, 'fish')).toBe(0);
    fishing.start(p, view);
    expect(fishing.state).toBe('casting');
  });

  it('Escのあとに投げアニメのonEndが届いても釣りの構えに戻らない', () => {
    const { fishing, advance, p, view, ends, played } = setup();
    fishing.start(p, view);
    advance(0.125); // 投げの途中でやめる
    fishing.cancel(p, view);
    expect(played[played.length - 1]).toBe('idle');
    ends[0](); // fish_castのonEndが遅れて届く
    expect(played[played.length - 1]).toBe('idle'); // fish_idleに戻されない
    expect(fishing.state).toBe('idle');
  });

  it('updateを止めている間はどの状態も進まない(ポーズ・会話中の相当)', () => {
    vi.useFakeTimers();
    try {
      const { fishing, state, advance, p, view } = setup();
      fishing.start(p, view);
      advance(CAST + 0.125);
      expect(fishing.state).toBe('waiting');
      vi.advanceTimersByTime(5000); // setTimeout駆動ならここで当たりが来てしまう
      expect(fishing.state).toBe('waiting');
      advance(WAIT + 0.125); // 再開
      expect(fishing.state).toBe('bite');
      fishing.action(p, view);
      expect(fishing.state).toBe('reeling');
      vi.advanceTimersByTime(5000); // 演出中もupdateが呼ばれなければ進まない
      expect(fishing.state).toBe('reeling');
      expect(p.locked).toBe(true);
      advance(REEL + 0.25);
      expect(fishing.state).toBe('cooldown');
      vi.advanceTimersByTime(5000); // クールダウンもdt駆動
      expect(fishing.state).toBe('cooldown');
      advance(1.375);
      expect(fishing.state).toBe('idle');
      expect(invCount(state, 'fish')).toBe(1); // 止めた分だけ余計に釣れたりしない
    } finally {
      vi.useRealTimers();
    }
  });

  it('釣り場の外・ツリザオ無しでは始まらない', () => {
    const { fishing, p, view } = setup();
    p.x = 0;
    p.z = 0;
    expect(fishing.canFish(p.x, p.z)).toEqual({ zone: null, ok: false });
    fishing.start(p, view);
    expect(fishing.state).toBe('idle');
  });

  it('locksPlayerは演出中だけtrue(cooldownは動いてよい)', () => {
    const { fishing, toBite, finishAnim, advance, p, view } = setup();
    expect(fishing.locksPlayer).toBe(false);
    toBite();
    expect(fishing.locksPlayer).toBe(true); // bite
    fishing.action(p, view);
    expect(fishing.locksPlayer).toBe(true); // reeling
    finishAnim();
    expect(fishing.locksPlayer).toBe(false); // cooldown
    advance(1.375);
    expect(fishing.locksPlayer).toBe(false); // idle
  });

  it('ヒントは状態ごとに切り替わる(cooldownは出さない)', () => {
    const { fishing, finishAnim, advance, p, view } = setup();
    expect(fishing.hint).toBeNull();
    fishing.start(p, view);
    expect(fishing.hint).toContain('まってる');
    advance(CAST + WAIT + 0.125);
    expect(fishing.hint).toContain('つりあげる');
    fishing.action(p, view);
    expect(fishing.hint).toBe('つりあげてる…');
    finishAnim();
    expect(fishing.hint).toBeNull();
  });
});

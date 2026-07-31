// 見せ場(初回の夜・ルミの木開花)と就寝を、排他的な状態機械で進行する。
// 睡眠はsetTimeoutを使わずタイムラインで処理し、多重実行できない。
import { POIS } from '../data/island';
import { terrainHeight } from '../entities/terrain';
import { burst } from '../entities/effects';
import { toast } from '../ui/Toast';
import { sfx } from '../audio/AudioSystem';
import { save } from '../save/SaveSystem';
import type { GameScene } from './GameScene';

export type SequenceState = 'idle' | 'sleeping' | 'intro' | 'bloom';

const SLEEP_FADE_IN = 0.45; // 暗転までの秒
const SLEEP_TOTAL = 1.05; // 起床までの秒

export class SequenceDirector {
  private state: SequenceState = 'idle';
  private t = 0; // 現在の状態の経過秒
  private sleepApplied = false; // 時刻更新を1回だけ行う
  private sleepFade: HTMLElement | null = null;
  private mossQueue: { x: number; y: number; z: number }[] = []; // 開花に呼応するコケ
  private npcReacted = false;

  constructor(private gs: GameScene) {}

  /** 演出・就寝中はプレイヤー操作とワールド時間を止める */
  get active(): boolean {
    return this.state !== 'idle';
  }

  get current(): SequenceState {
    return this.state;
  }

  start(kind: 'intro' | 'bloom'): void {
    if (this.state !== 'idle') return; // 排他: 進行中は開始しない
    this.state = kind;
    this.t = 0;
    const lp = POIS.lumiTree;
    const y = terrainHeight(lp.x, lp.z);
    this.gs.restoreAllOcclusionImmediately(); // 主役が半透明のまま始まらないように
    this.gs.camCtl.beginEvent(lp.x, y, lp.z, 13, 8); // 樹冠まで入る引き(開花の瞬間を見せる)
    if (kind === 'intro') {
      toast('夜になると、島の光が めをさます。', 'moss');
    } else {
      sfx('bloom');
      // 演出は「蕾」から始める(依頼完了時のapplyIslandLevel(2)が先に花へ切り替えているため戻す)
      this.gs.island.lumiBuds.scaling.setAll(1.05);
      this.gs.island.lumiFruits.scaling.setAll(0.001);
      // 開花に呼応させるヒカリゴケ(木に近い順に4つ)と、NPCの注目を準備
      this.npcReacted = false;
      this.mossQueue = [...this.gs.island.nodes.values()]
        .filter((n) => n.def.kind === 'moss')
        .map((n) => ({ x: n.def.x, y: n.y + 0.3, z: n.def.z, d: Math.hypot(n.def.x - lp.x, n.def.z - lp.z) }))
        .sort((a2, b2) => a2.d - b2.d)
        .slice(0, 4)
        .map(({ x, y: my, z }) => ({ x, y: my, z }));
      this.gs.npcs.reactToBloom(lp.x, lp.z, false); // まず木を見る
    }
  }

  /** Eキーでの早送り(intro/bloomのみ。就寝はスキップ不可) */
  skip(): void {
    if (this.state === 'intro' || this.state === 'bloom') this.end();
  }

  private end(): void {
    if (this.state === 'bloom') {
      // スキップ時も最終状態(蕾なし・花ひらく)へそろえる
      this.gs.island.lumiFruits.scaling.setAll(1.2);
      this.gs.island.lumiBuds.scaling.setAll(0.001);
    }
    this.state = 'idle';
    this.gs.camCtl.endEvent();
  }

  /** 自宅ベッドで寝る。連打しても1回ぶんしか実行されない */
  sleep(): void {
    if (this.state !== 'idle') return; // 排他: sleeping中の再実行を防ぐ
    this.state = 'sleeping';
    this.t = 0;
    this.sleepApplied = false;
    if (!this.sleepFade) {
      this.sleepFade = document.createElement('div');
      this.sleepFade.className = 'sleep-fade';
      document.getElementById('ui-root')!.appendChild(this.sleepFade);
    }
    this.sleepFade.classList.add('show');
  }

  update(dt: number): void {
    const gs = this.gs;
    // 初回の夜: 夕方開始から日没を迎えた瞬間に一度だけ(UIを開いている間は待つ)
    if (this.state === 'idle' && !gs.modalOpen && !gs.state.flags.intro_done && gs.island.time.hour >= 19.4 && gs.island.time.hour < 22) {
      gs.state.flags.intro_done = true;
      this.start('intro');
      sfx('bloom');
    }
    if (this.state === 'idle') return;
    this.t += dt;

    if (this.state === 'sleeping') {
      // 暗転しきったら: 時刻更新→GameStateへ同期→NPC再配置→同期後にセーブ(この順を守る)
      if (!this.sleepApplied && this.t >= SLEEP_FADE_IN) {
        this.sleepApplied = true;
        gs.island.time.sleep();
        gs.state.time = { day: gs.island.time.day, hour: gs.island.time.hour };
        gs.island.dayNight.update(gs.island.time.hour, gs.player.x, gs.player.z);
        gs.npcs.snapToSchedule(gs.island.time.hour);
        save(gs.state);
        toast('よくねむれた! あさになった', 'lumina');
      }
      if (this.t >= SLEEP_TOTAL) {
        this.sleepFade?.classList.remove('show');
        this.state = 'idle';
      }
      return;
    }

    const lp = POIS.lumiTree;
    if (this.state === 'bloom') {
      // 開花は「木が咲く」流れで段階的に:
      // 0〜1.4s 根元に光が入る → 1.4〜3.2s 光が幹を駆けのぼる →
      // 3.2〜4.6s 枝先に芽 → 4.6s〜 開花(実がふくらみ、コケが順に呼応、NPCがよろこぶ)
      const t = this.t;
      const baseY = terrainHeight(lp.x, lp.z);
      const pulse = Math.floor(t * 6) !== Math.floor((t - dt) * 6);
      if (pulse) {
        if (t < 1.4) {
          burst(lp.x + (Math.random() - 0.5) * 1.7, baseY + 0.3, lp.z + (Math.random() - 0.5) * 1.7, 'bloom', 4);
        } else if (t < 3.2) {
          const climb = (t - 1.4) / 1.8; // 幹に沿って上へ
          burst(lp.x + (Math.random() - 0.5) * 0.8, baseY + 0.6 + climb * 4.4, lp.z + (Math.random() - 0.5) * 0.8, 'bloom', 5);
        } else if (t < 4.6) {
          burst(lp.x + (Math.random() - 0.5) * 3.2, baseY + 4.4 + Math.random() * 2.0, lp.z + (Math.random() - 0.5) * 3.2, 'moss', 3);
        } else {
          burst(lp.x + (Math.random() - 0.5) * 3.8, baseY + 4.2 + Math.random() * 2.6, lp.z + (Math.random() - 0.5) * 3.8, 'bloom', 9);
          const m = this.mossQueue.shift();
          if (m) burst(m.x, m.y, m.z, 'moss', 7); // 周囲のヒカリゴケが順にめざめる
        }
      }
      if (t >= 4.6 && !this.npcReacted) {
        this.npcReacted = true;
        this.gs.npcs.reactToBloom(lp.x, lp.z, true); // よろこぶ
      }
      // 蕾→花: 3.2s〜蕾がふくらみ、4.6s〜蕾がすぼみながら花びらがひらく(球の追加ではなく差し替え)
      if (t < 3.2) {
        gs.island.lumiBuds.scaling.setAll(1.05);
      } else if (t < 4.6) {
        gs.island.lumiBuds.scaling.setAll(1.05 + ((t - 3.2) / 1.4) * 0.3);
      } else {
        const k = Math.min(1, (t - 4.6) / 1.6);
        const e = k * k * (3 - 2 * k);
        gs.island.lumiBuds.scaling.setAll(Math.max(0.001, 1.35 * (1 - e)));
        gs.island.lumiFruits.scaling.setAll(Math.max(0.001, 1.2 * e));
      }
      if (t > 6.8) this.end();
    } else if (this.t > 2.8) {
      this.end();
    }
  }
}

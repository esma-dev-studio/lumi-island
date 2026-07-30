// 見せ場(初回の夜・ルミの木開花)と就寝フェード: GameSceneから演出の進行だけを分離
import { POIS } from '../data/island';
import { terrainHeight } from '../entities/terrain';
import { burst } from '../entities/effects';
import { toast } from '../ui/Toast';
import { sfx } from '../audio/AudioSystem';
import { save } from '../save/SaveSystem';
import type { GameScene } from './GameScene';

export class SequenceDirector {
  private t = -1; // 経過秒(-1=停止中)
  private kind: 'intro' | 'bloom' | null = null;
  private sleepFade: HTMLElement | null = null;

  constructor(private gs: GameScene) {}

  get active(): boolean {
    return this.t >= 0;
  }

  start(kind: 'intro' | 'bloom'): void {
    this.kind = kind;
    this.t = 0;
    const lp = POIS.lumiTree;
    const y = terrainHeight(lp.x, lp.z);
    this.gs.camCtl.beginEvent(lp.x, y, lp.z, kind === 'intro' ? 13 : 11, kind === 'intro' ? 8 : 6.5);
    if (kind === 'intro') {
      toast('夜になると、島の光が めをさます。', 'moss');
    } else {
      sfx('bloom');
    }
  }

  end(): void {
    if (this.kind === 'bloom') this.gs.island.lumiFruits.scaling.setAll(1.2);
    this.t = -1;
    this.kind = null;
    this.gs.camCtl.endEvent();
  }

  update(dt: number): void {
    const gs = this.gs;
    // 初回の夜: 夕方開始から日没を迎えた瞬間に一度だけ
    if (this.t < 0 && !gs.state.flags.intro_done && gs.island.time.hour >= 19.4 && gs.island.time.hour < 22) {
      gs.state.flags.intro_done = true;
      this.start('intro');
      sfx('bloom');
    }
    if (this.t < 0) return;
    this.t += dt;
    const lp = POIS.lumiTree;
    if (this.kind === 'bloom') {
      // 実がふくらみ、粒が立ちのぼる
      const k = Math.min(1, this.t / 4.5);
      gs.island.lumiFruits.scaling.setAll(0.55 + (1.2 - 0.55) * k);
      if (Math.floor(this.t * 3) !== Math.floor((this.t - dt) * 3)) {
        burst(lp.x + (Math.random() - 0.5) * 3, terrainHeight(lp.x, lp.z) + 4 + Math.random() * 2.5, lp.z + (Math.random() - 0.5) * 3, 'bloom', 10);
      }
      if (this.t > 6.5) this.end();
    } else if (this.t > 2.8) {
      this.end();
    }
  }

  sleep(): void {
    const gs = this.gs;
    if (!this.sleepFade) {
      this.sleepFade = document.createElement('div');
      this.sleepFade.className = 'sleep-fade';
      document.getElementById('ui-root')!.appendChild(this.sleepFade);
    }
    const el = this.sleepFade;
    el.classList.add('show');
    gs.player.locked = true;
    setTimeout(() => {
      gs.island.time.sleep();
      gs.island.dayNight.update(gs.island.time.hour, gs.player.x, gs.player.z);
      toast('よくねむれた! あさになった', 'lumina');
      save(gs.state);
      el.classList.remove('show');
      gs.player.locked = false;
    }, 450);
  }
}

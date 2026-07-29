// ゲーム内時間(純ロジック・描画非依存)。1日=実時間10分。朝6:00開始。
export const DAY_REAL_SEC = 600;

export type DayPhase = 'day' | 'dusk' | 'night' | 'dawn';

export class TimeSystem {
  day = 1;
  hour = 6;

  advance(dtSec: number): void {
    this.hour += (dtSec * 24) / DAY_REAL_SEC;
    while (this.hour >= 24) {
      this.hour -= 24;
      this.day++;
    }
  }

  /** 寝る: 翌朝6時へ */
  sleep(): void {
    if (this.hour >= 6) this.day++;
    this.hour = 6;
  }

  get phase(): DayPhase {
    const h = this.hour;
    if (h >= 6 && h < 17) return 'day';
    if (h >= 17 && h < 19.5) return 'dusk';
    if (h >= 19.5 || h < 4.5) return 'night';
    return 'dawn';
  }

  get isNight(): boolean {
    return this.hour >= 19 || this.hour < 5;
  }

  /** "あさ6:12" のような表示 */
  label(): string {
    const h = Math.floor(this.hour);
    const m = Math.floor((this.hour - h) * 60);
    const name = this.phase === 'day' ? (h < 10 ? 'あさ' : 'ひる') : this.phase === 'dusk' ? 'ゆうがた' : this.phase === 'dawn' ? 'よあけ' : 'よる';
    return `${name} ${h}:${m.toString().padStart(2, '0')}`;
  }

  serialize(): { day: number; hour: number } {
    return { day: this.day, hour: this.hour };
  }
  restore(s: { day: number; hour: number }): void {
    this.day = s.day ?? 1;
    this.hour = s.hour ?? 6;
  }
}

// v24 フォトモード(P / 右上の「しゃしん」ボタン)。
//
// 画面の まわりに 額のわくを 出して、シャッターで 1まい のこす。
// わくの中は **1つも ふさがない**(見まわしも 歩きも そのまま)ので、
// 根の要素は pointer-events:none にして、ボタンだけを auto に もどしてある
// ——タッチUIの根(touch-root)と まったく同じ作り(教訓2: idセレクタに 負けない強さで打ちなおす)。
//
// 絵そのものは GameScene が canvas から 焼く(PhotoSystem がしまう)。
// ここは「わく・シャッター・のこり枚数・とじる」だけを 受けもつ。
import { sfx } from '../audio/AudioSystem';
import { PHOTO_FRAME, PHOTO_H, PHOTO_MAX, PHOTO_QUALITY, PHOTO_W } from '../systems/PhotoSystem';

/**
 * いまの画面を「額縁つきの1まい」に 焼く(data URL の JPEG)。
 *
 * WebGLの えは 描いた ちょくご(同じフレーム)しか 読み出せないので、
 * 呼ぶのは scene.render() の すぐ後だけ(GameScene.render の さいご)。
 * 額は 木のふち+白いマット。写真の たてよこ比は 画面と 同じ 16:9 に そろえて、
 * 中身が つぶれないように **はみ出すぶんを 切って** はめる(引きのばさない)。
 *
 * @returns data:image/jpeg;base64,… / 焼けなければ null
 */
export function framePhoto(src: HTMLCanvasElement | null): string | null {
  if (!src || !src.width || !src.height) return null;
  const F = PHOTO_FRAME;
  const out = document.createElement('canvas');
  out.width = PHOTO_W + F * 2;
  out.height = PHOTO_H + F * 2;
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  // 木のふち(外がわ)→ 白いマット → 写真、の3そう
  ctx.fillStyle = '#8a6a4a';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.fillStyle = '#63472f';
  ctx.fillRect(0, 0, out.width, 3);
  ctx.fillRect(0, out.height - 3, out.width, 3);
  ctx.fillStyle = '#f4efe2';
  ctx.fillRect(F - 6, F - 6, PHOTO_W + 12, PHOTO_H + 12);
  // 画面の まん中から 16:9 を 切りとる(引きのばさない)
  const want = PHOTO_W / PHOTO_H;
  const have = src.width / src.height;
  let sw = src.width, sh = src.height, sx = 0, sy = 0;
  if (have > want) {
    sw = src.height * want;
    sx = (src.width - sw) / 2;
  } else {
    sh = src.width / want;
    sy = (src.height - sh) / 2;
  }
  try {
    ctx.drawImage(src, sx, sy, sw, sh, F, F, PHOTO_W, PHOTO_H);
  } catch {
    return null; // 読み出せない環境では しゃしんを あきらめる(ゲームは 止めない)
  }
  // 写真の内がわに ほそい かげの線(紙が 1まい はまって見える)
  ctx.strokeStyle = 'rgba(60, 48, 32, 0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(F + 0.5, F + 0.5, PHOTO_W - 1, PHOTO_H - 1);
  const data = out.toDataURL('image/jpeg', PHOTO_QUALITY);
  // まっ白・まっ黒しか 写らなかった(読み出しに 失敗した)ときは のこさない
  return data.length > 2000 ? data : null;
}

export class PhotoUI {
  private el: HTMLElement;
  private countEl: HTMLElement;
  private noteEl: HTMLElement;
  open = false;
  /** シャッターを 押した(実さいの 焼きつけは GameScene が つぎの描画で行う) */
  onShutter: (() => void) | null = null;
  /** フォトモードを とじる */
  onClose: (() => void) | null = null;

  constructor() {
    const el = document.createElement('div');
    el.className = 'photo-frame hidden';
    el.innerHTML = `
      <div class="photo-edge photo-edge-t"></div>
      <div class="photo-edge photo-edge-b"></div>
      <div class="photo-edge photo-edge-l"></div>
      <div class="photo-edge photo-edge-r"></div>
      <div class="photo-corner photo-corner-tl"></div>
      <div class="photo-corner photo-corner-tr"></div>
      <div class="photo-corner photo-corner-bl"></div>
      <div class="photo-corner photo-corner-br"></div>
      <div class="photo-bar">
        <span class="photo-note" data-el="note">うごいて カメラを まわして、すきな ばめんで シャッター</span>
        <span class="photo-count" data-el="count"></span>
        <button class="photo-btn" data-act="shot" type="button">シャッター</button>
        <button class="photo-btn sub" data-act="close" type="button">とじる</button>
      </div>
      <div class="photo-flash" data-el="flash"></div>
    `;
    document.getElementById('ui-root')!.appendChild(el);
    this.el = el;
    this.countEl = el.querySelector('[data-el="count"]') as HTMLElement;
    this.noteEl = el.querySelector('[data-el="note"]') as HTMLElement;
    // クリックは委譲リスナー1本(毎描画の onclick 割り当てはしない)
    el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!t) return;
      if (t.dataset.act === 'shot') this.onShutter?.();
      else this.onClose?.();
    });
  }

  show(count: number): void {
    this.open = true;
    this.setCount(count);
    this.noteEl.textContent = 'うごいて カメラを まわして、すきな ばめんで シャッター';
    this.el.classList.remove('hidden');
    document.body.classList.add('photo-mode');
    sfx('open');
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.el.classList.add('hidden');
    document.body.classList.remove('photo-mode');
    sfx('close');
  }

  /** のこり枚数の 表示 */
  setCount(count: number): void {
    this.countEl.textContent = `${count} / ${PHOTO_MAX}まい`;
  }

  /** とった合図(白い ひとフラッシュ)+ 一言 */
  flash(note: string): void {
    this.noteEl.textContent = note;
    const f = this.el.querySelector('[data-el="flash"]') as HTMLElement;
    f.classList.remove('on');
    void f.offsetWidth; // アニメを かけ直すための 読みとり
    f.classList.add('on');
  }
}

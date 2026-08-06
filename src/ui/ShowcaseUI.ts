// Showcase画面のDOM UI(キャラ/アニメ切替・昼夜・整列・統計)
import type { ShowcaseScene } from '../scenes/ShowcaseScene';
import { CHARACTERS } from '../data/characters';

export function buildShowcaseUI(sc: ShowcaseScene): void {
  const root = document.getElementById('ui-root')!;
  const panel = document.createElement('div');
  panel.className = 'sc-panel';
  panel.innerHTML = `
    <div class="sc-title">Character Showcase</div>
    <div class="sc-row" id="sc-chars"></div>
    <div class="sc-row" id="sc-anims"></div>
    <div class="sc-row" id="sc-toggles">
      <button data-t="night">夜にする</button>
      <button data-t="lineup">みんな ならべる</button>
      <button data-t="turntable" class="on">回転</button>
    </div>
    <div class="sc-stats" id="sc-stats"></div>
  `;
  root.appendChild(panel);

  const charsRow = panel.querySelector('#sc-chars')!;
  for (const id of sc.characterIds) {
    const def = CHARACTERS[id];
    const b = document.createElement('button');
    b.textContent = `${def.name}(${def.species})`;
    b.dataset.id = id;
    if (id === sc.currentCharacter) b.classList.add('on');
    b.onclick = () => {
      sc.setCharacter(id);
      charsRow.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      panel.querySelector('[data-t="lineup"]')!.classList.remove('on');
    };
    charsRow.appendChild(b);
  }
  const animsRow = panel.querySelector('#sc-anims')!;
  for (const a of sc.anims) {
    const b = document.createElement('button');
    b.textContent = a;
    b.onclick = () => {
      sc.setAnim(a);
      animsRow.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    };
    if (a === 'idle') b.classList.add('on');
    animsRow.appendChild(b);
  }
  const tRow = panel.querySelector('#sc-toggles')!;
  tRow.querySelectorAll('button').forEach((b) => {
    const bt = b as HTMLButtonElement;
    bt.onclick = () => {
      const on = !bt.classList.contains('on');
      bt.classList.toggle('on', on);
      const t = bt.dataset.t;
      if (t === 'night') {
        sc.setNight(on);
        bt.textContent = on ? '昼にする' : '夜にする';
      } else if (t === 'lineup') sc.setLineup(on);
      else if (t === 'turntable') sc.setTurntable(on);
    };
  });
  const stats = panel.querySelector('#sc-stats')!;
  setInterval(() => {
    const s = sc.stats();
    stats.textContent = `FPS ${s.fps} | 三角形 ${s.tris.toLocaleString()} | マテリアル ${s.materials} | テクスチャ ${s.texKB}KB | GLB ${s.glbKB}KB`;
  }, 500);
}

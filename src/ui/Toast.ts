// 取得通知などの小さなトースト(左上に積む)
import { icon } from './icons';

let box: HTMLElement | null = null;

export function toast(text: string, iconId?: string): void {
  if (!box) {
    box = document.createElement('div');
    box.className = 'toast-box';
    document.getElementById('ui-root')!.appendChild(box);
  }
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `${iconId ? `<span class="t-ico">${icon(iconId)}</span>` : ''}<span>${text}</span>`;
  box.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 2100);
  while (box.children.length > 4) box.firstElementChild?.remove();
}

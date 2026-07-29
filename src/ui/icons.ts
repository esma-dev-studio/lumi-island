// アイテム・道具のSVGピクトグラム(絵文字は使わない)。すべて24x24。
const S = (body: string): string =>
  `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS: Record<string, string> = {
  wood: S('<path d="M5 8 L15 8 L19 12 L19 16 L9 16 L5 12 Z" fill="#b98d5f" stroke="#7a5a3d"/><ellipse cx="7.5" cy="10" rx="2.5" ry="3.4" fill="#e2cfa0" stroke="#7a5a3d"/><ellipse cx="7.5" cy="10" rx="1" ry="1.5" fill="none" stroke="#a8845c"/>'),
  stone: S('<path d="M6 16 L4 12 L8 7 L15 6 L20 11 L18 16 Z" fill="#b8b4a8" stroke="#6b675c"/><path d="M8 7 L11 11 L18 16" stroke="#8d897d"/>'),
  fiber: S('<path d="M12 20 C10 14 6 12 5 6 M12 20 C12 13 12 9 12 4 M12 20 C14 14 18 12 19 6" stroke="#5d8a4e"/>'),
  berry: S('<circle cx="9" cy="14" r="4.2" fill="#d98a9a" stroke="#a85f6f"/><circle cx="15.5" cy="12" r="3.4" fill="#e0a0ae" stroke="#a85f6f"/><path d="M12 5 L13 9" stroke="#5d8a4e"/><path d="M10.5 6.5 C12 5 14 5 15 6.5" stroke="#5d8a4e"/>'),
  moss: S('<path d="M4 17 C4 13 7 11 9 12 C9 8 15 8 15 12 C18 11 20 14 20 17 Z" fill="#9fe8c8" stroke="#4f9a78"/><circle cx="9" cy="14.5" r="0.8" fill="#e8fff4" stroke="none"/><circle cx="14" cy="13.5" r="0.8" fill="#e8fff4" stroke="none"/>'),
  ore: S('<path d="M12 3 L16 9 L14 19 L10 19 L8 9 Z" fill="#bcd0f0" stroke="#5f7aa8"/><path d="M12 3 L12 19 M8 9 L16 9" stroke="#8aa8d9"/>'),
  fish: S('<path d="M4 12 C8 7 14 7 17 12 C14 17 8 17 4 12 Z" fill="#8fb8cf" stroke="#4f7a95"/><path d="M17 12 L21 8.5 L20 12 L21 15.5 Z" fill="#8fb8cf" stroke="#4f7a95"/><circle cx="8" cy="11" r="0.9" fill="#2e4a5c" stroke="none"/>'),
  nightfish: S('<path d="M4 12 C8 7 14 7 17 12 C14 17 8 17 4 12 Z" fill="#9fe8c8" stroke="#4f9a78"/><path d="M17 12 L21 8.5 L20 12 L21 15.5 Z" fill="#9fe8c8" stroke="#4f9a78"/><circle cx="8" cy="11" r="0.9" fill="#1c3a30" stroke="none"/><path d="M6 6 L7 4.5 M10 5 L10.5 3.5" stroke="#9fe8c8"/>'),
  jam: S('<path d="M7 9 L17 9 L16.5 19 L7.5 19 Z" fill="#c96f82" stroke="#8a4a5a"/><path d="M7 9 C7 6 17 6 17 9" fill="#e2cfa0" stroke="#a8845c"/><path d="M9.5 5.5 L14.5 5.5" stroke="#a8845c"/>'),
  f_bench: S('<path d="M4 11 L20 11 L20 13 L4 13 Z" fill="#b98d5f" stroke="#7a5a3d"/><path d="M6 13 L6 18 M18 13 L18 18 M4 8 L20 8" stroke="#7a5a3d"/>'),
  f_lantern: S('<path d="M9 8 L15 8 L14 16 L10 16 Z" fill="#ffe2b0" stroke="#a87c3d"/><path d="M9 8 C9 5 15 5 15 8 M11 16 L11 18 L13 18 L13 16" stroke="#a87c3d"/><circle cx="12" cy="12" r="1.6" fill="#ffca7a" stroke="none"/>'),
  f_stonelamp: S('<path d="M8 18 L16 18 L15 14 L9 14 Z" fill="#b8b4a8" stroke="#6b675c"/><path d="M10 14 L10 9 L14 9 L14 14" stroke="#6b675c"/><path d="M12 5 L16 9 L12 13 L8 9 Z" fill="#bcd0f0" stroke="#5f7aa8"/>'),
  f_table: S('<path d="M4 9 L20 9 L20 11 L4 11 Z" fill="#b98d5f" stroke="#7a5a3d"/><path d="M6 11 L6 18 M18 11 L18 18 M12 11 L12 15" stroke="#7a5a3d"/>'),
  f_planter: S('<path d="M6 13 L18 13 L17 19 L7 19 Z" fill="#8a6a4a" stroke="#63472f"/><circle cx="9" cy="10" r="2" fill="#d98a9a" stroke="#a85f6f"/><circle cx="15" cy="10" r="2" fill="#e8d9a0" stroke="#b8a25f"/><path d="M9 12 L9 13 M15 12 L15 13" stroke="#5d8a4e"/>'),
  f_chair: S('<path d="M7 4 L9 4 L9 12 L17 12 L17 19 L15 19 L15 14 L9 14 L9 19 L7 19 Z" fill="#b98d5f" stroke="#7a5a3d"/>'),
  f_shelf: S('<rect x="5" y="4" width="14" height="16" fill="#b98d5f" stroke="#7a5a3d"/><path d="M5 9.5 L19 9.5 M5 15 L19 15" stroke="#7a5a3d"/><path d="M8 6 L8 9 M11 6.5 L11 9 M14 12 L14 14.5" stroke="#63472f"/>'),
  f_rug: S('<rect x="4" y="7" width="16" height="10" rx="1" fill="#cf8a63" stroke="#9a5f42"/><rect x="7" y="9.5" width="10" height="5" rx="0.5" fill="none" stroke="#e8cdb0"/>'),
  f_pot: S('<path d="M8 12 L16 12 L15 19 L9 19 Z" fill="#c96f52" stroke="#8a4a38"/><path d="M12 12 L12 8 M12 8 C10 8 9 6 9 5 C11 5 12 6 12 8 M12 8 C14 8 15 6 15 5 C13 5 12 6 12 8" stroke="#5d8a4e"/>'),
  f_sign: S('<rect x="5" y="5" width="14" height="8" rx="1" fill="#e2cfa0" stroke="#7a5a3d"/><path d="M12 13 L12 19 M8 8 L16 8 M8 10.5 L13 10.5" stroke="#7a5a3d"/>'),
  axe: S('<path d="M9 6 L18 17" stroke="#7a5a3d"/><path d="M6 9 C7 5 11 4 13 5 C11 7 11 9 12 10 C10 11 7 11 6 9 Z" fill="#b8b4a8" stroke="#6b675c"/>'),
  pickaxe: S('<path d="M8 8 L18 18" stroke="#7a5a3d"/><path d="M4 10 C6 5 12 3 16 5 C12 5 9 7 8 8 C7 9 6 11 6 13 C5 12 4 11 4 10 Z" fill="#b8b4a8" stroke="#6b675c"/>'),
  rod: S('<path d="M4 19 C10 15 16 9 19 4" stroke="#7a5a3d"/><path d="M19 4 C19 9 17 12 16 13" stroke="#9a9484" stroke-dasharray="1.5 1.5"/><circle cx="16" cy="15" r="1.6" fill="#cf8a63" stroke="#9a5f42"/>'),
  sickle: S('<path d="M9 15 L14 20" stroke="#7a5a3d"/><path d="M5 5 C11 3 16 6 17 11 C13 9 8 9 5 5 Z" fill="#b8b4a8" stroke="#6b675c"/>'),
  lumina: S('<circle cx="12" cy="12" r="7" fill="none" stroke="#c98a3d"/><circle cx="12" cy="12" r="3" fill="#ffd9a0" stroke="#c98a3d"/>'),
};

export function icon(id: string): string {
  return ICONS[id] ?? S('<circle cx="12" cy="12" r="8"/>');
}

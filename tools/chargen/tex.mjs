// テクスチャ生成キット: RGBAピクセルバッファへの描画 + 依存なしPNGエンコード(node:zlib)
import { deflateSync } from 'node:zlib';

export function hex(h) {
  const s = h.replace('#', '');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}
export function mix(a, b, t) {
  return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
}
export function shade(c, f) {
  // f<1で暗く f>1で明るく(白へ寄せる)
  if (f <= 1) return c.map((x) => Math.round(x * f));
  return mix(c, [255, 255, 255], Math.min(1, f - 1));
}

// 決定的乱数
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Tex {
  constructor(w = 512, h = 512) {
    this.w = w;
    this.h = h;
    this.data = new Uint8Array(w * h * 4);
  }
  px(x, y, c, a = 1) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    const d = this.data;
    d[i] = Math.round(d[i] * (1 - a) + c[0] * a);
    d[i + 1] = Math.round(d[i + 1] * (1 - a) + c[1] * a);
    d[i + 2] = Math.round(d[i + 2] * (1 - a) + c[2] * a);
    d[i + 3] = 255;
  }
  fill(c) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.px(x, y, c);
  }
  rect(x, y, w, h, c, a = 1) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.px(xx, yy, c, a);
  }
  // 上下グラデーション
  vgrad(x, y, w, h, c1, c2) {
    for (let yy = 0; yy < h; yy++) {
      const c = mix(c1, c2, yy / Math.max(1, h - 1));
      for (let xx = x; xx < x + w; xx++) this.px(xx, y + yy, c);
    }
  }
  // ソフトエッジ楕円
  ellipse(cx, cy, rx, ry, c, a = 1, soft = 1.5) {
    const x0 = Math.floor(cx - rx - soft), x1 = Math.ceil(cx + rx + soft);
    const y0 = Math.floor(cy - ry - soft), y1 = Math.ceil(cy + ry + soft);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < 1) this.px(x, y, c, a);
        else if (d < 1 + soft / Math.min(rx, ry)) {
          const f = 1 - (d - 1) / (soft / Math.min(rx, ry));
          this.px(x, y, c, a * f);
        }
      }
    }
  }
  // 太さのある線分
  line(x1, y1, x2, y2, w, c, a = 1) {
    const dx = x2 - x1, dy = y2 - y1;
    const l = Math.hypot(dx, dy) || 1;
    const steps = Math.ceil(l * 2);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.ellipse(x1 + dx * t, y1 + dy * t, w / 2, w / 2, c, a, 1);
    }
  }
  // 2次ベジェの太線(口・眉など)
  bezier(x1, y1, cx, cy, x2, y2, w, c, a = 1) {
    const steps = 40;
    let px = x1, py = y1;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const mt = 1 - t;
      const x = mt * mt * x1 + 2 * mt * t * cx + t * t * x2;
      const y = mt * mt * y1 + 2 * mt * t * cy + t * t * y2;
      this.line(px, py, x, y, w, c, a);
      px = x; py = y;
    }
  }
  // 細かい明度ノイズ(マットな布・毛の質感)
  noise(x, y, w, h, amount, seed = 1) {
    const r = rng(seed);
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        const i = (yy * this.w + xx) * 4;
        const f = 1 + (r() - 0.5) * amount;
        this.data[i] = Math.min(255, this.data[i] * f);
        this.data[i + 1] = Math.min(255, this.data[i + 1] * f);
        this.data[i + 2] = Math.min(255, this.data[i + 2] * f);
      }
    }
  }
  // 縦ストローク(毛並み)
  strokes(x, y, w, h, c, count, seed, lenMin = 3, lenMax = 8, alpha = 0.18) {
    const r = rng(seed);
    for (let i = 0; i < count; i++) {
      const sx = x + r() * w, sy = y + r() * h;
      const l = lenMin + r() * (lenMax - lenMin);
      const ang = Math.PI / 2 + (r() - 0.5) * 0.5;
      this.line(sx, sy, sx + Math.cos(ang) * l, sy + Math.sin(ang) * l, 1.2, c, alpha);
    }
  }
}

// ---------- PNG エンコード ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  const crcBuf = Buffer.alloc(4 + data.length);
  crcBuf.write(type, 0, 'ascii');
  data.copy(crcBuf, 4);
  out.writeUInt32BE(crc32(crcBuf), 8 + data.length);
  return out;
}
export function encodePNG(tex) {
  const { w, h, data } = tex;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    Buffer.from(data.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

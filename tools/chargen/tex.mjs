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
    this.clipRect = null; // 既定は かぎりなし(既存の絵は 1バイトも 変わらない)
  }
  /**
   * ぬる範囲を 四角で かぎる(null で ぜんぶ)。
   * 楕円・線は やわらかい ふちの ぶん 領域の外へ にじむ。あとから 足した絵が
   * 出荷ずみの領域を 1ピクセルでも 変えないことを **構造で** 保証するために使う。
   */
  setClip(r) {
    this.clipRect = r;
  }
  px(x, y, c, a = 1) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const cl = this.clipRect;
    if (cl && (x < cl.x || y < cl.y || x >= cl.x + cl.w || y >= cl.y + cl.h)) return;
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
  /**
   * 別の場所の絵を そのまま 写す(拡大縮小なし)。
   * 表情の口は「頭の絵の その場所を 写して、口だけ 描きかえた もの」なので、
   * 色・明暗のむら・粒(ノイズ)まで 頭と ぴたり 同じになる。
   */
  copyRect(sx, sy, w, h, dx, dy) {
    const buf = new Uint8Array(w * h * 4);
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        const s = ((sy + yy) * this.w + (sx + xx)) * 4;
        const d = (yy * w + xx) * 4;
        buf[d] = this.data[s]; buf[d + 1] = this.data[s + 1]; buf[d + 2] = this.data[s + 2]; buf[d + 3] = 255;
      }
    }
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        const s = (yy * w + xx) * 4;
        const d = ((dy + yy) * this.w + (dx + xx)) * 4;
        this.data[d] = buf[s]; this.data[d + 1] = buf[s + 1]; this.data[d + 2] = buf[s + 2]; this.data[d + 3] = 255;
      }
    }
  }

  /**
   * 別の場所の絵を **大きさを かえて** 写す(なめらかに 補間する)。
   *
   * 表情の目の 下地は 口と 同じで「頭の絵の その場所」を 写したもの。ただし 目は
   * 口とちがって 写す元と 貼る先の 大きさが そろわない: 頭の絵は 横=1周360度・
   * 縦=頭の高さ の 一様な写像なので、1pxの あらわす長さが たてと よこで ちがい、
   * 目の足あとは たてに 長い四角(例: ロカ 9.5 x 25.4px)になる。これを 32x32 の
   * 領域いっぱいに のばして 写すと、**クアッドの ふちの色が 頭と ぴたり そろう**
   * (中の 模様も 貼りもどせば もとの 大きさに もどるので、見た目の 粒は 変わらない)。
   *
   * flipY: 目のクアッドは UVの たて向きが 頭と 逆(画像の上=世界の下。body.mjs の
   * eyeQuad が uvRegion.tb と v=0→下 を 組み合わせているため)。上下を 返して 写す。
   *
   * 写す元(頭 y<176)と 貼る先(表情 y>=368)は かさならないので 一時バッファは いらない。
   */
  copyRectScaled(sx, sy, sw, sh, dx, dy, dw, dh, flipY = false) {
    const at = (x, y, k) => this.data[(y * this.w + x) * 4 + k];
    const clampX = (v) => Math.min(this.w - 1, Math.max(0, v));
    const clampY = (v) => Math.min(this.h - 1, Math.max(0, v));
    const sample = (fx, fy, k) => {
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const xa = clampX(x0), xb = clampX(x0 + 1), ya = clampY(y0), yb = clampY(y0 + 1);
      const a = at(xa, ya, k) * (1 - tx) + at(xb, ya, k) * tx;
      const b = at(xa, yb, k) * (1 - tx) + at(xb, yb, k) * tx;
      return a * (1 - ty) + b * ty;
    };
    for (let yy = 0; yy < dh; yy++) {
      const vv = (yy + 0.5) / dh;
      const v = flipY ? 1 - vv : vv;
      for (let xx = 0; xx < dw; xx++) {
        const u = (xx + 0.5) / dw;
        const fx = sx + u * sw - 0.5, fy = sy + v * sh - 0.5;
        const i = ((dy + yy) * this.w + (dx + xx)) * 4;
        for (let k = 0; k < 3; k++) this.data[i + k] = Math.round(sample(fx, fy, k));
        this.data[i + 3] = 255;
      }
    }
  }

  /**
   * 四角の 上から t1 までを、**そのすぐ下の きれいな行**の 色で ぬりつぶす。
   * 写してきた顔から「もとの口」を 消すのに使う。
   *
   * なぜ 下からなのか: 口の すぐ上には 鼻・ひげ・人中が ならんでいて、上の行を
   * 引きのばすと 鼻の こい色が 下へ すじになって のびる(実際に そうなった)。
   * 口の下は あご= どの種族も なめらかなので、下だけを 情報源にする。
   *
   * 1行を そのまま くり返すと 粒(ノイズ)が 縦じまに 見えるので、
   * 下の3行 × よこ5px を ならして「なめらかな地色」を 作り、粒は あとから のせ直す。
   */
  eraseTo(x, y, w, h, t1, noiseAmt = 0, seed = 1) {
    const r1 = Math.min(h - 4, Math.max(0, Math.round(h * t1)));
    const base = new Uint8Array(w * 3);
    for (let xx = 0; xx < w; xx++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = 1; dy <= 3; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const sx = Math.min(w - 1, Math.max(0, xx + dx));
          const i = ((y + r1 + dy) * this.w + (x + sx)) * 4;
          r += this.data[i]; g += this.data[i + 1]; b += this.data[i + 2]; n++;
        }
      }
      base[xx * 3] = Math.round(r / n); base[xx * 3 + 1] = Math.round(g / n); base[xx * 3 + 2] = Math.round(b / n);
    }
    for (let yy = 0; yy <= r1; yy++) {
      for (let xx = 0; xx < w; xx++) {
        const i = ((y + yy) * this.w + (x + xx)) * 4;
        this.data[i] = base[xx * 3]; this.data[i + 1] = base[xx * 3 + 1]; this.data[i + 2] = base[xx * 3 + 2];
        this.data[i + 3] = 255;
      }
    }
    if (noiseAmt > 0) this.noise(x, y, w, r1 + 1, noiseAmt, seed);
    return r1;
  }

  /**
   * 領域の ふちの色を 外へ n px 広げる(のりしろ)。
   * glTF既定の くり返し+なめらか拡大は 領域の ふちで となりの色を 半分ひろうので、
   * となりに 自分と 同じ色を 置いておく(教訓1「UVアトラスは 隣の色まで設計する」)。
   */
  bleed(x, y, w, h, n) {
    for (let yy = y - n; yy < y + h + n; yy++) {
      if (yy < 0 || yy >= this.h) continue;
      for (let xx = x - n; xx < x + w + n; xx++) {
        if (xx < 0 || xx >= this.w) continue;
        if (xx >= x && xx < x + w && yy >= y && yy < y + h) continue;
        const sx = Math.min(x + w - 1, Math.max(x, xx));
        const sy = Math.min(y + h - 1, Math.max(y, yy));
        const s = (sy * this.w + sx) * 4;
        const d = (yy * this.w + xx) * 4;
        this.data[d] = this.data[s]; this.data[d + 1] = this.data[s + 1]; this.data[d + 2] = this.data[s + 2]; this.data[d + 3] = 255;
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

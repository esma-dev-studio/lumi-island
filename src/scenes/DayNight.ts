// 昼夜の連続補間: 太陽・環境光・霧・空・発光・海色・光だまり・夜のプレイヤー近傍ライト
// 色は起動時にパース済み(毎フレームのFromHexStringなし)。重い更新は15Hzに間引く。
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { GlowLayer } from '@babylonjs/core/Layers/glowLayer';
import '@babylonjs/core/Layers/effectLayerSceneComponent';
import type { Scene } from '@babylonjs/core/scene';
import { Scene as BScene } from '@babylonjs/core/scene';
import { getGlowMats } from '../entities/flora';
import {
  setPoolLevels, nearestGlowSource, setWeatherSky, weatherGlowExcludes, festivalGlowExcludes,
} from '../entities/effects';
import type { WaterRefs } from '../entities/water';
import type { Sky, SkyColors } from '../entities/sky';

interface RawStop {
  h: number;
  sky: string; fog: string; sunC: string; sunI: number;
  hemiC: string; hemiG: string; hemiI: number;
  fogD: number;
  glowMint: number; glowAmber: number; glowBlue: number;
  sea: string;
  /** v15 空のてっぺんの色(地平線ぎわの sky より1段ふかい)。src/entities/sky.ts のドームが使う */
  zen: string;
  /** v15 雲がうける光の色(夕方は茜) */
  cloud: string;
}
// 夜は「暗い」ではなく「光がきれい」: 環境光を持ち上げ、道と人物が見える値にする
const RAW: RawStop[] = [
  { h: 4.5, sky: '#263551', fog: '#36465e', sunC: '#8aa0c8', sunI: 0.5, hemiC: '#5d6d94', hemiG: '#38405a', hemiI: 0.55, fogD: 0.0058, glowMint: 0.5, glowAmber: 0.55, glowBlue: 0.45, sea: '#2e4a63', zen: '#14203c', cloud: '#5a6b8c' },
  { h: 6, sky: '#e8c8a8', fog: '#e5c9ae', sunC: '#ffca8a', sunI: 1.1, hemiC: '#cfc0b0', hemiG: '#8a7a66', hemiI: 0.55, fogD: 0.005, glowMint: 0.12, glowAmber: 0.2, glowBlue: 0.1, sea: '#3f6a80', zen: '#c2ccda', cloud: '#f6cdb4' },
  { h: 9, sky: '#a6def4', fog: '#c8e2ea', sunC: '#fff0cf', sunI: 1.9, hemiC: '#c9e6f2', hemiG: '#8a7a66', hemiI: 0.7, fogD: 0.0038, glowMint: 0, glowAmber: 0, glowBlue: 0, sea: '#3f7288', zen: '#6fb3e0', cloud: '#fbfaf6' },
  { h: 15.5, sky: '#a8dcee', fog: '#c5dfe8', sunC: '#ffebc8', sunI: 1.8, hemiC: '#c9e5f2', hemiG: '#8a7a66', hemiI: 0.68, fogD: 0.0038, glowMint: 0, glowAmber: 0, glowBlue: 0, sea: '#3f7288', zen: '#6db0dd', cloud: '#fbf8f2' },
  { h: 17.5, sky: '#f2c08a', fog: '#e8bd96', sunC: '#ffb27a', sunI: 1.25, hemiC: '#d8b8a0', hemiG: '#7a6a58', hemiI: 0.55, fogD: 0.005, glowMint: 0.15, glowAmber: 0.25, glowBlue: 0.12, sea: '#40667c', zen: '#a98aa8', cloud: '#f2a878' },
  { h: 19.5, sky: '#324263', fog: '#3e4e6b', sunC: '#93a8cf', sunI: 0.62, hemiC: '#68789e', hemiG: '#3c4560', hemiI: 0.58, fogD: 0.0056, glowMint: 0.62, glowAmber: 0.72, glowBlue: 0.55, sea: '#2e4a63', zen: '#1e2a48', cloud: '#7a7b96' },
  { h: 22, sky: '#1b2a48', fog: '#27364f', sunC: '#8aa0c8', sunI: 0.52, hemiC: '#57678e', hemiG: '#343c50', hemiI: 0.52, fogD: 0.006, glowMint: 0.7, glowAmber: 0.8, glowBlue: 0.62, sea: '#24405a', zen: '#101c36', cloud: '#41496a' },
  { h: 28.5, sky: '#263551', fog: '#36465e', sunC: '#8aa0c8', sunI: 0.5, hemiC: '#5d6d94', hemiG: '#38405a', hemiI: 0.55, fogD: 0.0058, glowMint: 0.5, glowAmber: 0.55, glowBlue: 0.45, sea: '#2e4a63', zen: '#14203c', cloud: '#5a6b8c' },
];

/**
 * v14.2 までの色(**変えたところだけ**)。
 *
 * v15「空と光」で足した色の深みは、この表のぶんだけ:
 *   - 夜と夜明け前の 空・霧を 青がわへ 1段ふかく(#20304f → #1b2a48 など)
 *   - 昼の 太陽の色に ごくわずかな暖色、半球光と空に ごくわずかな彩度
 *   - 朝焼け(6時)と 夕焼け(17.5時)の行は **1文字も変えていない**
 *     (いちばん評判のよい2つなので、深みは 天のてっぺんの色 zen でしか足さない)
 * setDayNightDepth(false) でこちらへ戻せるので、同じビルドの同じ瞬間に
 * before/after のスクショを撮って「朝焼けが変わっていないこと」を証明できる。
 */
const PREV: Record<number, Partial<RawStop>> = {
  4.5: { sky: '#2a3a58', fog: '#3a4a63' },
  9: { sky: '#aee0f2', sunC: '#fff0d8', hemiC: '#cfe5ee' },
  15.5: { sunC: '#ffedd0', hemiC: '#cfe5ee' },
  19.5: { sky: '#36466a', fog: '#425270' },
  22: { sky: '#20304f', fog: '#2c3a56' },
  28.5: { sky: '#2a3a58', fog: '#3a4a63' },
};

interface Stop {
  h: number;
  sky: Color3; fog: Color3; sunC: Color3; hemiC: Color3; hemiG: Color3; sea: Color3;
  zen: Color3; cloud: Color3;
  sunI: number; hemiI: number; fogD: number;
  glowMint: number; glowAmber: number; glowBlue: number;
}
const parse = (list: RawStop[]): Stop[] =>
  list.map((r) => ({
    h: r.h,
    sky: Color3.FromHexString(r.sky), fog: Color3.FromHexString(r.fog), sunC: Color3.FromHexString(r.sunC),
    hemiC: Color3.FromHexString(r.hemiC), hemiG: Color3.FromHexString(r.hemiG), sea: Color3.FromHexString(r.sea),
    zen: Color3.FromHexString(r.zen), cloud: Color3.FromHexString(r.cloud),
    sunI: r.sunI, hemiI: r.hemiI, fogD: r.fogD,
    glowMint: r.glowMint, glowAmber: r.glowAmber, glowBlue: r.glowBlue,
  }));
const STOPS_NEW: Stop[] = parse(RAW);
const STOPS_PREV: Stop[] = parse(RAW.map((r) => ({ ...r, ...(PREV[r.h] ?? {}) })));

/** いま使っている色表。setDayNightDepth が入れかえる(ふだんは v15 のまま) */
let STOPS: Stop[] = STOPS_NEW;
/**
 * v15 の色の深みを 使うか。
 * false にすると v14.2 とまったく同じ色表に戻る(検証の before/after 用)。
 * GameScene.setSkyEnabled から 空・ビネットと一緒に 切りかえられる。
 */
export function setDayNightDepth(on: boolean): void {
  STOPS = on ? STOPS_NEW : STOPS_PREV;
}
export function dayNightDepthOn(): boolean {
  return STOPS === STOPS_NEW;
}

const C_MINT = Color3.FromHexString('#9fe8c8');
const C_AMBER = Color3.FromHexString('#ffd9a0');
const C_BLUE = Color3.FromHexString('#a8c8ff');

const TICK = 1 / 15; // 秒(重い色更新の周期)

// ---- 天気(くもり・あめ)のときに空と光を寄せる寒色 ----
// 「暗くする」のではなく「寒色に寄せて・コントラストを落とす」。夜と同じ考え方で、
// 道と人物が読めなくなるほどは暗くしない(半球光はほとんど下げない)。
const C_OVERCAST_SKY = Color3.FromHexString('#8d9aa6'); // 雨雲の空
const C_OVERCAST_FOG = Color3.FromHexString('#93a0aa'); // 雨けむり
const C_OVERCAST_SUN = Color3.FromHexString('#b8c4d2'); // 雲ごしの弱い光
const C_OVERCAST_HEMI = Color3.FromHexString('#a2b0bc');
const C_OVERCAST_SEA = Color3.FromHexString('#3c5a6b');
/** 雨雲そのものの色。晴れの日の白い雲から この灰色へ寄せる */
const C_OVERCAST_CLOUD = Color3.FromHexString('#c2c9cf');
/** いちばん寒いとき(本降り)の効き方 */
const W_SKY_MIX = 0.72; // 空・霧の色をどれだけ寒色へ寄せるか
const W_LIGHT_MIX = 0.55; // 太陽・半球光の色
const W_SUN_DOWN = 0.48; // 太陽の強さの下げ幅
const W_HEMI_DOWN = 0.1; // 半球光の下げ幅(暗くしすぎない)
const W_FOG_UP = 1.05; // 霧の濃さの増し幅(雨けむり)
const W_GLOW_UP = 0.35; // 発光物の増し幅(暗い空の中で灯りが映える)

export class DayNight {
  sun: DirectionalLight;
  hemi: HemisphericLight;
  glow: GlowLayer;
  lumiBoost = 1; // ルミの木の段階で島の発光を強める
  lastGlow = { mint: 0, amber: 0, blue: 0 };
  private poolLight: PointLight;
  private acc = TICK; // 初回は即時反映
  private tmpA = new Color3();
  /**
   * v15 そら(グラデーション・星・天の川・月・雲)。
   * 時刻の色を決める場所を1つにするため、DayNight が持って毎回まとめて わたす。
   * 未設定でも 昼夜の色は これまでどおり動く(空だけ出ない)。
   */
  private sky: Sky | null = null;
  private skyDay: (() => number) | null = null;
  private skyColors: SkyColors = {
    horizon: new Color3(), sky: new Color3(), zenith: new Color3(), cloud: new Color3(),
  };
  /** 天気の寒色ぐあい(0=はれ 1=本降り)。WeatherSystemが毎フレーム書き込む */
  private cold = 0;
  /** 部屋にいるあいだの環境光の倍率(1=島にいる。setIndoorDamp 参照) */
  private indoorDamp = 1;
  private lastHour = 6;
  private lastPx: number | undefined;
  private lastPz: number | undefined;

  constructor(
    private scene: Scene,
    private water: WaterRefs
  ) {
    this.sun = new DirectionalLight('sun', new Vector3(-0.45, -1, -0.3), scene);
    this.sun.position = new Vector3(40, 60, 30);
    this.hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
    this.glow = new GlowLayer('glow', scene, { mainTextureSamples: 2 });
    this.glow.intensity = 0.4;
    // 天気の演出のうち、発光レイヤーに焼かれると にじむものを外す(虹)
    for (const m of weatherGlowExcludes()) this.glow.addExcludedMesh(m);
    // v16 ほしまつりの ランタンの かさ・うつりこみ(すでに加算合成の にじみ)も 外す。
    // 二重に にじませると 白い まるに つぶれて、紙のちょうちんの形が 消える
    for (const m of festivalGlowExcludes()) this.glow.addExcludedMesh(m);
    scene.fogMode = BScene.FOGMODE_EXP2;
    // 夜: いちばん近い発光物からプレイヤーへ光を回す(動的ライトはこの1灯のみ)
    this.poolLight = new PointLight('poolLight', new Vector3(0, -50, 0), scene);
    this.poolLight.intensity = 0;
    this.poolLight.range = 8;
    this.poolLight.diffuse = C_AMBER;
  }

  /**
   * v15 そらを つなぐ(IslandScene.build が 1回だけ呼ぶ)。
   * @param dayOf 日付を読む関数。月の満ち欠けに使う(値を持ちまわらず、そのつど読む)
   */
  attachSky(sky: Sky, dayOf: () => number): void {
    this.sky = sky;
    this.skyDay = dayOf;
    this.update(this.lastHour, this.lastPx, this.lastPz);
  }

  /** 毎フレーム呼ばれるが、実際の更新は15Hz */
  tick(dt: number, hour: number, px?: number, pz?: number): void {
    this.acc += dt;
    if (this.acc < TICK) return;
    this.acc = 0;
    this.update(hour, px, pz);
  }

  /**
   * 天気の寒色ぐあいを設定する(0=はれ 1=本降り)。
   * 色の計算はupdateにまとめてあるので、ここでは値を覚えて、変わったときだけ塗り直す
   * (setHourのような即時更新のあとでも、天気が反映された絵になる)。
   */
  setCold(cold: number): void {
    const v = Math.max(0, Math.min(1, cold));
    if (Math.abs(v - this.cold) < 0.004) return;
    this.cold = v;
    this.update(this.lastHour, this.lastPx, this.lastPz);
  }
  get coldLevel(): number {
    return this.cold;
  }

  /**
   * 部屋にいるあいだ、島の環境光(空の光と太陽)にかける倍率(1=そのまま)。
   *
   * 別空間の部屋は 島から離れた所に建っているだけで、空の光も太陽も そのまま当たる。
   * そのため部屋の点光源をいくら弱めても「暗い部屋」にならなかった(ノクトの部屋)。
   * ここを小さくすると その部屋にいるあいだだけ 全体が落ちる。
   * 部屋を出るときに 1 へ戻すのは IslandScene.setNpcRoom / setHomeRoom の役目。
   */
  setIndoorDamp(v: number): void {
    const d = Math.max(0.2, Math.min(1, v));
    if (Math.abs(d - this.indoorDamp) < 0.004) return;
    this.indoorDamp = d;
    this.update(this.lastHour, this.lastPx, this.lastPz);
  }
  get indoorDampLevel(): number {
    return this.indoorDamp;
  }

  /** 即時更新(デバッグ・イベント用) */
  update(hour: number, px?: number, pz?: number): void {
    this.lastHour = hour;
    this.lastPx = px;
    this.lastPz = pz;
    const w = this.cold;
    const h = hour < STOPS[0].h ? hour + 24 : hour;
    let a = STOPS[0], b = STOPS[STOPS.length - 1];
    for (let i = 0; i < STOPS.length - 1; i++) {
      if (h >= STOPS[i].h && h <= STOPS[i + 1].h) {
        a = STOPS[i];
        b = STOPS[i + 1];
        break;
      }
    }
    const t0 = (h - a.h) / (b.h - a.h || 1);
    const t = t0 * t0 * (3 - 2 * t0);
    const L = (x: number, y: number): number => x + (y - x) * t;

    Color3.LerpToRef(a.sky, b.sky, t, this.tmpA);
    // 天気ぶんの寒色寄せ。時刻の色を作りおえてから、その上に重ねる(時刻の階調は保つ)
    if (w > 0) Color3.LerpToRef(this.tmpA, C_OVERCAST_SKY, w * W_SKY_MIX, this.tmpA);
    this.scene.clearColor = new Color4(this.tmpA.r, this.tmpA.g, this.tmpA.b, 1);
    setWeatherSky(this.tmpA); // 水たまりの映りこみ・虹の下地に使う空の色
    Color3.LerpToRef(a.fog, b.fog, t, this.scene.fogColor);
    if (w > 0) Color3.LerpToRef(this.scene.fogColor, C_OVERCAST_FOG, w * W_SKY_MIX, this.scene.fogColor);
    this.scene.fogDensity = L(a.fogD, b.fogD) * (1 + w * W_FOG_UP);

    // ---- v15 そら: 地平線ぎわ=霧の色(海と空の継ぎ目を消す)/その上=空の色/てっぺん=1段ふかい色 ----
    // 空だけ別の表を持つと 天気や時刻でずれるので、色は ぜんぶ ここで作って わたす
    if (this.sky) {
      const sc = this.skyColors;
      sc.horizon.copyFrom(this.scene.fogColor);
      sc.sky.copyFrom(this.tmpA);
      Color3.LerpToRef(a.zen, b.zen, t, sc.zenith);
      Color3.LerpToRef(a.cloud, b.cloud, t, sc.cloud);
      if (w > 0) {
        // くもり・雨のときは 空のグラデーションを ねかせ(てっぺんも 同じ寒色へ寄せる)、
        // 雲そのものは 雨雲の灰色へ寄せる
        Color3.LerpToRef(sc.zenith, C_OVERCAST_SKY, w * W_SKY_MIX, sc.zenith);
        Color3.LerpToRef(sc.cloud, C_OVERCAST_CLOUD, w * 0.7, sc.cloud);
      }
      this.sky.applyTime(hour, this.skyDay ? this.skyDay() : 1, sc, w);
    }

    Color3.LerpToRef(a.sunC, b.sunC, t, this.sun.diffuse);
    if (w > 0) Color3.LerpToRef(this.sun.diffuse, C_OVERCAST_SUN, w * W_LIGHT_MIX, this.sun.diffuse);
    this.sun.intensity = L(a.sunI, b.sunI) * (1 - w * W_SUN_DOWN) * this.indoorDamp;
    Color3.LerpToRef(a.hemiC, b.hemiC, t, this.hemi.diffuse);
    Color3.LerpToRef(a.hemiG, b.hemiG, t, this.hemi.groundColor);
    if (w > 0) {
      Color3.LerpToRef(this.hemi.diffuse, C_OVERCAST_HEMI, w * W_LIGHT_MIX, this.hemi.diffuse);
      Color3.LerpToRef(this.hemi.groundColor, C_OVERCAST_HEMI, w * W_LIGHT_MIX * 0.5, this.hemi.groundColor);
    }
    // 開花後は夜の環境光がわずかに明るくなる(島がめざめた感じ)
    this.hemi.intensity =
      L(a.hemiI, b.hemiI) * (1 + (this.lumiBoost - 1) * 0.08) * (1 - w * W_HEMI_DOWN) * this.indoorDamp;

    // 太陽の向き(6時=東から、18時=西へ。夜は月の固定方向)
    const dayT = Math.max(0, Math.min(1, (hour - 6) / 12.5));
    if (hour >= 5.5 && hour <= 19) {
      const el = Math.max(0.38, Math.sin(Math.PI * dayT));
      this.sun.direction.set(-Math.cos(Math.PI * dayT) * 0.75, -el, -0.35);
      this.sun.direction.normalize();
    } else {
      this.sun.direction.set(0.25, -1, -0.2);
      this.sun.direction.normalize();
    }

    // 発光(植物・窓・街灯)+光だまり
    const gm = getGlowMats(this.scene);
    // 雨・くもりの暗い空では、窓や街灯の明かりを少しだけ強める(昼でも灯りが見えるように)
    const gw = 1 + w * W_GLOW_UP;
    const mint = L(a.glowMint, b.glowMint) * this.lumiBoost * gw;
    const amber = L(a.glowAmber, b.glowAmber) * gw;
    const blue = L(a.glowBlue, b.glowBlue) * Math.min(1.3, this.lumiBoost) * gw;
    this.lastGlow = { mint, amber, blue };
    gm.mint.emissiveColor.copyFrom(C_MINT);
    gm.mint.emissiveColor.scaleToRef(mint, gm.mint.emissiveColor);
    gm.amber.emissiveColor.copyFrom(C_AMBER);
    gm.amber.emissiveColor.scaleToRef(amber, gm.amber.emissiveColor);
    gm.blue.emissiveColor.copyFrom(C_BLUE);
    gm.blue.emissiveColor.scaleToRef(blue, gm.blue.emissiveColor);
    this.glow.intensity = (0.25 + L(a.glowMint, b.glowMint) * 0.5) * Math.min(1.4, this.lumiBoost);
    setPoolLevels(amber, mint, blue);

    // 海・池の色(雨のときは彩度を落として寒色へ)
    Color3.LerpToRef(a.sea, b.sea, t, this.water.seaMat.diffuseColor);
    if (w > 0) {
      Color3.LerpToRef(this.water.seaMat.diffuseColor, C_OVERCAST_SEA, w * W_LIGHT_MIX, this.water.seaMat.diffuseColor);
    }
    this.water.seaMat.diffuseColor.scaleToRef(0.96, this.water.pondMat.diffuseColor);

    // 夜のプレイヤー近傍ライト
    if (px !== undefined && pz !== undefined && amber > 0.12) {
      const src = nearestGlowSource(px, pz);
      if (src) {
        this.poolLight.position.set(src.x, src.y + 0.9, src.z);
        this.poolLight.intensity = 1.05 * amber;
      } else {
        this.poolLight.intensity = 0;
      }
    } else {
      this.poolLight.intensity = 0;
    }
  }
}

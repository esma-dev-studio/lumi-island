// カメラ遮蔽: カメラとプレイヤーの間に入った物を すかして、外れたら 元に戻す。
// 会話・見せ場の前には即時復元して、主役が透けたまま始まらないようにする。
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { SubMesh } from '@babylonjs/core/Meshes/subMesh';
import type { Material } from '@babylonjs/core/Materials/material';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import type { Scene } from '@babylonjs/core/scene';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import type { IslandScene } from './IslandScene';
import type { CameraController } from './CameraController';
import type { PlayerController } from '../systems/PlayerController';

// ---------------------------------------------------------------------------
// v27 「緑のセロファンの膜」をやめる。
//
// v26 までは mesh.visibility(=通常アルファ)で すかしていた。これは
// **どんなに うすくしても「色のついた膜」**になる:
//   - 半透明の面は 背景の色に 葉の緑を のせるので、画面ぜんたいが 緑がかる
//   - 半透明の面は 不透明の列から 外れて 奥から順に 描かれるので、
//     手前の しげみ・地面より あとに 上書きされ、遠近が くずれて見える
//   実測(.logs/screenshots/audit_v17/04_forest_north.png): 半透明の樹冠1枚が
//   画面の1/4を おおい、緑の セロファンを はったように 見えていた。
//
// v27 の やりかた = **ディザ透過(スクリーンドア)**。
//   画素を うすくするのではなく、**Bayer 8x8 の 網目で 画素を 間引く(discard)**。
//   残った画素は **不透明のまま**なので、
//     - 色の膜が 原理的に 出ない(背景の色は そのまま 見える)
//     - 不透明の列で 描かれる = 並べ替え不要・遠近が くずれない
//     - 影・GlowLayer は 別パスなので これまでどおり
//   時間の 補間は「網目の こまかさ(残す割合)」を 動かして行う。
//
// さらに v27 は **穴(hole)**を あける:
//   ディザを かけるのは 画面上の **プレイヤーの まわりの円**だけにして、
//   そこから 外は 元の 不透明の木のまま にする。
//   ——「木は 木のまま・プレイヤーの前だけ 網目になる」ので、
//     林ぜんたいが スカスカに 見えることが なくなる。
//
// 判定(だれを すかすか)も しぼった:
//   v26 は「外わく球の中心が 視線から 半径×0.72 の内側か」だけを見ていたので、
//   よこに 立っているだけの 木(球の中心は 近いが 実際には 前に いない)も 対象になった。
//   v27 は **カメラ→プレイヤーの線分 vs メッシュの外わく箱(+円柱の太さ SEG_R)**で判定する。
//   ほそ長い木・ひくい岩の 形が そのまま 効くので、本当に 前に立っている物だけが 残る。
// ---------------------------------------------------------------------------

/** 小さな遮蔽物で 残す画素の割合(形が読めるていどに残す) */
const FADE_SMALL = 0.34;
/** 画面を まるごと ふさぐ 大きな葉群・屋根で 残す画素の割合 */
const FADE_HUGE = 0.12;
/** 見かけの角の大きさ(外わく半径 ÷ 距離)。この間で FADE_SMALL → FADE_HUGE へ移る */
const HUGE_K0 = 0.3;
const HUGE_K1 = 0.78;
/**
 * 下限まで かかる時間(秒)。深さが変わっても 同じ時間で とどくように、
 * 1歩の幅を (1 - 下限) から 割り出す(深いフェードだけ もたつく、が起きない)。
 */
const FADE_STEPS = 5.5;
/** 元にもどる1歩(15Hzごと)。かかりは はやく・もどりは ゆっくり(しっとり側に寄せる) */
const RECOVER_STEP = 0.1;

/**
 * 遮蔽の判定に使う「線分の太さ」(m)。カメラ→プレイヤーの線分を この半径の
 * 円柱に ふとらせ、メッシュの外わく箱と まじわるものだけを 対象にする。
 * プレイヤーの体の半径(約0.35m)+ 余裕。大きくすると よこの木まで 網目になる。
 */
export const SEG_R = 1.0;
/**
 * 線分の どこまでで「前に いる」と みなすか(0=カメラ, 1=プレイヤー)。
 * プレイヤーに ほぼ くっついている物(足もとの草など)は すかさない。
 */
const SEG_T_MAX = 0.93;

/**
 * 穴のふち(内側): この距離までは すきまなく 網目にする(m)。
 * プレイヤーの 背たけの半分(約0.68m)より 大きくして、頭のてっぺんまで 確実に あける。
 */
const HOLE_R_IN = 0.85;
/**
 * 穴のふち(外側): ここから外は 元の不透明にもどる(m)。
 * 大きくすると なめらかだが、木が よこを かすめただけの場面で
 * 網目の しみが 広く出る(実測: 2.4mでは 画面の1/6に しみが出た)。
 */
const HOLE_R_OUT = 1.6;
/** 穴を使わないとき(mode='dither')に入れる 巨大な半径(画素) */
const HOLE_OFF_IN = 1e6;
const HOLE_OFF_OUT = 2e6;
/**
 * 「プレイヤーより手前」と みなす余裕(m)。
 * 穴モードでは **カメラからプレイヤーまでの距離より近い画素だけ**を間引く。
 * こうすると、同じメッシュでも「プレイヤーの向こうがわに ある葉」は 元のまま残り、
 * 本当に 前に かぶさっている葉だけが 網目になる
 * ——木のよこを 通りすぎるだけの場面で 画面が よごれない。
 */
const HOLE_DEPTH_MARGIN = 0.15;
/** 穴を使わないときの 深さのしきい値(実質 無限=全部を「手前」とみなす) */
const HOLE_DEPTH_OFF = 1e6;

/**
 * その遮蔽物で **残す画素の割合**(0..1。小さいほど よく透ける)。
 *
 * v26 では「アルファの下限」だったが、v27 では「Bayer の網目で 残す画素の割合」。
 * 値の意味は変わっても「画面を ふさぐものほど 深く すかす」という ねらいも、
 * 画面占有率から 割り出した 0.12〜0.34 という 幅も そのまま使う。
 *
 * @param radiusWorld 外わく(境界球)の半径 m
 * @param dc          カメラから 外わくの中心までの距離 m
 */
export function fadeFloor(radiusWorld: number, dc: number): number {
  const k = radiusWorld / Math.max(0.4, dc);
  const t = Math.max(0, Math.min(1, (k - HUGE_K0) / (HUGE_K1 - HUGE_K0)));
  const s = t * t * (3 - 2 * t); // なめらかに(しきい値で かくかく 変わらない)
  return FADE_SMALL + (FADE_HUGE - FADE_SMALL) * s;
}

/**
 * 線分(a→b)が 箱(min..max を r だけ ふくらませたもの)を つらぬくか。
 * つらぬくなら 入口の位置(0..1)、つらぬかないなら -1 を返す。
 * ——スラブ法。平方根も 三角関数も 使わない。
 *
 * 遮蔽の候補は 島ぜんぶで 200個ちかくあり、これを 15Hz で まわす。
 * 配列を1つでも 作ると 毎秒1万個のごみになるので、軸ごとに べた書きする
 * (v26 の判定も 同じ理由で 配列を使っていなかった)。
 */
export function segmentBoxEnter(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  minx: number, miny: number, minz: number,
  maxx: number, maxy: number, maxz: number,
  r: number
): number {
  let t0 = 0;
  let t1 = 1;
  // 1軸ぶんの スラブ。範囲の外なら すぐ -1
  const slab = (a: number, d: number, lo: number, hi: number): boolean => {
    if (d > -1e-6 && d < 1e-6) return a >= lo && a <= hi;
    let ta = (lo - a) / d;
    let tb = (hi - a) / d;
    if (ta > tb) {
      const s = ta;
      ta = tb;
      tb = s;
    }
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    return t0 <= t1;
  };
  if (!slab(ax, bx - ax, minx - r, maxx + r)) return -1;
  if (!slab(ay, by - ay, miny - r, maxy + r)) return -1;
  if (!slab(az, bz - az, minz - r, maxz + r)) return -1;
  return t0;
}

/** 遮蔽の見せかた。既定は 'hole'(ディザ+プレイヤーのまわりだけ) */
export type OcclusionMode = 'hole' | 'dither' | 'alpha' | 'off';

/**
 * だれを すかすかの 決めかた(比較用に3段。既定は 'ray')。
 *   sphere … v26。外わく球の中心が 視線から 半径×0.72 の内側か
 *   box    … カメラ→プレイヤーの線分 vs 外わく箱(+SEG_R)
 *   ray    … box で ふるったあと、**本当に 葉に あたっているか**を 3本のレイで確かめる
 *
 * ray まで やる理由: 木は「みき + はなれた 葉のかたまり」なので、外わく箱には
 * 大きな すきまが 入る。箱だけだと「よこに 立っているだけの木」も 当たってしまい、
 * プレイヤーの となりに 網目の しみが 出る(実測: 構図04)。
 */
export type OcclusionAim = 'sphere' | 'box' | 'ray';

/** レイを飛ばす先(プレイヤーのどこを かくされたくないか)。y は 足もとからの高さ m */
const AIM_POINTS: { y: number; side: number }[] = [
  { y: 0.75, side: 0 }, // むね
  { y: 1.3, side: 0 }, // あたま
  { y: 0.75, side: 0.32 }, // かたはば(右)
  { y: 0.75, side: -0.32 }, // かたはば(左)
];

/** 画面上の「穴」。x,y=中心(デバイス画素) rIn/rOut=ふち(デバイス画素) depth=プレイヤーまでの距離(m) */
interface HoleRect {
  x: number;
  y: number;
  rIn: number;
  rOut: number;
  depth: number;
}

/**
 * ディザのマテリアルプラグインが 読む 共有の入れもの。
 * メッシュごとの「残す割合」と、1フレームに1回だけ求める「穴」を持つ。
 */
class DitherRegistry {
  /** メッシュ → 残す画素の割合(0..1)。無ければ 1(=なにも間引かない) */
  readonly keep = new Map<AbstractMesh, number>();
  private hole: HoleRect = { x: 0, y: 0, rIn: HOLE_OFF_IN, rOut: HOLE_OFF_OUT, depth: HOLE_DEPTH_OFF };
  private holeFrame = -1;
  /** 穴を使うか(mode='dither' のときは false=全面を網目にする) */
  useHole = true;
  /** プレイヤーの ワールド座標(穴の中心)。GameScene 側から 毎フレーム 読み直す */
  playerAt: () => { x: number; y: number; z: number } = () => ({ x: 0, y: 0, z: 0 });

  keepOf(m: AbstractMesh): number {
    return this.keep.get(m) ?? 1;
  }

  /**
   * 穴の中心と ふちを デバイス画素で求める。
   * 描画のさいちゅう(hardBindForSubMesh)に呼ばれるので、そのフレームの
   * view×projection が すでに 確定している = 1フレームの ずれが 出ない。
   * 同じフレームで 何度 呼ばれても 計算は1回だけ。
   */
  holeOf(scene: Scene): HoleRect {
    const frame = scene.getFrameId();
    if (frame === this.holeFrame) return this.hole;
    this.holeFrame = frame;
    if (!this.useHole) {
      this.hole = { x: 0, y: 0, rIn: HOLE_OFF_IN, rOut: HOLE_OFF_OUT, depth: HOLE_DEPTH_OFF };
      return this.hole;
    }
    const eng = scene.getEngine();
    const W = eng.getRenderWidth();
    const H = eng.getRenderHeight();
    const m = scene.getTransformMatrix().m; // view × projection
    const p = this.playerAt();
    // 胸のあたりを 中心にする(足もとだと 頭が 網目から はみ出す)
    const cy = p.y + 0.75;
    const cam = scene.activeCamera;
    const camDist = cam
      ? Math.hypot(p.x - cam.globalPosition.x, cy - cam.globalPosition.y, p.z - cam.globalPosition.z)
      : HOLE_DEPTH_OFF;
    const proj = (x: number, y: number, z: number): { sx: number; sy: number; w: number } => {
      const w = x * m[3] + y * m[7] + z * m[11] + m[15];
      const iw = Math.abs(w) < 1e-6 ? 0 : 1 / w;
      const nx = (x * m[0] + y * m[4] + z * m[8] + m[12]) * iw;
      const ny = (x * m[1] + y * m[5] + z * m[9] + m[13]) * iw;
      // NDC(-1..1, y上向き)→ gl_FragCoord(0..W/H, y上向き)
      return { sx: (nx * 0.5 + 0.5) * W, sy: (ny * 0.5 + 0.5) * H, w };
    };
    const c = proj(p.x, cy, p.z);
    const up = proj(p.x, cy + 1, p.z);
    // 1mが 何画素になるか。カメラの後ろ・真横に来たら 穴を閉じる
    const pxPerM = c.w > 0.05 ? Math.abs(up.sy - c.sy) : 0;
    this.hole =
      pxPerM > 1
        ? {
            x: c.sx,
            y: c.sy,
            rIn: HOLE_R_IN * pxPerM,
            rOut: HOLE_R_OUT * pxPerM,
            depth: Math.max(0.2, camDist - HOLE_DEPTH_MARGIN),
          }
        : { x: 0, y: 0, rIn: HOLE_OFF_IN, rOut: HOLE_OFF_OUT, depth: HOLE_DEPTH_OFF };
    return this.hole;
  }
}

/**
 * ディザ透過のマテリアルプラグイン。
 *
 * **元のマテリアルには 付けない**(全部の草木の フラグメントに discard が入り、
 * GPUの 早期Zが 効かなくなる)。遮蔽の対象になった メッシュにだけ、
 * 元マテリアルの **複製** を あてがい、そちらに このプラグインを付ける。
 *
 * uniform は メッシュごとに 変える必要があるが、Babylon は
 * 「同じマテリアル・同じ効果・同じ visibility」の 連続描画で bindForSubMesh を
 * 省略する。**hardBindForSubMesh は 省略されない**ので こちらに置く。
 */
class OcclusionDitherPlugin extends MaterialPluginBase {
  constructor(
    material: Material,
    private readonly reg: DitherRegistry
  ) {
    // enable は ここでは false。registerForExtraEvents を true にしてからでないと
    // hardBindForSubMesh の 登録が 行われない(_activatePlugin が その場で見る)
    super(material, 'LumiOccDither', 210, undefined, true, false);
    this.registerForExtraEvents = true;
    this._enable(true);
  }

  getClassName(): string {
    return 'LumiOccDither';
  }

  getUniforms(): { externalUniforms: string[] } {
    // 宣言は CUSTOM_FRAGMENT_DEFINITIONS 側で書く。ここは
    // 「Effect が 場所を 引けるように 名前を 教える」だけ
    return { externalUniforms: ['lumiOccKeep', 'lumiOccHole', 'lumiOccDepth'] };
  }

  getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    if (shaderType !== 'fragment') return null;
    return {
      // Bayer 8x8(64段)を 3回の fract で 作る。配列の添字を 使わないので
      // WebGL1/WebGL2 の どちらでも 同じように 通る
      CUSTOM_FRAGMENT_DEFINITIONS: `
uniform float lumiOccKeep;
uniform vec4 lumiOccHole;
uniform float lumiOccDepth;
float lumiBayer2(vec2 a){ vec2 b=floor(a); return fract(b.x*0.5+b.y*b.y*0.75); }
float lumiBayer8(vec2 a){ return lumiBayer2(a*0.25)*0.0625+lumiBayer2(a*0.5)*0.25+lumiBayer2(a); }
`,
      // プレイヤーより手前の画素だけを、プレイヤーのまわりの円の中で 間引く。
      // vPositionW と vEyePosition は default.fragment がいつも持っている
      CUSTOM_FRAGMENT_MAIN_BEGIN: `
if(distance(vPositionW,vEyePosition.xyz)<lumiOccDepth){
  float lumiD=distance(gl_FragCoord.xy,lumiOccHole.xy);
  float lumiK=mix(lumiOccKeep,1.0,smoothstep(lumiOccHole.z,lumiOccHole.w,lumiD));
  if(lumiBayer8(gl_FragCoord.xy)>=lumiK) discard;
}
`,
    };
  }

  hardBindForSubMesh(_ubo: UniformBuffer, scene: Scene, _engine: AbstractEngine, subMesh: SubMesh): void {
    const eff = subMesh.effect;
    if (!eff) return;
    const h = this.reg.holeOf(scene);
    eff.setFloat('lumiOccKeep', this.reg.keepOf(subMesh.getRenderingMesh()));
    eff.setFloat4('lumiOccHole', h.x, h.y, h.rIn, h.rOut);
    eff.setFloat('lumiOccDepth', h.depth);
  }
}

export class OcclusionController {
  private faded = new Set<Mesh>();
  private recovering = new Set<Mesh>();
  private occScratch = new Set<Mesh>(); // 15Hzごとのnew Setを避ける
  /** 今回のフレームで決めた「そのメッシュの下限」。ループを2回まわさないための入れもの */
  private floorOf = new Map<Mesh, number>();
  /** メッシュごとの いまの「残す割合」(1=素のまま)。ディザ用 */
  private levelOf = new Map<Mesh, number>();
  /** 元マテリアル → ディザ用の複製 */
  private ditherMat = new Map<Material, Material>();
  /** いま複製をあてているメッシュ → 元マテリアル(戻すため) */
  private swapped = new Map<Mesh, Material>();
  private reg = new DitherRegistry();
  private mode: OcclusionMode = 'hole';
  /** だれを すかすかの 決めかた(比較用に切り替えられる) */
  private aim: OcclusionAim = 'ray';
  /** 今回の update で使う レイの向きと長さ */
  private aimRays: { ox: number; oy: number; oz: number; dx: number; dy: number; dz: number; len: number }[] = [];
  /** メッシュの三角形(遮蔽物は動かないので1回だけ読む)。取れなければ null */
  private geom = new Map<Mesh, { pos: ArrayLike<number>; idx: ArrayLike<number> } | null>();

  constructor(
    private island: IslandScene,
    private player: PlayerController,
    private camCtl: CameraController
  ) {
    this.reg.playerAt = () => ({ x: this.player.x, y: this.player.y, z: this.player.z });
    // 遮蔽の対象になりうる マテリアルの複製を **先に** 作っておく。
    // 遊んでいる さいちゅうに 作ると、そのマテリアルの シェーダを
    // その場で コンパイルすることになり 1フレーム 止まる。
    // ここは GameScene の init(=読み込み画面の裏)なので 見えない。
    for (const m of this.island.occludables) {
      const src = m.material;
      if (src) this.ditherMaterialFor(src);
    }
  }

  /** 見せかたを切り替える(検証・比較用。切り替えのたびに いったん全復元する) */
  setMode(mode: OcclusionMode): void {
    if (mode === this.mode) return;
    this.restoreAllImmediately();
    this.mode = mode;
    this.reg.useHole = mode === 'hole';
  }

  /** だれを すかすかの 決めかたを切り替える(検証・比較用) */
  setAim(aim: OcclusionAim): void {
    if (aim === this.aim) return;
    this.restoreAllImmediately();
    this.aim = aim;
  }

  /** 透明化中・回復途中のメッシュを即座に全復元する(会話・イベントカメラ開始前に呼ぶ) */
  restoreAllImmediately(): void {
    for (const m of this.faded) this.restoreMesh(m);
    for (const m of this.recovering) this.restoreMesh(m);
    // 保険: どの集合からも 落ちてしまったメッシュが 複製マテリアルを 持ったままにならない
    // ようにする(「木が すけたまま 残る」は 見た目の事故として いちばん重い)
    for (const m of [...this.swapped.keys()]) this.restoreMesh(m);
    this.faded.clear();
    this.recovering.clear();
    this.floorOf.clear();
    this.levelOf.clear();
    this.reg.keep.clear();
  }

  /** いま すかしているメッシュ(検証・撮影用。読むだけで副作用はない) */
  get fadedList(): { name: string; visibility: number; keep: number; floor: number }[] {
    const out: { name: string; visibility: number; keep: number; floor: number }[] = [];
    for (const m of this.faded) {
      out.push({
        name: m.name,
        visibility: m.visibility,
        keep: this.levelOf.get(m) ?? 1,
        floor: this.floorOf.get(m) ?? FADE_SMALL,
      });
    }
    return out;
  }

  /** いまの設定(検証用) */
  get settings(): { mode: OcclusionMode; aim: OcclusionAim; segR: number; swapped: number } {
    return { mode: this.mode, aim: this.aim, segR: SEG_R, swapped: this.swapped.size };
  }

  update(): void {
    if (this.mode === 'off') {
      if (this.faded.size || this.recovering.size) this.restoreAllImmediately();
      return;
    }
    const p = this.player;
    const c = this.camCtl.cam.position;
    const px = p.x, py = p.y + 0.8, pz = p.z;
    const dx = px - c.x, dy = py - c.y, dz = pz - c.z;
    const L = Math.hypot(dx, dy, dz);
    const nowFaded = this.occScratch;
    nowFaded.clear();
    this.floorOf.clear();
    if (this.aim === 'ray') this.buildAimRays(c.x, c.y, c.z, p.x, p.y, p.z);
    // 画面に写っていないメッシュは 透かす意味がない(カメラを ふり向けた先が
    // 最初から うすくなっている、が起きる)。frustumPlanes は 1フレームめだけ
    // まだ無いことがあるので、そのときは これまでどおり 全部を見る
    const planes = this.island.scene.frustumPlanes ?? null;
    for (const m of this.island.occludables) {
      const bi = m.getBoundingInfo();
      const b = bi.boundingSphere;
      const cw = b.centerWorld;
      const dc = Math.hypot(cw.x - c.x, cw.y - c.y, cw.z - c.z);
      let blocks: boolean;
      if (this.aim !== 'sphere') {
        // 線分 vs 外わく箱(+円柱の太さ)。ほそ長い木の形が そのまま 効く
        const bb = bi.boundingBox;
        const lo = bb.minimumWorld;
        const hi = bb.maximumWorld;
        const t = segmentBoxEnter(
          c.x, c.y, c.z, px, py, pz,
          lo.x, lo.y, lo.z, hi.x, hi.y, hi.z, SEG_R
        );
        blocks = t >= 0 && t < SEG_T_MAX;
        // 外わく箱には「みきと 葉のあいだの すきま」も入る。
        // 本当に 葉に あたっているかを レイで 確かめる(ここを省くと
        // よこに 立っているだけの木に 網目の しみが 出る)
        if (blocks && this.aim === 'ray') blocks = this.rayHits(m);
      } else {
        // v26 の判定(比較用)。外わく球の中心が 視線から どれだけ 離れているか だけ
        const inside = dc < b.radiusWorld * 0.95;
        blocks = inside;
        if (!inside) {
          const t = Math.max(0.05, Math.min(0.95, ((cw.x - c.x) * dx + (cw.y - c.y) * dy + (cw.z - c.z) * dz) / (L * L)));
          const qx = c.x + dx * t, qy = c.y + dy * t, qz = c.z + dz * t;
          const d = Math.hypot(cw.x - qx, cw.y - qy, cw.z - qz);
          blocks = d < b.radiusWorld * 0.72 && t < 0.93;
        }
      }
      if (!blocks) continue;
      if (planes && !m.isInFrustum(planes)) continue;
      nowFaded.add(m);
      this.floorOf.set(m, fadeFloor(b.radiusWorld, dc));
    }
    for (const m of nowFaded) {
      const floor = this.floorOf.get(m) ?? FADE_SMALL;
      // 深いフェードほど 1歩を大きくして、下限に とどくまでの時間を そろえる
      const step = (1 - floor) / FADE_STEPS;
      const cur = this.levelOf.get(m) ?? 1;
      const next = cur > floor ? Math.max(floor, cur - step) : Math.min(floor, cur + step);
      this.applyLevel(m, next);
      this.recovering.delete(m);
    }
    // 対象から外れたメッシュは、完全に戻りきるまで回復を続ける(途中で0.98等のまま残さない)
    for (const m of this.faded) {
      if (!nowFaded.has(m)) this.recovering.add(m);
    }
    for (const m of this.recovering) {
      const next = Math.min(1, (this.levelOf.get(m) ?? 1) + RECOVER_STEP);
      this.applyLevel(m, next);
      if (next >= 1) this.recovering.delete(m);
    }
    // ディザの複製マテリアルは 昼夜で 動く色(ランプの emissive など)を
    // 持っていない。使っているあいだだけ 元マテリアルから 写しておく
    this.syncSwappedMaterials();
    this.occScratch = this.faded; // 前回セットを次回のスクラッチとして再利用
    this.faded = nowFaded;
  }

  // -------------------------------------------------------------------------
  // だれを すかすか(レイでの 仕上げ判定)
  // -------------------------------------------------------------------------

  /**
   * カメラから プレイヤーの4点(むね・あたま・両かた)へ 向かうレイを 組み直す。
   * 1回の update につき 1回だけ。長さは プレイヤーの手前 SEG_T_MAX までにして、
   * 足もとの草や プレイヤー自身を ひろわないようにする。
   */
  private buildAimRays(cx: number, cy: number, cz: number, px: number, py: number, pz: number): void {
    this.aimRays.length = 0;
    // カメラ→プレイヤーの水平の向きから「よこ」を作る(肩はばのレイに使う)
    const fx = px - cx;
    const fz = pz - cz;
    const fl = Math.hypot(fx, fz) || 1;
    const rx = -fz / fl;
    const rz = fx / fl;
    for (const a of AIM_POINTS) {
      const tx = px + rx * a.side;
      const ty = py + a.y;
      const tz = pz + rz * a.side;
      const dx = tx - cx, dy = ty - cy, dz = tz - cz;
      const len = Math.hypot(dx, dy, dz);
      if (len < 0.2) continue;
      this.aimRays.push({
        ox: cx, oy: cy, oz: cz,
        dx: dx / len, dy: dy / len, dz: dz / len,
        len: len * SEG_T_MAX,
      });
    }
  }

  /**
   * そのメッシュが 4本のレイの どれかを さえぎっているか。
   *
   * Babylon の mesh.intersects を使わないのは、**依存を増やしたくない**から
   * (@babylonjs/core の 新しい 値としてのimportを1本足すだけで Viteの
   *  依存プリバンドルが 割り直され、起動ごと落ちる — 教訓4)。
   * レイをメッシュのローカル座標へ移して、Möller–Trumbore で 三角形と当てる。
   * 面の裏表は 見ない(この島のメッシュは 巻き順が そろっていない物がある)。
   */
  private rayHits(m: Mesh): boolean {
    const g = this.geomOf(m);
    if (!g) return true; // 三角形が読めないときは 安全側(すかす)へ倒す
    const inv = m.getWorldMatrix().clone();
    inv.invert();
    const e = inv.m;
    const { pos, idx } = g;
    for (const a of this.aimRays) {
      // 原点は点として、向きはベクトルとして ローカルへ移す。
      // 一次変換なので パラメータ t(=ワールドでの距離)は そのまま使える
      const ox = a.ox * e[0] + a.oy * e[4] + a.oz * e[8] + e[12];
      const oy = a.ox * e[1] + a.oy * e[5] + a.oz * e[9] + e[13];
      const oz = a.ox * e[2] + a.oy * e[6] + a.oz * e[10] + e[14];
      const dx = a.dx * e[0] + a.dy * e[4] + a.dz * e[8];
      const dy = a.dx * e[1] + a.dy * e[5] + a.dz * e[9];
      const dz = a.dx * e[2] + a.dy * e[6] + a.dz * e[10];
      for (let i = 0; i + 2 < idx.length; i += 3) {
        const i0 = idx[i] * 3, i1 = idx[i + 1] * 3, i2 = idx[i + 2] * 3;
        const ax = pos[i0], ay = pos[i0 + 1], az = pos[i0 + 2];
        const e1x = pos[i1] - ax, e1y = pos[i1 + 1] - ay, e1z = pos[i1 + 2] - az;
        const e2x = pos[i2] - ax, e2y = pos[i2 + 1] - ay, e2z = pos[i2 + 2] - az;
        const px = dy * e2z - dz * e2y;
        const py = dz * e2x - dx * e2z;
        const pz = dx * e2y - dy * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (det > -1e-8 && det < 1e-8) continue; // レイと平行
        const invDet = 1 / det;
        const tx = ox - ax, ty = oy - ay, tz = oz - az;
        const u = (tx * px + ty * py + tz * pz) * invDet;
        if (u < 0 || u > 1) continue;
        const qx = ty * e1z - tz * e1y;
        const qy = tz * e1x - tx * e1z;
        const qz = tx * e1y - ty * e1x;
        const v = (dx * qx + dy * qy + dz * qz) * invDet;
        if (v < 0 || u + v > 1) continue;
        const t = (e2x * qx + e2y * qy + e2z * qz) * invDet;
        if (t > 0.05 && t < a.len) return true;
      }
    }
    return false;
  }

  /** そのメッシュの頂点と三角形(1回だけ読んで使いまわす。遮蔽物は動かない) */
  private geomOf(m: Mesh): { pos: ArrayLike<number>; idx: ArrayLike<number> } | null {
    if (this.geom.has(m)) return this.geom.get(m) ?? null;
    const pos = m.getVerticesData('position');
    const idx = m.getIndices();
    const g = pos && idx && idx.length >= 3 ? { pos, idx } : null;
    this.geom.set(m, g);
    return g;
  }

  // -------------------------------------------------------------------------
  // すかしかたの実体
  // -------------------------------------------------------------------------

  /** そのメッシュの「残す割合」を level(0..1) にする */
  private applyLevel(m: Mesh, level: number): void {
    if (level >= 1) {
      this.restoreMesh(m);
      return;
    }
    this.levelOf.set(m, level);
    if (this.mode === 'alpha') {
      m.visibility = level;
      return;
    }
    // ディザ: 不透明のまま 網目で 間引く
    this.reg.keep.set(m, level);
    if (this.swapped.has(m)) return;
    const src = m.material;
    const dit = src ? this.ditherMaterialFor(src) : null;
    if (!src || !dit) {
      // 複製できないマテリアル(MultiMaterial など)は v26 と同じ 半透明で のがす。
      // 膜が出るのは よくないが、主役が 隠れたままに なるほうが もっと悪い
      m.visibility = level;
      return;
    }
    this.swapped.set(m, src);
    m.material = dit;
  }

  /** そのメッシュを 素の見た目に もどす */
  private restoreMesh(m: Mesh): void {
    this.levelOf.delete(m);
    m.visibility = 1;
    this.reg.keep.delete(m);
    const src = this.swapped.get(m);
    if (src) {
      m.material = src;
      this.swapped.delete(m);
    }
  }

  /**
   * 元マテリアルに対応する「ディザ用の複製」を返す(1回だけ作って使いまわす)。
   * 複製できないマテリアルでは null を返し、そのメッシュは すかさない
   * (すかせないより、膜が出るほうが 悪い)。
   */
  private ditherMaterialFor(src: Material): Material | null {
    const hit = this.ditherMat.get(src);
    if (hit) return hit === src ? null : hit; // src 自身は「作れなかった」印
    // プラグインを 受けつけるのは Standard/PBR 系だけ(MultiMaterial には 付かない)
    const kind = src.getClassName();
    if (kind !== 'StandardMaterial' && kind !== 'PBRMaterial' && kind !== 'PBRMetallicRoughnessMaterial') {
      this.ditherMat.set(src, src);
      return null;
    }
    const cloned = src.clone(`${src.name}_occDither`);
    if (!cloned) {
      this.ditherMat.set(src, src); // 二度と試さない印(= すかさない)
      return null;
    }
    new OcclusionDitherPlugin(cloned, this.reg);
    this.ditherMat.set(src, cloned);
    return cloned;
  }

  /** 使用中の複製へ、元マテリアルの「動く色」を写す(昼夜でランプの色が止まらないように) */
  private syncSwappedMaterials(): void {
    for (const src of this.swapped.values()) {
      const dst = this.ditherMat.get(src);
      if (!dst || dst === src) continue;
      if (src.getClassName() !== 'StandardMaterial' || dst.getClassName() !== 'StandardMaterial') continue;
      const s = src as StandardMaterial;
      const d = dst as StandardMaterial;
      d.diffuseColor.copyFrom(s.diffuseColor);
      d.emissiveColor.copyFrom(s.emissiveColor);
      d.specularColor.copyFrom(s.specularColor);
      d.ambientColor.copyFrom(s.ambientColor);
      d.alpha = s.alpha;
    }
  }
}

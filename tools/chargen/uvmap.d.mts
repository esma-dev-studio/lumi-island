// tools/chargen/uvmap.mjs の型定義(UVアトラスの配置)。
// tsconfig の include に tests/unit が入っているので、テストから import するには型が要る
// (tools/ は JS のままにしたいので、実装は .mjs・型だけ ここに置く)。

export declare const TEXSIZE: number;

/** ピクセル矩形と、そこから作った各種UV表現 */
export interface UvRegion {
  px: { x: number; y: number; w: number; h: number };
  bt: [number, number, number, number];
  tb: [number, number, number, number];
  uv: (u: number, v: number) => [number, number];
}

/** 部位ごとのUV領域(頭・髪・服・脚・腕…) */
export declare const REG: Record<string, UvRegion>;

/** 表情の名前(GLBのモーフターゲット名) */
export declare const FACE_NAMES: readonly string[];

/** 口の絵の大きさ(px)。頭の絵から そのまま写すので 写す元と同じ */
export declare const MOUTH_PATCH: { w: number; h: number };

/** 表情ごとの目・口のUV領域 */
export declare const FACE_REG: Record<string, { eyeL: UvRegion; eyeR: UvRegion; mouth: UvRegion }>;

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

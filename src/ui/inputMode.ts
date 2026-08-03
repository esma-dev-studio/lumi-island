// 画面に出す操作案内を「いまの入力手段」で切り替えるための小さなヘルパー。
//
// 入力手段の判定はここでは持たない(UA判定もしない)。TouchControls が
// pointerType==='touch' の観測で出し入れしているタッチUIの根(.touch-root)の
// 表示状態を、そのまま唯一の情報源として読む。
// TouchControls.setVisible() は visible フィールドと .hidden クラスを必ず同時に
// 更新するので、案内文とタッチUIの見え方が食い違うことはない。
// (TouchControls.ts 側は編集しない=読むだけ)
//
// ただしタイトル画面は GameScene より前なので TouchControls がまだ存在しない。
// そこだけ下の順で代わりの手がかりを見る(判定はこのファイルだけに置き、
// 呼び出し側には一切書かない):
//   1) .touch-root がある      → その表示状態(ゲーム中はこれだけを見る)
//   2) <html class="touch-ui"> → main.ts がタッチ端末に付けている印
//   3) (pointer: coarse)       → 上の2つが無い環境の最後の手がかり

/** TouchControls がタッチUIの根に付けているクラス名 */
export const TOUCH_ROOT_CLASS = 'touch-root';

/** main.ts がタッチ端末のとき <html> に付けるクラス名(TouchControlsが無い場面用) */
export const TOUCH_DEVICE_CLASS = 'touch-ui';

// 毎フレーム querySelector しないための保持。作り直し(dispose)は isConnected で気づく。
let cachedRoot: Element | null = null;

function touchRoot(): Element | null {
  if (typeof document === 'undefined') return null; // 画面のない環境(単体テスト等)
  if (cachedRoot && cachedRoot.isConnected) return cachedRoot;
  cachedRoot = document.querySelector(`.${TOUCH_ROOT_CLASS}`);
  return cachedRoot;
}

/**
 * いまタッチ操作か(=タッチUIが画面に出ているか)。
 * 案内を出すたびに呼ぶこと。起動時に固定してはいけない
 * (キーボードで始めて途中から指で触った場合も切り替わる)。
 */
export function isTouchMode(): boolean {
  if (typeof document === 'undefined') return false; // 画面のない環境(単体テスト等)
  const el = touchRoot();
  // ゲーム中: タッチUIの表示状態だけを見る(キーボードに持ちかえたら false に戻る)
  if (el) return !el.classList.contains('hidden');
  // タイトル画面など、TouchControls がまだ作られていない場面のフォールバック
  if (document.documentElement.classList.contains(TOUCH_DEVICE_CLASS)) return true;
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches
  );
}

/** 入力手段で文言を選ぶ。第1引数=キーボード、第2引数=タッチ */
export function byInput<T>(keyboard: T, touch: T): T {
  return isTouchMode() ? touch : keyboard;
}

/** 右下の丸い行動ボタンが代わりをするキー(押す場所が1つしかないので消すだけ) */
const ACTION_KEY_RE = /<kbd>\s*(?:E|Space)\s*<\/kbd>/gi;

/**
 * ヒント(HTML)からキーの表示を取り除く。元の文字列(InteractionRouting 等)は変えない。
 * ・E/Space は右下の大きいボタンが代わりなので消すだけ
 * ・R/Esc など専用ボタンがあるキーは、そこから後ろを切り落とす
 *   (「まわす」「やめる」は配置中のボタンとして画面に出ている)
 */
export function hintWithoutKeys(html: string): string {
  if (!html) return '';
  let s = html.replace(ACTION_KEY_RE, '');
  const other = s.search(/<kbd>/i);
  if (other >= 0) s = s.slice(0, other);
  return s.trim();
}

/** テスト用: 保持している .touch-root を捨てて次回に引き直す */
export function resetInputModeCache(): void {
  cachedRoot = null;
}

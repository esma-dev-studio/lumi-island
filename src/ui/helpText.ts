// そうさほうほうの一覧(タイトル画面とポーズメニューで同じものを出す)。
//
// なぜ1つのファイルにまとめたか:
//   v13.2 までは TitleScreen と PauseMenu が それぞれ自分のコピーを持っていて、
//   エモート・すわる・くみあわせ・でんごんばん・バッジ・いろみずが
//   両方から そろって抜け落ちていた。書く場所が2つあると必ず片方だけ古くなるので、
//   ここを唯一の情報源にして 両画面が import する形にした。
//
// 表のかたち: .help-grid は「左=なにをするか / 右=どうなるか」の2列。
//   行が17行まで増えたので、.help-sec(2列ぶち抜きの小見出し)で4つの節に分けてある。
//   ・うごく / さわって つかう / しらべると できること / がめんを ひらく
//   節に分けると「いま どこを読んでいるか」が分かり、探している操作にたどりつける。
//
// 文言の決まり: 子ども向けのひらがな文。キー名は <kbd> で囲む(CSSで四角い見た目になる)。
// キーの割りあては src/scenes/InputRouter.ts が唯一の実体なので、変えるときは両方を見ること。

/**
 * 2列ぶち抜きの小見出し(節の区切り)。
 *
 * わざと <span> ではなく <div> にしてある: .help-grid の中身は
 * 「span が2つで1行(左=操作 / 右=どうなるか)」という並びで、
 * 単体テストも `.help-grid span` を2つずつ組にして読む。
 * 見出しを span にすると その組が1つずれて、以降の行が全部ずれてしまう。
 */
const sec = (title: string): string => `<div class="help-sec">${title}</div>`;

export const HELP_KEYBOARD = `
            ${sec('うごく')}
            <span><kbd>W A S D</kbd>/<kbd>矢印</kbd></span><span>あるく</span>
            <span><kbd>Shift</kbd></span><span>はしる</span>
            <span><kbd>マウス</kbd>ドラッグ</span><span>カメラを まわす</span>
            <span><kbd>ホイール</kbd></span><span>ズーム(よる・ひく)</span>
            ${sec('さわって つかう')}
            <span><kbd>E</kbd>/<kbd>Space</kbd></span><span>しらべる・とる・はなす</span>
            <span><kbd>X</kbd></span><span>てをふる(つづけて もう一度で よろこぶ)</span>
            <span><kbd>R</kbd></span><span>(はいち中)まわす</span>
            ${sec('しらべると できること')}
            <span>ベンチの まえで <kbd>E</kbd></span><span>すわる(もう一度 <kbd>E</kbd>で たつ)</span>
            <span>たてふだの まえで <kbd>E</kbd></span><span>でんごんばん(きょうの おてつだい)</span>
            <span>おいた かぐの まえで <kbd>E</kbd></span><span>いろみずで いろを ぬる</span>
            ${sec('がめんを ひらく')}
            <span><kbd>Tab</kbd>/<kbd>I</kbd></span><span>もちもの</span>
            <span><kbd>C</kbd></span><span>クラフト(レシピ / くみあわせ)</span>
            <span><kbd>Q</kbd></span><span>おねがい</span>
            <span><kbd>Z</kbd></span><span>ずかん(バッジ・てがみも ここ)</span>
            <span><kbd>Esc</kbd></span><span>とじる・メニュー</span>`;

export const HELP_TOUCH = `
            ${sec('うごく')}
            <span>左下を ゆびで うごかす</span><span>あるく</span>
            <span>おおきく うごかす</span><span>はしる</span>
            <span>がめんを ゆびで なぞる</span><span>カメラを まわす</span>
            <span>ゆび2本で ひろげる・ちぢめる</span><span>ズーム(よる・ひく)</span>
            ${sec('さわって つかう')}
            <span>右下の 大きいボタン</span><span>しらべる・とる・はなす</span>
            <span>「てをふる」ボタン</span><span>てをふる(つづけて もう一度で よろこぶ)</span>
            <span>「まわす」ボタン</span><span>(はいち中)まわす</span>
            ${sec('しらべると できること')}
            <span>ベンチの そばで 大きいボタン</span><span>すわる(もう一度で たつ)</span>
            <span>たてふだの そばで 大きいボタン</span><span>でんごんばん(きょうの おてつだい)</span>
            <span>おいた かぐの そばで 大きいボタン</span><span>いろみずで いろを ぬる</span>
            ${sec('がめんを ひらく')}
            <span>右上の「もちもの」</span><span>もちもの</span>
            <span>右上の「クラフト」</span><span>クラフト(レシピ / くみあわせ)</span>
            <span>右上の「おねがい」</span><span>おねがい</span>
            <span>右上の「ずかん」</span><span>ずかん(バッジ・てがみも ここ)</span>
            <span>右上の「メニュー」</span><span>とじる・メニュー</span>`;

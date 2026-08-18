// 「いまやること」とホットヒント(Eの1行)の意味カテゴリを判定し、両者の矛盾を機械検出する。
// UXボット(tools/ux_bot.mjs)の判定に使う純関数モジュール。DOM・ブラウザ・内部IDには一切依存しない。
//
// 方針:
//   - 入力は「画面に出ている日本語」だけ(内部の目標ID・アイテムIDは使わない)。
//   - 判定は「そのEヒントを押すことが、いま表示されている目的の前進になるか」。
//   - 迷ったら矛盾にしない(過剰検出はボットの判定を無意味にする)。
//
// 判定の根拠にした画面文字列の出どころ:
//   目的: src/systems/ObjectiveSystem.ts / src/systems/TutorialSystem.ts / src/data/quests.ts
//   ヒント: src/scenes/InteractionRouting.ts / src/systems/GatherSystem.ts(verb) /
//           src/systems/InteractionSystem.ts(道具不足の理由) / src/systems/FishingSystem.ts /
//           src/systems/PlacementSystem.ts / src/ui/DialogueUI.ts

/** 目的・ヒントの共通カテゴリ(素材別に分けるのは「別の素材のEが出ている」を検出するため) */
export const GATHER_CATEGORIES = [
  'gatherWood', 'gatherStone', 'gatherFiber', 'gatherMoss', 'gatherOre', 'gatherBerry',
  // v6で増えた「拾いもの」。道具が要らないので blocked(理由表示)にはならず、必ず動詞のヒントが出る
  'gatherFlower', 'gatherMushroom', 'gatherShell', 'gatherStar',
  // v8で増えた「拾いもの」。同じく道具は要らない
  'gatherTwig', 'gatherCutgrass', 'gatherClay', 'gatherFloat',
  // v9: 雨の日だけ地面に出るカタツムリ。むしあみは要らず、手でひろう(=採取と同じあつかい)
  'gatherSnail',
  // v9: カマでかる「背の高い草」。既存の草むら(クサツル)とは別の素材なので別カテゴリ
  'gatherStraw',
  // v11第2章: よるの入り江でしかとれない2種。道具は要らず、島の拾いものと同じあつかい
  'gatherStarweed', 'gatherLightshell',
];
const GATHER = new Set(GATHER_CATEGORIES);
/**
 * 「そのとき その場でしか拾えない」拾いもの(v11.1)。
 * ほしのかけら=夜だけ / うきだま=朝だけ / カタツムリ=雨の日だけ で、時間がすぎると消える。
 * src/systems/ObjectiveSystem.ts の TRANSIENT_PICKUPS(+ GameScene.routeWithSnail)が
 * 「どの誘導中でも拾える」ようにしたので、判定器もそれに合わせる。
 * これは判定の緩和ではなく、設計の意味論への較正:
 * 目的が「もくざいを あつめよう」でも、足もとの ほしのかけらを拾うのは仕様どおりの動き。
 * 復活するふつうの採取ノード(木・岩・草・ベリー・コケ・こうせき)はここに入れない
 * ので、「別素材の採取ヒントが出ている」の検出はこれまでどおり効く
 * (v4コーパスの 179 gatherOre×gatherMoss / 262 gatherMoss×gatherStone は不変)。
 */
const TRANSIENT_PICKUP = new Set(['gatherStar', 'gatherFloat', 'gatherSnail']);
/**
 * 何をしていてもよい目的。「ゲームがプレイヤーの行動を絞っていない場面」がこれにあたる。
 *   free     : クリア後の自由行動
 *   tutorial : 移動チュートリアル
 *   talk     : 未受注(オファー)の「◯◯の はなしを聞こう」
 *
 * talkを入れているのは判定の緩和ではなく、このゲームの設計の意味論に判定器を合わせる較正。
 * src/systems/ObjectiveSystem.ts の objectiveActionContext は、目的がNPCを指していても
 * headlineが報告見出しでないあいだ(=まだ依頼を引き受けていないオファー段階)は
 * FREE_CONTEXT()を返し、guided:false のままにする。
 * src/systems/ObjectiveInteractionPolicy.ts の selectInteraction も guided:false のときは
 * 全候補から優先度と距離だけで選ぶので、道すがらの採取・釣り・買い物のEヒントが出るのは仕様どおり。
 * つまり未受注段階の「いまやること」は指示ではなく提案であり、寄り道は矛盾ではない
 * (受注前に採取や売買を塞ぐと、依頼と依頼のあいだの自由時間が死んでしまう)。
 * 引き受けたあとの段階(報告'report'・採取・釣り・クラフト・配置・ベッド待ち)は guided:true なので、
 * 従来どおり厳格に判定する。特に'report'は talk系のヒントだけをtrueにする。
 *
 * v11第2章で足した2つも、同じ「設計の意味論への較正」:
 *   money : ふねの しゅうり代(500ルミナ)をためる段階。
 *           ためかたは1つではない(うる・つる・ほる・虫をとる…)ので、
 *           src/systems/ObjectiveSystem.ts の objectiveActionContext は
 *           obj.money を FREE_CONTEXT() にして 行動を絞らない。
 *           とくに「Eお店をみる」は お金をためる ど真ん中の行動で、矛盾どころか正解。
 *   sail  : 島と入り江のあいだで「ふねの のりばへ行こう」と案内している段階
 *           (withAreaTravel が作る目的)。のりばまでは ただの移動なので、
 *           道すがらの採取・釣りは寄り道ではない。こちらも FREE_CONTEXT()。
 */
const ANYTHING_OK_OBJ = new Set(['free', 'tutorial', 'talk', 'money', 'sail']);

/** HTML片(kbdタグ等)と全角スペースをならして、素の1行にする */
function normalize(text) {
  return String(text ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/[\s\u3000]+/g, ' ') // U+3000(全角スペース)も1つの空白にならす
    .trim();
}

// ---- 目的(「いまやること」の1行)のカテゴリ表。上から順に最初に当たったものを採用 ----
export const OBJ_RULES = [
  { cat: 'tutorial', re: /あるいてみよう/, src: 'TutorialSystem: <kbd>WASD</kbd>か<kbd>矢印キー</kbd>で あるいてみよう' },
  { cat: 'free', re: /じゆうに くらそう/, src: 'ObjectiveSystem: 島で じゆうに くらそう(headline=クリア!)' },
  // NPC不在の待ち案内。「ほうこくしよう」より先に見る(不在時は報告ではなく就寝が次の行動)
  { cat: 'sleep', re: /ねているよ|ねて まとう|ベッドで .*ねよう/, src: 'ObjectiveSystem/NpcAvailabilityService: ◯◯は もう ねているよ<br>家のベッドで 朝まで ねよう / 家に はいって ベッドで ねよう' },
  { cat: 'report', re: /ほうこくしよう/, src: 'ObjectiveSystem: ◯◯に ほうこくしよう(headline=できた!)' },
  // v20第3章 おつかい(たのむ人と とどける人がちがう依頼)。行きつく先が「その人に会う」
  // なのは 報告と まったく同じなので report にそろえる
  { cat: 'report', re: /に とどけよう/, src: 'ObjectiveSystem: ノクトに とどけよう(quests.ts reportNpc)' },
  // 「◯◯と はなそう」は v11第2章の offerLabel(ロカとの であい)。未受注の提案なので talk と同じ
  { cat: 'talk', re: /はなしを聞こう|話しかけよう|と はなそう/, src: 'ObjectiveSystem: ◯◯の はなしを聞こう / quests.ts offerLabel: ロカと はなそう' },
  // v11第2章 ふねの しゅうり代をためる段階。ためかたを絞らないので ANYTHING_OK_OBJ に入れてある
  { cat: 'money', re: /ルミナを ためよう/, src: 'ObjectiveSystem: しゅうり代の 500ルミナを ためよう(ツムギ工房で もちものを うろう)' },
  // v11第2章 島 ⇄ よるの入り江 のまたぎ(withAreaTravel)と、
  // 章のあいだの橋わたし(chapterBridge: ふねが なおってから 初上陸までの区間)。
  // どちらも ObjectiveSystem の sailObjective が作るので、画面に出る文はこの2つだけ
  { cat: 'sail', re: /ふねで .*(もどろう|わたろう)/, src: 'ObjectiveSystem sailObjective: ふねで しまへ もどろう / ふねで よるの入り江へ わたろう' },
  // v20第3章 島 ⇄ いちば島 のまたぎ(withAreaTravel の trainObjective)と、
  // 章のあいだの橋わたし(chapterBridge: えきが できてから 初上陸までの区間)。
  // のりものへ向かう段階、という意味は ふねと まったく同じなので sail にそろえる
  { cat: 'sail', re: /でんしゃ.*(のろう|かえろう)/, src: 'ObjectiveSystem trainObjective: よるの えきから でんしゃに のろう / でんしゃで しまへ かえろう' },
  // v11第2章 とうだいに レンズを つける段階
  { cat: 'lighthouse', re: /とうだいに .*つけよう/, src: 'ObjectiveSystem: とうだいに レンズを つけよう' },
  { cat: 'craft', re: /ざいりょうが そろった|Cで .+を作ろう/, src: 'ObjectiveSystem: ざいりょうが そろったよ! <kbd>C</kbd>で ◯◯を作ろう' },
  // v20第3章 くみあわせで りょうりを1つ つくる段階(q3_taste)
  { cat: 'craft', re: /くみあわせ.*つくろう/, src: 'ObjectiveSystem: <kbd>C</kbd>の「くみあわせ」で りょうりを 1つ つくろう' },
  { cat: 'place', re: /島に .*置こう|島に置こう|置こう/, src: 'ObjectiveSystem: ランタンを 島に置こう(もちもの→おく) / 光る家具を 島に置こう' },
  // v20第3章 キッチンだいを 家の中に おく段階。既存の place は漢字の「置こう」だけを見るので、
  // かな書きの「おこう」を あとから 足す(既存の式は 1文字も変えない)
  { cat: 'place', re: /家の中に おこう/, src: 'ObjectiveSystem: キッチンだいを 家の中に おこう(もちもの→おく)' },
  { cat: 'fish', re: /つろう|つりあげよう/, src: 'ObjectiveSystem: 桟橋で サカナをつろう / quests.ts: サカナを 1匹 つろう' },
  // 素材別。「ルミナこうせき」は「いし」を含まないので順序の取り違えは起きないが、明示的に先に見る
  { cat: 'gatherOre', re: /こうせき.*(ほろう|あつめよう)/, src: 'ObjectiveSystem: 高台で こうせきをほろう / ルミナこうせきを あつめよう(ITEMS.ore.name)' },
  { cat: 'gatherWood', re: /もくざい.*あつめよう/, src: 'ObjectiveSystem: もくざいを あつめよう(q_wood / ITEMS.wood.name)' },
  { cat: 'gatherStone', re: /いしを あつめよう/, src: 'ObjectiveSystem craftStep: いしを あつめよう(ITEMS.stone.name)' },
  { cat: 'gatherFiber', re: /クサツル.*あつめよう/, src: 'ObjectiveSystem craftStep: クサツルを あつめよう(ITEMS.fiber.name)' },
  { cat: 'gatherMoss', re: /ヒカリゴケ.*あつめよう/, src: 'ObjectiveSystem craftStep: ヒカリゴケを あつめよう(ITEMS.moss.name)' },
  { cat: 'gatherBerry', re: /ベリー.*あつめよう/, src: 'ObjectiveSystem craftStep: ルミベリーを あつめよう(ITEMS.berry.name)' },
  // v6の素材。いまの依頼はこれらを要求しないので実走行では出ないが、
  // レシピ駆動のcraftStepが将来これらを案内したときに unknown にならないよう先に登録しておく
  { cat: 'gatherFlower', re: /のばな.*あつめよう/, src: 'ObjectiveSystem craftStep: のばなを あつめよう(ITEMS.flower.name)' },
  { cat: 'gatherMushroom', re: /きのこ.*あつめよう/, src: 'ObjectiveSystem craftStep: きのこを あつめよう(ITEMS.mushroom.name)' },
  { cat: 'gatherShell', re: /かいがら.*あつめよう/, src: 'ObjectiveSystem craftStep: かいがらを あつめよう(ITEMS.shell.name)' },
  { cat: 'gatherStar', re: /ほしのかけら.*(あつめよう|見つけよう)/, src: 'ObjectiveSystem craftStep: ほしのかけらを あつめよう(ITEMS.starshard.name)' },
  // v8の素材。v6と同じ理由で、レシピ駆動のcraftStepが将来これらを案内したときにunknownにしない
  { cat: 'gatherTwig', re: /こえだ.*あつめよう/, src: 'ObjectiveSystem craftStep: こえだを あつめよう(ITEMS.twig.name)' },
  { cat: 'gatherCutgrass', re: /かりくさ.*あつめよう/, src: 'ObjectiveSystem craftStep: かりくさを あつめよう(ITEMS.cutgrass.name)' },
  { cat: 'gatherClay', re: /ねんど.*あつめよう/, src: 'ObjectiveSystem craftStep: ねんどを あつめよう(ITEMS.clay.name)' },
  { cat: 'gatherFloat', re: /うきだま.*(あつめよう|見つけよう)/, src: 'ObjectiveSystem craftStep: うきだまを あつめよう(ITEMS.glassfloat.name)' },
  // v9: 雨の日だけの素材。同じ理由(将来のcraftStepでunknownにしない)
  { cat: 'gatherSnail', re: /カタツムリ.*(あつめよう|見つけよう)/, src: 'ObjectiveSystem craftStep: カタツムリを あつめよう(ITEMS.snail.name)' },
  { cat: 'gatherStraw', re: /わら.*あつめよう/, src: 'ObjectiveSystem craftStep: わらを あつめよう(ITEMS.straw.name)' },
  // v11第2章 よるの入り江の2種。「ほしくさ」は「ほしのかけら」とも「わら」とも重ならない別の文言
  { cat: 'gatherStarweed', re: /ほしくさ.*あつめよう/, src: 'ObjectiveSystem: ほしくさを あつめよう(ITEMS.starweed.name)' },
  { cat: 'gatherLightshell', re: /ひかりの貝.*あつめよう/, src: 'ObjectiveSystem: ひかりの貝を あつめよう(ITEMS.lightshell.name)' },
];

// ---- ホットヒント(.hud-hint)のカテゴリ表。上から順に最初に当たったものを採用 ----
export const HINT_RULES = [
  // 配置モード中は置ける/置けないどちらのヒントにも「まわす」が出る
  { cat: 'place', re: /まわす/, src: 'PlacementSystem: <kbd>E</kbd>おく <kbd>R</kbd>まわす <kbd>Esc</kbd>やめる / ◯◯ — うごかして ばしょを さがそう …' },
  { cat: 'dialogue', re: /つぎへ|おわる/, src: 'DialogueUI: <kbd>E</kbd>つぎへ / <kbd>E</kbd>おわる' },
  // 「◯◯には △△が ひつよう」は行動を促すヒントではなく理由表示。fishより先に見る
  { cat: 'blocked', re: /には .*(ひつよう|まってから)/, src: 'InteractionRouting: つりには ツリザオが ひつよう / つりには すこし まってから / InteractionSystem: ◯◯には オノが ひつよう' },
  // v11 「いまは できない理由・いまの ようす」だけを出す表示(押しても何も起きない)。
  // 行動をうながすヒントではないので、上の blocked とまったく同じあつかいにする
  {
    cat: 'blocked', re: /しゅうりちゅう|しまっている|まわっている/,
    src: 'CoveArea: ふねは しゅうりちゅう みたい / とびらは しまっている / とうだいの あかりが まわっている',
  },
  // v11第2章 ふねに のる・ふねで しまへ かえる(島 ⇄ よるの入り江)
  {
    cat: 'sail', re: /ふねに のる|ふねで しまへ かえる/,
    src: 'InteractionRouting: <kbd>E</kbd>ふねに のる / <kbd>E</kbd>ふねで しまへ かえる',
  },
  // v20第3章 「いつ来るか」だけを言う 表示だけの案内(押しても何も起きない)。
  // のる/かえる より先に見る(「でんしゃに のる」は下の enter が拾う)
  {
    cat: 'blocked', re: /でんしゃ.*(くるよ|行ってしまった|9じごろ)/,
    src: 'TrainRideSystem stationPrompt: でんしゃは こんやの 9じごろ くるよ / きょうの でんしゃは 行ってしまった。また つぎの よるに / つぎの でんしゃは あしたの よる 9じごろ',
  },
  // v20第3章 でんしゃの のりおり。自宅の出入りと同じ「常時許可」カテゴリにそろえる
  // (島へ帰る唯一の手段なので、どの誘導中でも 矛盾にしない)
  { cat: 'enter', re: /でんしゃに のる/, src: 'InteractionRouting: <kbd>E</kbd>でんしゃに のる' },
  { cat: 'exit', re: /でんしゃで しまへ かえる/, src: 'InteractionRouting: <kbd>E</kbd>でんしゃで しまへ かえる' },
  // v11第2章 とうだいに レンズを つける(点灯の見せ場がはじまる)
  {
    cat: 'lighthouse', re: /とうだいに .*つける/,
    src: 'InteractionRouting: <kbd>E</kbd>とうだいに レンズを つける',
  },
  { cat: 'fish', re: /つりをする|つりあげる|まってる/, src: 'InteractionRouting: <kbd>E</kbd>つりをする / FishingSystem: まってる… <kbd>Esc</kbd>やめる / !! <kbd>E</kbd>つりあげる' },
  { cat: 'shop', re: /お店をみる|うる・かう/, src: 'InteractionRouting: <kbd>E</kbd>お店をみる(うる・かう)' },
  // v20第3章 テンの店(週がわり)。ツムギ工房と同じ shop = 誘導中に出たら 矛盾とみなす
  { cat: 'shop', re: /テンの店を みる|しゅうがわり/, src: 'InteractionRouting: <kbd>E</kbd>テンの店を みる(しゅうがわり)' },
  { cat: 'sleep', re: /ねる[((]あさまで/, src: 'InteractionRouting: <kbd>E</kbd>ねる(あさまで)' },
  // v7 マイホーム: 自宅の出入り。sleepと同じ「常時許可」カテゴリ(下の isSemanticMatch を参照)
  { cat: 'enter', re: /家に はいる/, src: 'InteractionRouting: <kbd>E</kbd>家に はいる' },
  { cat: 'exit', re: /そとへ でる/, src: 'InteractionRouting: <kbd>E</kbd>そとへ でる' },
  { cat: 'gatherWood', re: /木をきる/, src: 'GatherSystem verb: 木をきる(tree)' },
  { cat: 'gatherStone', re: /岩をくだく/, src: 'GatherSystem verb: 岩をくだく(rock)' },
  // v8「かりくさをかる」は かな書きなので、漢字の「草をかる」(クサツル)とは重ならない。
  // それでも取り違えが起きないよう、かりくさを先に見る
  { cat: 'gatherCutgrass', re: /かりくさをかる/, src: 'GatherSystem verb: かりくさをかる(cutgrass)' },
  { cat: 'gatherFiber', re: /草をかる|クサツルをかる/, src: 'GatherSystem verb: 草をかる(grass)' },
  { cat: 'gatherMoss', re: /ヒカリゴケをとる/, src: 'GatherSystem verb: ヒカリゴケをとる(moss)' },
  { cat: 'gatherOre', re: /こうせきをほる/, src: 'GatherSystem verb: こうせきをほる(ore)' },
  { cat: 'gatherBerry', re: /ベリーをつむ/, src: 'GatherSystem verb: ベリーをつむ(berry)' },
  // v6の拾いもの。「ベリーをつむ」より後ろでよい(文言が重ならない)
  { cat: 'gatherFlower', re: /のばなをつむ/, src: 'GatherSystem verb: のばなをつむ(flower)' },
  // v10 自宅のお庭の花だん。どちらも「のばな」をあつかう行動なので gatherFlower にそろえる
  // (うえる=のばなを1つ使う / つみとる=満開の株から のばなが2つ手に入る)。
  // 「うえる」側の候補は kind='place' で作ってあり、ObjectiveSystem の preferredKinds に
  // place は決して入らないので、依頼の誘導中(guided)はそもそも画面に出ない。
  // 育ちきっていない区画の「つみとるには もうすこし まってから」は、上の blocked が先に当たる。
  { cat: 'gatherFlower', re: /はなを うえる/, src: 'InteractionRouting: <kbd>E</kbd>はなを うえる(庭の花だん・空き)' },
  { cat: 'gatherFlower', re: /つみとる/, src: 'InteractionRouting: <kbd>E</kbd>つみとる(庭の花だん・満開)' },
  { cat: 'gatherMushroom', re: /きのこをとる/, src: 'GatherSystem verb: きのこをとる(mushroom)' },
  { cat: 'gatherShell', re: /かいがらをひろう/, src: 'GatherSystem verb: かいがらをひろう(shell)' },
  { cat: 'gatherStar', re: /ほしのかけらをひろう/, src: 'GatherSystem verb: ほしのかけらをひろう(starshard)' },
  // v8の拾いもの(「かりくさをかる」は上の gatherFiber より前に置いてある)
  { cat: 'gatherTwig', re: /こえだをひろう/, src: 'GatherSystem verb: こえだをひろう(twig)' },
  { cat: 'gatherClay', re: /ねんどをとる/, src: 'GatherSystem verb: ねんどをとる(clay)' },
  { cat: 'gatherFloat', re: /うきだまをひろう/, src: 'GatherSystem verb: うきだまをひろう(glassfloat)' },
  // v9: 雨の日のカタツムリ(GameScene.routeWithSnailが出すヒント。むしあみは要らない)
  { cat: 'gatherSnail', re: /カタツムリをひろう/, src: 'GameScene.routeWithSnail: <kbd>E</kbd>カタツムリをひろう(snail)' },
  // v9: カマ→わら。「わらをかる」は「草をかる」「かりくさをかる」と重ならない別の文言
  { cat: 'gatherStraw', re: /わらをかる/, src: 'GatherSystem verb: わらをかる(tallgrass)' },
  // v11第2章 よるの入り江の2種(道具は要らない拾いもの)。
  // 「ほしくさをつむ」は「ベリーをつむ」と、「ひかりの貝をひろう」は「かいがらをひろう」と
  // 文言が重ならないので、この位置(既存の採取ヒントのあと)で取り違えは起きない
  { cat: 'gatherStarweed', re: /ほしくさをつむ/, src: 'GatherSystem verb: ほしくさをつむ(starweed)' },
  { cat: 'gatherLightshell', re: /ひかりの貝をひろう/, src: 'GatherSystem verb: ひかりの貝をひろう(lightshell)' },
  // v9: 虫あみ・シャベルの行動。シャベル(dig)は依頼の目的にならないので誘導中は出ない。
  // 虫あみ(catch)は v11 から「常時許可」になった(下の isSemanticMatch を参照)。
  // 「こうせきをほる」(gatherOre)より後ろに置くこと(「ほる」が横取りしないように)。
  // v11の予告ヒント「むしが いる! ちかづいて つかまえよう」も同じ catch にそろえる
  // (「つかまえるには 虫あみが ひつよう」は上の blocked が先に当たるので混ざらない)
  {
    cat: 'catch', re: /むしあみでつかまえる|つかまえ/,
    src: 'InteractionRouting: <kbd>E</kbd>むしあみでつかまえる / むしが いる! ちかづいて つかまえよう',
  },
  { cat: 'dig', re: /ほる/, src: 'InteractionRouting: <kbd>E</kbd>ほる(ほりあと)' },
  // v10: 展示家具(すいそう・むしかご)の出し入れ。「もちかえる」(carry)とは別の行動なので別カテゴリ。
  // catch(/つかまえる/)・dig(/ほる/)より後ろでよい(文言が重ならない)。
  // carry より前に置くのは順序の意図を明示するためで、「いれる」「とりだす」に
  // 「もちかえる」は含まれないので、どちらの順でも判定は同じ
  {
    cat: 'display', re: /いきものを いれる|とりだす/,
    src: 'InteractionRouting: <kbd>E</kbd>いきものを いれる / <kbd>E</kbd>◯◯を とりだす',
  },
  { cat: 'carry', re: /もちかえる/, src: 'InteractionRouting: <kbd>E</kbd>◯◯を もちかえる' },
  { cat: 'talk', re: /と はなす/, src: 'InteractionRouting: <kbd>E</kbd>◯◯と はなす' },
];

/**
 * 「いまやること」のカテゴリ。headlineは任意(「できた!」は報告、「クリア!」は自由行動)。
 * 当てはまらない文言はunknown(判定材料がないだけなので、矛盾には数えない)。
 */
export function categorizeObjective(text, headline = '') {
  const t = normalize(text);
  const h = normalize(headline);
  if (!t && !h) return 'unknown';
  if (/クリア/.test(h)) return 'free';
  if (/できた/.test(h) && !/ねているよ|ねて まとう/.test(t)) return 'report';
  for (const r of OBJ_RULES) if (r.re.test(t)) return r.cat;
  return 'unknown';
}

/** ホットヒントのカテゴリ。空文字はnone(ヒントが出ていない=矛盾のしようがない) */
export function categorizeHint(text) {
  const t = normalize(text);
  if (!t) return 'none';
  for (const r of HINT_RULES) if (r.re.test(t)) return r.cat;
  return 'unknown';
}

/** パネル見出しが店(ツムギ工房)かどうか。誤操作カウント用 */
export function isShopPanelTitle(title) {
  return /ツムギ工房|お店|ショップ/.test(normalize(title));
}

/**
 * 目的とヒントが意味的に噛み合っているか。falseなら「表示どうしが矛盾している」。
 *
 * 過剰検出をしないための規則(なぜtrueにするかの明文化):
 *  - hint=none: ヒントが出ていないので矛盾のしようがない。
 *  - 目的がfree/tutorial/talk: ゲーム側が行動を絞っていない場面(ANYTHING_OK_OBJの説明を参照)。
 *    talk(未受注のオファー)は guided:false で全候補が出るので、どのヒントでも矛盾しない。
 *  - hint=blocked(「◯◯には △△が ひつよう」): 行動を促すヒントではなく理由の表示。
 *    むしろ目的(道具づくり)を補強するので矛盾に数えない。
 *  - hint=dialogue(つぎへ/おわる): 会話送りはどの目的中でも起こる。
 *  - hint=sleep(「Eねる(あさまで)」): どの目的の最中に出てもよい補助導線。
 *    src/systems/ObjectiveSystem.ts は ALWAYS_ALLOWED = ['sleep'] を定義し、
 *    誘導中(guided)のどの文脈にも必ず混ぜている(報告・採取・釣り・クラフト/配置の
 *    preferredKindsすべてに ...ALWAYS_ALLOWED が入っている)。
 *    夜になって対象が見つからない・NPCが寝ているといった場面で詰ませないための普遍的な逃げ道で、
 *    READMEも「ねる」は補助機能と明記し、tests/e2e/sleep.spec.ts が挙動を保護している。
 *    設計として「いつ出てもよい」ものなので、blocked/dialogueと同格の常時許可あつかいにする
 *    (これは判定の緩和ではなく、設計の意味論への較正)。
 *    なお目的そのものがベッド誘導(objCat='sleep')のときは従来どおり厳格で、
 *    採取などのヒントが出れば矛盾のまま。
 *  - hint=enter/exit(「Eいえに はいる」「Eそとへ でる」): v7でベッドが家の中へ移り、
 *    「ねる」には まず入室が要るようになった。src/systems/ObjectiveSystem.ts の
 *    ALWAYS_ALLOWED も ['sleep','enter','exit'] になっていて、誘導中のどの文脈にも混ざる
 *    (混ぜないと「ベッドでねて待つ」の誘導どおりに動けない・室内に閉じこめられる)。
 *    よって sleep と同じ常時許可あつかいにする。判定の緩和ではなく、設計の意味論への較正。
 *  - hint=unknown: 表にない文言(src側の新しいヒント等)を矛盾と決めつけない。
 *    ただし見落としに気づけるよう、summarizeTraceがunknownHintsとして文言を残す。
 *  - 目的=craft(「Cで ◯◯を作ろう」): 目的文には作る物しか出ず、不足素材が何かは読み取れない。
 *    そのため採取系のヒントは「不足素材を集めている」可能性があり、矛盾に数えない。
 *  - 目的=place(「◯◯を 島に置こう」): q_lumiは「光る家具を3つ」なので、1つ置いた後も
 *    次の家具の素材集めが必要になる。よって採取系のヒントは矛盾に数えない。
 *  - 目的=report + hint=talk: 報告は「はなす」で行うので同じ行動。
 *  - 目的=unknown: 判定材料がないものを矛盾と断定しない。
 * 逆に必ずfalseにするもの:
 *  - hint=shop(「Eお店をみる」): 店は依頼の進行に一切寄与しない。
 *    行動が絞られている段階(受注済み)では必ず矛盾。
 *  - 別素材の採取ヒント(例: 目的=ヒカリゴケ + ヒント=岩をくだく)。
 *  - 目的=report + hint=fish(報告に行くべき場面での釣り再開)。
 *  - hint=display(v10の すいそう・むしかごの出し入れ): carry と同じ「かざる遊び」の寄り道。
 *    候補の kind は 'pickup' なので ObjectiveSystem の preferredKinds には決して入らず、
 *    誘導中(guided)は表示されない設計。出ていたら候補の絞りこみが壊れたということなので、
 *    sleep/enter/exit のような「常時許可」にはしない(GATHER_CATEGORIES にも入れない)。
 *
 * v11で常時許可に足したもの(判定の緩和ではなく、設計の意味論への較正):
 *  - hint=catch(虫あみ): src/systems/ObjectiveSystem.ts の ALWAYS_ALLOWED に 'catch' が入り、
 *    誘導中(guided)のどの文脈にも意図的に混ざるようになった。虫は数秒でとまり直して動き、
 *    ホタルは夜しか出ない「あとで戻れない相手」なので、依頼中に虫あみを完全に封じると
 *    「見えているのに捕れない」になるため(子どもの苦情の一因)。
 *    誘導の横取りは優先度で防いでいる(catch=32 < 採取30・庭29・報告NPC10)。
 *
 * v11.1で常時許可に足したもの(実プレイの苦情「報告しに行く間にアイテムが拾えない」への修正。
 * 線引きは v10.1の虫とりで学んだ教訓とまったく同じ「あとで戻れる相手か」):
 *  - hint=dig(シャベル): ALWAYS_ALLOWED に 'dig' が入った。ほりあとは日付が変わると
 *    別の場所へ移る「その日かぎり」のもので、依頼をこなすあいだに日付は変わる。
 *    優先度 dig=33 は 採取30・庭29・報告NPC10 より弱いので誘導は横取りしない。
 *  - hint=時間限定の拾いもの(ほしのかけら・うきだま・カタツムリ): 上の TRANSIENT_PICKUP を参照。
 *  - 目的=report × 採取のヒント: 報告は「その相手に会う」ことだけが条件で、
 *    道すがら何を採っても1ミリも遅れない。ObjectiveSystem は報告の文脈に 'gather' を入れ、
 *    素材の絞りこみ(targetItemIds)もしない。報告そのものが横取りされないことは優先度で保証。
 *    ※ report × fish / report × shop は これまでどおり false のまま
 *      (「報告に行かず釣りつづける」「店を開いてしまう」の検出は合否条件そのもの)。
 *  - hint=pickup系(carry「もちかえる」/ display「いれる・とりだす」)は 従来どおり厳格のまま。
 *    自分で置いた家具はいつでも戻れる相手で、資源も増えない(むしろ島から減る)。
 *    ObjectiveSystem の preferredKinds に 'pickup' は入らないので、誘導中は表示されない設計。
 *    出ていたら候補の絞りこみが壊れたということなので、常時許可にはしない。
 */
export function isSemanticMatch(objCat, hintCat) {
  if (!hintCat || hintCat === 'none') return true;
  // shopより先に見る。未受注(talk)は自由行動あつかいなので店のヒントも矛盾ではない
  if (ANYTHING_OK_OBJ.has(objCat)) return true;
  if (hintCat === 'blocked') return true;
  if (hintCat === 'dialogue') return true;
  // ねる・自宅の出入り・虫とり・穴ほりは ObjectiveSystem の ALWAYS_ALLOWED で
  // 全誘導文脈に意図的に混ぜてある補助導線(上のコメントに根拠あり)
  if (
    hintCat === 'sleep' || hintCat === 'enter' || hintCat === 'exit' ||
    hintCat === 'catch' || hintCat === 'dig'
  ) {
    return true;
  }
  // 時間で消える拾いもの(夜のかけら・朝のうきだま・雨のカタツムリ)も同じ扱い
  if (TRANSIENT_PICKUP.has(hintCat)) return true;
  if (hintCat === 'unknown') return true;
  if (hintCat === 'shop') return false;
  if (objCat === hintCat) return true;
  if (objCat === 'report' && hintCat === 'talk') return true;
  // 報告のとちゅうの採取は寄り道ではない(釣り・店は上で false のまま)
  if (objCat === 'report' && GATHER.has(hintCat)) return true;
  if ((objCat === 'craft' || objCat === 'place') && GATHER.has(hintCat)) return true;
  if (objCat === 'unknown') return true;
  return false;
}

/** 進捗表示(.obj-sub)の「n / m」だけを取り出す(距離の増減は進捗ではない) */
function progressKey(sub) {
  return (String(sub ?? '').match(/\d+\s*\/\s*\d+/) ?? [''])[0].replace(/\s/g, '');
}
/** 進捗表示の「→ Nm」を取り出す(近づけていれば停滞ではない) */
function distOf(sub) {
  const m = String(sub ?? '').match(/(\d+)\s*m/);
  return m ? parseInt(m[1], 10) : null;
}

/** traceの1行にカテゴリ判定を足す(既存の項目は消さない・順序も変えない) */
export function annotateRow(row) {
  const objectiveCategory = categorizeObjective(row.obj ?? '', row.head ?? '');
  const hintCategory = categorizeHint(row.hint ?? '');
  return {
    ...row,
    objectiveCategory,
    hintCategory,
    semanticMatch: isSemanticMatch(objectiveCategory, hintCategory),
  };
}

/**
 * 同じ目的のまま進捗も距離も改善しない区間を探す。
 * 1区間につき1件だけ記録する(長い停滞を秒数ぶん水増ししない)。
 */
function findStalls(rows, stallSec) {
  const stalls = [];
  let key = null;
  let since = 0;
  let best = Infinity;
  let reported = false;
  for (const r of rows) {
    const k = `${r.obj ?? ''}|${progressKey(r.sub)}`;
    const d = distOf(r.sub);
    if (k !== key) {
      key = k; since = r.sec; best = d ?? Infinity; reported = false;
      continue;
    }
    if (d !== null && d < best) {
      best = d; since = r.sec; reported = false;
      continue;
    }
    if (!reported && r.sec - since >= stallSec) {
      stalls.push({ sec: r.sec, sinceSec: since, durationSec: r.sec - since, obj: r.obj, sub: r.sub });
      reported = true;
    }
  }
  return stalls;
}

/**
 * trace配列(ux_result.jsonのtrace)をまとめて判定する。
 * 返り値のtraceはカテゴリ判定を足した新しい配列(元の配列は変更しない)。
 */
export function summarizeTrace(rows, stallSec = 60) {
  const trace = (rows ?? []).map(annotateRow);
  const semanticMismatches = trace
    .filter((r) => !r.semanticMatch)
    .map((r) => ({
      sec: r.sec, obj: r.obj, hint: r.hint,
      objectiveCategory: r.objectiveCategory, hintCategory: r.hintCategory,
    }));
  const refishDuringReport = trace
    .filter((r) => r.objectiveCategory === 'report' && r.hintCategory === 'fish')
    .map((r) => ({ sec: r.sec, obj: r.obj, hint: r.hint }));
  const stalls = findStalls(trace, stallSec);
  // 表にないヒント文言。矛盾には数えないが、カテゴリ表の更新もれに気づくために残す
  const unknownHints = [...new Set(
    trace.filter((r) => r.hintCategory === 'unknown').map((r) => normalize(r.hint))
  )];
  return {
    trace,
    semanticMismatches,
    semanticMismatchCount: semanticMismatches.length,
    refishDuringReport,
    refishDuringReportCount: refishDuringReport.length,
    stalls,
    stallCount: stalls.length,
    unknownHints,
  };
}

/**
 * UX判定。完走していても、表示の矛盾が1件でもあればFAIL。
 * (ボットが進めたか=result とは別に、遊ぶ人が迷わないかを見る)
 */
export function uxVerdictOf({ result, semanticMismatchCount, refishDuringReportCount, shopOpens, stallCount }) {
  const ok = result === 'ok'
    && semanticMismatchCount === 0
    && refishDuringReportCount === 0
    && (shopOpens ?? 0) === 0
    && stallCount === 0;
  return ok ? 'PASS' : 'FAIL';
}

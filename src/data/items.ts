// アイテム・道具・レシピ・店の品ぞろえ(データ駆動)
export type ItemId =
  | 'wood' | 'stone' | 'fiber' | 'berry' | 'moss' | 'ore'
  | 'flower' | 'mushroom' | 'shell' | 'starshard'
  // v8 拾えるものを増やす(どれも道具なしで手にとれる)
  | 'twig' | 'cutgrass' | 'clay' | 'glassfloat'
  | 'fish' | 'nightfish' | 'jam'
  // v8 海の魚(桟橋でだけ つれる)
  | 'seafish' | 'rarefish'
  // v9 雨の日だけ 地面に出る(道具なしで手にひろえる)
  | 'snail'
  // v9 虫あみでつかまえる虫6種(昼4・夜2)
  | 'b_shiro' | 'b_ageha' | 'b_tento' | 'b_kabuto' | 'b_hotaru' | 'b_suzu'
  // v17 虫を6種たして12種に(昼5・夕方1・夜1)
  | 'b_kuwa' | 'b_kama' | 'b_semi' | 'b_batta' | 'b_tonbo' | 'b_ookuwa'
  // v23 カブト・クワガタ族を7種たして 10しゅるいに(島3・よるの入り江2・いちば島2)
  | 'b_nokogiri' | 'b_hirata' | 'b_giraffa' | 'b_miyama' | 'b_caucasus' | 'b_niji' | 'b_hercules'
  // v17 魚を3種たす(コイ=池の昼 / タイ=海の昼のややレア / タツノオトシゴ=第2章のあとの夜の海)
  | 'koi' | 'seabream' | 'seahorse'
  // v9 シャベルで ほりだすもの3種 / カマでかる わら
  | 'shard_pot' | 'shiny_stone' | 'gold_piece' | 'straw'
  // v11 よるの入り江でとれる2種(道具はいらない)
  | 'starweed' | 'lightshell'
  // v11第2章 とうだいの あかりを ともす「ひかりのレンズ」(クラフトで作る だいじなもの)
  | 'lens'
  // v12 くみあわせ: りょうり6種(キッチンだいが家にあると つくれる)
  | 'd_grillfish' | 'd_mushsoup' | 'd_berrypie' | 'd_starmochi' | 'd_shellsoup' | 'd_nightgrill'
  // v12 くみあわせ: いろみず4色(おいてある家具に ぬって 色を かえる)
  | 'paint_red' | 'paint_blue' | 'paint_yellow' | 'paint_green'
  | 'f_bench' | 'f_lantern' | 'f_stonelamp' | 'f_table' | 'f_planter'
  | 'f_chair' | 'f_shelf' | 'f_rug' | 'f_pot' | 'f_sign'
  | 'f_flowerbed' | 'f_mushlamp' | 'f_shelldeco' | 'f_starlantern'
  // v7-P2 室内向けの家具(クラフト)
  | 'f_bookcase' | 'f_dishrack' | 'f_flowervase'
  // v8 新しい置き家具(うえきばち f_pot は お店の品をクラフトでも作れるようにした)
  | 'f_broom' | 'f_jar' | 'f_birdhouse' | 'f_pinwheel' | 'f_seamobile' | 'f_gardentable'
  // v9 新しい置き家具4種(虫かご・いにしえのつぼ・わらのマット・かかし)
  | 'f_bugcage' | 'f_ancient_pot' | 'f_strawmat' | 'f_scarecrow'
  // v10 とった魚をかざる すいそう(むしかごと同じ「展示家具」)
  | 'f_aquarium'
  // v13 たくさん入る おおきい版(小さい版に1ぴき入れると 作りかたを ひらめく)
  | 'f_aquarium_big' | 'f_bugcage_big'
  // v9 おくりもの: なかよし度5でおしえてもらう とくべつな家具3種(NPC1人につき1つ)
  | 'f_finetable' | 'f_fishtrophy' | 'f_starmap'
  // v11第2章 ロカのお礼レシピで作る「とうだいのランタン」(家に かざれる 小さな灯台)
  | 'f_lighthouse_lantern'
  // v12 りょうりの入口(通常レシピ)と、くみあわせで見つかる かざり4種
  | 'f_kitchen'
  | 'f_sealamp' | 'f_starmobile' | 'f_shellwind' | 'f_terrarium'
  // v7-P2 模様替え(かべがみ・ゆかいた)。使っても無くならないので、各1個あれば足りる
  | 'wall_cream' | 'wall_sky' | 'wall_leaf'
  // v12 くみあわせで見つかる かべがみの色版2枚
  | 'wall_rose' | 'wall_night'
  | 'floor_wood' | 'floor_tile' | 'floor_rug'
  // v14 じっせきの ごほうびでしか 手に入らない3点(お店・レシピ・くみあわせに 出さない)
  | 'wall_bottle' | 'f_starlantern_gold' | 'f_lighthouse_lantern_night'
  // ---- v20 第3章「いちば島」 ----
  // よその島の素材2種(テンの店でしか買えない)と、あずかりもの・まきもの
  | 'aroma_leaf' | 'sweet_honey' | 'gift_parcel' | 'scroll'
  // テンの店の 限定家具3種と、第3章で おぼえる家具2種
  | 'f_market_lantern' | 'f_travel_trunk' | 'f_station_clock' | 'f_aroma_lamp' | 'f_far_map'
  // テンの店の 限定かべがみ・ゆかいた
  | 'wall_lantern' | 'wall_market' | 'floor_stone' | 'floor_mat'
  // ---- v21 生命感パック ----
  // なかよし度10の「ふたりの じかん」でしか 手に入らない3点
  | 'sunsetfish' | 'f_pair_bench' | 'f_travel_map'
  // ぬし(3か所)と、その トロフィー家具3種
  | 'nushi_koi' | 'nushi_dai' | 'nushi_yoru'
  | 'f_trophy_koi' | 'f_trophy_dai' | 'f_trophy_yoru';

export type ToolId = 'axe' | 'pickaxe' | 'rod' | 'sickle' | 'net' | 'shovel';

export interface ItemDef {
  id: ItemId;
  name: string;
  sell: number; // 売値(ルミナ)
  kind: 'material' | 'food' | 'furniture' | 'decor';
  desc: string;
  glow?: boolean; // 置いたとき夜に光る家具
  /**
   * だいじなもの(依頼で使う道具)。売る・おくりものにする ができない。
   * 「うっかり手ばなして 依頼が進められなくなる」を構造で防ぐための印で、
   * 売値は 0 にそろえる(src/data/items.ts validateItemData が機械検査する)。
   */
  keyItem?: boolean;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  wood: { id: 'wood', name: 'もくざい', sell: 8, kind: 'material', desc: '木からとれる。クラフトの基本ざいりょう' },
  stone: { id: 'stone', name: 'いし', sell: 8, kind: 'material', desc: 'ごつごつした石。ツルハシで岩からとる' },
  fiber: { id: 'fiber', name: 'クサツル', sell: 6, kind: 'material', desc: 'じょうぶな草のつる。カマでかりとる' },
  berry: { id: 'berry', name: 'ルミベリー', sell: 10, kind: 'food', desc: 'あまい実。夜はほんのり光る' },
  moss: { id: 'moss', name: 'ヒカリゴケ', sell: 14, kind: 'material', desc: '夜に光るコケ。ランタンの材料' },
  ore: { id: 'ore', name: 'ルミナこうせき', sell: 25, kind: 'material', desc: '高台でとれる光る石' },
  flower: { id: 'flower', name: 'のばな', sell: 4, kind: 'material', desc: '草原に かたまってさく小さな花。手でつめる' },
  mushroom: { id: 'mushroom', name: 'きのこ', sell: 5, kind: 'material', desc: '林の木の根もと、日かげに生える' },
  shell: { id: 'shell', name: 'かいがら', sell: 6, kind: 'material', desc: '浜べの砂の上でひろえる、おうぎの形' },
  starshard: { id: 'starshard', name: 'ほしのかけら', sell: 18, kind: 'material', desc: '夜だけ 地面できらめく、まれな かけら' },
  // ---- v8 拾えるもの4種 ----
  twig: { id: 'twig', name: 'こえだ', sell: 3, kind: 'material', desc: '林の木の根もとに おちている 小さなえだ' },
  cutgrass: { id: 'cutgrass', name: 'かりくさ', sell: 3, kind: 'material', desc: '草むらで つかめる やわらかい草' },
  clay: { id: 'clay', name: 'ねんど', sell: 5, kind: 'material', desc: '池の どろの岸で とれる こまかい土' },
  glassfloat: { id: 'glassfloat', name: 'うきだま', sell: 25, kind: 'material', desc: '朝の浜に ながれつく ガラスのうきだま' },
  fish: { id: 'fish', name: 'サカナ', sell: 18, kind: 'food', desc: '昼の海や池でつれる' },
  nightfish: { id: 'nightfish', name: 'ヨザカナ', sell: 35, kind: 'food', desc: '夜だけつれる、光る魚' },
  // ---- v8 海の魚2種(桟橋でだけ つれる。池では つれない) ----
  seafish: { id: 'seafish', name: 'あおうお', sell: 12, kind: 'food', desc: '昼の海で つれる、青いせなかの魚' },
  rarefish: { id: 'rarefish', name: 'にじうお', sell: 30, kind: 'food', desc: '夜の海に まれに出る、にじ色にひかる魚' },
  // ---- v9 雨の日だけ 地面に出る(むしあみは いらない。手でひろえる) ----
  snail: { id: 'snail', name: 'カタツムリ', sell: 14, kind: 'material', desc: '雨の日だけ 草の上を ゆっくり あるく。手でひろえる' },
  jam: { id: 'jam', name: 'ベリージャム', sell: 45, kind: 'food', desc: 'ルミベリーをにつめた。みんな大すき' },
  // ---- v9 虫6種(むしあみが ひつよう。昼は花と草と林、夜は池と草むら) ----
  b_shiro: { id: 'b_shiro', name: 'モンシロチョウ', sell: 8, kind: 'material', desc: '昼の花のまわりを ひらひら とぶ 白いチョウ' },
  b_ageha: { id: 'b_ageha', name: 'アゲハチョウ', sell: 15, kind: 'material', desc: '花のそばに ときどき来る、大きな もようのチョウ' },
  b_tento: { id: 'b_tento', name: 'テントウムシ', sell: 10, kind: 'material', desc: '草むらの 地面すれすれを あるく 赤い虫' },
  b_kabuto: { id: 'b_kabuto', name: 'カブトムシ', sell: 30, kind: 'material', desc: '林の木の みきに とまっている、つのの ある虫' },
  b_hotaru: { id: 'b_hotaru', name: 'ホタル', sell: 18, kind: 'material', desc: '夜の池のまわりで ちかちか 光りながら ただよう' },
  b_suzu: { id: 'b_suzu', name: 'スズムシ', sell: 12, kind: 'material', desc: '夜の草むらに いる、りんりんと鳴く虫' },
  // ---- v17 虫6種(むしあみが ひつよう)。売値は「見つけにくさ」の順にならべてある ----
  b_batta: { id: 'b_batta', name: 'バッタ', sell: 9, kind: 'material', desc: '草地に いる 黄みどりの虫。大きな 後ろあしで ぴょんと とぶ' },
  b_semi: { id: 'b_semi', name: 'セミ', sell: 14, kind: 'material', desc: '昼の 木のみきで 鳴いている。羽を 屋根のように たたんでいる' },
  b_tonbo: { id: 'b_tonbo', name: 'トンボ', sell: 16, kind: 'material', desc: '夕方の 池のそばを すいすい とぶ 赤いトンボ。羽が 4まい ある' },
  b_kama: { id: 'b_kama', name: 'カマキリ', sell: 22, kind: 'material', desc: '草むらで じっと まちぶせする 緑の虫。前あしが かまの形' },
  b_kuwa: { id: 'b_kuwa', name: 'クワガタ', sell: 26, kind: 'material', desc: '昼の 木のみきに いる、大きな あごの ある虫' },
  b_ookuwa: { id: 'b_ookuwa', name: 'オオクワガタ', sell: 60, kind: 'material', desc: 'よるの 木のみきに まれに いる、つやのある 黒い大きなクワガタ' },
  // ---- v23 カブト・クワガタ族7種。売値は「どこまで行かないと 会えないか」の順 ----
  // 島(30〜70)< よるの入り江(48・100)< いちば島(90・150)
  b_nokogiri: { id: 'b_nokogiri', name: 'ノコギリクワガタ', sell: 30, kind: 'material', desc: 'ひるの 木のみきに いる 赤茶色のクワガタ。大あごが 内がわへ ぐいと まがる' },
  b_hirata: { id: 'b_hirata', name: 'ヒラタクワガタ', sell: 34, kind: 'material', desc: 'よるの 木のみきに いる。ひらたくて はばの広い 黒いからだ' },
  b_giraffa: { id: 'b_giraffa', name: 'ギラファノコギリクワガタ', sell: 70, kind: 'material', desc: 'よるの 木のみきに まれに いる。からだと おなじくらい 長い 大あご' },
  b_miyama: { id: 'b_miyama', name: 'ミヤマクワガタ', sell: 48, kind: 'material', desc: 'よるの入り江の ほしくさ野原で ひるに 見つかる。頭の うしろに 王冠のような つのが ある' },
  b_caucasus: { id: 'b_caucasus', name: 'コーカサスオオカブト', sell: 100, kind: 'material', desc: 'よるの入り江の 夜に いる 大きなカブト。つのが 3本 ある' },
  b_niji: { id: 'b_niji', name: 'ニジイロクワガタ', sell: 90, kind: 'material', desc: 'いちば島の 夜に いる。まるい せなかが にじ色に ひかる' },
  b_hercules: { id: 'b_hercules', name: 'ヘラクレスオオカブト', sell: 150, kind: 'material', desc: 'いちば島の 夜に まれに いる、いちばん 大きなカブト。黄色い はねと 上下2本の つの' },
  // ---- v17 魚3種 ----
  koi: { id: 'koi', name: 'コイ', sell: 22, kind: 'food', desc: '昼の池に いる 大きな魚。だいだい色と 白の もようが ある' },
  seabream: { id: 'seabream', name: 'タイ', sell: 45, kind: 'food', desc: '昼の海で ときどき つれる、ももいろの めでたい魚' },
  seahorse: { id: 'seahorse', name: 'タツノオトシゴ', sell: 70, kind: 'food', desc: 'とうだいが ともってから、よるの海に まれに 見られる 小さな いきもの' },
  // ---- v9 シャベルの ほりだしもの3種 ----
  shard_pot: { id: 'shard_pot', name: 'つぼのかけら', sell: 10, kind: 'material', desc: '土の中から 出てきた、もようの ある やきものの かけら' },
  shiny_stone: { id: 'shiny_stone', name: 'きらきらの石', sell: 20, kind: 'material', desc: 'みがいたように つやつやした、ふしぎな 小石' },
  gold_piece: { id: 'gold_piece', name: 'きんのかけら', sell: 60, kind: 'material', desc: 'まれに 出てくる、ずっしり重い 金いろの かけら' },
  // ---- v9 カマで かる わら ----
  straw: { id: 'straw', name: 'わら', sell: 4, kind: 'material', desc: '背の高い草を かってたばねた もの' },
  // ---- v11 よるの入り江の2種(ふねで わたった先の 野原と砂浜でとれる) ----
  starweed: { id: 'starweed', name: 'ほしくさ', sell: 12, kind: 'material', desc: 'よるの入り江の野原にゆれる 銀いろの草。穂が ほしくずのように光る' },
  lightshell: { id: 'lightshell', name: 'ひかりの貝', sell: 20, kind: 'material', desc: '入り江の砂浜でひろえる貝。夜は 中がわが あお白く光る' },
  // ---- v11第2章 ひかりのレンズ(とうだいに つける だいじなもの) ----
  lens: {
    id: 'lens', name: 'ひかりのレンズ', sell: 0, kind: 'material', keyItem: true,
    desc: 'ひかりの貝と ほしくさと こうせきで つくった、とうだいの あかりの レンズ。うることは できない',
  },
  // ---- v12 りょうり6種(くみあわせで見つかる)。食べると 小さな効果が しばらくつづく ----
  // 「かざる」ためにも置けるので isPlaceable が true になる(kindは food のまま)。
  // 効果の中身は src/systems/CookingEffects.ts の DISH_EFFECT がまとめて持つ。
  d_grillfish: { id: 'd_grillfish', name: 'やきざかな', sell: 30, kind: 'food', desc: 'サカナを 木のえだで あぶった。こうばしい においが する' },
  d_mushsoup: { id: 'd_mushsoup', name: 'きのこスープ', sell: 24, kind: 'food', desc: 'きのこを ことこと にこんだ スープ。林の においが する' },
  d_berrypie: { id: 'd_berrypie', name: 'ベリーパイ', sell: 60, kind: 'food', desc: 'ルミベリーと ジャムの あまい パイ。やくと ほんのり 光る' },
  d_starmochi: { id: 'd_starmochi', name: 'ほしくさもち', sell: 40, kind: 'food', desc: 'ほしくさの 穂を ついて まるめた おもち。だれかに わけたくなる' },
  d_shellsoup: { id: 'd_shellsoup', name: 'ひかりスープ', sell: 55, kind: 'food', desc: 'ひかりの貝の スープ。のむと からだが ぽうっと あたたかい' },
  d_nightgrill: { id: 'd_nightgrill', name: 'くしやき', sell: 50, kind: 'food', desc: 'ヨザカナを こえだの くしに さして やいた。よるの においが する' },
  // ---- v12 いろみず4色(くみあわせで見つかる)----
  // おいてある家具に ぬって 色を かえる。かべがみと同じで「つかっても 無くならない」
  // (子どもが 何度でも ぬりなおせるように。src/systems/PlacementSystem.ts paint)。
  paint_red: { id: 'paint_red', name: 'あかみず', sell: 20, kind: 'material', desc: '木の実から しぼった あかい いろみず。おいてある家具に ぬれる' },
  paint_blue: { id: 'paint_blue', name: 'あおみず', sell: 20, kind: 'material', desc: 'こうせきと かいがらから とった あおい いろみず。おいてある家具に ぬれる' },
  paint_yellow: { id: 'paint_yellow', name: 'きいろみず', sell: 20, kind: 'material', desc: 'のばなを にだした きいろい いろみず。おいてある家具に ぬれる' },
  paint_green: { id: 'paint_green', name: 'みどりみず', sell: 20, kind: 'material', desc: 'ヒカリゴケと草の みどりの いろみず。おいてある家具に ぬれる' },
  f_bench: { id: 'f_bench', name: 'ウッドベンチ', sell: 30, kind: 'furniture', desc: 'すわってひと休みできるベンチ' },
  f_lantern: { id: 'f_lantern', name: 'ランタン', sell: 40, kind: 'furniture', desc: '夜をやさしく照らす', glow: true },
  f_stonelamp: { id: 'f_stonelamp', name: 'いしのランプ', sell: 55, kind: 'furniture', desc: 'ルミナこうせきの明かり', glow: true },
  f_table: { id: 'f_table', name: '木のテーブル', sell: 35, kind: 'furniture', desc: 'がっしりした木のテーブル' },
  f_planter: { id: 'f_planter', name: '花のプランター', sell: 25, kind: 'furniture', desc: '花をかざる木の箱' },
  f_chair: { id: 'f_chair', name: 'チェア', sell: 20, kind: 'furniture', desc: 'かわいい木のイス' },
  f_shelf: { id: 'f_shelf', name: '本だな', sell: 45, kind: 'furniture', desc: '本をならべるたな' },
  f_rug: { id: 'f_rug', name: 'ラグ', sell: 30, kind: 'furniture', desc: 'ふかふかのしきもの' },
  f_pot: { id: 'f_pot', name: 'うえきばち', sell: 18, kind: 'furniture', desc: 'みどりのうえきばち' },
  f_sign: { id: 'f_sign', name: 'かんばん', sell: 15, kind: 'furniture', desc: 'メッセージをかける立てふだ' },
  f_flowerbed: { id: 'f_flowerbed', name: 'はなだん', sell: 26, kind: 'furniture', desc: '木わくに土を入れて のばなをうえた花だん' },
  f_mushlamp: { id: 'f_mushlamp', name: 'きのこランプ', sell: 38, kind: 'furniture', desc: 'かさが黄みどりに光る きのこの明かり', glow: true },
  f_shelldeco: { id: 'f_shelldeco', name: 'かいがらのかざり', sell: 24, kind: 'furniture', desc: '流木にかいがらをならべた 小さなおきもの' },
  f_starlantern: { id: 'f_starlantern', name: 'ほしのランタン', sell: 60, kind: 'furniture', desc: 'ほしのかけらの あお白い光', glow: true },
  // ---- v7-P2 室内向けの家具(外に置いてもよい) ----
  // 「本だな」(f_shelf・お店で買う)とは別物なので、名前で見分けられるようにしてある
  f_bookcase: { id: 'f_bookcase', name: '木のほんだな', sell: 40, kind: 'furniture', desc: '木とクサツルで組んだ、せの低いほんだな' },
  f_dishrack: { id: 'f_dishrack', name: 'しょっきだな', sell: 42, kind: 'furniture', desc: 'おさらとカップをならべる 台所のたな' },
  f_flowervase: { id: 'f_flowervase', name: 'はなかざり', sell: 28, kind: 'furniture', desc: 'かいがらの花びんに のばなをいけた。夜はほのかに光る', glow: true },
  // ---- v8 新しい置き家具6種(うえきばち f_pot は上の お店の品と同じもの) ----
  f_broom: { id: 'f_broom', name: 'ほうき', sell: 22, kind: 'furniture', desc: 'こえだの柄に かりくさをたばねた ほうき' },
  f_jar: { id: 'f_jar', name: 'つぼ', sell: 26, kind: 'furniture', desc: 'ねんどを やいて作った、ずんぐりした つぼ' },
  f_birdhouse: { id: 'f_birdhouse', name: 'とりのすばこ', sell: 34, kind: 'furniture', desc: '小さな丸い入口の すばこ。とまり木つき' },
  f_pinwheel: { id: 'f_pinwheel', name: 'かざぐるま', sell: 28, kind: 'furniture', desc: '風で はねが ゆっくりまわる かざぐるま' },
  f_seamobile: { id: 'f_seamobile', name: 'うみのモビール', sell: 52, kind: 'furniture', desc: 'うきだまと かいがらのモビール。夜は あお白くひかる', glow: true },
  f_gardentable: { id: 'f_gardentable', name: 'ガーデンテーブル', sell: 46, kind: 'furniture', desc: '石の脚に 木の天板をのせた そとのテーブル' },
  // ---- v9 新しい置き家具4種 ----
  f_bugcage: { id: 'f_bugcage', name: 'むしかご', sell: 30, kind: 'furniture', desc: 'こえだで 組んだ かご。つかまえた虫を えらんで 入れられる' },
  f_ancient_pot: { id: 'f_ancient_pot', name: 'いにしえのつぼ', sell: 55, kind: 'furniture', desc: 'つぼのかけらを つなぎ合わせて なおした、つぎめの ある土器' },
  f_strawmat: { id: 'f_strawmat', name: 'わらのマット', sell: 20, kind: 'furniture', desc: 'わらを ぐるぐる まいて あんだ、まるい しきもの' },
  f_scarecrow: { id: 'f_scarecrow', name: 'かかし', sell: 35, kind: 'furniture', desc: 'わらと こえだで つくった 畑の見はり。ぼうしを かぶっている' },
  // ---- v9 おくりもの: なかよし度5の お礼レシピで作れる3種(島のみんなの おしえ) ----
  f_finetable: { id: 'f_finetable', name: 'こだわりのテーブル', sell: 70, kind: 'furniture', desc: 'ツムギが おしえてくれた、木めを えらんで 組んだ とくべつなテーブル' },
  f_fishtrophy: { id: 'f_fishtrophy', name: 'さかなのトロフィー', sell: 65, kind: 'furniture', desc: 'ミナモが おしえてくれた、木の台に つった魚を かざる トロフィー' },
  f_starmap: { id: 'f_starmap', name: 'ほしぞらのちず', sell: 80, kind: 'furniture', desc: 'ノクトが おしえてくれた、夜空の 星のならびを うつしとった ちず' },
  // ---- v11第2章 ロカのお礼レシピ。とうだいの形をした 小さなランプ(夜に光る) ----
  f_lighthouse_lantern: {
    id: 'f_lighthouse_lantern', name: 'とうだいのランタン', sell: 62, kind: 'furniture', glow: true,
    desc: 'ロカが おしえてくれた、小さな とうだいの あかり。夜になると てっぺんが ぽうっと ともる',
  },
  // ---- v10 展示家具: つった魚を 入れて かざる ----
  f_aquarium: { id: 'f_aquarium', name: 'すいそう', sell: 48, kind: 'furniture', desc: 'つった魚を えらんで 入れられる ガラスの水そう。中を 魚が およぐ' },
  // ---- v13 おおきい版(6ぴき入る)。家にも にわにも おける ----
  f_aquarium_big: {
    id: 'f_aquarium_big', name: 'おおきな すいそう', sell: 96, kind: 'furniture',
    desc: '魚が 6ぴきまで 入る、よこに ながい 水そう。上と下の 2だんに わかれて およぐ',
  },
  f_bugcage_big: {
    id: 'f_bugcage_big', name: 'おおきな むしかご', sell: 62, kind: 'furniture',
    desc: '虫が 6ぴきまで 入る、とまり木の ついた 大きな かご。ホタルを 入れると 夜に ちかちか 光る',
  },
  // ---- v12 りょうりの入口。家の中に おくと、くみあわせの りょうりが つくれるようになる ----
  f_kitchen: { id: 'f_kitchen', name: 'キッチンだい', sell: 50, kind: 'furniture', desc: '木のてんばんと なべの ある だいどころの台。家の中に おくと りょうりが できる' },
  // ---- v12 くみあわせで見つかる かざり4種 ----
  f_sealamp: { id: 'f_sealamp', name: 'うみのランプ', sell: 58, kind: 'furniture', glow: true, desc: 'ひかりの貝を 木のわくに ならべた ランプ。夜は あお白く ともる' },
  f_starmobile: { id: 'f_starmobile', name: 'ほしのモビール', sell: 54, kind: 'furniture', glow: true, desc: 'ほしくさの 穂を つるした モビール。夜は 穂が ほしくずのように 光る' },
  f_shellwind: { id: 'f_shellwind', name: 'かいのふうりん', sell: 40, kind: 'furniture', desc: 'こえだに かいがらを ぶらさげた ふうりん。風で かろやかに 鳴る' },
  f_terrarium: { id: 'f_terrarium', name: 'こけのびん', sell: 62, kind: 'furniture', glow: true, desc: 'ガラスの うつわに ヒカリゴケを もりつけた かざり。夜は みどりに ほんのり 光る' },
  // ---- v7-P2 模様替え(室内で「つかう」。何度でも かえられる) ----
  // 名前は6文字までにする。もちものの1マスは4文字ほどで折り返すので、
  // 「クリームのかべがみ」のような長い名前は3〜4行に割れて読みにくい(実機のスクショで確認)。
  // くわしい説明は desc(マスのツールチップ)にのせる
  wall_cream: { id: 'wall_cream', name: 'クリームかべ', sell: 40, kind: 'decor', desc: 'あたたかいクリーム色のかべがみ。しっくいのような ざらり感' },
  wall_sky: { id: 'wall_sky', name: 'そら色のかべ', sell: 40, kind: 'decor', desc: 'あわいそら色に 白いたてじまのかべがみ' },
  wall_leaf: { id: 'wall_leaf', name: 'わかばのかべ', sell: 40, kind: 'decor', desc: 'わかば色の地に 小さな葉っぱのもようのかべがみ' },
  // v12 くみあわせで見つかる かべがみの色版2枚(いろみずと同じ「色であそぶ」なかま)
  wall_rose: { id: 'wall_rose', name: 'ももいろかべ', sell: 40, kind: 'decor', desc: '木の実で そめた ももいろの かべがみ。小さな 白い水玉つき' },
  wall_night: { id: 'wall_night', name: 'ほしぞらかべ', sell: 40, kind: 'decor', desc: 'こんいろの地に ほしのかけらを ちりばめた かべがみ' },
  floor_wood: { id: 'floor_wood', name: '木のゆか', sell: 40, kind: 'decor', desc: 'いた目のある あたたかい木のゆかいた' },
  floor_tile: { id: 'floor_tile', name: 'タイルのゆか', sell: 40, kind: 'decor', desc: '白いタイルと めじの線。すっきりしたゆかいた' },
  floor_rug: { id: 'floor_rug', name: 'ラグのゆか', sell: 40, kind: 'decor', desc: '一面がおりもののゆかいた。ふかふかに見える' },
  // ---- v14 じっせきの ごほうび限定の3点 ----
  //
  // 入手経路は src/systems/AchievementRewards.ts の ACHIEVEMENT_REWARDS **だけ**。
  // SHOP_STOCK・RECIPES・COMBOS のどこにも入れない(お店にも クラフトにも 出ない)。
  // どれも だいじなもの(keyItem)にしてある: 二度と手に入らないので、
  // うっかり 売ったり あげたりして 無くならないように 構造で止める
  // (ひかりのレンズ と まったく同じ考え方。売値は0にそろえる約束)。
  wall_bottle: {
    id: 'wall_bottle', name: 'ボトルかべ', sell: 0, kind: 'decor', keyItem: true,
    desc: 'ガラスびんのような みどりの かべがみ。じっせきの ごほうびでしか 手に入らない',
  },
  f_starlantern_gold: {
    id: 'f_starlantern_gold', name: 'きんのランタン', sell: 0, kind: 'furniture', glow: true, keyItem: true,
    desc: 'ほしのランタンの きん色の もの。夜は あたたかい 金いろに ともる。じっせきの ごほうびでしか 手に入らない',
  },
  f_lighthouse_lantern_night: {
    id: 'f_lighthouse_lantern_night', name: 'よるのとうだい', sell: 0, kind: 'furniture', glow: true, keyItem: true,
    desc: 'こんいろの 小さな とうだい。夜は てっぺんが あお白く ともる。じっせきの ごほうびでしか 手に入らない',
  },
  // =========================================================================
  // v20 第3章「いちば島」。入手経路は **テンの店(週がわり)だけ** ——
  // SHOP_STOCK にも RECIPES の材料にも 出さない(ここでしか買えないことが 毎週かよう理由)。
  // =========================================================================
  aroma_leaf: {
    id: 'aroma_leaf', name: 'かおりのは', sell: 24, kind: 'material',
    desc: 'よその島の は。もむと あまい かおりが する。テンの店でだけ 買える',
  },
  sweet_honey: {
    id: 'sweet_honey', name: 'あまいみつ', sell: 30, kind: 'material',
    desc: 'よその島の 花から とれた みつ。びんの中で とろりと ひかる。テンの店でだけ 買える',
  },
  // 第3章の おつかいで あずかる もの。うる・あげるが できない(なくすと 話が すすまない)
  gift_parcel: {
    id: 'gift_parcel', name: 'あずかりもの', sell: 0, kind: 'material', keyItem: true,
    desc: 'テンから あずかった、ぬのに つつまれた 小さな はこ。だれかに とどける',
  },
  // まきもの: 買った その場で ひらくので、もちものには 入らない(値だんは MarketStock が持つ)
  scroll: {
    id: 'scroll', name: 'まきもの', sell: 0, kind: 'material', keyItem: true,
    desc: 'くみあわせの ひみつが 1つ かいてある まきもの。ひらくと 作りかたが わかる',
  },
  f_market_lantern: {
    id: 'f_market_lantern', name: 'いちばのちょうちん', sell: 58, kind: 'furniture', glow: true,
    desc: 'いちば島の 通りに ならぶ ちょうちん。夜は だいだい色に ぽっと ともる',
  },
  f_travel_trunk: {
    id: 'f_travel_trunk', name: 'たびのトランク', sell: 62, kind: 'furniture',
    desc: '革の帯を まいた 旅の かばん。ふたに たくさんの ふだが はってある',
  },
  f_station_clock: {
    id: 'f_station_clock', name: 'えきのとけい', sell: 70, kind: 'furniture',
    desc: 'まるい 文字ばんの おきどけい。よるの えきの 時計と おなじ かたち',
  },
  f_aroma_lamp: {
    id: 'f_aroma_lamp', name: 'かおりのランプ', sell: 66, kind: 'furniture', glow: true,
    desc: 'テンが おしえてくれた、かおりのはを たく ランプ。夜は みどりに ゆらめく',
  },
  f_far_map: {
    id: 'f_far_map', name: 'よそじまのちず', sell: 84, kind: 'furniture',
    desc: 'テンが なかよしの しるしに くれた、まだ 行ったことのない 島々の ちず',
  },
  wall_lantern: { id: 'wall_lantern', name: 'あかりかべ', sell: 40, kind: 'decor', desc: 'こい あめ色の地に ちょうちんの もようが ならぶ かべがみ' },
  wall_market: { id: 'wall_market', name: 'いちばかべ', sell: 40, kind: 'decor', desc: 'いちばの のれんのような、たてじまと ふだの もようの かべがみ' },
  floor_stone: { id: 'floor_stone', name: 'いしのゆか', sell: 40, kind: 'decor', desc: 'いちば通りの しきいしを うつした、まるい石の ゆかいた' },
  floor_mat: { id: 'floor_mat', name: 'ゴザのゆか', sell: 40, kind: 'decor', desc: 'かわいた 草を あんだ ゴザの ゆか。ひんやり すずしい' },
  // =========================================================================
  // v21 生命感パック。入手経路は **1回きりの出来事だけ** ——
  // お店・レシピ・くみあわせ・くじ引きの どこにも 出さない。
  // ぜんぶ だいじなもの(keyItem・売値0)にしてある: 二度と手に入らないので、
  // うっかり 売ったり あげたりして 無くならないように 構造で止める
  // (ひかりのレンズ・じっせきの ごほうび3点と まったく同じ考え方)。
  // =========================================================================
  // ---- なかよし度10「ふたりの じかん」の しるし(src/systems/BondEventSystem.ts)----
  sunsetfish: {
    id: 'sunsetfish', name: 'ゆうやけうお', sell: 0, kind: 'food', keyItem: true,
    desc: 'ミナモと 二人で つった、ゆうやけの いろの 魚。うることは できない',
  },
  f_pair_bench: {
    id: 'f_pair_bench', name: 'ふたりのベンチ', sell: 0, kind: 'furniture', keyItem: true,
    desc: 'ツムギと 二人で けずって 組んだ ベンチ。かたっぽの あしだけ すこし ふとい',
  },
  f_travel_map: {
    id: 'f_travel_map', name: 'たびのちず', sell: 0, kind: 'furniture', keyItem: true,
    desc: 'テンが 行った島に しるしを つけてきた ちず。いちばん あたらしい しるしが この島',
  },
  // ---- ぬし(src/systems/BossFishSystem.ts)。同じ釣り場で20ひき つった人の前にだけ 出る ----
  nushi_koi: {
    id: 'nushi_koi', name: 'ヌシコイ', sell: 0, kind: 'food', keyItem: true,
    desc: 'あさの 池の そこに ひそんでいた、うでほどの 大きな コイ。うることは できない',
  },
  nushi_dai: {
    id: 'nushi_dai', name: 'シマダイさま', sell: 0, kind: 'food', keyItem: true,
    desc: 'まひるの おきから 来た、しま もようの 大ダイ。うることは できない',
  },
  nushi_yoru: {
    id: 'nushi_yoru', name: 'ヨルノヌシ', sell: 0, kind: 'food', keyItem: true,
    desc: 'よるの入り江の そこで 光っていた 大きな魚。うることは できない',
  },
  f_trophy_koi: {
    id: 'f_trophy_koi', name: 'ヌシコイのがく', sell: 0, kind: 'furniture', keyItem: true,
    desc: 'ヌシコイを うつしとった 木のがくぶち。かべぎわに かけて かざる',
  },
  f_trophy_dai: {
    id: 'f_trophy_dai', name: 'シマダイのがく', sell: 0, kind: 'furniture', keyItem: true,
    desc: 'シマダイさまを うつしとった 木のがくぶち。かべぎわに かけて かざる',
  },
  f_trophy_yoru: {
    id: 'f_trophy_yoru', name: 'ヨルノヌシのがく', sell: 0, kind: 'furniture', glow: true, keyItem: true,
    desc: 'ヨルノヌシを うつしとった 木のがくぶち。よるは 魚の かたちが あお白く 光る',
  },
};

// ---------------------------------------------------------------------------
// v10/v13 展示家具(すいそう・むしかご と、その おおきい版)。
// 「置いた家具に いきものを 入れて かざる」しくみを、この1つの表だけで決める。
//   - accepts  : 入れられるItemId(もちものから1つ減って PlacedFurniture.contents に入る)
//   - capacity : 何びきまで 入るか(小さい版=1 / おおきい版=6)
//                ここを増やすだけで UI(スロット・のこり数)・セーブの切りつめ・実績まで ついてくる。
//                見た目(およぐ みち・とまる場所)は src/entities/furniture.ts の
//                AQUA_SPECS.lanes / CAGE_SPECS.spots が capacity ぶん用意する約束
//                (足りないと slot % lanes.length で かさなって「団子」になる。
//                 tests/unit/display_big_v13.test.ts が 両方の数を つき合わせる)。
//   - statKey  : 入れた回数の累計カウンタ(じっせきが読む。GameState.stats のキー)
//   - upgrade  : はじめて中身を入れたときに ひらめく「おおきい版」のレシピID(おおきい版には無い)
// UI(DisplayUI)・Eのルーティング・メッシュ・じっせきは、すべてこの表を唯一の情報源にする。
//
// v13で1匹→複数に一般化した。中身は PlacedFurniture.contents(配列)だけが持ち、
// v12までの content(1匹)は セーブの読みこみで contents=[content] へ移していく
// (src/save/SaveSystem.ts。旧セーブでも入れた いきものが消えない)。
//
// おおきい版の入手経路を「小さい版に1ぴき入れたら ひらめく」にした理由:
//   くみあわせ(combos.ts)は材料の合計2〜3個までで、おおきい版の値だんに合う材料を組めない。
//   それに「すいそうを 使ってみた子」にだけ次の目標が出るほうが 目標の階段として素直で、
//   ひらめきの引き金を「素材の初回入手」に無理やり結びつけずに済む(RECIPE_DISCOVERYを汚さない)。
// ---------------------------------------------------------------------------
// v17 いきものを ふやしたら、この2つの表に足すだけで
// すいそう・むしかご(大小)・ずかん・おくりもの・実績が ぜんぶ ついてくる。
// ならびは BUG_IDS(=BUG_DEFS の順)と そろえること(display_v10.test.ts が両方向を見る)。
const DISPLAY_FISH = ['fish', 'nightfish', 'seafish', 'rarefish', 'koi', 'seabream', 'seahorse'] as const;
const DISPLAY_BUGS = [
  'b_shiro', 'b_ageha', 'b_tento', 'b_kabuto', 'b_hotaru', 'b_suzu',
  'b_batta', 'b_kuwa', 'b_kama', 'b_semi', 'b_tonbo', 'b_ookuwa',
  // v23 カブト・クワガタ族7種
  'b_nokogiri', 'b_hirata', 'b_giraffa', 'b_miyama', 'b_caucasus', 'b_niji', 'b_hercules',
] as const;

export const DISPLAY_FURNITURE = {
  f_aquarium: {
    label: 'すいそう',
    accepts: DISPLAY_FISH,
    capacity: 1,
    statKey: 'display_fish',
    empty: 'いま いれられる魚が ない。海や池で つってこよう!',
    full: 'すいそうは いっぱい。とりだすと また いれられるよ',
    upgrade: 'r_aquarium_big',
  },
  f_aquarium_big: {
    label: 'おおきな すいそう',
    accepts: DISPLAY_FISH,
    capacity: 6,
    statKey: 'display_fish',
    empty: 'いま いれられる魚が ない。海や池で つってこよう!',
    full: 'おおきな すいそうは 6ぴきで いっぱい。とりだすと また いれられるよ',
  },
  f_bugcage: {
    label: 'むしかご',
    accepts: DISPLAY_BUGS,
    capacity: 1,
    statKey: 'display_bug',
    empty: 'いま いれられる虫が ない。むしあみで つかまえてこよう!',
    full: 'むしかごは いっぱい。とりだすと また いれられるよ',
    upgrade: 'r_bugcage_big',
  },
  f_bugcage_big: {
    label: 'おおきな むしかご',
    accepts: DISPLAY_BUGS,
    capacity: 6,
    statKey: 'display_bug',
    empty: 'いま いれられる虫が ない。むしあみで つかまえてこよう!',
    full: 'おおきな むしかごは 6ぴきで いっぱい。とりだすと また いれられるよ',
  },
} as const satisfies Record<string, {
  label: string; accepts: readonly ItemId[]; capacity: number;
  statKey: string; empty: string; full: string; upgrade?: string;
}>;

export type DisplayFurnitureId = keyof typeof DISPLAY_FURNITURE;

/** 展示家具か(すいそう・むしかご の大小)。Eのヒント・DisplayUI・実績の判定はここを通す */
export function isDisplayFurniture(item: string): item is DisplayFurnitureId {
  return Object.prototype.hasOwnProperty.call(DISPLAY_FURNITURE, item);
}

/** その展示家具に入れられるものか(セーブから復元した contents の検証にも使える) */
export function canDisplayIn(furniture: DisplayFurnitureId, item: string): boolean {
  return (DISPLAY_FURNITURE[furniture].accepts as readonly string[]).includes(item);
}

/** その家具に 何びきまで入るか(展示家具でなければ0)。セーブの検証・UI・実績が読む */
export function displayCapacity(item: string): number {
  return isDisplayFurniture(item) ? DISPLAY_FURNITURE[item].capacity : 0;
}

/**
 * その展示家具に「おおきい版」のレシピがあるか(小さい版だけが持つ)。
 * PlacementSystem.putIn が、はじめて中身を入れたときに この1つを おぼえさせる。
 */
export function displayUpgradeRecipe(item: string): string | null {
  if (!isDisplayFurniture(item)) return null;
  const def = DISPLAY_FURNITURE[item] as { upgrade?: string };
  return def.upgrade ?? null;
}

// ---------------------------------------------------------------------------
// v12 りょうり(くみあわせで見つかる 食べもの)。
//
// この配列だけが「りょうりか どうか」の情報源。ここに載っているものは
//   - もちものに「たべる」が出る(効果は src/systems/CookingEffects.ts)
//   - 家に かざれる(isPlaceable が true。テーブルの上の小物として置ける)
//   - おくりものにできる(kind が food なので giftableItems にそのまま乗る)
// の3つが同時に成り立つ。ItemDef.kind は 'food' のままにしてある:
// kind を furniture にすると「もちもの」で食べものに見えなくなるため。
// ---------------------------------------------------------------------------
export const COOKED_FOODS = [
  'd_grillfish', 'd_mushsoup', 'd_berrypie', 'd_starmochi', 'd_shellsoup', 'd_nightgrill',
] as const satisfies readonly ItemId[];

export type CookedFoodId = (typeof COOKED_FOODS)[number];

/** りょうりか(「たべる」ボタン・かざれるかの判定はここを通す) */
export function isCookedFood(item: string): item is CookedFoodId {
  return (COOKED_FOODS as readonly string[]).includes(item);
}

/**
 * 置ける(配置モードに入れる)ものか。
 * ふつうの家具に加えて、りょうりも「テーブルの上の小物」として置ける。
 * もちものの「おく」ボタン・セーブの家具の検証・配置システムは すべてここを通す
 * (どこか1か所だけ通し忘れると「置けたのにロードで消える」が起きる)。
 */
export function isPlaceable(item: string): boolean {
  if (!(item in ITEMS)) return false;
  return ITEMS[item as ItemId].kind === 'furniture' || isCookedFood(item);
}

// ---------------------------------------------------------------------------
// v12 いろみず(おいてある家具の 色を かえる)。
//
// 色は「決定論のパレット」: ゲームの中で すでに使っている色から取っている
// (赤=とうだいの帯 / 青=トロフィーの魚 / 黄=ランタンの灯り / 緑=草)。
// 彩度を上げすぎると 原色のおもちゃに見える(教訓1)ので、どれも にごった色にそろえる。
// 保存するのは この表の hex だけ(SaveSystem が検証して、知らない色は捨てる)。
// ---------------------------------------------------------------------------
export const PAINT_COLORS = {
  paint_red: { label: 'あか', hex: '#c9705c' },
  paint_blue: { label: 'あお', hex: '#7aa8d4' },
  paint_yellow: { label: 'きいろ', hex: '#dcb56a' },
  paint_green: { label: 'みどり', hex: '#7aa85f' },
} as const satisfies Partial<Record<ItemId, { label: string; hex: string }>>;

export type PaintId = keyof typeof PAINT_COLORS;

/** いろみずか(もちものの「ぬる」・Eの候補の判定はここを通す) */
export function isPaint(item: string): item is PaintId {
  return Object.prototype.hasOwnProperty.call(PAINT_COLORS, item);
}

/** 保存してよい家具の色か(セーブの検証。この表にない色は「色なし」に落とす) */
export function isPaintColor(hex: unknown): hex is string {
  return typeof hex === 'string' && Object.values(PAINT_COLORS).some((p) => p.hex === hex);
}

/** もちものの中の いろみず(ならびは PAINT_COLORS の順で固定) */
export function ownedPaints(inventory: Partial<Record<ItemId, number>>): PaintId[] {
  return (Object.keys(PAINT_COLORS) as PaintId[]).filter((id) => (inventory[id] ?? 0) > 0);
}

/** 模様替えアイテムが かべ・ゆか のどちらを かえるか(この表にあるものだけ「つかう」が出る) */
export const DECOR_SLOT = {
  wall_cream: 'wall', wall_sky: 'wall', wall_leaf: 'wall',
  wall_rose: 'wall', wall_night: 'wall',
  // v14 じっせきの ごほうび限定(お店にもクラフトにも出ない)
  wall_bottle: 'wall',
  // v20 テンの店の 週がわり限定(いちば島でしか買えない)
  wall_lantern: 'wall', wall_market: 'wall',
  floor_wood: 'floor', floor_tile: 'floor', floor_rug: 'floor',
  floor_stone: 'floor', floor_mat: 'floor',
} as const satisfies Partial<Record<ItemId, 'wall' | 'floor'>>;

export type DecorId = keyof typeof DECOR_SLOT;
export type DecorSlot = (typeof DECOR_SLOT)[DecorId];

/** 部屋の見た目(かべ・ゆか)。GameState.homeStyle の中身と同じ形 */
export interface HomeStyle {
  wall: string;
  floor: string;
}

/** 何も買っていないときの部屋(いちばん最初の見た目) */
export const DEFAULT_HOME_STYLE: HomeStyle = { wall: 'wall_cream', floor: 'floor_wood' };

export const WALL_STYLE_IDS: DecorId[] = (Object.keys(DECOR_SLOT) as DecorId[]).filter((k) => DECOR_SLOT[k] === 'wall');
export const FLOOR_STYLE_IDS: DecorId[] = (Object.keys(DECOR_SLOT) as DecorId[]).filter((k) => DECOR_SLOT[k] === 'floor');

/** 模様替えアイテムか(もちものの「つかう」ボタン・セーブの検証が使う) */
export function isDecor(item: string): item is DecorId {
  return Object.prototype.hasOwnProperty.call(DECOR_SLOT, item);
}

/** そのIDが、そのスロット(かべ/ゆか)に使える見た目か */
export function isStyleFor(slot: DecorSlot, id: string): boolean {
  return isDecor(id) && DECOR_SLOT[id] === slot;
}

export const TOOLS: Record<ToolId, { id: ToolId; name: string; desc: string }> = {
  axe: { id: 'axe', name: 'オノ', desc: '木をきって、もくざいをとる' },
  pickaxe: { id: 'pickaxe', name: 'ツルハシ', desc: '岩やこうせきをくだく' },
  rod: { id: 'rod', name: 'ツリザオ', desc: '海や池で魚をつる' },
  sickle: { id: 'sickle', name: 'カマ', desc: '草をかりとる。背の高い草からは わらがとれる' },
  // v9 道具→素材の階段: 道具を作ると、その道具でしか手に入らない素材が増える
  net: { id: 'net', name: '虫あみ', desc: '虫をつかまえる' },
  shovel: { id: 'shovel', name: 'シャベル', desc: '地面のほりあとを ほる' },
};

/** 道具の表示名(ヒントの「◯◯が ひつよう」に使う)。TOOLSを唯一の情報源にする */
export function toolName(tool: ToolId): string {
  return TOOLS[tool].name;
}

export interface RecipeDef {
  id: string;
  name: string;
  out: ItemId | ToolId;
  outKind: 'item' | 'tool';
  cost: Partial<Record<ItemId, number>>;
}

export const RECIPES: RecipeDef[] = [
  { id: 'r_sickle', name: 'カマ', out: 'sickle', outKind: 'tool', cost: { wood: 2, stone: 1 } },
  { id: 'r_rod', name: 'ツリザオ', out: 'rod', outKind: 'tool', cost: { wood: 2, fiber: 2 } },
  { id: 'r_bench', name: 'ウッドベンチ', out: 'f_bench', outKind: 'item', cost: { wood: 4 } },
  { id: 'r_lantern', name: 'ランタン', out: 'f_lantern', outKind: 'item', cost: { wood: 1, moss: 2 } },
  { id: 'r_stonelamp', name: 'いしのランプ', out: 'f_stonelamp', outKind: 'item', cost: { stone: 2, ore: 1 } },
  { id: 'r_table', name: '木のテーブル', out: 'f_table', outKind: 'item', cost: { wood: 3, stone: 1 } },
  { id: 'r_planter', name: '花のプランター', out: 'f_planter', outKind: 'item', cost: { wood: 1, fiber: 1, berry: 1 } },
  { id: 'r_jam', name: 'ベリージャム', out: 'jam', outKind: 'item', cost: { berry: 3 } },
  { id: 'r_flowerbed', name: 'はなだん', out: 'f_flowerbed', outKind: 'item', cost: { flower: 3, wood: 2 } },
  { id: 'r_mushlamp', name: 'きのこランプ', out: 'f_mushlamp', outKind: 'item', cost: { mushroom: 2, moss: 2 } },
  { id: 'r_shelldeco', name: 'かいがらのかざり', out: 'f_shelldeco', outKind: 'item', cost: { shell: 3 } },
  { id: 'r_starlantern', name: 'ほしのランタン', out: 'f_starlantern', outKind: 'item', cost: { starshard: 1, stone: 2 } },
  // ---- v7-P2 ----
  { id: 'r_bookcase', name: '木のほんだな', out: 'f_bookcase', outKind: 'item', cost: { wood: 4, fiber: 2 } },
  { id: 'r_dishrack', name: 'しょっきだな', out: 'f_dishrack', outKind: 'item', cost: { wood: 3, stone: 2 } },
  { id: 'r_flowervase', name: 'はなかざり', out: 'f_flowervase', outKind: 'item', cost: { flower: 2, shell: 1 } },
  { id: 'r_wall_leaf', name: 'わかばのかべ', out: 'wall_leaf', outKind: 'item', cost: { fiber: 2, flower: 3 } },
  { id: 'r_floor_rug', name: 'ラグのゆか', out: 'floor_rug', outKind: 'item', cost: { fiber: 4, flower: 2 } },
  // ---- v8 新しい家具7種 ----
  // うえきばち(r_pot)は お店の品 f_pot と同じもの。作っても買っても手に入る
  // (かべがみ・ゆかいたと同じ考え方。名前が2つに割れると子どもが混乱するので新IDを作らない)。
  { id: 'r_broom', name: 'ほうき', out: 'f_broom', outKind: 'item', cost: { twig: 2, cutgrass: 2 } },
  { id: 'r_pot', name: 'うえきばち', out: 'f_pot', outKind: 'item', cost: { clay: 2, flower: 1 } },
  { id: 'r_jar', name: 'つぼ', out: 'f_jar', outKind: 'item', cost: { clay: 3 } },
  { id: 'r_birdhouse', name: 'とりのすばこ', out: 'f_birdhouse', outKind: 'item', cost: { wood: 2, twig: 2 } },
  { id: 'r_pinwheel', name: 'かざぐるま', out: 'f_pinwheel', outKind: 'item', cost: { twig: 1, fiber: 1, flower: 1 } },
  { id: 'r_seamobile', name: 'うみのモビール', out: 'f_seamobile', outKind: 'item', cost: { glassfloat: 1, shell: 2 } },
  { id: 'r_gardentable', name: 'ガーデンテーブル', out: 'f_gardentable', outKind: 'item', cost: { wood: 3, stone: 1 } },
  // ---- v9 道具2種と、その道具でとれる素材から作るもの4種 ----
  { id: 'r_net', name: '虫あみ', out: 'net', outKind: 'tool', cost: { twig: 2, fiber: 2 } },
  { id: 'r_shovel', name: 'シャベル', out: 'shovel', outKind: 'tool', cost: { wood: 2, stone: 2 } },
  { id: 'r_bugcage', name: 'むしかご', out: 'f_bugcage', outKind: 'item', cost: { twig: 3, fiber: 2 } },
  { id: 'r_ancient_pot', name: 'いにしえのつぼ', out: 'f_ancient_pot', outKind: 'item', cost: { shard_pot: 3, clay: 1 } },
  { id: 'r_strawmat', name: 'わらのマット', out: 'f_strawmat', outKind: 'item', cost: { straw: 3 } },
  { id: 'r_scarecrow', name: 'かかし', out: 'f_scarecrow', outKind: 'item', cost: { straw: 3, twig: 2, cutgrass: 1 } },
  // ---- v10 すいそう。うきだま(ガラス)を初めて拾ったときに ひらめく(うみのモビールと同時) ----
  { id: 'r_aquarium', name: 'すいそう', out: 'f_aquarium', outKind: 'item', cost: { glassfloat: 1, wood: 2, stone: 1 } },
  // ---- v13 おおきい版2種。小さい版に はじめて いきものを入れたときに ひらめく ----
  // (INITIAL_RECIPES にも RECIPE_DISCOVERY にも入れない。入手経路は
  //  DISPLAY_FURNITURE の upgrade → PlacementSystem.putIn だけ)。
  // 材料は小さい版の ちょうど2倍+だいのぶんの もくざい。たくさん入るぶん しっかり高い
  { id: 'r_aquarium_big', name: 'おおきな すいそう', out: 'f_aquarium_big', outKind: 'item', cost: { glassfloat: 2, wood: 4, stone: 2 } },
  { id: 'r_bugcage_big', name: 'おおきな むしかご', out: 'f_bugcage_big', outKind: 'item', cost: { twig: 5, fiber: 3, wood: 2 } },
  // ---- v9 おくりもの: なかよし度5の お礼でおぼえる3種 ----
  // INITIAL_RECIPES にも RECIPE_DISCOVERY にも入れない(お礼だけが入手経路)。
  // 材料は「そのNPCらしいもの」で組む: ツムギ=木とやきもの、ミナモ=魚とかいがら、ノクト=星と草。
  { id: 'r_woodtable_fine', name: 'こだわりのテーブル', out: 'f_finetable', outKind: 'item', cost: { wood: 4, shard_pot: 1 } },
  { id: 'r_fishtrophy', name: 'さかなのトロフィー', out: 'f_fishtrophy', outKind: 'item', cost: { fish: 1, shell: 2 } },
  { id: 'r_starmap', name: 'ほしぞらのちず', out: 'f_starmap', outKind: 'item', cost: { starshard: 1, straw: 2, moss: 2 } },
  // ---- v11第2章 ----
  // ひかりのレンズ: ロカの「ひらめき」でだけ おぼえる(INITIAL_RECIPES にも RECIPE_DISCOVERY にも入れない)。
  // 材料は入り江でとれる2種+島のこうせき=「島と入り江の両方をめぐった証」になる組み合わせ。
  { id: 'r_lens', name: 'ひかりのレンズ', out: 'lens', outKind: 'item', cost: { lightshell: 3, starweed: 2, ore: 2 } },
  // とうだいのランタン: ロカと なかよし度5の お礼でおぼえる(ほかの3人と同じ流儀)
  { id: 'r_lighthouse_lantern', name: 'とうだいのランタン', out: 'f_lighthouse_lantern', outKind: 'item', cost: { lightshell: 2, wood: 2 } },
  // ---- v12 りょうりの入口。ふつうのレシピ(最初から見える)----
  // これを家の中に おくと、くみあわせタブの りょうりが つくれるようになる。
  { id: 'r_kitchen', name: 'キッチンだい', out: 'f_kitchen', outKind: 'item', cost: { wood: 4, stone: 2, clay: 1 } },
  // ---- v12 くみあわせで見つかる16種 ----
  // どれも INITIAL_RECIPES にも RECIPE_DISCOVERY にも入れない。
  // 入手経路は「くみあわせタブで ためして 当てる」だけ(src/data/combos.ts)。
  // 材料は COMBOS の inputs と必ず同じにする(validateComboData が機械検査する)。
  { id: 'r_grillfish', name: 'やきざかな', out: 'd_grillfish', outKind: 'item', cost: { fish: 1, wood: 1 } },
  { id: 'r_mushsoup', name: 'きのこスープ', out: 'd_mushsoup', outKind: 'item', cost: { mushroom: 2, cutgrass: 1 } },
  { id: 'r_berrypie', name: 'ベリーパイ', out: 'd_berrypie', outKind: 'item', cost: { berry: 2, jam: 1 } },
  { id: 'r_starmochi', name: 'ほしくさもち', out: 'd_starmochi', outKind: 'item', cost: { starweed: 2, straw: 1 } },
  { id: 'r_shellsoup', name: 'ひかりスープ', out: 'd_shellsoup', outKind: 'item', cost: { lightshell: 2, moss: 1 } },
  { id: 'r_nightgrill', name: 'くしやき', out: 'd_nightgrill', outKind: 'item', cost: { nightfish: 1, twig: 1 } },
  { id: 'r_paint_red', name: 'あかみず', out: 'paint_red', outKind: 'item', cost: { berry: 3 } },
  { id: 'r_paint_blue', name: 'あおみず', out: 'paint_blue', outKind: 'item', cost: { ore: 1, shell: 2 } },
  { id: 'r_paint_yellow', name: 'きいろみず', out: 'paint_yellow', outKind: 'item', cost: { flower: 3 } },
  { id: 'r_paint_green', name: 'みどりみず', out: 'paint_green', outKind: 'item', cost: { moss: 2, cutgrass: 1 } },
  { id: 'r_wall_rose', name: 'ももいろかべ', out: 'wall_rose', outKind: 'item', cost: { berry: 2, fiber: 1 } },
  { id: 'r_wall_night', name: 'ほしぞらかべ', out: 'wall_night', outKind: 'item', cost: { starshard: 1, moss: 2 } },
  { id: 'r_sealamp', name: 'うみのランプ', out: 'f_sealamp', outKind: 'item', cost: { lightshell: 2, wood: 1 } },
  { id: 'r_starmobile', name: 'ほしのモビール', out: 'f_starmobile', outKind: 'item', cost: { starweed: 2, fiber: 1 } },
  { id: 'r_shellwind', name: 'かいのふうりん', out: 'f_shellwind', outKind: 'item', cost: { shell: 2, twig: 1 } },
  { id: 'r_terrarium', name: 'こけのびん', out: 'f_terrarium', outKind: 'item', cost: { moss: 2, glassfloat: 1 } },
  // ---- v20 第3章 テンが おしえてくれる2種 ----
  // どちらも INITIAL_RECIPES にも RECIPE_DISCOVERY にも COMBOS にも入れない。
  // かおりのランプ = 依頼 q3_taste の お礼 / よそじまのちず = なかよし度5の お礼。
  // 材料に「よその島の素材」を1つ入れてあるので、作るには いちば島へ行く必要がある
  // (= 週がわりの店に かよう理由が レシピの側からも できる)。
  { id: 'r_aroma_lamp', name: 'かおりのランプ', out: 'f_aroma_lamp', outKind: 'item', cost: { aroma_leaf: 2, wood: 1 } },
  { id: 'r_far_map', name: 'よそじまのちず', out: 'f_far_map', outKind: 'item', cost: { aroma_leaf: 1, sweet_honey: 1, wood: 2 } },
];

// 最初から知っているレシピ。
// はなだん・かいがらのかざりは「拾える素材が増えた」ことに気づいてもらう入口なので最初から見せる。
// きのこランプ・ほしのランタンは素材の初回入手でひらめく(src/systems/DiscoverySystem.ts)。
// v7-P2の5つ(室内向け家具3・かべがみ/ゆか2)は、家の中を自分で飾れることに気づく入口なので最初から見せる
// (ひらめきの引き金にできる「初めて手に入る素材」がもう残っていないため)。
// v8: ほうき・つぼ・ガーデンテーブルも最初から見せる(拾えるものが増えたことに気づく入口)。
// うえきばち・かざぐるま・とりのすばこ・うみのモビールは素材の初回入手でひらめく。
// v9: 道具(虫あみ・シャベル)は「作ると新しい素材がとれる」階段の入口なので最初から見せる。
// わらのマットも同じ理由(カマ→わら→マット の1歩目を見せる)。
// むしかご・いにしえのつぼ・かかしは、その道具でとれた素材の初回入手でひらめく。
// v12: キッチンだいも最初から見せる。くみあわせタブの りょうりが
// 「キッチンだいが あれば つくれそう」と出たときに、作りかたが すぐ見つかるようにする。
export const INITIAL_RECIPES = [
  'r_sickle', 'r_rod', 'r_flowerbed', 'r_shelldeco',
  'r_bookcase', 'r_dishrack', 'r_flowervase', 'r_wall_leaf', 'r_floor_rug',
  'r_broom', 'r_jar', 'r_gardentable',
  'r_net', 'r_shovel', 'r_strawmat',
  'r_kitchen',
];

// ツムギの店で買える家具・かべがみ・ゆかいた
export const SHOP_STOCK: { item: ItemId; price: number }[] = [
  { item: 'f_chair', price: 40 },
  { item: 'f_shelf', price: 90 },
  { item: 'f_rug', price: 60 },
  { item: 'f_pot', price: 35 },
  { item: 'f_sign', price: 30 },
  // 模様替え(6種とも同じ値段)。作れる2種も置いてある(作らずに買ってもよい・戻したいときにも買える)
  { item: 'wall_cream', price: 120 },
  { item: 'wall_sky', price: 120 },
  { item: 'wall_leaf', price: 120 },
  { item: 'floor_wood', price: 120 },
  { item: 'floor_tile', price: 120 },
  { item: 'floor_rug', price: 120 },
];

// データ整合性チェック(起動時に呼ぶ)
export function validateItemData(): string[] {
  const problems: string[] = [];
  for (const r of RECIPES) {
    for (const key of Object.keys(r.cost)) {
      if (!(key in ITEMS)) problems.push(`レシピ${r.id}の材料${key}が存在しない`);
    }
    if (r.outKind === 'item' && !(r.out in ITEMS)) problems.push(`レシピ${r.id}の産出${r.out}が存在しない`);
    if (r.outKind === 'tool' && !(r.out in TOOLS)) problems.push(`レシピ${r.id}の産出${r.out}が存在しない`);
  }
  for (const s of SHOP_STOCK) {
    if (!(s.item in ITEMS)) problems.push(`店の品${s.item}が存在しない`);
  }
  // だいじなもの(keyItem)は うれない・あげられない。売値は0にそろえる
  // (0でないと「うる」画面から消したのに値段だけ残っている、というちぐはぐが起きる)
  for (const [id, def] of Object.entries(ITEMS)) {
    if (def.keyItem && def.sell !== 0) problems.push(`だいじなもの${id}の売値が0でない`);
  }
  // 模様替え: 表とITEMSのkindが食い違うと「つかう」が出ない/出すぎるので、両方向を見る
  for (const id of Object.keys(DECOR_SLOT)) {
    if (!(id in ITEMS)) problems.push(`模様替え${id}が存在しない`);
    else if (ITEMS[id as ItemId].kind !== 'decor') problems.push(`模様替え${id}のkindがdecorでない`);
  }
  for (const [id, def] of Object.entries(ITEMS)) {
    if (def.kind === 'decor' && !isDecor(id)) problems.push(`decorの${id}がDECOR_SLOTに無い`);
  }
  if (!isStyleFor('wall', DEFAULT_HOME_STYLE.wall)) problems.push('既定のかべがみが不正');
  if (!isStyleFor('floor', DEFAULT_HOME_STYLE.floor)) problems.push('既定のゆかいたが不正');
  // 展示家具: 家具そのものが置ける家具で、入れられるものが実在するか(両方向を見る)
  for (const [id, def] of Object.entries(DISPLAY_FURNITURE)) {
    if (!(id in ITEMS)) problems.push(`展示家具${id}が存在しない`);
    else if (ITEMS[id as ItemId].kind !== 'furniture') problems.push(`展示家具${id}のkindがfurnitureでない`);
    const accepts = def.accepts as readonly ItemId[];
    if (accepts.length === 0) problems.push(`展示家具${id}に入れられるものが無い`);
    for (const it of accepts) {
      if (!(it in ITEMS)) problems.push(`展示家具${id}に入れる${it}が存在しない`);
    }
    // 入る数は1以上の整数(0だと「入れられるのに入らない」家具になる)
    if (!Number.isInteger(def.capacity) || def.capacity < 1) problems.push(`展示家具${id}のcapacityが1以上の整数でない`);
    // おおきい版のレシピ: 実在して、その産出が また展示家具で、入れられるものが同じで、もっと入ること
    const up = (def as { upgrade?: string }).upgrade;
    if (up !== undefined) {
      const r = RECIPES.find((x) => x.id === up);
      if (!r) problems.push(`展示家具${id}のおおきい版レシピ${up}が存在しない`);
      else if (!isDisplayFurniture(r.out)) problems.push(`展示家具${id}のおおきい版${r.out}が展示家具でない`);
      else {
        const big = DISPLAY_FURNITURE[r.out];
        if (big.capacity <= def.capacity) problems.push(`展示家具${id}のおおきい版${r.out}のほうが入らない`);
        const a = [...accepts].sort().join(',');
        const b = [...(big.accepts as readonly ItemId[])].sort().join(',');
        if (a !== b) problems.push(`展示家具${id}とおおきい版${r.out}で入れられるものが違う`);
        if (big.statKey !== def.statKey) problems.push(`展示家具${id}とおおきい版${r.out}でstatKeyが違う`);
      }
    }
  }
  // v12 りょうり: 実在して kind が food か(kindがちがうと「たべる」が出ない)
  for (const id of COOKED_FOODS) {
    if (!(id in ITEMS)) problems.push(`りょうり${id}が存在しない`);
    else if (ITEMS[id].kind !== 'food') problems.push(`りょうり${id}のkindがfoodでない`);
    else if (!isPlaceable(id)) problems.push(`りょうり${id}が置けない`);
  }
  // v12 いろみず: 実在して、色が重ならないか(同じ色が2つあると ぬり分けが見分けられない)
  const hexes = new Set<string>();
  for (const [id, def] of Object.entries(PAINT_COLORS)) {
    if (!(id in ITEMS)) problems.push(`いろみず${id}が存在しない`);
    if (!/^#[0-9a-f]{6}$/.test(def.hex)) problems.push(`いろみず${id}の色が不正`);
    if (hexes.has(def.hex)) problems.push(`いろみず${id}の色が重複`);
    hexes.add(def.hex);
  }
  return problems;
}

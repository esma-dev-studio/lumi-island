# ルミ島のくらし — Lumi Island

夜になると植物や鉱石がやわらかく光る小さな島で、採取・釣り・クラフトをしながら島に「灯り」を取り戻す、ブラウザで遊べる3Dスローライフゲーム(Vertical Slice、15〜30分)。

**▶ ブラウザで遊ぶ: https://esma-dev-studio.github.io/lumi-island/** (PC・キーボード操作)

- 完全オリジナルIP。キャラクター・建物・音・テクスチャはすべてプログラム生成の自作アセット
- キャラクターはスキンメッシュ+12種アニメーションのGLB(自作プロシージャル生成パイプライン製)
- スクリーンショット: `.logs/screenshots/review_v4/`(27枚: 誘導・会話・池・高台・配置・開花前後など)

## 起動方法

```bash
npm ci        # (はじめてなら npm install でも可)
npm run dev
```

ブラウザで http://localhost:5183 を開く(PCブラウザ推奨。Edge/Chromeで確認済み)。

- キャラクターGLB(`public/assets/characters/`)は同梱済み。追加生成なしで起動できる。再生成: `npm run gen:characters`
- 配布用ビルド: `npm run build` → `dist/`(この開発機でローカル成功を確認済み)
- キャラクター展示画面(開発用): http://localhost:5183/?scene=showcase
- デバッグ起動(テストフック有効): http://localhost:5183/?scene=game&debug=1

## 操作方法

最初に必要なのは**移動とEだけ**。ほかのキーは遊びが進むと解放され、そのつど画面で案内される。

| 入力 | 動作 | 使えるようになるタイミング |
|---|---|---|
| WASD / 矢印キー | あるく | 最初から |
| Shift | はしる | 最初から |
| E / Space | しらべる・とる・はなす・つりあげる | 最初から |
| Esc | 閉じる / メニュー | 最初から |
| Tab / I | もちもの | はじめて素材を手に入れたら |
| Q | 島のおねがい | はじめて依頼を受けたら |
| C | クラフト | 最初の依頼を達成したら |
| R | (配置モード中)回転 | 配置モード中のみ |

## 遊び方(ゲームの流れ)

ゲームは**夕方から始まり、開始から1分ほどで夜**になって島の植物や鉱石が光り出します。
画面左上の**「いまやること」**に、次の1アクションと目的地への距離が常に表示され、
画面端の矢印・目的地の光の柱・NPC頭上の「!」マーカーが道案内をします。

1. 広場の左にある**ツムギ工房**であいさつ → 最初のおねがい「工房の材料あつめ」
2. 北の林で木をきる → 報酬のツルハシで岩・高台の鉱石もとれるように
3. ツリザオをクラフトして釣り(昼はサカナ、**夜はヨザカナ**) → ミナモのおねがい
4. 夜の高台にいる**ノクト**の研究をてつだう → 「いしのランプ」のレシピ
5. **ランタンを作って島に置く**(ツムギのおねがい) → さらに光る家具を合計3つ置くと、広場の「ルミの木」が目をさます

売却はツムギ工房のカウンター(うる/かう)。家具は「もちもの」から「おく」で配置できます。
セーブは自動(約20秒ごと+節目)。タイトルの「つづきから」で再開できます。

**「ねる」は補助機能です。** 自宅のドアでEを押すと朝までスキップできますが、これは
自由探索・時間調整のための補助であり、**メイン依頼の進行に睡眠は必要ありません**。
依頼を受注中・報告待ちのNPCは questCritical により在宅時間帯でも家に入らず、
いつでも話しかけられます(`src/systems/NPCSystem.ts`)。
夜のあいだにやることが済んで昼の時間帯へ送りたいとき(昼のサカナを釣りたいときなど)や、
NPCがどうしても見つからないときの補助導線として使ってください。

## 構成

```
src/
  main.ts          エントリ(タイトル→ゲーム/展示のルーティング)
  game/            GameState(純データ。セーブ対象)
  scenes/          GameScene(統括) / InteractionRouting(E入力) / SequenceDirector(見せ場) / IslandScene / DayNight / ShowcaseScene
  systems/         Player/NPC/Interaction/Gather/Fishing/Crafting/Quest/Placement/Time(純ロジック)
  characters/      CharacterView(GLBロード・クロスフェード・まばたき)
  entities/        terrain/water/flora/deco/buildings/furniture(実行時プロシージャル生成)
  data/            items/recipes/quests/npcs/island(データ駆動。起動時に整合性検査)
  ui/              HUD/会話/所持品/クラフト/店/依頼/タイトル/メニュー(DOM)
  audio/           WebAudio合成の効果音・環境音
  save/            localStorageセーブ(バージョン管理・破損時は新規へ復旧)
tools/
  chargen/         キャラクターGLB生成パイプライン(リグ・アニメ・テクスチャ)
  shot.mjs 等      ヘッドレスEdgeでのスクリーンショット検証ハーネス
tests/
  unit/            Vitest(100件: 状態・クラフト・依頼・目標・候補選択・時間・セーブ・採取・配置)
  e2e/             Playwright(21件: 基本フロー・睡眠・夜釣り・モーダル停止・会話カメラ・オンボーディング)
```

- ロジック(systems)はBabylon/DOM非依存でユニットテスト可能
- キャラクターのモデルパス・縮尺・アニメ名は `src/data/characters.ts` で管理
- ライセンス記録: [ATTRIBUTIONS.md](ATTRIBUTIONS.md)(外部アセットはフォントのみ)

## テスト・検証(3段階)

- **A. ユニット** — `npm run verify` … typecheck + lint + Vitest 100件 + 同形異文字チェック
- **B. 決定的リグレッション** — `npm run e2e`(Playwright 21件・システムのEdge)/
  `npm run test:regression`(実キー入力でタイトル→全依頼→開花を通しで実行。進行判断に
  内部状態の読み取りを使うため回帰試験であり、「子どもが遊べた証明」ではない)
- **C. ブラックボックスUX** — `npm run test:ux` … 画面の目標文・距離・矢印・マーカー・
  通常キーだけで遊ぶ(内部状態・デバッグAPI不使用)。範囲はタイトル→初クラフト→初家具配置
  (v4で273秒・エラー0の完走実績。`.logs/ux_result.json`)。
  子ども向けUXの最終判定は人間によるブラインドプレイテスト(`.logs/usability_test_report.md`・未実施)
- 性能 — `npm run test:performance`(結果: `.logs/performance_report.md`)
- 実測記録: `.logs/playtest_report.md`(回帰ボット) / `.logs/ux_result.json`(UXボット)

## 制約・既知の事項

- PCブラウザ・キーボード操作が対象(モバイル用UIは未実装。入力・UIは分離してあり追加可能)
- 採取ノードの枯れ/復活状態はセーブ対象外(リロードで復活。仕様)
- 音はブラウザの自動再生制限のため、最初のクリック/キー入力後に有効になる

## 開発ドキュメント

[PLAN.md](PLAN.md) / [AGENTS.md](AGENTS.md) / [ART_DIRECTION.md](ART_DIRECTION.md) / [CHARACTER_SPEC.md](CHARACTER_SPEC.md) / [ASSET_PIPELINE.md](ASSET_PIPELINE.md) / 品質ゲート記録: `.logs/gate_review.md`

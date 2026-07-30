# ルミ島のくらし — Lumi Island

夜になると植物や鉱石がやわらかく光る小さな島で、採取・釣り・クラフトをしながら島に「灯り」を取り戻す、ブラウザで遊べる3Dスローライフゲーム(Vertical Slice、15〜30分)。

- 完全オリジナルIP。キャラクター・建物・音・テクスチャはすべてプログラム生成の自作アセット
- キャラクターはスキンメッシュ+9種アニメーションのGLB(自作プロシージャル生成パイプライン製)
- スクリーンショット: `.logs/screenshots/final/`(タイトル/キャラ展示/昼/夜/会話/採取/クラフト/配置/所持品/依頼完了)

## 起動方法

```bash
npm install
npm run dev
```

ブラウザで http://localhost:5183 を開く(PCブラウザ推奨。Edge/Chromeで確認済み)。

- キャラクターGLBはリポジトリに同梱済み。再生成する場合: `npm run gen:characters`
- キャラクター展示画面(開発用): http://localhost:5183/?scene=showcase
- デバッグ起動(テストフック有効): http://localhost:5183/?scene=game&debug=1

## 操作方法

| 入力 | 動作 |
|---|---|
| WASD / 矢印キー | あるく |
| Shift | はしる |
| E / Space | しらべる・とる・はなす・つりあげる |
| Tab / I | もちもの |
| C | クラフト |
| Q | 島のおねがい(依頼リスト) |
| R | (配置モード中)回転 |
| Esc | 閉じる / メニュー |

## 遊び方(ゲームの流れ)

1. 広場の左にある**ツムギ工房**であいさつ → 最初のおねがい「工房の材料あつめ」
2. 北の林で木をきる → 報酬のツルハシで岩・高台の鉱石もとれるように
3. ツリザオをクラフトして釣り(昼はサカナ、**夜はヨザカナ**) → ミナモのおねがい
4. 夜の高台にいる**ノクト**の研究をてつだう → 「いしのランプ」のレシピ
5. ランタンなど**光る家具を島に3つ置く**と、広場の「ルミの木」が目をさます

売却はツムギ工房のカウンター(うる/かう)。家具は「もちもの」から「おく」で配置できます。
セーブは自動(約20秒ごと+節目)。タイトルの「つづきから」で再開できます。

## 構成

```
src/
  main.ts          エントリ(タイトル→ゲーム/展示のルーティング)
  game/            GameState(純データ。セーブ対象)
  scenes/          GameScene(統括) / IslandScene(環境) / DayNight / ShowcaseScene
  systems/         Player/NPC/Interaction/Gather/Fishing/Crafting/Quest/Placement/Time(純ロジック)
  characters/      CharacterView(GLBロード・クロスフェード・まばたき)
  entities/        terrain/water/flora/buildings/furniture(実行時プロシージャル生成)
  data/            items/recipes/quests/npcs/island(データ駆動。起動時に整合性検査)
  ui/              HUD/会話/所持品/クラフト/店/依頼/タイトル/メニュー(DOM)
  audio/           WebAudio合成の効果音・環境音
  save/            localStorageセーブ(バージョン管理・破損時は新規へ復旧)
tools/
  chargen/         キャラクターGLB生成パイプライン(リグ・アニメ・テクスチャ)
  shot.mjs 等      ヘッドレスEdgeでのスクリーンショット検証ハーネス
tests/
  unit/            Vitest(30件: 状態・クラフト・依頼・時間・セーブ・採取)
  e2e/             Playwright(7件: 開始・移動・採取・クラフト・配置復元・会話依頼・釣り)
```

- ロジック(systems)はBabylon/DOM非依存でユニットテスト可能
- キャラクターのモデルパス・縮尺・アニメ名は `src/data/characters.ts` で管理
- ライセンス記録: [ATTRIBUTIONS.md](ATTRIBUTIONS.md)(外部アセットはフォントのみ)

## テスト

```bash
npm run typecheck   # TypeScript
npm run lint        # ESLint
npm test            # Vitest(ユニット)
npm run e2e         # Playwright(要: システムのEdge。ブラウザDL不要)
npm run check:chars # 同形異文字の混入検査
```

## 制約・既知の事項

- PCブラウザ・キーボード操作が対象(モバイル用UIは未実装。入力・UIは分離してあり追加可能)
- 採取ノードの枯れ/復活状態はセーブ対象外(リロードで復活。仕様)
- `npm run build` はこの開発機では動作確認済みだが、配布は未実施(ローカル起動が前提)
- 音はブラウザの自動再生制限のため、最初のクリック/キー入力後に有効になる

## 開発ドキュメント

[PLAN.md](PLAN.md) / [AGENTS.md](AGENTS.md) / [ART_DIRECTION.md](ART_DIRECTION.md) / [CHARACTER_SPEC.md](CHARACTER_SPEC.md) / [ASSET_PIPELINE.md](ASSET_PIPELINE.md) / 品質ゲート記録: `.logs/gate_review.md`

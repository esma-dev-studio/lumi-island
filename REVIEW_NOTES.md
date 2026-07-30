# レビュー用メモ(v2)

## プロジェクト概要
「Lumi Island(ルミ島のくらし)」— ブラウザで遊べる3Dスローライフゲームの Vertical Slice(15〜30分)。
TypeScript + Vite + Babylon.js。キャラクター・環境・音はすべてプログラム生成の自作アセット(完全オリジナルIP)。

- ゲーム内容・完成条件: `README.md` / `PLAN.md`
- 完成条件チェック: `.logs/dod_check.md` / キャラ品質ゲート: `.logs/gate_review.md`
- **実プレイ計測(デバッグなし完走)**: `.logs/playtest_report.md`
- 実行画面: `.logs/screenshots/review_v2/`(16枚)

## v1レビュー(2026-07-30)への対応
| 指摘 | 対応 |
|---|---|
| q_lantern がcollect型でランタンを消費する矛盾 | `placeItem`型を新設。配置数で判定し、完了しても配置物・所持品を消費しない |
| ポーズが見た目だけ | PauseMenu表示中は時間・NPC・世界更新を完全停止(E2Eで検証) |
| セーブ検証が弱い | 全フィールドのスキーマ検証+サニタイズ(不正ID/負数/NaN/重複ID/未来ver等をユニットテスト) |
| ZIPにGLBがない・lockがない | 配布物にGLB4体+package-lock+distを同梱。新規ディレクトリで `npm ci`→build を検証 |
| 次の行動が分からない | 左上「いまやること」HUD(常時1アクション+進捗+距離)+ ObjectiveSystem |
| 目的地が分からない | 画面端の方向矢印+距離 / 固定目的地の光の柱 / NPC頭上の「!」「✓」マーカー |
| キー数が多い | 段階解放(最初は移動とEのみ。Tab/C/Qは体験に応じて解放・案内) |
| 迷子になる | 60秒進展なしで自動ヒント(60秒クールダウン・近接時は出さない) |
| 夜景がすぐ見えない | 夕方18:30開始。開始約25秒で日没→初回のみ2.8秒の見せ場(カメラ+発光+一文) |
| 採取に手触りがない | 対象のゆれ+素材の粒+アイテム飛び+ヒットストップ55ms+カメラシェイク+即時進捗 |
| 依頼達成が地味 | 専用の達成バナー(報酬+つぎの行動。クリック/Eで早送り) |
| キャラが小さい | カメラを約21%接近(8.4→6.6)。会話時はふたりが見えるクローズアップへ補間 |
| 夜が暗い | 夜の環境光を引き上げ+発光家具の光だまり+最寄り発光源からの動的ライト1灯 |
| 草が切り株に見える | クラスタ配置(3〜7個+空白)+種類7種+エリア別構成+12Hzの弱い風(3位相) |
| エリアが同じに見える | 林=密+切株+落ち葉 / 池=アシ+バケツと竿 / 高台=岩肌+望遠鏡 / 浜=流木 / 工房=まき+木箱 |
| ツムギ/ミナモの種族が弱い | 角を外へカール・横に張る垂れ耳・長いマズル / 低い横耳・幅広マズル・明るい口元・太い尾 |
| GameSceneが肥大 | Objective/Tutorial/InteractionResolver/CameraController/WorldMarker/QuestDialogue に分離 |
| 距離補正のマジックナンバー | InteractionResolver(優先度と距離を分離した候補モデル+ユニットテスト) |
| 毎フレーム負荷 | 色は起動時パース+参照再利用、DayNight/遮蔽/風は12〜15Hz、DPR上限1.5 |
| E2Eがデバッグ頼み | `tests/e2e/onboarding.spec.ts`(実キーのみ)+実プレイボット(`tools/playtest_bot.mjs`) |
| (ボットが発見)ツリザオ材料の案内が飛ぶ | クサツルにはカマ(木2+石1)が必要だが目標が案内せず詰まる → ObjectiveSystemに「カマの材料→カマを作る」段階を追加+ユニットテスト |
| 400行超ファイル | flora(593)→flora+deco / GameScene(565)→GameScene+SequenceDirector+InteractionRouting に分割(全ファイル約400行以下) |

## 構成の要点
- `src/systems/` … 純ロジック(Objective/Tutorial/Resolver/Quest/Craft/Gather/Save 等。Vitest 51件)
- `src/scenes/` … GameScene(組み立て)/ InteractionRouting / SequenceDirector / Island / DayNight / Camera / WorldMarker / QuestDialogue
- `src/entities/` … 地形・水・植生・建物・家具・小物・演出(実行時プロシージャル生成)
- `tools/chargen/` … キャラGLB生成(リグ26ボーン+アニメ12種+まばたきモーフ)
- `tests/e2e/` … Playwright 9件(うち1件はデバッグAPI不使用のオンボーディング)

## 実行方法
`npm ci` → `npm run dev` → http://localhost:5183 (GLB同梱・追加生成不要)
検証一括: `npm run verify` / E2E: `npm run e2e` / 配布ビルド: `npm run build`(dist/)

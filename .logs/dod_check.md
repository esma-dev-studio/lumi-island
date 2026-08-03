# Definition of Done / 公開可否チェック

> **このファイルは `node tools/generate_reports.mjs` による自動生成です。手で編集しないでください**(編集内容は次回の生成で失われます)。数値の出どころは下の「入力」に挙げたJSONだけで、このファイルに手書きの数値はありません。

| 項目 | 値 |
|---|---|
| Run ID(決定的リグレッションボット) | `pt-20260803T1207-2ccad940` — 導出(mtime+内容ハッシュ) |
| Run ID(ブラックボックスUXボット) | `ux-20260803T1222-060db3f0` — 導出(mtime+内容ハッシュ) |
| Run ID(耐久性能) | `pf-20260803T1326-13282857` — JSON埋め込み |
| Run ID(Visual Review) | NOT TESTED(入力なし) |
| Run ID(人間ブラインドテスト) | NOT TESTED(入力なし) |
| gitコミット | `d676573`(**未コミットの変更あり**) |
| 生成日時 | 2026-08-03 13:26 JST |
| 生成コマンド | `node tools/generate_reports.mjs` |
| 入力 | `.logs/playtest_result.json`(更新 2026-08-03 12:07 JST) / `.logs/ux_result.json`(更新 2026-08-03 12:22 JST) / `.logs/perf_result.json`(更新 2026-08-03 13:26 JST) / `.logs/visual_review_result.json` = **なし** / `.logs/human_test_result.json` = **なし** |
| 過去走行の記録 | `.logs/history/runs.md`(現行のこのファイルには**今回の実測値だけ**を載せる) |

## 現在の到達段階

# Internal Alpha

自動テスト・UXボット・耐久性能のどれかが未達のため、**社内アルファ止まり**。外部に配らない。

## 3段階の条件と充足状況

| 段階 | 条件 | 判定 | 根拠 |
|---|---|---|---|
| Limited Playtestに必要 | ユニットテストが全緑 | **PASS** | 222/222 成功・失敗0 |
| Limited Playtestに必要 | E2Eテストが全緑 | **NOT TESTED** | `e2e_result.json` が無い(未取得) |
| Limited Playtestに必要 | 回帰ボットが完走(依頼全完了・エラー0) | **PASS** | 完走=はい・依頼5/5・エラー0 |
| Limited Playtestに必要 | UXボットがPASS(表示の矛盾・停滞0) | **FAIL** | result=ok・意味矛盾1件・停滞1回・報告中の再釣り0回・店の誤開き0回 |
| Limited Playtestに必要 | 耐久性能が10分連続でPASS(p95<=25ms・p99<=35ms・フリーズ0) | **NOT TESTED** | **smokeのみ**(62秒の短縮走行)。短縮版はPASS扱いにしない |
| Public Releaseに必要 | 人間ブラインドテスト3人がPASS | **NOT TESTED** | `human_test_result.json` が無い(**未実施**) |
| Public Releaseに必要 | Visual ReviewがPASS | **NOT TESTED** | `visual_review_result.json` が無い(未実施) |

判定の書き分け: **PASS**=証跡があって条件を満たす / **FAIL**=証跡があって条件を満たさない /
**NOT TESTED**=そもそも試していない(または結果が不完全)。**未実施をFAILとは呼ばない**。

## 段階の定義

| 段階 | 条件 | いまの可否 |
|---|---|---|
| Internal Alpha(社内のみ) | 自動テスト(unit/e2e/回帰)のいずれかが欠落・失敗、またはUXボットFAIL、または耐久性能が未PASS | **ここ** |
| Limited Playtest(限定公開) | 自動テスト全緑 + UXボットPASS + 耐久性能PASS。人間テストが無ければ**ここが上限** | 未達 |
| Public Release(一般公開) | 上記すべて + 人間ブラインドテスト3人PASS + Visual Review PASS | 未達 |

## 次の段階に進むために足りないもの

| 妨げている項目 | いまの判定 | どの段階のために必要か |
|---|---|---|
| E2Eテスト | **NOT TESTED** | Limited Playtest |
| UXボット | **FAIL** | Limited Playtest |
| 耐久性能(10分) | **NOT TESTED** | Limited Playtest |
| 人間ブラインドテスト3人 | **NOT TESTED** | Public Release |
| Visual Review | **NOT TESTED** | Public Release |

## 入力にしたJSON

| 入力 | ファイル | 状態 | Run ID | 更新 |
|---|---|---|---|---|
| 決定的リグレッションボット | `.logs/playtest_result.json` | あり | `pt-20260803T1207-2ccad940` | 2026-08-03 12:07 JST |
| ブラックボックスUXボット | `.logs/ux_result.json` | あり | `ux-20260803T1222-060db3f0` | 2026-08-03 12:22 JST |
| 耐久性能 | `.logs/perf_result.json` | あり | `pf-20260803T1326-13282857` | 2026-08-03 13:26 JST |
| Visual Review | `.logs/visual_review_result.json` | **なし**(NOT TESTED) | ー | ー |
| 人間ブラインドテスト | `.logs/human_test_result.json` | **なし**(NOT TESTED) | ー | ー |
| ユニットテスト(vitest) | `.logs/unit_result.json` | あり | `ut-20260803T1322-d4f6a243` | 2026-08-03 13:22 JST |
| E2Eテスト(playwright) | `.logs/e2e_result.json` | **なし**(NOT TESTED) | ー | ー |

## 取得コマンド

| 入力 | コマンド |
|---|---|
| ユニットテスト | `npm run test:unit:json` |
| E2Eテスト | `npx playwright test --reporter=json`(結果を `.logs/e2e_result.json` に保存) |
| 回帰ボット | `npm run test:regression` |
| UXボット | `npm run test:ux` |
| 耐久性能(本番10分) | `npm run test:endurance` |
| Visual Review | 判定結果を `.logs/visual_review_result.json` に保存 |
| 人間ブラインドテスト | 実施結果を `.logs/human_test_result.json` に保存 |
| このファイルの再生成 | `npm run report` |


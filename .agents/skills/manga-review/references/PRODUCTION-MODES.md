# 制作モード

`workflow.json` の `productionMode` は `quality`（品質優先）または `economy`（節約）。省略は従来動作で、既存レビューのfingerprintも維持する。新規作品の既定はquality。

```powershell
node cli/auto.mjs start "C:\path\original.txt" --mode economy
node cli/new-work.mjs my-story "タイトル" "C:\path\original.txt" --mode economy
$env:MANGA_PROJECT='works/my-story/workflow.json'
node cli/stage-review.mjs mode quality
```

同じ原作の受付再開ではモードを暗黙に変更しない。異なるモードを指定した再開は拒否する。既存作品の切替にはstage-review modeを使い、通常CLIの履歴保存を通す。切替後は新requestで必要なレビューを取り直す。確定パッケージは変更せず、必要なら改訂版を作る。

## 実装された差

qualityは従来の広いレビュー入力。新規作品と `stage-review mode` で明示切替した作品には `reviewPolicy.version: 3` が付き、economyのartworkは対象コマ、直前直後と明示した依存コマへ絞る。storyboard・letteringは対象ページと境界コマを残す。話者・可視顔・手の記録から人物を収集する。source・script・finalは全文・全体確認を維持する。全工程の独立レビュー、画像だけの初読、合格条件も維持する。旧economy設定を自動移行せず、古い確認記録の意味を変えない。

局所工程の原作は、sourceHashと全区間の連続性・対象コマを検証できるsource-coverage.jsonがある場合のみ該当範囲を埋め込む。対応表が欠ける・古い・対象文脈を覆わない場合は全文に戻す。元の原作と対応表はハッシュ依存として保持し、変更を無視しない。離れた伏線や衣装・感情の前提は、受け側コマの `reviewDependencies: ["01-1"]` にコマIDを保存する。依存を推移的に追い、循環で停止不能にならず、存在しないIDは拒否する。意味上の依存関係を自動発見する機能ではない。

顔参照を省くのは、cast.faceDesign.referenceの所有者全員が対象外で、referenceRolesの値が厳密に `identity` の専用参照だけ。スタイル兼用・役割未分類・共有参照は維持する。ページ・コマ・状態・sectionで明示された参照も維持する。絵柄の基準を兼ねる画像にはidentityを指定しない。

モードはレビュー入力のハッシュに含む。関連人物・対象ページ・前後関係・原作・使用画像の変更は引き続き失効対象。節約で除外された無関係な人物設定だけの変更は局所レビューを失効させない。モデル名や推論能力を切り替える機能ではない。

## 制作エージェントの運用

両モードとも、重要な決定・却下理由・ユーザー指定を以下のJSONにして `node cli/stage-review.mjs decision works/my-story/decision.json` で保存する。主担当は依頼やレビューで新しい決定が出た時点で記録する。チャット内容からの自動推測・抽出ではない。

```json
{"id":"shirt","kind":"preference","text":"上着は白い作業シャツ","reason":"ユーザー指定","scope":{"actors":["a"]}}
```

kindはpreference・rejected・continuity。scopeはpanels・pages・actors・sectionsのID配列で、省略は全体。未知の対象は拒否する。同じidは更新し、以前の内容は通常CLIの履歴へ残る。保存先はworkflow.jsonのproductionDecisions。レビューと生成指示へ関連する記録を渡すため、履歴を渡さなくても好みと却下理由を引き継げる。画像だけの初読には渡さない。

## 履歴なしで独立レビューを実行する

```powershell
node cli/review-run.mjs source all
node cli/review-run.mjs script all
node cli/review-run.mjs storyboard 01
node cli/stage-review.mjs pending
node cli/review-run.mjs pending
```

既定はインストール済みCodex CLIの `codex exec --ephemeral --json --sandbox read-only`。resume/forkを使わず、リポジトリ外の一時ディレクトリへ対象資料だけをスナップショットし、stdinへ新しい依頼を渡す。親チャットの履歴は渡さず、セッション関連の環境変数も除く。画像だけの初読は画像と観察の依頼だけで別プロセスを起動する。照合はさらに別プロセスで行う。認証・モデル・利用枠はCLIの設定に従う。CLI不在・未ログイン・利用枠不足は失敗として残し、検品済みにしない。

現在の入力ハッシュを通常のrecordコマンドで再照合し、観察・台詞・読順・未解決指摘の検査を通す。起動成功だけでは合格しない。pendingは有効な合格記録を保ち、古い・未確認の対象だけを列挙・実行する。変更が隣接コマ・離れた依存コマへ影響する場合も再確認対象になる。全体脚本と最終稿の確認は省かない。

prompt、資料のスナップショット、応答、stdout/stderr、実際のtask名、JSONLのusageは `workflow/review-runs/` に保存する。usageが返らない場合は未計測とする。別ディレクトリでの起動は履歴の非引継ぎを実装するが、OSによるファイルアクセスの完全隔離を保証しない。レビュアーには提供資料以外を読まないよう指示する。

他の実行環境は `reviewRunner: {"protocol":"packet-v1","command":"実行ファイル","args":[]}` で宣言できる。新規プロセスへstdinでprompt・packetパス・outputパス・imagesを渡す。実際の独立エージェントを起動し、outputへJSONを書くアダプターが必要。resume/fork系の引数は拒否する。テスト用アダプターの成功をAI検品と報告しない。

Codex CLIの仕様は [公式の非対話実行](https://developers.openai.com/codex/noninteractive) とローカルの `codex exec --help` で確認した。

## 短い出力と詳細ログ

economyのstage-review prepare・prepare-reading・pendingとgeneration prepare・prepare-editは、通常は状態・request・detailsのパスだけを表示する。全文はworkflow/cli-logsへ保存する。`--verbose` で従来どおり全文を表示できる。画像ツールには短いstdoutを渡さず、request内の正確なpromptと参照を読む。runnerの失敗時もログの保存先を返す。

## 作画前の確定と修正再開

```powershell
node cli/stage-review.mjs seal
# 絵を見て構図・台詞を見直す場合
node cli/stage-review.mjs reopen "手紙を受け取る動作を分割する"
# 脚本・ネームを修正し、pendingで必要なレビューを再取得してから
node cli/stage-review.mjs seal
```

新規作品と明示的なmode切替ではdesignSealRequiredを有効にする。source・script・全ページのstoryboardが現在の入力で合格して初めてsealを保存できる。sealがない・再開中・入力が変わった状態では画像生成準備と完成buildを拒否する。planや配置変更は可能で、画像を見た後でも修正して再レビュー・再確定できる。確定・再開の理由と以前のsealをdesign-historyへ残す。

economyではまず1候補を生成し、不備や同一性の判断困難があれば候補を追加する。qualityでは難しい場面の候補比較を積極的に検討する。いずれも必要な顔候補比較・角度表情集や実画像の検品を省略せず、不備を予算だけで合格にしない。問題が局所資料で判断できなければ全文・追加参照を確認し、追加資料も正式なレビュー入力へ含めて記録する。必要ならqualityへ切り替える。

## 比較を再実行する

`node cli/compare-modes.mjs` は保存済み作品に対して品質優先・前回の節約実装・今回の節約実装を同じ条件で比較し、docs/metrics/production-mode-comparison.jsonへ保存する。入力文字量、計画上の画像数、存在する画像数、全文へのフォールバック回数、台詞1箇所変更時の再確認対象数を分ける。既存作品は変更しない。モデルの実usage・画像トークン・推論・出力・キャッシュ・再生成回数の比較ではない。

実トークンを測る場合は `MANGA_PROJECT` を明示して `node cli/measure-review.mjs works/my-story/workflow.json 01-1` を実行する。同じ保存済みコマで品質優先・節約の独立レビューを実際に2回起動し、利用枠を消費する。制作の合格・採用記録へは反映せず、測定用の応答とusageを別保存する。結果はdocs/metrics/measured-review-comparison.json。入力・キャッシュ・出力・推論の各値と実行順を残す。1回ずつの標本なので全作品・全工程の削減率として一般化しない。

今回の比較は [26作品の入力比較](metrics/production-mode-comparison.json) と [実コマ1件のusage比較](metrics/measured-review-comparison.json) に保存した。前者の脚本・原作文字量は42.85%減（前回実装15.70%減）、台詞1箇所変更時の再確認対象は26作品合計229件から181件。後者の入力トークンは41,506から39,428で約5.0%減、入力＋出力の集計は約4.7%減。隣接画像を追加する場合があり、資料の文字削減率と実トークン削減率は一致しない。両方とも修正依頼の応答で、作品の完成認定には使っていない。

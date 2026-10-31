# 生成指示と読順レビュー

新規作品は `promptPolicy: {"version": 2}` を使う。既存作品へ設定を自動追加しないため、保存済みの指示・採用記録・工程レビューは従来の判定を維持する。既存作品で切り替える場合は設定変更前後に履歴を保存し、plan、必要な再採用または再生成、検品を正式にやり直す。確定パッケージを更新しない。

## 画像生成と修正

生成指示には場面・演技、見えている人物、場面の衣装と小道具、配置、絵柄を分けて渡す。画面外の声や別場面の人物を、そのコマへ描かせない。家具や植物の有無と背景の密度は場面・ショットに従う。原作と脚本のレビューでは引き続き全文と前後の因果を確認する。

`generation prepare` が返す `prompt` と `references` を同じ順番で画像ツールへ渡す。`referenceManifest` の番号・役割と保存する入力画像・ハッシュは同じ一覧から作る。レイアウト画像は現在のネームの正確なパスで識別し、素材が `panels/` にあるという理由だけでネームと扱わない。追加素材の役割は作品の `referenceRoles` に記入する。

編集は `generation prepare-edit`、検品結果からの修正は `workflow quality-repair` を使う。画像1が対象で、以降は補助参照。生成用の全文指示を重ねず、変更箇所と維持範囲を渡す。指定した変更に必要な手・接触物・遮蔽は一緒に修正できる。修正後は実画像の比較、顔・口の再計測、文字配置と描画検品が必要。

## 読順を二段階で確認する

新規作品の `productionReview.readingProtocol` は `two-phase-v1`。storyboard・lettering・finalでは通常の `prepare` の前に画像だけの読順観察を保存する。

```powershell
# 最新の番号なしネームをPNGへ出力
node cli/export.mjs works/my-story/workflow/storyboards-unnumbered
node cli/stage-review.mjs prepare-reading storyboard 01
# 返された画像だけを実際のサブエージェントへ渡し、回答を作品内へ保存
node cli/stage-review.mjs record-reading storyboard 01 works/my-story/workflow/first-read.json
# ここで初めて原作・脚本・意図した順番を渡して照合
node cli/stage-review.mjs prepare storyboard 01
node cli/stage-review.mjs record storyboard 01 works/my-story/workflow/comparison.json
```

最初の回答は `request`、実際の `reviewer: {role: "subagent", task: "タスク名"}` と `pages: [{page: "01", scan: "位置と読んだ台詞を自然な順番で記述。無言の反応も含む", observation: "近接する吹き出し、読み飛ばし、迷い、判読不能などの具体的観察"}]` を含める。原作や正解のコマ番号を先に見せず、期待どおりの順へ補正しない。

照合回答の `readingReview` には従来の項目に加え、prepareが返す `firstReadingHash` と、最初の観察との差を説明する `comparison` を入れる。読み飛ばしや曖昧さが未解決なら `changes-requested`。CLIは読順の意味を自動判定しない。最初の観察は上書きできず、画像や脚本を直した場合は新しい入力に対して観察し直す。

letteringは `workflow/review/page-XX.png`、finalは `output/page-XX.png` を先に最新SVGから出力し、工程名を置き換えて同じ手順を使う。各工程の実画像を見て判断し、白いテスト画像による機械検証と区別する。入力の分離は、レビュアーが他のファイルへアクセスできないことを保証する仕組みではない。

## 根拠と検証の範囲

[OpenAIの画像プロンプトガイド](https://developers.openai.com/api/docs/guides/image-prompting) の具体的な構図・参照役割・変更と維持の指定を採り入れた。[画像評価の例](https://developers.openai.com/cookbook/examples/multimodal/image_evals) と [GenEval](https://arxiv.org/abs/2310.11513) を踏まえ、人物・小道具・配置など観察できる項目を個別に検品する。[コミュニティの編集事例](https://community.openai.com/t/how-to-preserve-images-during-edits/1392634) は仮説の参考とし、保証や定量的根拠にはしない。

自動テストは参照番号、編集と生成の分離、観察の保存・失効、従来方式の回帰を検査する。画質や漫画の面白さの向上は保証しない。効果の判断には実画像を用いた同条件での比較が必要。

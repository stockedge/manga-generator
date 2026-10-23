# 汎用の漫画制作ワークフロー（第8版）

メモなどを横書きで引用する場合は、セリフへ `textDirection: "horizontal"` と `textColumns: ["一行目", "二行目"]` を指定する。配列は表示行の順番で、結合した内容は改行を除いた `text` と完全一致する必要がある。省略時または `vertical` は従来の縦書き。横書きも顔・手・小道具・尾・読順の検査対象で、文字を変えずに向きを変更した場合も `plan`、ネーム、採用・合成・独立レビューを更新する。

scriptの合格には全コマの `dialogueReview` が必要です。原作の問い返答や指示対象を復元してからネームと画像編集へ進みます。OCRの一致は脚本の自然さの証明ではありません。詳細は[工程レビュー](docs/REVISION-AND-REVIEWS.md)を参照してください。

ネーム設計は [読順・場面転換・時間と感情](docs/NARRATIVE-FLOW.md) に従う。原作の情報公開順と感情の変化を先に設計し、`workflow plan` が保存する `workflow/narrative-plan.json` と `workflow/reading-flow/` で全コマの接続を検討する。番号なしの実読レビューを先に行い、番号付き経路と照合する。配置が合わないときは人物配置・構図・コマ分割へ戻る。共通処理変更後の既存ロックは、新基準の検品・再現検証を通してから改訂版を固定する。

吹き出しの尾が小道具の線へ接近する場合は `dialogue.tailLength` に24〜160の整数で最大長を指定できる（未指定160）。口・顔の座標は実画像のまま保ち、`plan` → 同一素材の正式再採用（新規生成と区別）→ `preview` とPNG → 独立文字レビューを行う。長さだけを変えて検品済みと扱わない。

修正前後の状態保存、復元、セリフの視線誘導計画、各工程の独立レビューは [修正・レビュー手順](docs/REVISION-AND-REVIEWS.md) に従う。直接編集の前後は `history checkpoint`、作品内の編集スクリプトは `history run` を使う。

原作だけからCodexへ制作を任せる場合は [自動制作](docs/AUTOMATIC.md) を使う。`auto.mjs start` は受付・再開、`status` は実物の状態確認、`finish` は既存の検品・原作対応・PDF検査・再構築・固定・パッケージ検証を通して完了を記録する。以下はその内部でも使う制作手順である。

作品は works/<作品ID>/ に原作、設定、素材、ネーム、完成原稿を分けて保存する。現在の作品は works/kensei/。別作品用の未完成雛形は works/sample/。共通処理に登場人物名や作者名を埋め込まない。描画の方針は [第7版の記録](docs/ART-QUALITY.md)、従来の設計判断は [改善の記録](docs/IMPROVEMENTS.md) にまとめた。

## 新しい作品を追加

```powershell
node cli/new-work.mjs my-story "作品タイトル" "C:\path\original.txt"
$env:MANGA_PROJECT='works/my-story/workflow.json'
```

同じ作品IDへの上書きは拒否する。原作ファイルの指定は省略できる。以後のコマンドは MANGA_PROJECT で選択した作品だけを扱う。未指定なら works/kensei/workflow.json を使う。

## 脚本と場面の状態を決める

1. source/original.txt を読み、workflow.json の雛形を実際の漫画脚本へ置き換える。cast に任意の人物ID・名前・外見を登録し、地の文は kind: caption とする。原作の指定と漫画用に補った設定を区別する。
2. ページの purpose・expectation、コマの role・scene・読み順・矩形・セリフを決める。必要なら action・emotion・camera を記録する。無言の反応や余韻も使う。
3. cast の invariants や description に基本の外見を、sections に場面で変わる衣装・舞台・小道具を保存する。page.section で場面を指定し、回想や時間経過のコマは panel.section で切り替える。

```json
{
  "renderMode": "panels",
  "sections": {
    "shop": {
      "summary": "店で手紙を受け取る",
      "location": "机と窓がある小さな店",
      "costumes": {"a": "白い作業シャツ"},
      "objects": {"letter": "古い封筒。封蝋は一つ"},
      "references": ["works/my-story/assets/shop.png"]
    }
  }
}
```

costumes のキーは cast の人物IDと一致させる。objects は小道具IDと説明の対応。panel.state で同じ場面の一部分を上書きできる。例えば `"state":{"objects":{"letter":"開封後。封筒は机の上"}}` とする。上の参照パスは設定例なので、使用する場合は実ファイルを用意する。

## ネームと人物位置を決める

引用や台詞の一部だけ小さくする場合は、任意の `textSizeRanges: [{"start": 3, "end": 5, "fontSize": 22}]` を指定できる。start は0始まり、end は含まない位置で、`text` から改行LFを除いた全文のUnicodeコードポイント単位で数える（絵文字などのサロゲートペアを1文字と数える）。範囲は空でなく、昇順で重複せず全文内に収める。fontSize は20〜26の整数。縦書き・横書き・列をまたぐ範囲に対応し、本文と列指定は変更しない。吹き出し・衝突検査の寸法は安全側の26pxのまま。未指定時は従来の描画。指定・変更後はplanと必要な採用・工程レビューを更新する。

意味のまとまりで縦書きの列を明示する場合は、セリフに任意の `textColumns` を指定する。例えば `"text":"違う。これは、傷じゃない。","textColumns":["違う。これは、","傷じゃない。"]`。配列順に右から左へ配置する。各列は空でない文字列で、連結した文字が `text` の改行を除いた全文と完全に一致する必要がある。欠落・追加・空列は拒否する。指定時は `capacity` で再分割せず、列数と最長列から吹き出しの幅・高さを計算する。未指定のセリフは従来の容量指定を使う。これは語境界の自動判定ではなく作者・エージェントの編集指定である。

`textColumns` を変更したら `plan` をやり直し、吹き出し・顔・尾・重要物の位置と合成を確認する。失効した採用・工程レビューは正式に再取得し、必要なら構図を修正してから完成出力する。

人物・小道具の基準画像を assets/characters.png に用意し、references に登録する。speakers の anchor は口付近、face は顔の矩形。座標は1024×1536ページ全体の基準。dialogue の x と dy はコマ左上からの距離である。

発話していない人物も含め、すべての見えている顔を登録する。重要な手や小道具は protected に登録する。画面外の声は kind: offscreen、顔が見えない後頭部は kind: head とする。

```powershell
npm run workflow:plan
# コマ参照用のPNGも書き出す
node cli/export.mjs works/my-story/workflow/panels
```

workflow/story-memory.json に解決済みの場面状態を、panel-jobs.json にコマごとの指示・参照・保存先を出す。コマ方式では隣のコマの scene を直しても、変更のないコマは再採用不要。原作、共通の人物・絵柄、参照画像、ページ全体の狙いを変えると複数コマが失効することがある。

## コマ画像を生成し、候補を選ぶ

ここからのCLI例は操作の抜粋。生成準備へ進む前に source・script・対象ページの storyboard の最新正式レビューを通す。採用後は artwork、文字合成後は lettering、全体完成時は final を [工程レビュー](docs/REVISION-AND-REVIEWS.md) の prepare → 実際のサブエージェント確認 → record → check で記録する。番号なしネームのPNG出力と通常の読順確認は [読順確認](docs/NARRATIVE-FLOW.md) に従う。

新規作品は renderMode: panels を標準にする。Codexの画像生成へコマの指示と参照画像を渡す。外部の画像生成環境を使う場合は、`generation.mjs prepare` と `accept-panel` に `--renderer` を指定する。文字・吹き出し・枠は描かせず、予定した吹き出し範囲を白く空ける。必要なコマだけ候補を追加して比較する。

```powershell
node cli/workflow.mjs candidate-panel 01-1 "C:\path\candidate-A.png" --note "表情A" --renderer "Codex built-in image_gen"
node cli/workflow.mjs candidate-panel 01-1 "C:\path\candidate-B.png" --note "表情B" --renderer "Codex built-in image_gen"
```

assets/candidates/01-1/index.html で比較する。表示の「現在の計画／古い計画」は比較画面を作った時点の情報で、採用時には現在の指示との一致を再検査する。コマの口位置、演技、人物と小道具、手の形、余白を確認して選ぶ。

```powershell
# candidate-panel が返した保存先を指定する
node cli/workflow.mjs accept-panel 01-1 "works/my-story/assets/candidates/01-1/保存名.png" --reviewed --reason "表情と立ち位置がネームに合うため採用"
```

直接取り込むこともできる。生成手段・モデル名が分かる場合は --renderer・--model で記録する。分からない値を推測して書かない。候補の申告値は採用記録へ引き継ぐ。採用時のジョブ・参照ハッシュ・由来、採用理由、差し替え前後の素材を記録する。assetSources には原作・参照素材のパスをキーに、由来や利用条件を記入できる。記録は法的な権利判定ではない。

## 合成原稿を確認する

全コマを取り込んだら、実際の絵に合わせて顔・口の座標、吹き出しの位置を調整する。計画が変わったら plan をやり直し、失効した素材を目視して再採用または再生成する。古い指示の候補をそのまま再採用することはできない。

```powershell
node cli/workflow.mjs preview
# workflow/review/page-01.svg を実際に見て確認した後に実行
node cli/workflow.mjs review 01 --speakers --faces --order --continuity
node cli/workflow.mjs quality-plan
# 以下の描画検品を全コマで記録してから完成出力
npm run workflow:status
npm run workflow:build
npm run workflow:layers
```

review は、話者・顔の重なり・読順・前後の連続性を目で確認した記録。各ページに必要。未確認や古い記録は完成出力を止める。実物を見ていないのに --reviewed や確認フラグを付けない。

実画像を測り直した後の台詞位置候補は `node cli/workflow.mjs layout 01` で確認し、`--apply` で設定へ反映できる。顔・protected・他の吹き出しと尾を避け、読順を保つ位置と縦書きの文字数を探索する。白い背景を画像認識する機能ではないため、合成後の見やすさは必ず目で確認する。解がない場合は構図や脚本の調整を求め、登録した顔・重要物を消して通過させない。変更後は plan、素材の正規の再採用、位置と品質の確認が必要。

output/layers/page-01-artwork.svg と page-01-lettering.svg は同じページ座標で重ねられる。後者に文字・吹き出し・尾・枠・ページ番号が入り、両者のキャンバス背景は透明である。絵の白地まで自動で切り抜く機能ではない。外部編集した結果を確定する場合は、作品の正本へ修正を戻し、確認と固定をやり直す。

## コマごとの描画検品（第7版）

quality-plan は workflow/quality/index.html と各コマの *.template.json を出力する。画面で縮小・100%・200%、合成ページを確認し、雛形を別名（例：01-1.review.json）にコピーして記入する。plan は雛形を更新するため、記入済みの雛形を唯一の保存先にしない。

views の各値を確認後に true にする。observation に具体的な観察を書く。8項目それぞれに result: pass / fail / na と note を記入する。見える手や顔の項目を na で済ませない。issues の問題には category、description、status: open / resolved を付ける。不合格の記録も保存できるが、完成出力は通らない。

```powershell
node cli/workflow.mjs quality-plan
# 実物を確認して記録を作った後
node cli/workflow.mjs quality-review 01-1 works/my-story/workflow/quality/01-1.review.json
# 不合格・未解決の問題から修正指示を作る場合
node cli/workflow.mjs quality-repair 01-1
# workflow/quality/01-1.repair.json の対象と参照を読み、画像生成ツールで修正
# 修正後は accept-panel → preview → ページの review → quality-plan → quality-review
```

修正指示は自動生成した計画であり、画像修正の実行結果ではない。完成出力には全コマの有効な合格記録が必要。quality の描画指示を変更すると生成計画も失効する。素材を実際に見て保持できる場合は正規の accept で理由を残して再採用し、変更した指示で生成したと誤記しない。

CLIで確認用PNGを保存する場合は以下を使う。倍率の指定は検品用で、通常のネーム・完成出力は等倍のままにする。

```powershell
node cli/export.mjs works/my-story/workflow/quality --scale 0.25
node cli/export.mjs works/my-story/workflow/quality/panels --scale 2
```

[方針と根拠、限界](docs/ART-QUALITY.md)も参照する。旧版は従来の確認を維持する。第7版の quality.required を消して検査を回避することはできない。

## 既存のページ素材を使う場合

第8版では cast.faceDesign に3特徴・reference・settingBasis、referenceRoles に画像ごとの役割を記録する。顔候補と表情集を先に作り、各コマの品質記録の faceIdentity に見えている人物の3特徴と表情を基準画像と照合した観察を残す。参照画像と顔設定の変更は過去の確認を失効させる。詳細は [顔の設計](docs/FACE-DESIGN.md) を参照。

renderMode: page では、従来どおり1024×1536のページPNGを取り込める。works/kensei はこの方式で採用済み画像を維持している。

```powershell
node cli/workflow.mjs accept 01 "C:\path\generated.png" --reviewed --reason "実画像の構図と台詞配置を確認"
```

コマ位置が計画と違う場合は --source-rects に元画像内のコマ矩形をJSON配列で指定する。個別の accept-panel でコマを差し替えることもできる。ページ方式の素材・位置確認も、変更後は再確認が必要である。

個別素材より新しいページ素材を採用する場合は、ページの accept 後に `node cli/workflow.mjs use-page 04-2 --reviewed --reason "新ページの顔を確認"` を使う。旧個別PNG・採用記録を履歴へ保存してから、ページ素材を表示する。合成後の確認は改めて必要。

## 再発防止と再現

未知の話者、枠外の口・顔・吹き出し、重なり、尾が顔・別の吹き出し・保護範囲を横切る場合、曖昧な読順を拒否する。セリフは配列順、上から下・近い高さでは右から左。左の吹き出しの後に右を読む場合は80px以上下げる粗い検出規則で、最終判断は合成原稿で行う。

```powershell
npm run check
node tests/verify-workflow.mjs
node cli/reproduce.mjs freeze
node cli/reproduce.mjs
node cli/reproduce.mjs bundle
```

npm run check は白い検証用PNGで別作品を一時作成し、コマだけでの制作、場面記憶、変更時の失効、候補・履歴・レイヤー分離、従来の配置検査を試す。既存作品の漫画化とは別の機械検証である。

作品ごとの workflow.lock.json に入力と完成出力のSHA-256を保存する。採用済み素材からSVG/HTMLを同一ハッシュで再構築し、出力済みの編集レイヤーも再構築する。新しいAI画像生成自体は非決定的。PNGの再書き出しはフォント・ブラウザに依存する。全ページの事前検査を通過するまで完成原稿を書き換えないが、OS障害時の書込み全体をトランザクションで保護する機能はない。

Node.js 24、WindowsのMeiryoとChrome/Edgeで検証。別作品の持ち運びパッケージでも MANGA_PROJECT に対象の設定を指定する。保存済み releases/ は編集せず、改訂版は新しく保存する。

通常の bundle は未圧縮のフォルダーへコピーし、そのフォルダーで全ページを再構築する。空き容量が少ない場合は `node cli/reproduce.mjs bundle --compressed` で `.tar.gz` を保存できる。圧縮版はストリーム処理で作成し、内部の全ファイルをロックのSHA-256と照合する。Node.js標準ライブラリだけで作成できる。任意の空きのある場所へ `tar -xzf パッケージ.tar.gz -C 展開先` で展開し、ルートで MANGA_PROJECT を設定して `node cli/reproduce.mjs` を実行する。展開時には未圧縮の一式と再構築用の空き容量が必要。

再生成できる workflow/review の合成プレビューと workflow/quality の倍率別確認PNGは、パッケージの入力から除く。元の素材、位置情報、検品記録、生成・修正指示は保存し、完成PNG・SVG・HTMLは含める。検品用の画面とPNGは quality-plan と export で作り直せる。

## 原作URLと生成実行の保存

カクヨムの公開作品は `node cli/import-kakuyomu.mjs URL tmp/import/作品ID` で全公開エピソードを取り込み、original.txt を `auto start` へ渡す。retrieval.json に取得範囲を保存する。

組み込み画像ツールを呼ぶ直前に `node cli/generation.mjs prepare コマID`、編集なら `prepare-edit コマID 素材PNG 指示TXT` を実行し、返されたpromptとreferencesをツールへ渡す。成功後は `record コマID request.json 生成PNG` で実物を保存する。各コマを採用後、`node cli/generation.mjs compile` で採用画像に対応する生成記録をまとめる。新規生成は非決定的で、保存した素材からのSVG・HTML組版を再現する。

直前の採用画像の手・小道具などを編集時の補助参照にする場合は、`node cli/generation.mjs prepare-edit コマID 素材PNG 指示TXT --reference 補助PNG` を使う。指示TXTに「画像1は編集対象、画像2は手の握りだけの参照」のように役割と維持するものを明記する。追加参照にもスナップショットとハッシュを保存する。参照の追加・準備は画像編集の実行や連続性の承認ではない。実際のツールへ返された全参照を渡し、編集後に比較する。

PNG書き出しは `node cli/export.mjs 対象ディレクトリ 19-1` のようにIDを一つだけ指定する。ページなら `19` を指定し、倍率は必要な場合だけ末尾へ `--scale 2` を付ける。`png 19` のような不存在IDや複数IDはエラーになる。コマ参照を生成へ渡す前に、現在のSVGからPNGを書き出す。成功した準備コマンドだけでは、古いPNGを更新した証拠にならない。

複数ページの実画像座標をまとめて直した場合は `node cli/workflow.mjs layout all --apply` を使える。その後にplan、必要な再採用、previewと目視確認、reviewとquality-reviewを実行する。安全な座標だけでは話者が伝わることを保証しない。話者と反対側の吹き出しや、短い尾が別人の肩へ見える箇所は実プレビューで移動する。

各コマの任意項目 `storyboardSketch` はネーム専用の構造化下図です。`version: 1`、一瞬を記す `moment`、`primitives`（line/rect/ellipse/構造化path）を指定し、座標はコマ内の0〜1で表します。生SVG/XML・外部URI・文字ラベルは受け付けず、コマ範囲でクリップします。指定したネームだけ顔ガイドの灰塗りを透明にし、完成画像へ下図を混ぜません。未指定の作品の描画とjobは変わりません。形を修正したら再planと必要な素材採用・工程reviewを行ってください。下図の顔・口・手・道具位置は予定であり、実画像では測り直して検品します。下図の存在やCLI成功を作画品質の合格と扱いません。

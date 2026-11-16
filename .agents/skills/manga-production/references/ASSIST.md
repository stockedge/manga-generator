# 任意の制作補助とCLI修正

原作・脚本・採用素材を正本として維持し、必要な場面だけで使う補助機能です。出力は候補として保存し、実見・正式採用・独立レビューを省略しません。完成済み作品を再制作したり、画風や配置を全作品へ自動適用したりする機能ではありません。

## 制作時の使い分け

- **原作・脚本の確認：** 原作全文を保持し、概要・節目・人物役割・口調を補助索引として整理する。各記述を原文明言／制作側の解釈／漫画用補足／不明に分ける。ページのpurposeとexpectationを再利用し二重の正本を作らない。テーマの一致は、出来事・因果・感情の一致と分けて確認する。原作のある作品を型へ改変しない。新規企画で希望がある場合だけ、型を使う案と使わない案を同じ要件で比べ、独自要素と因果を確認する。
- **ネームと読順：** 保存した仮案で必要な部分だけ比較する。構図・所有・人物位置が不明なら引きや俯瞰も候補にし、実際の顔高を確認する。反応削除は問い返答・動作・心情の前提を失わない場合だけ。均等カードは初期整理用、斜め・枠なし等は個別試作であり標準にしない。めくりは本文開始面・前付け・表示単位ごとに実見する。
- **参照資料：** 必要な衣装・背面・表情・背景角度だけ資料化する。顔の正本は別に維持し、原作にない年齢・身長等を推測で埋めない。referenceRolesで顔／線と塗り／服と小道具／背景と構図を区別する。前ページは位置の補助で、現在の場面状態・ネーム・顔正本を優先する。見本の不備を引き継がない。3Dを必須にせず、平面図で足りるか先に確認する。
- **修正と画風：** 一括文字生成は任意プレビューに限定し、正解台詞と後組版を維持する。接触を直すときは手・小道具・遮蔽を一緒に照合する。表情・構図の問題はネームへ戻る。線幅・画風戻し・限定着色は対象を指定した候補比較だけで、全作品のstyleを変更しない。揺れ・ムラ・紙質を全作品へ共通付加しない。台詞短縮は意味・話者・応答を照合し、固定字数上限を設けない。白地の消去は本当に白地か確認してから行う。
- **擬音：** `panel.soundEffects`へ横書きの擬音を任意指定できる。位置はページ全体の座標、fontSizeは20〜160。顔・保護範囲・台詞・尾を避け、通常と縮小で確認する。回転・縁取り・文字の自動変形を必須化しない。文字なし素材と後組版を維持する。
- **マスクと外部編集：** 自動分離は常設しない。必要時だけCLIまたは外部エディタで候補を作り、原画像・別名保存・再読込を保持する。マスクは人物・髪・指・小道具・境界・内部穴・半透明を通常と縮小で確認する。アルファがあるだけで実用品と扱わず、隠れた背景の復元も主張しない。返却後は実際の修正内容をUTF-8テキストに保存し、`generation record-edit <コマID> <元PNG> <修正PNG> <修正内容.txt>` で元の生成記録へ由来を結び付ける。元画像に生成記録がない場合は拒否される。候補登録、正規の採用、座標測り直し、合成と独立レビューを行う。PSDは通常画素層の受渡しに限定し、CSPや編集可能な文字の互換性を保証しない。
- **配置・判型：** 判型変更や等分4コマ・タイトル帯は必要案件だけで試す。cropによる欠損とcontainによる縮小を区別し、文字・顔・動作を実見する。5:8をKindleの必須値にしない。
- **任意の企画相談：** 原作がなく企画相談を希望する場合だけ、形式・テーマ・概要・人物・分量・色・題名の既知情報を整理する。既知事項を再質問せず、選択不能なら仮案と明記して具体案を出す。番号以外の回答や質問省略も認める。仮案を未承認のまま脚本へ確定しない。原作がある場合は通常のauto startへ進む。
- **環境と検品：** 導入は確認済み／未確認／利用不可を分ける。新作を強制作成せず、利用可能な制作モードと環境を案内する。サービスの最新仕様は実接続するときに確認し、認証・枠不足を画質不合格にしない。演出手引きは該当場面の補助索引として使う。
- **配布準備：** 公開とは別に、完成素材のハッシュ・ページ順・投稿先条件・未確認事項・工程担当を非公開で準備する。Xの返信先は実ID取得後に確認し、APIの自己返信可否を推測しない。pixivのAI分類等は公開時に確認する。制作記録から絶対パスや未確認モデル・費用・人の手描き実施を推測で公開資料へ入れない。Kindleは完成版を再利用し目次・別表紙・判型を確認する。新規投稿・販売・KPF生成は自動実行しない。

## 任意CLIの使い方

対象を `MANGA_PROJECT` で指定する。出力先は対象作品の `workflowDir/assistance/新しい名前` に限定し、既存フォルダーを上書きしない。作品へ書き出す操作は履歴付きで行う。

```powershell
$env:MANGA_PROJECT='works/my-story/workflow.json'
node cli/history.mjs run node cli/assist.mjs index plan-notes
node cli/history.mjs run node cli/assist.mjs cards cast-cards
node cli/history.mjs run node cli/assist.mjs spreads opening-spreads 1
node cli/history.mjs run node cli/assist.mjs delivery private-delivery
node cli/history.mjs run node cli/assist.mjs external repair-01 PANEL_ID
node cli/history.mjs run node cli/assist.mjs return repair-01 works/my-story/returned.png
```

`index`は正本のページ目的・コマ・台詞・動作を索引にする。`cards`は登録済み設定を共通書式で表示し、未記入の年齢等は不明のままにする。`spreads`の数値は前付け枚数で、右綴じ・最初は左の単頁という仮定を明示した計画と画像一覧を作る。未出力の頁は未出力と表示する。`delivery`はPNGのrender receiptと現SVGを照合してページ順、未送信の返信先、公開前条件、実生成ログ由来の担当索引を作る。プラットフォームの最新条件を検証済みとは扱わず、常にreadyToPublishはfalse。

`external`は現在のコマPNGと設定ハッシュを固定する。`edit`で修正候補を作って`return`へ渡せば、画面操作なしで往復できる。外部エディタの別名保存・再読込は任意の代替経路。寸法や元設定が変わっていたら返却を拒否する。返却PNGは未採用候補で、出力JSONにあるcandidate-panelコマンドを実行した後も、実見、正式accept、顔・口・保護範囲の測り直し、previewと独立レビューが必要。現在の正式スキーマにない変形を、SVG差替えで採用したことにしない。

原作のない任意相談は `intake 名前 brief.json`。入力はformat/theme/synopsis/characters/length/colour/titleの文字列と、仮案に該当するキーのtentative配列。既知・仮案・不明を区別するだけで、勝手に作品を開始しない。原作持込の受付は従来どおりauto startを使う。

### 擬音の後組版

```json
{"soundEffects":[{"text":"ガンッ","x":60,"y":300,"fontSize":80}]}
```

コマへ指定し、位置はページ全体の座標。横書きの字数×fontSize幅、1.5×fontSize高の保守的な領域で顔・台詞・尾・重要物との衝突を拒否する。実際の書体の読みやすさや演出は実画像で確認する。`plan`から通常の再確認・必要な採用を行い、生成し直していない絵を新規生成と記録しない。未指定時の従来出力は維持する。

### 画面操作なしの局所修正

`node cli/history.mjs run node cli/assist.mjs edit 新しい名前 修正JSON` で修正自体もCLIから実行できる。Pillowを利用できるMANGA_PYTHONを指定する。元画像を上書きせず、edited.png・修正前・差分画像・縮小と計測結果を保存する。

```json
{"source":"works/my-story/stray.png","reason":"白地内の不要線を消す","operations":[{"kind":"white","rect":[18,109,112,27]}]}
```

rectは元PNGピクセルの `[x,y,width,height]`。whiteは指定範囲を白で覆い、外周が不透明な白でなければ拒否する。外周が白でも意味のある線や文字を消し得るため、対象と結果は実見する。

```json
{"source":"works/my-story/mask-candidate.png","reason":"指定した袖のマスク穴を元画像の色で戻す","operations":[{"kind":"alpha","rect":[300,590,30,30],"value":255,"restoreFrom":"works/my-story/original.png"}]}
```

alphaは指定範囲の透過値を0〜255へ変更する。穴の補修ではrestoreFromで同寸の元画像の色も復元できる。0なら指定範囲を透明にできる。自動で人物を判別する処理ではなく、指定矩形の外が変わっていないことを画素単位で検査する。顔・手の生成修復や背景補完は、この画素編集コマンドには含めない。返却PNGと同じ候補登録・正式採用・座標確認の経路を使う。

### マスク検品・判型候補・PSD画素層の入出力

Pillowを利用できるPythonをMANGA_PYTHONへ指定する。PSDを使う場合だけpsd-toolsが必要で、通常制作への必須依存ではない。

```powershell
node cli/history.mjs run node cli/assist.mjs mask mask-check works/my-story/mask-spec.json
node cli/history.mjs run node cli/assist.mjs fit format-candidate works/my-story/fit-spec.json
node cli/history.mjs run node cli/assist.mjs layout four-panel-candidate works/my-story/layout-spec.json
node cli/history.mjs run node cli/assist.mjs psd editor-layers works/my-story/layers-spec.json
node cli/history.mjs run node cli/assist.mjs unpack editor-return works/my-story/psd-spec.json
node cli/history.mjs run node cli/assist.mjs anthology private-volume works/my-story/volume-spec.json
```

入力JSONの例（すべてワークスペースからの相対パス）：

```json
{"source":"works/my-story/original.png","candidate":"works/my-story/alpha-candidate.png"}
```

maskはアルファ・白/マゼンタ合成・縮小と不透明部分のRGB差を出し、usableMaskは未判定のままにする。座標指定のマスク作成・補修はeditのalpha操作で行える。自動切抜きが必要なら利用可能なバックエンドを別途確認する。Paint等の画面操作は任意で、使う場合は背景非表示とPNGのアルファを確認する。ボタン成功や透明画素数を品質合格にしない。

```json
{"source":"works/my-story/page.png","size":[960,1536],"method":"contain","reason":"指定された納品サイズの試作"}
```

fitはcontainまたはcropを明示する。元画像を保持した派生PNGであり、現行の正本・PDF寸法を変更しない。cropの欠損、containの縮小、文字と顔を確認する。

```json
{"page":"01","variant":"title","title":"試作の題名"}
```

layoutは保存済みSVGを使う独立候補。equal/titleは4コマだけ、ほかにframeless/diagonal/edgeがある。埋込画像と本文は保持するが、切抜きで見えなくなる文字・顔・動作がないか必ず確認する。縮小倍率を結果JSONへ記録する。`node cli/export.mjs works/my-story/workflow/assistance/名前 01`でPNGにできる。現行の矩形・非重複の正規検査を通らない形の正式採用には対応していない。

layoutの既定は正式素材がreadyであり、保存SVGの本文と埋込画像が現在の脚本・採用素材に一致することを要求する。旧出力を独立の試作資料としてだけ使う場合は入力に `"sourceSnapshotOnly":true` を明示する。その場合は現脚本との一致を主張せず、位置情報も再認証しない。

```json
{"size":[1024,1536],"layers":[{"name":"Artwork","file":"works/my-story/artwork.png"},{"name":"Lettering","file":"works/my-story/lettering.png","visible":true}]}
```

psdは配列の前から背景→前景。各層にx/y/visibleを指定でき、保存・再読込後の名前・順序・座標・表示・実効RGBAを照合する。人物背景分離は行わず、必要な素材は利用者側で検品したものを用意する。unpackは `{"source":"works/my-story/edited.psd"}` でPNG層・座標・表示・合成を取り出す。RGB8、通常画素層、対応できるマスクに限定し、対応外の層を黙って平坦化しない。文字は画素であり編集可能な写植ではない。ICC、ベクトル、CSPや全PSDの互換は保証しない。[psd-toolsの仕様と制限](https://psd-tools.readthedocs.io/en/latest/usage.html)も参照。

anthologyの入力例は `{"frontMatter":3,"completions":["works/story-a/automation.json","works/story-b/automation.json"]}`。完成記録と保存archiveのハッシュを照合し、archive内の凍結workflow・保存納品物を読み取って章境界・目次用情報を計画する。現行改訂版のページ数や作者へ置き換えず、archiveを変更・全展開・再作画しない。別表紙・権利・現行入稿条件・端末プレビューは未確認として残し、KPF作成や公開を実行しない。

一括文字入りの任意プレビューには、既存planが保存する `workflowDir/prompts/page-ID-baked.txt` を使える。プレビュー画像を後組版用の文字なし正本へ無検証に採用しない。別の画風・限定着色・前頁参照の比較は、既存のprepare-edit/candidate-panelとreferenceRolesを使い、作品別の具体的な変更要求に限定する。

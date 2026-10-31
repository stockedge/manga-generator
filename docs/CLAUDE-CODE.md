# Claude Codeで漫画を制作する

Claude Codeが脚本・指示・PNGの視覚確認・サブエージェントレビューを担当し、
ComfyUIが画像生成と編集を担当する。組版・検査・PDF・履歴・再現は共通CLIを使う。
Claudeの契約だけでGPUや外部画像生成が付属するという意味ではない。

## 導入

1. このリポジトリを取得し、ルートでClaude Codeを起動する。`CLAUDE.md` は
   `AGENTS.md` を読み込む。`/memory` で確認する。
2. Node.js 24、Chrome/Edge、日本語フォント、Python、Popplerを用意する。
   `npm ci` を実行する。PDF用Pythonの仮想環境へ
   `python -m pip install reportlab pypdf Pillow` を実行し、そのPython実行ファイルを
   `MANGA_PYTHON` に指定する。ブラウザ自動検出が失敗したら `MANGA_BROWSER` に実行ファイルを指定する。
3. [ComfyUIの構築](COMFYUI.md)を実施し、試験PNGを生成してClaudeのReadで実際に開く。
4. `/agents` で `.claude/agents/manga-reviewer.md` が認識されることを確認する。
   実際に起動して画像を読めることと、返されるタスク識別情報を確認する。
   必要なツール・認証・利用枠がない場合はその状態を保存して報告する。

Claudeが起動してもAPIが403やモデルアクセス拒否を返す場合は、契約・接続先・選択モデルの
利用権限を確認する。設定や認証を無断で切り替えず、実行不能と記録する。
`claude --version` の成功だけでは、画像読取やサブエージェントの利用可能性を確認したことにならない。

Windows PowerShellでの設定例（各パスは実環境に合わせる）：

```powershell
$env:MANGA_PYTHON='C:\path\pdf-venv\Scripts\python.exe'
$env:MANGA_BROWSER='C:\Program Files\Google\Chrome\Application\chrome.exe'
```

## 原作を渡した後の実行

```powershell
node cli/auto.mjs start original.txt --renderer "ComfyUI+Qwen-Image-Edit-2511-FP8"
# startが返した実際のパスを指定する
$env:MANGA_PROJECT='works/auto-原作ハッシュ先頭12桁/workflow.json'
node cli/auto.mjs status
```

以後は `docs/AUTOMATIC.md` の全工程を実行する。Codex専用箇所は次のように置き換える。

| 共通手順の記載 | Claude Codeでの実行 |
| --- | --- |
| imagegenスキル・組み込みimage_gen | `cli/qwen-comfy.mjs`。参照・指示の渡し方はCOMFYUI.md参照 |
| view_image | Readで保存済みPNGを開く。画像を読めない場合は未確認として止める |
| 独立サブエージェント | manga-reviewerを実際に起動し、prepareのrequest・テンプレート・実ファイルを渡す |
| PDFスキル・同梱Python | `cli/pdf.mjs create` と `verify`、MANGA_PYTHON、Popplerによる全ページの実読 |

Codexのローカルスキルや実行開始マーカーはClaude環境の前提にしない。
番号なし画像の初読は原作・脚本を渡す前に独立レビューする。主担当が回答を保存し、
`stage-review record/check` へ渡す。タスク名や観察を捏造しない。必要なら新しい
サブエージェントを起動し直し、主担当の自己レビューで代用しない。
履歴・原作対応・品質・読順・PDF検査・finishの条件は省略しない。

同じ原作の既存作品は再開になる。異なるrendererへの無断変更は拒否される。
既存の確定パッケージやレビューは書き換えない。

## 検証と完了

`MANGA_PROJECT` を指定して `npm run check` を実行する。これは検証用素材を使う
機械検査で、新作漫画の制作成功ではない。実制作は全画像の生成・視覚確認・正式レビューを
経て `auto finish` を通し、読書画面・PDF・再現パッケージを渡して初めて完了とする。
構築スクリプトを変更したときは、GPUやダウンロードを使わない
`python -B tests/verify-comfyui-setup.py` と
`bash -n scripts/comfyui/setup.sh scripts/comfyui/start.sh` も実行する。
GPU料金は接続先で発生する。作業終了時には借りたGPUの停止と永続ディスクの課金状態も確認する。

公式資料：[指示ファイル](https://code.claude.com/docs/en/memory)、
[サブエージェント](https://code.claude.com/docs/en/sub-agents)。

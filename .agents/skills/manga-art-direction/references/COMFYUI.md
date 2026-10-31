# ComfyUI＋Qwenの構築と共通制作フローへの接続

公開構成はQwen-Image-Edit-2511のFP8本体・テキストエンコーダー・VAEのみ。
特定の試作作品やLoRAを必要としない。ComfyUIやモデル本体はGitへ含めず取得する。
既存のComfyUIも、必要なモデルと `TextEncodeQwenImageEditPlus` があれば利用できる。

## Linux NVIDIA GPUホストの構築

Git、Python 3、venv、CUDA対応PyTorchが利用できるホストを用意する。
FP8でも大きいモデルのため、過去の試作では48GB VRAMを使用した。
モデル以外に仮想環境・ダウンロード途中ファイル・生成物が必要なので、
ディスクは100GB程度から見積もり、実際の空き容量とモデルサイズを確認する。
RunPodを使う場合はGPU単価・ディスク料金・SSH接続先を契約時に確認する。
有料GPUの新規作成は、この手順を読むだけでは実行されない。

リポジトリをGPUホストへ取得するか、`scripts/comfyui/` の3ファイルを同じフォルダーへ転送する。

```bash
export MANGA_COMFY_HOME=/workspace/manga-comfy
bash scripts/comfyui/setup.sh
bash scripts/comfyui/start.sh
```

setupはシステムのCUDA PyTorchを参照する専用venvを作る。既存ComfyUIを自動更新・resetしない。
モデルはHugging Faceの取得時のコミットへ固定してダウンロードし、完全なLFS SHA-256を照合する。
中断ファイルは `.download` として残り、再実行時にダウンロードし直す。
既存のモデルが一致しなければ上書きせず停止する。
`models/manga-models.json`、`comfyui-commit.txt`、`python-packages.txt` が取得環境の記録となる。
依存パッケージ全体を固定するlockではなく、将来の再構築時の完全一致を保証しない。
取得障害やメモリ不足はログを保存して解決し、別モデルへ黙って切り替えない。

startはフォアグラウンドで動く。Ctrl+Cで終了する。外部公開せず127.0.0.1へバインドする。
リモートの場合、制作PCの別ターミナルでSSHトンネルを維持する。

```bash
ssh -N -L 8188:127.0.0.1:8188 -p PORT USER@GPU_HOST
curl --fail http://127.0.0.1:8188/system_stats
```

`system_stats` の応答は起動確認だけ。画像生成の成功とは区別する。
Windowsの既存ComfyUIでは `python scripts/comfyui/download-models.py C:\path\ComfyUI\models`
でモデル取得だけを利用できる。GPUドライバーとPyTorchは
[ComfyUI公式のOS別導入手順](https://docs.comfy.org/installation/manual_install)で準備する。

## 生成の疎通確認

制作PCでUTF-8の指示ファイルを作って実行する。生成画像とJSONは作品フォルダーまたはtmpへ保存する。

```bash
node cli/qwen-comfy.mjs run --prompt-file tmp/smoke-prompt.txt --out tmp/comfy-smoke.png --seed 123
```

PNGを実際に開き、生成成功を確認する。生成条件・ハッシュは `.png.json` に保存される。
この試験画像を作品の採用素材や検品記録として流用しない。

## 本番の生成・編集・記録

原作の受付は `auto start --renderer "ComfyUI+Qwen-Image-Edit-2511-FP8"` を使う。
以後すべての制作CLIで `MANGA_PROJECT` を明示する。事前レビュー・plan・最新ネームPNGを先に用意する。

```bash
node cli/generation.mjs prepare 01-1 --renderer "ComfyUI+Qwen-Image-Edit-2511-FP8" --model "Qwen/Qwen-Image-Edit-2511" --seed 123
```

返されたrequest JSONの正確なpromptをUTF-8ファイルへ書き、referencesの全PNGを
その順序で `--images` へカンマ区切りで渡す（最大3枚）。参照が3枚を超える計画は黙って省略せず、
参照シートなどへ再設計し、planとレビューを更新してprepareし直す。
参照なしの場合は `--images` を省略する。

```bash
node cli/qwen-comfy.mjs run --prompt-file works/WORK/workflow/prompt.txt --images ref1.png,ref2.png --out works/WORK/assets/result.png --seed 123
node cli/generation.mjs record 01-1 REQUEST.json works/WORK/assets/result.png
node cli/workflow.mjs accept-panel 01-1 SAVED.png --reviewed --reason "実画像を確認した具体的な採用理由" --renderer "ComfyUI+Qwen-Image-Edit-2511-FP8" --model "Qwen/Qwen-Image-Edit-2511"
node cli/generation.mjs compile
```

REQUEST.jsonはprepareが返した保存先、SAVED.pngはrecordが返した保存素材を使う。
acceptは実画像を読んだ後に行う。生成条件のsidecarも作品内へ残す。
編集は `generation prepare-edit PANEL TARGET.png EDIT.txt --renderer ... --model ... --seed ...`
を使い、返された対象・補助参照・正確な編集指示を同様に渡す。
人物基準画像や表情集も同じCLIで生成し、指示・参照・sidecarと候補を保存する。
その後は共通の採用・位置測定・組版・品質・工程レビュー・PDF・再現手順へ進む。

モデルの取得先と条件は[公式モデル配布元](https://huggingface.co/Comfy-Org/Qwen-Image-Edit)を参照。
LoRAを追加するときは個別の利用条件を確認し、実際のファイルと生成条件を記録する。

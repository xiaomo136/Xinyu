# 心语 Web 版

这是一个可直接运行的本地 Web 项目，用来先把“情感陪护数字人”的前后端链路跑通，并为后续接入 Live2D、本地模型和多种语音能力保留清晰接口。

## 当前能力

- Web 前端聊天界面
- Ollama 接入 `Qwen2.5:3b`
- FunASR 连续语音对话
- 自动停顿提交与连续回复
- 页面内可调 TTS 语速
- 手机端“启用声音”解锁按钮
- 轻量情绪 / 风险判断
- 会话历史保存
- FunASR 服务桥接接口
- 三种 TTS 路径
  - `windows`
  - `gitee_api`
  - `edge_xiaoxiao`
  - `local_service`
- 浏览器语音识别 / 浏览器语音播放兜底
- 已接入 Live2D 数字人（默认 Hiyori）

## 运行 Web 服务

在项目根目录执行：

```powershell
./scripts/start-web.ps1
```

这个脚本会：

- 检查 `FunASR` 是否已启动
- 必要时自动后台拉起 `tools/funasr_bridge.py`
- 再启动 Web 服务

启动后打开：

```text
http://127.0.0.1:3000
```

如果要让手机访问，请让手机和电脑连接同一 Wi-Fi，再打开终端打印出的局域网地址。

## 当前默认配置

`config/app.config.json` 当前默认是：

- LLM: `ollama` -> `qwen2.5:3b`
- ASR: `funasr`
- TTS: `edge_xiaoxiao`

如果你更看重实时性，推荐先用 `edge_xiaoxiao` 或 `windows`；`gitee_api` 已保留，但更适合作为备用或展示链路。

## Qwen2.5:3b

当前代码默认通过 Ollama 调用：

```json
"llm": {
  "type": "ollama",
  "ollama": {
    "baseUrl": "http://127.0.0.1:11434",
    "model": "qwen2.5:3b",
    "timeoutMs": 45000
  }
}
```

## FunASR

### 1. 代码入口

- `server/providers/asr/funasr.js`
- `server/services/asr-service.js`
- `tools/funasr_bridge.py`

### 2. 启动桥接服务

先准备 Python 环境并安装依赖：

```powershell
pip install -r tools/funasr-requirements.txt
```

然后启动：

```powershell
./scripts/start-funasr.ps1
```

默认监听：

```text
http://127.0.0.1:8778
```

Web 端录音后会向：

```text
POST /api/asr/recognize
```

发送 WAV Base64，再由后端转发给 FunASR 桥接服务。

另外，`/api/asr/recognize` 也兼容评测模式：

- `Content-Type: audio/mpeg`（或其他音频类型）
- Body 直接传二进制 mp3
- 返回 `{"result":"这是一个测试语音。"}`

## TTS 三种方式

### 1. Windows TTS

配置：

```json
"tts": {
  "type": "windows",
  "activeProvider": "windows"
}
```

对应文件：

- `server/providers/tts/windows.js`
- `scripts/windows-tts.ps1`

### 2. 本地部署 TTS 服务

配置：

```json
"tts": {
  "type": "local_service",
  "localService": {
    "url": "http://127.0.0.1:9880/tts",
    "timeoutMs": 60000
  }
}
```

约定返回：

```json
{
  "audioBase64": "...",
  "mimeType": "audio/wav"
}
```

或者直接返回音频二进制。

### 3. API 调用

配置：

```json
"tts": {
  "type": "api",
  "activeProvider": "gitee_api",
  "api": {
    "url": "https://example.com/tts",
    "method": "POST",
    "headers": {},
    "timeoutMs": 60000
  }
}
```

请求体默认发送：

```json
{
  "text": "要合成的文本"
}
```

## 一键切换 TTS

当前已经同时保留：

- `windows`
- `gitee_api`
- `edge_xiaoxiao`

你可以通过一个函数直接切换。

### 1. 浏览器里切

打开页面后，在浏览器控制台执行：

```js
await window.setTtsProvider("windows")
await window.setTtsProvider("gitee_api")
await window.setTtsProvider("edge_xiaoxiao")
```

### 2. 后端运行时切

后端内部对应函数在：

- `server/services/tts-service.js`

核心调用是：

```js
ttsService.setProvider("windows")
ttsService.setProvider("gitee_api")
ttsService.setProvider("edge_xiaoxiao")
```

### 3. HTTP 接口切

```text
POST /api/tts/provider
```

请求体：

```json
{
  "providerName": "windows"
}
```

或：

```json
{
  "providerName": "gitee_api"
}
```

或：

```json
{
  "providerName": "edge_xiaoxiao"
}
```

## 关键文件

- `server/index.js`：Web 服务入口
- `server/services/chat-service.js`：对话流程
- `server/services/asr-service.js`：ASR 调度
- `server/services/tts-service.js`：TTS 调度
- `server/services/risk-engine.js`：情绪与风险分析
- `server/providers/llm/ollama.js`：Qwen/Ollama 适配
- `server/providers/asr/funasr.js`：FunASR 适配
- `server/providers/tts/windows.js`：Windows TTS 适配
- `server/providers/tts/http.js`：本地服务 / API TTS 适配
- `public/index.html`：网页结构
- `public/styles.css`：界面样式
- `public/app.js`：前端交互逻辑
- `public/avatar/live2d-adapter.js`：Live2D 适配器
- `public/avatar/live2d/characters/free/Hiyori/`：Live2D 模型资源
- `public/avatar/placeholder-adapter.js`：占位适配器（兜底）

## Live2D 说明

- 默认角色模型来自 `awesome-digital-human-live2d` 项目中的 Hiyori 资源。
- 本地配置位置：`config/app.config.json` -> `providers.avatar`。
- 如果 Live2D 运行时不可用，前端会自动回退到占位数字人，避免页面不可用。

## 比赛 Baseline

仓库新增了一个 `ml/` 目录，用来承接比赛里真正需要提交的
`prediction_emotion` 基线训练、推理和评测逻辑。

### 目录说明

- `ml/dataset.py`：扫描比赛数据目录，或读取你自定义的 manifest
- `ml/model.py`：可输出 `K` 条候选的 PyTorch baseline
- `ml/train.py`：训练脚本
- `ml/infer.py`：导出 `prediction_emotion.npy`
- `ml/evaluate.py`：计算关键评测指标
- `ml/metrics.py`：指标实现

### 安装依赖

```powershell
pip install -r ml/requirements.txt
```

### 推荐的数据准备方式

优先准备一个 manifest，而不是完全依赖自动扫描。因为比赛本质上是
speaker -> listener 的反应生成，显式清单更容易把配对关系控制准确。

支持 `json` 或 `jsonl`，单条样本格式如下：

```json
{
  "sample_id": "sample-0001",
  "split": "train",
  "audio_path": "train/Audio_files/NoXI/.../clip.wav",
  "face_path": "train/3D_FV_files/NoXI/.../clip.npy",
  "emotion_path": "train/Emotion/NoXI/.../P1/clip.csv"
}
```

如果你暂时还没有整理 manifest，`ml/dataset.py` 也支持从
`train/Emotion` 出发做启发式匹配，但这更适合快速摸底，不建议作为最终口径。

### 训练

```powershell
python -m ml.train --data-root S:\path\to\competition_data --train-manifest train.json --val-manifest val.json
```

训练完成后会在 `artifacts/baseline/` 下生成：

- `best.pt`
- `last.pt`
- `history.json`

### 推理并导出 prediction_emotion

```powershell
python -m ml.infer --checkpoint artifacts/baseline/best.pt --data-root S:\path\to\competition_data --split val --manifest val.json
```

输出目录默认是 `artifacts/infer/`，会包含：

- `prediction_emotion.npy`
- `target_emotion.npy`
- `source_features.npy`
- `sample_ids.json`
- `summary.json`

### 评测

```powershell
python -m ml.evaluate --prediction-file artifacts/infer/prediction_emotion.npy --target-file artifacts/infer/target_emotion.npy --speaker-file artifacts/infer/source_features.npy --sample-ids artifacts/infer/sample_ids.json
```

如果你只是先做本地烟测，可以额外加 `--dtw-stride 4` 或 `--dtw-stride 10`
来近似计算 `FRdist`；正式自评时请回到默认的精确口径。

这套 baseline 当前实现了：

- `FRCorr`
- `FRdist`
- `FRDiv`
- `FRDvs`
- `FRVar`
- `FRSyn`

`FRRea` 需要先把预测结果渲染成帧目录，再通过 `pytorch-fid` 计算。

## 下一步推荐

如果你接下来继续做比赛版，建议顺序如下：

1. 启动并验证 FunASR 桥接服务
2. 决定 TTS 最终走 `windows`、`local_service` 还是 `api`
3. 把占位数字人替换成 Live2D 适配器
4. 再考虑把视觉模态和情绪识别并入同一套后端

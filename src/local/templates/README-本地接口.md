# Aurabot 本地接口

这个文件夹里的脚本可以接管大肥鱼的几项能力，换成你自己的模型或远程服务。Linux 部署可以用 InstaBox Private RVC Worker 做远程换声。
插件升级不会动这个文件夹。脚本改完保存就生效，不用重启 DSH。

| 文件 | 接管什么 | 什么时候用 |
|---|---|---|
| `tts.mjs` | 语音合成（她发的语音条） | 每次她要发语音 |
| `image.mjs` | 生图 | 她调用画图工具时 |
| `song-convert.mjs` | 翻唱里「人声 → 她的声音」这一步 | 每次翻唱（下载、分离、混音、发送还是插件做）；Linux 模板默认调用 InstaBox 私有 RVC Worker |
| `asr.mjs` | 别人发来的语音条转文字 | 收到语音条时最先试 |

每个文件要在面板「本地接口」页**打开开关**才会用；文件不存在或开关关着，就用插件内置的方式。

## 写法约定

- 是 Node.js 的 ES 模块（`.mjs`），`export default async function (参数) { ... }`。
- 可以用 Node 自带的一切：`fetch`、`node:fs`、`node:child_process`（调你的 Python 项目）……不能 `npm install` 第三方包。
- 出错就 `throw new Error('原因')`：语音、识别会退回内置方式；生图、翻唱会让她告诉对方没成功和原因。
- 用参数里的 `log.info()` / `log.warn()` 打日志，会出现在面板「日志」页。
- 超时：语音 60 秒、识别 60 秒、生图 5 分钟、翻唱换声 60 分钟。

## 各脚本的参数和返回值

### tts.mjs
- 参数：`{ text, outDir, log }`
- 返回：音频文件路径（wav / mp3 / silk），或 `{ file }`

### image.mjs
- 参数：`{ prompt, size, outDir, log }`（`size` 形如 `"1024x1024"`，`prompt` 已带上面板里的固定风格）
- 返回：图片 `Buffer`，或 `{ buffer }` / `{ file }` / `{ base64 }` / `{ url }`

### song-convert.mjs
- 参数：`{ input, output, pitch, voice, voiceFile, indexFile, log }`
  - `input`：分离出来的人声 wav；`output`：要写出的 wav 路径
  - `pitch`：变调半音；`voice`：面板里选的音色名；`voiceFile` / `indexFile`：导入过的 .pth / .index 路径（可能为空）
- 返回：换好声音的 wav 路径（一般就是 `output`）
- 开了这个之后，翻唱不再需要内置的 Applio 和音色模型（人声分离环境还是要装）。Linux 分支生成的默认 `song-convert.mjs` 会调用 InstaBox Worker；需要先把 `rvc-worker.env.example` 复制为 `rvc-worker.env`，填入私有 HTTPS 基础 URL、Port Token、Worker Key 和模型名，并设置文件权限为仅运行 DSH 的用户可读（`chmod 600`）。**不要把真实 `rvc-worker.env` 提交 Git。**

### asr.mjs
- 参数：`{ file, log }`（`file` 是 16kHz 单声道 wav）
- 返回：识别出的文字，或 `{ text }`；听不清返回空字符串

## 让 DSH 帮你改

在面板「本地接口」页点「复制给 DSH 的话」，粘给 DSH，再补一句你用的是什么服务、地址和关键参数，它会读这份说明、帮你把脚本改好。

## InstaBox 远程 RVC（Linux）

点击「本地接口」→ 翻唱换声 →「生成模板」后，会同时生成 `song-convert.mjs` 和 `rvc-worker.env.example`。复制示例为 `rvc-worker.env`，填写：

- `RVC_BASE_URL`：Private HTTPS 基础地址，不包含 `?_token=` 查询参数。
- `RVC_PORT_TOKEN`：InstaBox Private Port 的 Token。
- `RVC_WORKER_KEY`：Worker 自己的 API Key。
- `RVC_MODEL`：InstaBox `/v1/models` 返回的模型文件名，例如 `Fp231.pth`。
- `RVC_F0_METHOD`：`pm` 或 `rmvpe`，默认 `pm`。

示例文件与真实密钥分离；真实配置只保存在 Aurabot 数据目录 `local/rvc-worker.env`，权限设为 `600`。脚本先检查 Worker 和模型，再提交一次 POST（不盲目重试，避免重复任务），随后轮询并下载 WAV。远程模型名和 F0 算法参与翻唱缓存键。腾讯云仍负责下载歌曲、人声分离、FFmpeg 混音和 QQ 发送；InstaBox 只负责 RVC 推理。

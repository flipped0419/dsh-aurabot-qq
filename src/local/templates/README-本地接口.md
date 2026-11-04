# Aurabot 本地接口

这个文件夹里的脚本可以接管大肥鱼的几项能力，换成你自己的模型或远程服务。Linux 部署可以用 InstaBox Private RVC Worker 做远程换声。
插件升级不会动这个文件夹。脚本改完保存就生效，不用重启 DSH。

| 文件 | 接管什么 | 什么时候用 |
|---|---|---|
| `tts.mjs` | 语音合成（她发的语音条） | 每次她要发语音 |
| `image.mjs` | 生图 | 她调用画图工具时 |
| `song-convert.mjs` | 仅翻唱换声 | 腾讯云仍需先分离人声；可调用 InstaBox RVC |
| `song-process.mjs` | 完整歌曲片段的「分离＋换声」 | 先于本地分离调用，InstaBox 同时完成两个模型推理，腾讯云只负责下载、截取、混音和 QQ 发送 |
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

### song-process.mjs
- 参数：`{ input, outputVocals, outputInstrumental, pitch, voice, voiceFile, indexFile, log }`
  - `input` 为**原始歌曲的已截取片段**（MP3/WAV 等）；输出分别是经过 RVC 转换的人声 WAV、未变声的伴奏 WAV。
- 返回：`{ vocals: '/输出路径/人声.wav', instrumental: '/输出路径/伴奏.wav' }`。
- 启用后会**跳过腾讯云本地人声分离和单独的 song-convert.mjs**，只保留 FFmpeg 截取/混音、原有点歌及发送逻辑。无需在腾讯云安装 PyTorch、audio-separator 或本地 RVC。
- 同时打开两个翻唱扩展时 `song-process.mjs` 优先；禁用即可恢复原流程。
- 模板使用 `rvc-worker.env`；需要 InstaBox Worker 提供 `/v1/song-jobs`、两个声轨结果接口，且完成分离模型安装。

### asr.mjs
- 参数：`{ file, log }`（`file` 是 16kHz 单声道 wav）
- 返回：识别出的文字，或 `{ text }`；听不清返回空字符串

## 让 DSH 帮你改

在面板「本地接口」页点「复制给 DSH 的话」，粘给 DSH，再补一句你用的是什么服务、地址和关键参数，它会读这份说明、帮你把脚本改好。

## InstaBox 远程 RVC（Linux）

点击「本地接口」→ 整段翻唱处理（分离＋换声）→「生成模板」后，会同时生成 `song-process.mjs` 和 `rvc-worker.env.example`。复制示例为 `rvc-worker.env`，填写：

- `RVC_BASE_URL`：Private HTTPS 基础地址，不包含 `?_token=` 查询参数。
- `RVC_PORT_TOKEN`：InstaBox Private Port 的 Token。
- `RVC_WORKER_KEY`：Worker 自己的 API Key。
- `RVC_MODEL`：InstaBox `/v1/models` 返回的模型文件名，例如 `Fp231.pth`。
- `RVC_F0_METHOD`：`pm` 或 `rmvpe`；整段翻唱推荐并默认使用 `rmvpe`（已通过歌曲试听对比）。
- `RVC_SEPARATOR_PROFILE`：InstaBox Worker 当前分离模式，正式方案为 `mel-vocals`。须与 `/health.separator_profile` 一致，否则脚本拒绝提交，避免混用缓存。

示例文件与真实密钥分离；真实配置只保存在 Aurabot 数据目录 `local/rvc-worker.env`，权限设为 `600`。脚本先检查 Worker 和模型，再提交一次 POST（不盲目重试，避免重复任务），随后轮询并下载 WAV。远程模型名和 F0 算法参与翻唱缓存键。使用 `song-convert.mjs` 时腾讯云仍负责下载、人声分离、FFmpeg 混音和 QQ 发送；使用新的 `song-process.mjs` 时 InstaBox 负责分离＋RVC，腾讯云只负责下载、截取、FFmpeg 混音和 QQ 发送。InstaBox 的 4C8G 已完成短歌曲的模型对照测试：15 秒歌曲 MelBand 分离约 68.5 秒、BS-RoFormer 约 276 秒；用户试听认为 MelBand + RMVPE 与 BS-RoFormer + RMVPE 的最终混音效果接近、均无明显电音。CPU 处理长歌曲仍可能耗时数分钟，推荐先在主人私聊使用短片段验证。完整 QQ 翻唱尚未在腾讯云生产链路验收。

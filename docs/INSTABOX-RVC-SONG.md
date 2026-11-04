# Aurabot 1.1.24 · InstaBox 远程歌曲分离 + RVC

## 当前状态

此方案已适配 **Aurabot 1.1.24** 的 `upgrade/aurabot-1.1.24` 分支，提交源码尚未自动部署至腾讯云生产。原 1.1.24 已验收的聊天、TTS、QQ 消息、登录态和配置全部保留，不要直接运行旧 `linux-port` 版本覆盖生产。

InstaBox 4C8G 使用独立 Worker 提供 `/v1/song-jobs`（分离 + 换声、两个 WAV 下载），原 `/v1/jobs` 换声接口保留。InstaBox 已通过完整 `/v1/song-jobs` 实机测试（双轨下载通过）。2026-11-04 对同一 15 秒歌曲片段测得：MDX HQ5 分离 9.105 秒但人声伴奏残留明显；BS-RoFormer 276.263 秒；MelBand RoFormer 68.459 秒。MelBand 与 BS 的 RVC RMVPE 混音试听均无明显电音，最终确定 MelBand + RMVPE。**InstaBox 生产 Worker 已切换 `mel-vocals` 并通过 30 秒真实歌曲的 RMVPE 全链路 API 实测：139.3 秒，双声轨均可下载；腾讯云 QQ 端到端仍待验收。**

## 数据流

```
腾讯云 1.1.24：下载歌曲 → FFmpeg 截取（最多 179s）
  → 本地接口 song-process.mjs 上传片段（Private HTTPS / 双层鉴权）
  → InstaBox MelBand RoFormer 分离人声 + 伴奏，随后 RVC RMVPE CPU 换声
  → 从 InstaBox 下载两条 WAV
  → 腾讯云 FFmpeg 混音、淡入淡出 → QQ 语音
```

旧 `local.song` = 单独 RVC 换声；新 `local.songProcess` = 完整片段分离 + 换声。两者同时开启时优先 `local.songProcess`。新开关默认 `false`，旧链路保持原样。

## 上线前需要满足

1. InstaBox 上完成 `flipped0419/aurabot-rvc` 的 `worker/install-separator.sh`（CPU-only PyTorch / audio-separator 独立 venv；不要重新执行整机初装脚本）。
2. 不覆盖现有 RVC 生产文件，先备份 `/opt/rvc-worker/app.py`，再测试新代码、重启 Worker、验证 `separator_ready=true`；执行 `tests/smoke_song_local.py`，再用含真实伴奏的合规短片段做分离质量/性能验证。
3. 腾讯云仅安装系统 `ffmpeg`，并核对 4 GiB 内存/磁盘空间；不安装 Torch 和 audio-separator。
4. 在腾讯云以 **Aurabot 1.1.24 正式部署目录** 为基线，以 GitHub `upgrade/aurabot-1.1.24` 的更新提交构建**新的隔离 release**，在测试通过之后才切换 symlink；不得把旧 `/opt/aurabot/source`（1.0.4）当生产目录，也不直接覆盖 `/opt/aurabot/releases/1.1.24`。
5. 在 Aurabot 管理面板【本地接口】找到【整段翻唱处理（分离＋换声）】，点【生成模板】。脚本存放在生产数据目录 `/opt/aurabot/data/local/song-process.mjs`。生成模板不会覆盖已有文件；只在新接口生成需要的脚本。
6. 在同一数据目录将 `rvc-worker.env.example` 复制成 `rvc-worker.env`。填入 `RVC_BASE_URL`（不含 query Token）、`RVC_PORT_TOKEN`、`RVC_WORKER_KEY`、`RVC_MODEL=Fp231.pth`、`RVC_F0_METHOD=rmvpe`、`RVC_SEPARATOR_PROFILE=mel-vocals`，所有密钥只在服务器私有文件；**权限 0600**，属主为服务账户 `aurabot`，不提交 GitHub 或 Google Drive。
7. 在面板打开 `local.songProcess` 和 `song.enabled`，保留 `local.tts` 等既有开关不变。优先主人私聊试唱，确保产出的语音能在 QQ 播放，再考虑开放给其他人使用。

## 回滚

- **最轻回滚**：只关闭面板中的 `local.songProcess`，其他功能不受影响；旧模式仍需依赖本地分离环境，不代表自动恢复为可翻唱。
- 如新 Worker 影响旧 RVC 服务：恢复备份 `/opt/rvc-worker/app.py.before-song` 到 `/opt/rvc-worker/app.py` 并重启 `rvc-worker`；InstaBox RVC 本身和 private 端口不变。
- 如新 1.1.24 构建有异常：切回原 `/opt/aurabot/releases/1.1.24` symlink 并重启现有 `aurabot-dsh.service`，不更改数据目录或 SnowLuma 容器。

## 分离模型切换（InstaBox 已完成验收）

Worker 仓库 `flipped0419/aurabot-rvc` 提供 `RVC_SEPARATOR_PROFILE` 三种固定模型：`mel-vocals`（试听选中）、`bs-roformer`（高质量备用）、`mdx-hq5`（速度对比）。**代码默认仍是 BS-RoFormer，但 InstaBox 服务器现有配置明确设置 `RVC_SEPARATOR_PROFILE=mel-vocals`，2026-11-04 已验证生产 Worker 的 `/health.separator_profile=mel-vocals`。** 此前生产切换已先验证 `/data/rvc-worker/separator-models/vocals_mel_band_roformer.ckpt` 存在，备份 `/opt/rvc-worker/app.py` 与 `/etc/rvc-worker.env`，更新 Worker 代码，设置 `RVC_SEPARATOR_PROFILE=mel-vocals` 并重启，已检查 `/health` 的 `separator_profile=mel-vocals`、`separator_ready=true`，并完成独立 30 秒歌曲 `tests/smoke_song_local.py --f0-method rmvpe` 全链路测试：`PASSED full-song API in 139.3 s`，两条 WAV 下载通过。回滚时恢复两个备份并重启，不删除模型文件。

Aurabot 侧的 `song-process.mjs` 默认用 RMVPE；`rvc-worker.env` 需要写入 `RVC_F0_METHOD=rmvpe`、`RVC_SEPARATOR_PROFILE=mel-vocals`，脚本对照 Worker 的实际 `separator_profile`，不一致时在提交任务前中止。两个参数都纳入翻唱缓存键，切换模型不会复用旧的 MDX 缓存。旧的 `/v1/jobs` 纯 RVC 仍保留 PM 默认值。不要让私人配置进源码或项目背景。

## 安全与资源

- Worker 限制上传 64 MiB、歌曲片段时长 180 秒，单工作线程串行执行，两模型不常驻同时推理；8 GiB RAM 的实际峰值仍须实测。
- POST 提交只执行一次，超时后不能自动重复提交，避免创建重复任务；GET 可重试。
- 任务有鉴权、结果两条 WAV 仅通过受保护端点返回。已完成历史任务的清理是按启动和新任务提交触发，**不是定时任务**。
- 模型 `.pth` 应仅从信任来源取得；绝不把任何 Token、Cookie、SSH 私钥、QQ 登录态或用户音频放进源码。

# Aurabot Linux 移植记录（实验分支）

基线：上游 Aurabot v1.0.4（b502b83）。目标是保留 **原版 SnowLuma + 个人 QQ 小号** 路线，
不是腾讯 QQ 开放平台机器人，现有功能模块、DSH preset 和管理面板均予以保留。

## 已验证

- Node.js 25.x Linux 上执行 `npm test`：149/149 测试通过。
- 群聊、私聊、记忆、空间、表情、语音等使用 **模拟 DSH/OneBot** 验证；
  这**不是**实际 DSH Web 或 SnowLuma/QQ 客户端的集成验收。
- TTS 增加 Linux Python venv (`bin/python`、`lib/pythonX.Y/site-packages`) 探测，
  `python3 -m venv` 安装入口；Linux 缺失 TTS 时抛出可读错误，让上层退回文字。
- 翻唱环境可识别 Linux 绝对路径、磁盘空间与常见可执行文件位置。
- 新增 InstaBox Private RVC Worker 远程换声模板：腾讯云只做下载、人声分离和混音，InstaBox 负责 RVC CPU 推理；远程模型和 F0 算法参与缓存键。

## 下一步（尚未验证）

1. 在与 QwenPaw 完全独立的测试运行环境安装 DSH Web profile，验证 Aurabot 侧栏、
   两个 preset、路由和数据持久化。Node.js / pnpm 版本按所选 DSH 发行版固定。
2. 用户自行按 SnowLuma 官方许可与文档安装 Linux Docker 版，亲自完成协议确认和 QQ 小号登录。
3. 在 Aurabot 面板连接已有 OneBot HTTP/WS 地址（配套的凭据保持在私有数据目录）。
   SnowLuma 自动启动、自动注入应关闭，避免 Windows 进程管理逻辑生效。
4. 验证真实 QQ 群聊和私聊、空间、表情、语音和断线恢复；再适配 Linux 连接向导。
5. 已通过腾讯云到 InstaBox 的私有 HTTPS 健康检查、模型查询和真实 WAV 上传/推理/下载；下一步在 DSH 中启用远程换声脚本，检查腾讯云 audio-separator / FFmpeg 环境，并完成整首 QQ 翻唱验收。2C2G 不执行本地 GPU 推理。

## 隔离与密钥

- 仅在独立实验目录下做源码开发；不修改运行中的 QwenPaw 容器服务。
- 不把 QQ 登录态、OneBot Token、模型 API Key、QQ/B 站 Cookie、密码写入仓库。
- 实际部署时避免给群聊 Agent 宿主机文件与 shell 权限；不要公网开放 DSH/SnowLuma 管理面板。
- 原项目采用 SnowLuma 的非官方 QQ 接入方式，可能违反 QQ 平台协议并触发账号限制。

## 2026-10-26：DSH Web 实机验证与 Linux 连接界面

- 在 QwenPaw 容器独立用户 aurabotlab 下部署 DSH 0.2.1-rc.2 和 pnpm 10.18.3。
- 通过 link: 方式安装本分支，启动 127.0.0.1:3180。
- 带会话认证验证 DSH Web 页面 HTTP 200、Aurabot /api/state HTTP 200、ok=true、
  平台 linux、12 个模块可见；默认总开关关闭和试运行开启。
- 新增 Linux 外部 SnowLuma 连接模式和 Web 提示，Linux 默认不使用 Windows 本地注入管理器。
- 完整测试 150/150 通过；Linux Edge TTS 独立虚拟环境真正合成中文 MP3 成功。
- 该容器没有 Docker daemon 和 SYS_PTRACE，无法完成本机 SnowLuma Docker 验收；
  参见 deploy/linux/compose.yaml、verify-host.sh、README.md。
- GitHub fork flipped0419/dsh-aurabot-qq 已可被集成读取，
  但集成写入 Git Trees 返回 HTTP 403；当前 Git 提交仍保存在服务器本地。

## 2026-11-02：InstaBox 远程 RVC Worker 联调

- InstaBox 端已部署 CPU RVC Worker，腾讯云通过 Private HTTPS 访问；`/health` 与 `/v1/models` 双层鉴权均返回 HTTP 200。
- 13.91 秒 WAV 从腾讯云上传到 InstaBox，CPU 推理后成功轮询并下载 40 kHz 单声道 WAV（约 1.1 MB）。
- Linux 分支新增远程换声模板，密钥只放在 Aurabot 数据目录 `local/rvc-worker.env`，不入库。QQ 完整翻唱、真实音色和音质验收仍待完成。

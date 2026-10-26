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
  **翻唱一键安装器尚未适配 Linux**，仍包含 Windows PowerShell 和 GPU/CUDA 依赖。

## 下一步（尚未验证）

1. 在与 QwenPaw 完全独立的测试运行环境安装 DSH Web profile，验证 Aurabot 侧栏、
   两个 preset、路由和数据持久化。Node.js / pnpm 版本按所选 DSH 发行版固定。
2. 用户自行按 SnowLuma 官方许可与文档安装 Linux Docker 版，亲自完成协议确认和 QQ 小号登录。
3. 在 Aurabot 面板连接已有 OneBot HTTP/WS 地址（配套的凭据保持在私有数据目录）。
   SnowLuma 自动启动、自动注入应关闭，避免 Windows 进程管理逻辑生效。
4. 验证真实 QQ 群聊和私聊、空间、表情、语音和断线恢复；再适配 Linux 连接向导。
5. 翻唱的下载、人声分离、RVC、混音、安装器单独适配；2C2G 不执行本地 GPU 推理，
   需要远程计算资源时沿用原项目的本地接口扩展点。

## 隔离与密钥

- 仅在独立实验目录下做源码开发；不修改运行中的 QwenPaw 容器服务。
- 不把 QQ 登录态、OneBot Token、模型 API Key、QQ/B 站 Cookie、密码写入仓库。
- 实际部署时避免给群聊 Agent 宿主机文件与 shell 权限；不要公网开放 DSH/SnowLuma 管理面板。
- 原项目采用 SnowLuma 的非官方 QQ 接入方式，可能违反 QQ 平台协议并触发账号限制。

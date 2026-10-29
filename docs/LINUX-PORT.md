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


## 2026-10-29：上游 v1.1.16 升级合并（QwenPaw 隔离测试）

- 独立工作树：aurabot-upgrade-1.1.16，分支 upgrade/aurabot-1.1.16；未修改原 linux-port。
- 上游基线 ce76774（1.1.16），从生产源码 dcc23a9（1.0.4 Linux 移植）合并。
- 冲突文件：client/client.js、src/core/config.js、src/core/llm.js、src/voice/tts.js、test/e2e.test.js。
- Linux 默认选择外部 OneBot 网关（原有 1.0.4 配置没有 gateway 字段）；不自动启动或注入 SnowLuma。
- 保留网关模型 reasoningEffort 留空不传的兼容行为，采用新版模型元数据探测与不支持时重试逻辑。
- 保留 Linux lib / lib64 下 edge-tts 虚拟环境探测；语音安装优先采用新版跨平台实现。
- Linux 连接面板保留外部 OneBot 部署提示，其他功能采用新版上游管理界面。
- 修复新版图库路径校验在 Linux 上接受 Windows 路径分隔符的问题；修正测试中固定 /tmp 文件导致的权限冲突。
- QwenPaw Node.js 25.6.0 完整测试：420 项，419 通过、0 失败、1 跳过；真实 SnowLuma 与腾讯云生产验收尚未进行。
- 不能把本分支的通过视为真实 QQ、B 站、抖音或生产 DSH 的完整验收。
- 生产升级前：备份生产 /opt/aurabot/source Git 提交、DSH Web Profile 以及私有 Aurabot 数据目录；核对 QQ 登录、消息收发、私聊工具权限、B站和 TTS；确认 1.1.16 代码与配置迁移后再切换。
- QQ Cookie、OneBot Token、模型 API Key、登录态和 SSH 凭据只留在私有运行配置；不写入 Git 仓库或 Google Drive 背景文档。


## 2026-10-29：QQ 原生工具审批桥（仅隔离开发，尚未生产启用）

在 upstream v1.1.16 + Linux 移植升级分支增加 `src/security/qq-approval.js`。开关位于 Aurabot「聊天 → DSH 原生工具审批（实验）」并且**默认关闭**。这是 DSH `approval/request` 的一次性应答器，不是 `tools/pre-execute` 危险命令检测的替代品；保留上游「危险命令确认」开关及独立回复语法。

- **适用范围：** 只在 SnowLuma 已核对机器人 QQ 登录、且 DSH 会话映射到主人 QQ 私聊时工作。群聊/其他私聊/子 Agent/其他 DSH 会话交还原有 DSH Web 审批链。
- **授权绑定：** 从 DSH 会话的 `session/event → tool/call` 获得完整参数，再按 Agent Session ID、精确 Tool Call ID、Tool Name 三重核对；请求本身缺少完整参数或过期时不通过 QQ 授权。
- **回复格式：** `批准 8位十六进制编号` 或 `拒绝 8位十六进制编号`；只有主人 QQ 私聊的精确回复有效。编号随机生成、仅单次有效。普通「确认/取消」仍给原有危险命令保护使用。
- **安全策略：** 默认关闭、120秒超时拒绝、同时最多4个审批；即使 OneBot 发送请求挂起，也不影响超时拒绝、断线/关闭开关/取消/工具结束/会话结束/服务销毁撤销；已过期审批码不能进入 AI 聊天。
- **敏感数据：** 对参数中常见密码、Token、Cookie、Authorization 等关键词及超长参数采用保守回退，继续交由 DSH 原审批界面；不能把任何凭据写入仓库或测试脚本。
- **环境要求：** 不向 QQ 机器人额外开放 HTTP 接口，不更改 DSH 审批策略或自动设成全权限。
- **隔离验证：** 测试文件 `test/qq-approval.test.js` 和 `test/qq-approval-integration.test.js`；后者用假 DSH 宿主 + 本地 OneBot HTTP/WS 完成从请求、消息通知到主人回复的真实传输模拟。没有使用真人 QQ 登录。
- **仍需腾讯云验收：** 生产 DSH 0.2.1-rc.2 的实际请求事件、QQ 消息收发、Web 同时打开时的瀑布式应答顺序、升级后旧配置兼容、异常断线及重启。正式生产切换前先核对安全模式及回滚备份，**不要只因模拟测试通过就打开开关**。


## 腾讯云下一轮升级测试清单（未执行）

1. 只读核验现有 `/opt/aurabot/source` 仍为 `linux-port` / `dcc23a9`、Git 干净；核验 `aurabot-dsh.service`、当前 QQ 与 DSH Web 登录状态。
2. 备份生产 Aurabot 源码 Git 引用、DSH Web Profile、私人插件数据目录，以及原始 systemd unit / drop-in；真实凭据和 QQ 登录态仅留在服务器权限受控目录，绝不上传 GitHub/Drive。
3. 拉取 GitHub `upgrade/aurabot-1.1.16` 到新的本地测试工作树，核验源码 tree SHA；不要 `git pull` 覆盖 `linux-port`，不要在 `3180` 和原 SnowLuma 端口直接起第二套服务。
4. 用独立临时 DSH Profile + 模拟 OneBot 验证 1.1.16 Web 入口、面板、路由和模块加载；如果必须连接真实 QQ，先制定单连接切换和回滚方案。
5. 优先验证旧配置中缺失 `gateway` 字段时保留外部 OneBot 连接；检查 DSH 网关模型、语音 Edge TTS、B 站和现有扩展，新增可能主动发公开内容的模块需保持关闭。
6. QQ 原生工具审批开关默认关闭；确认 Web 原审批、`dangerConfirm` 旧危险命令审批均未回归后，再单独开启实验开关，在主人 QQ 私聊测试一条无风险的审批指令。
7. 真实联调须覆盖同意、拒绝、超时、网关断线、重启、含敏感参数回退和多会话隔离；出现异常立即关闭新开关并回滚。完成生产验收后，先以服务器最终文件为准，再由用户决定同步到云盘源码/长期背景。

尚未实现 `ask_user_question` 的 QQ 回答桥；本版本仅处理存在准确 `tool/call` 的原生审批。

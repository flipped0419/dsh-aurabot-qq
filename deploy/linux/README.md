# Aurabot Linux 部署：DSH Web + SnowLuma + 真实 QQ 账号

本移植保留原版 Aurabot 的全部模块及 Web 面板，不转换为腾讯 QQ 开放平台机器人。
截至 2026-10-26，DSH Web 已在 QwenPaw 容器独立启动，150/150 模拟测试通过；
真实 SnowLuma / QQ 登录、空间、表情、翻唱尚未联调。

## 环境划分

DSH Web / Aurabot:
- Node.js >=22.19 或 >=24、pnpm、DSH 0.2.1-rc.2。
- 低权限系统用户，单独 HOME / 数据目录。
- 只监听 127.0.0.1:3180；Web 登录令牌属于私密信息。
- Linux 使用外部 SnowLuma 的 OneBot HTTP/WS 地址及 Token。

SnowLuma / 真实 Linux QQ:
- 官方镜像 motricseven7/snowluma:v1.14.17。
- 需要 Docker daemon，并允许 SYS_PTRACE、seccomp=unconfined、1GB /dev/shm。
- 当前 QwenPaw Kubernetes 容器没有可用 Docker daemon，也没有 CAP_SYS_PTRACE，因此不能就地运行。
- 本目录 Compose 仅面向另一台符合条件的 Docker 主机，不自动同意协议，也不自动扫码。
- 2C2G 运行全部组件风险较高，推荐先实测内存峰值。

## 一、在具备 Docker 权限的主机启动 SnowLuma

先阅读官方部署文档及软件协议：
https://snowluma.github.io/zh/docs/guide/deploy/docker

运行：

    bash deploy/linux/verify-host.sh
    docker compose -f deploy/linux/compose.yaml config
    docker compose -f deploy/linux/compose.yaml up -d

默认所有端口只监听宿主机 127.0.0.1。
- 6081 = noVNC，用户本人扫码登录专用 QQ 小号。
- 5099 = SnowLuma 控制台，用户本人阅读并确认协议。
- 3000 = OneBot HTTP；3001 = OneBot WebSocket。

默认自动注入关闭；请在完成协议确认后按照官方 UI 手动接入所需 QQ 进程。
如需从个人电脑管理，使用 SSH 端口转发，不能直接改成 0.0.0.0 公开端口。
三个 Docker 卷保存配置与 QQ 登录态，升级时不要删除。

## 二、在独立的低权限用户下安装 DSH 与 Aurabot

使用官方 DSH 0.2.1-rc.2 和 pnpm，并在独立 HOME 下：

    dsh plugin --profile web add link:/absolute/path/to/dsh-aurabot-qq
    bash deploy/linux/start-dsh.sh

如 DSH 处于运行中，安装/升级插件之后先重启。
打开 DSH Web 左侧栏的 Aurabot → 连接。
填专用 QQ 小号、主人 QQ 号，以及已存在的 OneBot HTTP / WS 地址和 Token。

注意：如果 DSH 和 SnowLuma 不在同一个网络命名空间，127.0.0.1 不是同一主机；
应通过可信内网或 SSH 隧道转发宿主机 13000/13001，绝不能直接暴露无保护的 OneBot 服务。
第一次上线保持 Aurabot 总开关关闭或试运行开启，验证发言范围后再正式启用。

## 三、保留功能与待验收项目

- 原版人格、权限区分、记忆、心情、群聊策略、表情包、空间、B站等模块原样保留。
- Linux Edge TTS 已安装并在开发容器真实合成成功，音频通过模块写入。
- DSH API 返回 Aurabot 状态 200 / ok=true，版本为 1.0.4，12 个模块被加载。
- 原版本地 RVC/Applio 安装器尚有 Windows 特有的路径、下载和 CUDA 依赖。
- 完整翻唱需要继续做跨平台适配或外置 GPU 推理；2C2G 不适合本地模型。

## 四、安全和维护

- 真实 QQ 账号经 SnowLuma 的非官方接口接入，存在平台协议及账号限制风险。仅建议使用小号。
- QQ 密码、登录态、OneBot Token、TTS/API Key、Cookie、SSH 私钥不得放入源码仓库。
- DSH Web、SnowLuma WebUI、noVNC 不公开开放，优先使用 SSH 端口转发。
- DSH 与 SnowLuma 数据和权限隔离，群聊的 DSH preset 不允许直接操作服务器。
- 不要从当前 QwenPaw 生产容器中启动 Docker daemon 或修改其容器安全策略。

## 腾讯云北京轻量（4C4G）迁移前注意

此配置针对项目中已存在的腾讯云服务器准备，尚未进行实时资源测试，也没有在腾讯云执行部署。
- 生产 CAP 已使用宿主机 127.0.0.1:3000，禁止覆盖；本 Compose 改用 13000。
- 现有持久化 Chrome 的 noVNC 使用 127.0.0.1:6080，SnowLuma 使用 6081。
- 当前腾讯云已有 Certd、CAP/Valkey、Waiting Room 专用 Valkey、持久化 Chrome、
  OpenResty 与 Beszel；先查看内存、Docker 实际占用、监听端口、磁盘、失败的 systemd 服务，再做部署决定。
- 国内腾讯云到 Docker Hub/GitHub 的下载可能失败，优先使用服务商镜像加速源，
  不自动改写 Docker daemon.json。
- Docker 的 SYS_PTRACE/seccomp=unconfined 降低了隔离强度。避免共享敏感宿主目录，
  不设置 privileged: true，不向公网发布 noVNC/WebUI/OneBot。
- 4 GiB RAM（外加现有 4 GiB Swap）不能仅凭规格判断足够；
  真实 QQ 和持久化 Chrome 都可能产生高峰值，先小规模试运行并保留回滚。
- DSH Web 建议以独立用户/systemd 启动，优先使用 localhost:3180；未经核验不接入公网入口。

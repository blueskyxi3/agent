# AI Hub Agent

独立维护的 AI Hub 智能助手插件，源码仓库为 [blueskyxi3/agent](https://github.com/blueskyxi3/agent)。前端、服务端、Go 启动器、测试和发布均在本仓库完成；构建无需 AI Hub 源码，运行时通过 SDK v2 HTTP 插件接口接入 AI Hub。

## 独立开发与构建

构建要求 Node.js 22+、npm、Go 1.25+ 和 Python 3。

```bash
git clone https://github.com/blueskyxi3/agent.git
cd agent
npm ci
npm run typecheck
npm run build
npm test
go test ./...
make package VERSION=1.0.0
AGENT_TEST_PACKAGE="$PWD/dist/agent-1.0.0-$(go env GOOS)-$(go env GOARCH).zip" make test-package
```

目录包括 `apps/server`、`apps/web`、`packages/contracts`、`launcher` 和 `scripts`；`go.mod` 仅供本项目启动器使用。打包产物用于 GitHub Release，安装时按下文登记 GitHub 下载地址。

SDK v2 市场插件。前端使用 assistant-ui，后端使用 Pi SDK；宿主提供插件生命周期、全站界面扩展点，以及原有的用户偏好、能力目录、确认执行和审计。

## process 模式安装与运行

`process` 由 plugin-deployer 托管，master 默认使用内嵌部署器，不需要另外执行 `npm start`。插件的 `site.global.layer` 扩展点提供全站悬浮入口和面板；个人设置中的“开启智能助手”只控制当前用户是否使用入口，不能代替插件安装与启用。

1. 先运行支持 SDK v2 全站扩展点的新版 AI Hub，并确认节点是 `master`，部署器的 process 能力已开启。
2. 从 [Agent Releases](https://github.com/blueskyxi3/agent/releases) 选择已发布的 `<版本>`（如 `1.0.0`），取得附件 `catalog.json`。安装包由 master 通过 GitHub 下载，再交给部署器；按**部署器**的操作系统和架构选择产物，安装时无需本地 ZIP、Node.js、npm 或 Go。
3. 用 root 账号进入“系统设置 → 扩展管理 → 注册目录项”，粘贴该 Release 的 `catalog.json`；已有目录项应显式更新。`manifest.version` 必须与 Release 包内版本一致，扁平 `artifacts` 中只保留 GitHub HTTPS 下载地址。本仓库为公有仓库，Release 的 `catalog.json` 和 process ZIP 均使用公开 HTTPS 下载地址，无需配置 GitHub 下载令牌。
4. 进入“插件市场 → 智能助手”，选择安装或试用，模式选 `process`，数据库选默认的**独立 SQLite**，然后提交。安装会校验包和清单、生成内部通信密钥并启动 Agent；无需设置 `AGENT_HOST_SECRET`。
5. 插件市场中的状态应为 `active`。在“系统设置 → 智能助手配置”确认悬浮启动器已开启，再在个人设置中开启智能助手并选好 API Key、文本模型。刷新页面后，右下角应出现悬浮入口，`/assistant` 页面也应可用。停用插件后入口应消失。

插件市场图片保存在本仓库的 `plugin-logos/agent.png` 和 `plugin-backgrounds/agent.png`，`catalog.example.json` 使用对应的公开 HTTPS 图片地址。AI Hub 主进程下载并缓存远端图片；也可将目录中的 `logo`、`background` 改为 `/plugin-logos/agent.png`、`/plugin-backgrounds/agent.png`，使用宿主自带的本地图片。已有目录项需要显式更新后生效。

如果插件已是 `active`，但浏览器加载 `/api/plugin-bridge/agent/assets/plugin.js` 报 `ERR_CONTENT_DECODING_FAILED`，需重新编译并重启新版 AI Hub 主程序。宿主的插件桥接路径必须绕开通用 API gzip 中间件，否则插件资源会被重复压缩。

如果已有旧版会话，先停止旧 Agent，再按下文迁移数据，之后安装插件；不要让两个服务同时写入会话库。

### GitHub 安装包与发布

维护者先推送与版本号一致的 Git 标签，再从该标签运行 [Agent Release 工作流](https://github.com/blueskyxi3/agent/actions/workflows/agent-release.yml)。工作流分别在 Linux amd64、Linux arm64、macOS arm64 原生 runner 上构建并验证自包含进程包，最后发布 ZIP 和 `catalog.json`。例如：

```bash
git tag -a 1.0.0 -m "Agent 1.0.0"
git push origin 1.0.0
gh workflow run agent-release.yml --repo blueskyxi3/agent --ref 1.0.0 -f version=1.0.0
```

版本 `1.0.0` 的[插件目录 JSON](https://github.com/blueskyxi3/agent/releases/download/1.0.0/catalog.json)和安装包均可直接下载：

| 部署器平台 | GitHub 安装包 |
| --- | --- |
| Linux amd64 | [agent-1.0.0-linux-amd64.zip](https://github.com/blueskyxi3/agent/releases/download/1.0.0/agent-1.0.0-linux-amd64.zip) |
| Linux arm64 | [agent-1.0.0-linux-arm64.zip](https://github.com/blueskyxi3/agent/releases/download/1.0.0/agent-1.0.0-linux-arm64.zip) |
| macOS arm64 | [agent-1.0.0-darwin-arm64.zip](https://github.com/blueskyxi3/agent/releases/download/1.0.0/agent-1.0.0-darwin-arm64.zip) |

master 会直接从 GitHub 下载 ZIP。下载或安装包校验失败会报错，不会改取本地文件。

## Kubernetes 模式安装

1. 将本目录的 `catalog.json`（或 `catalog.example.json`）登记到插件目录，确认 `modes` 包含 `kubernetes`。已登记的目录不会随源码自动更新。
2. 为 plugin-deployer 开启 Kubernetes 后端。使用现有 Helm Chart 时，先创建插件命名空间，并在部署 AI Hub 时配置下列 values；Chart 会生成相应 ServiceAccount、Role 和 RoleBinding：

   ```bash
   kubectl create namespace aihub-plugins
   ```

   ```yaml
   pluginDeployer:
     mode: embedded
     backend: kubernetes
     namespace: aihub-plugins
     storageClass: "" # 使用集群默认 StorageClass，或填写可用的 StorageClass
     storageSize: 1Gi
     imagePullSecrets: [] # 私有镜像仓库的 Secret 名称，需先在插件命名空间创建
   ```

   非 Helm 部署的等价 `config.yaml` 配置如下。部署器需具备插件命名空间内 Deployment、Service、Secret、PVC 的 get/create/update/delete 权限；默认从 Pod 的 ServiceAccount 读取 API 地址、Token 和 CA：

   ```yaml
   plugin_deployer:
     mode: embedded
     backend: kubernetes
     kubernetes:
       namespace: aihub-plugins
       storage_class: ""
       storage_size: 1Gi
       image_pull_secrets: []
   ```

3. 在“插件市场 → 智能助手”安装或试用，模式选择 `kubernetes`，填写 POC 镜像 `ctt-repository-cn-guangzhou.cr.volces.com/compute-power-zone/ai-hub-agent:1.0.0`、端口 `3100`、健康路径 `/api/v1/health`。宿主回调地址填写插件 Pod 能访问的 master Service origin，例如 `http://ai-hub-web.compute-power-zone.svc:3000`，按实际命名空间和 Service 名称替换；数据库选择**独立 SQLite**。镜像内 `/internal/manifest` 的版本须与目录的 `manifest.version` 一致。
4. 提交后由部署器创建单副本、Recreate 策略的 Deployment、ClusterIP Service、配置 Secret 和独立 PVC；配对密钥自动生成，SQLite 位于 `/data/plugin/agent.sqlite`。master 需能访问插件 Service DNS。等待市场状态变为 `active` 后，按 process 模式第 5 步开启用户入口。

Kubernetes 模式直接拉取镜像，不下载 process ZIP。插件停用和卸载由市场管理，卸载保留 PVC 数据。`k8s/deployment.yaml` 和 Helm 中预部署的 Agent 服务属于 `external` 接入方式，使用市场托管的 Kubernetes 模式时不必重复部署。独立部署器的配置见[AI Hub 插件部署器文档](https://github.com/blueskyxi3/ai-hub/blob/main/docs/deployment/plugin-marketplace.md)。

## external 模式本地运行

独立开发运行要求 Node.js 22+。先启动 AI Hub（默认 `http://127.0.0.1:3000`），再在插件市场将 `catalog.example.json` 登记为目录项，并以 `external` 模式登记本地服务。市场登记的配对密钥与 `AGENT_HOST_SECRET` 必须相同，至少 32 字符。

```bash
npm install
npm run build
AGENT_HOST_SECRET=local-dev-ai-hub-plugin-secret-2026 \
AIHUB_INTERNAL_URL=http://127.0.0.1:3000 npm run start -w @ai-hub-agent/server
```

浏览器只访问宿主的 `/api/plugin-bridge/agent/api/v1/*` 和 `/api/plugin-bridge/agent/assets/*`。旧 `/agent/*` 不再注册。插件资源包含 `assets/plugin.js`，用于挂载全站悬浮入口和面板。

## 配置

### 自托管语音识别

独立的 [AI Hub ASR 子项目](https://github.com/blueskyxi3/ai-hub/blob/main/asr/README.md) 提供 SenseVoice CPU 服务、Dockerfile、Compose 和模型准备命令。管理员通过现有 OpenAI 兼容转写渠道接入，用户在个人设置选择 `sensevoice-small-int8` 并开启语音输入。录音由浏览器直接提交 Go 主进程鉴权和转发。手动录音的结果插入草稿，用户确认后发送。ASR 的运行时和模型不进入 Agent process 安装包，不新增数据库字段。

录音支持停止/取消、120 秒上限、WAV 转换、麦克风音量和草稿冲突保护。浏览器需要 HTTPS 或 localhost。完整时序与验证说明见[AI Hub ASR 集成文档](https://github.com/blueskyxi3/ai-hub/blob/main/.req/agent/asr-integration.md)。

连续语音对话要求 ASR 0.2.0 模块、包含 `assistant.voice.control` 扩展点的主进程，以及新版 Agent 前端（本次本机 process 包为 1.1.0）。管理员先在“系统设置 → 应用设置 → 模块化设置 → 语音唤醒与退出”开启总开关，再由用户点击输入栏中的“开启语音对话”。本地检测唤醒词后，停顿默认 1.2 秒会自动转写、发送并回复；回复及播报期间暂停听写，结束后继续。“退下吧”等口令只退出对话并回到待唤醒，不提交给 Agent。已有手输草稿、附件或识别期间编辑草稿时，保留转写供明确插入。页面隐藏后释放麦克风，再次可见时需要主动开启。

总开关默认关闭；待唤醒音频仅在浏览器处理。KWS/WASM 资源由独立 ASR 经 Go 插件代理提供，Agent 不内置模型。`ASR_API_KEY` 用于转写渠道，`ASR_HOST_SECRET` 用于 ASR 模块配对，二者与 Agent 配对密钥分别配置。主进程 `config.yaml` 不需要 `ASR_API_KEY`。

浏览器验收可在本仓库根目录执行 `npm exec -w @ai-hub-agent/web -- playwright install chromium firefox webkit`，再执行 `npm run test:browser -w @ai-hub-agent/web`。硬件权限和原生 Safari/Edge 另在目标设备验收。

文本、图像、视频、转写、语音合成模型和推理强度都由当前用户在 AI Hub 个人设置中选择；Agent 环境变量不覆盖个人选择。完整运行变量见 `.env.example`。

单轮响应超时时长由管理员在“系统设置 → 模块化设置 → 智能助手配置”中设置，默认 240 秒，可设置为 5–300 秒。`AGENT_REQUEST_TIMEOUT_MS` 仅在主站未下发有效配置时作为兼容回退值。

模型请求不使用平台管理员密钥，也不会自动创建 `sys_playground`。宿主代理为每个请求签发插件身份和用户委托凭证；Agent 验证插件身份后用委托凭证回调宿主，由宿主再次校验用户、插件状态及原路由权限。因此配额、分组、限流和审计沿用当前用户身份。聊天请求的委托凭证最多有效六分钟，其余请求仍为一分钟。

## 安全边界

- 未登录、模块关闭或跨用户 thread ID 均被拒绝。
- Pi 内置的 `read`、`bash`、`edit`、`write` 全部关闭。
- 能力工具只接受主项目登记的操作 ID；查询及修改都会再次执行原路由鉴权。
- 修改操作使用主项目持久化的十分钟确认记录；敏感值只从确认表单进入原接口，不进入模型上下文。
- 未完成语义核对的运行时路由只可发现，不可由模型自动执行。
- 不接受模型返回的任意 URL、HTML、组件名或 shell 命令执行。
- 图片仅接受 PNG/JPEG/WebP/GIF，单次最多 4 张；请求体上限约 28 MiB。

## 工具与主项目 API

Agent 工具在 `apps/server/src` 中实现，业务数据和权限仍由主项目提供。固定绑定由 `tool-bindings.ts` 统一登记并由测试检查：

| Agent 工具 | 主项目接口或处理方式 |
| --- | --- |
| `search_capabilities` | `GET /api/user/self/assistant/capabilities` |
| `describe_capability` | `GET /api/user/self/assistant/capabilities/:operation_id` |
| `execute_capability` | `POST /api/user/self/assistant/executions`，随后重放登记的 Gin 路由 |
| `get_execution` / `chart_execution` | `GET /api/user/self/assistant/executions/:execution_id`；图表聚合在 Agent 内完成 |
| `list_workflows` | `GET /api/user/self/assistant/workflows` |
| `get_role_guide` | `GET /api/user/self/assistant/role-guide`，返回按当前角色和页面权限过滤的已发布能力指南与首屏问题 |
| `suggest_followups` | 在成功回答结束时暂存两个相关问题；持久化成功后以 `suggestions` artifact 推送，不显示普通工具轨迹 |
| `get_consumption_summary` | `GET /api/user/self/assistant/consumption-summary`，按当前显示币种一次返回可用额度、消费金额、模型排行和每日趋势；默认不展示积分 |
| `open_console_page` | 根据 `GET /api/user/self` 返回的页面权限在前端生成站内导航按钮 |
| `prepare_refresh_usage` | 生成浏览器操作按钮，点击后调用 `GET /api/user/self/usage`，展示当前币种下的可用额度、累计消费和累计请求 |
| `generate_image` / `generate_video` | 主项目的 Assistant 媒体专用接口 |

能力路由事实位于 `common/assistantcatalog/routes.json`，人工审核策略位于 `common/assistantcatalog/policies.json`。路由扫描不会自动授予 Agent 权限。

AI Hub 的路由、参数或中间件变更后，在 AI Hub 仓库根目录运行 `go run ./cmd/assistant-catalog` 更新路由事实，再审核策略差异并运行 `go run ./cmd/assistant-policy --check`。路由哈希不匹配的旧策略不会在运行时授予执行权限；新增路由应先确认权限和数据范围，再决定是否开放给助手。已发布的角色指南和流程存放在数据库中，文案调整需在“助手内容”中审核发布。

## 镜像

`external` 镜像在本仓库根目录构建，镜像运行时需设置 `AGENT_HOST_SECRET`，对外只暴露 AI Hub；Agent 的 3100 端口留在内网。先更新宿主，再部署镜像并在市场登记同一个配对密钥。

```bash
docker build --platform linux/amd64 -f Dockerfile \
  -t ctt-repository-cn-guangzhou.cr.volces.com/compute-power-zone/ai-hub-agent:1.0.0 .
docker push ctt-repository-cn-guangzhou.cr.volces.com/compute-power-zone/ai-hub-agent:1.0.0
```

### POC 现有 Deployment 升级（external 模式）

POC 已有 `compute-power-zone/ai-hub-agent` Deployment，容器名为 `agent`，现有 Service 为 `ai-hub-agent-svc:3100`。当前副本数为 0，且尚未配置 SDK v2 配对密钥。首次采用此 external 接入方式时，先生成并保存密钥，再创建 Secret；后续升级复用该 Secret：

```bash
export AGENT_HOST_SECRET="$(openssl rand -hex 32)"
kubectl -n compute-power-zone create secret generic ai-hub-agent-pairing \
  --from-literal=AGENT_HOST_SECRET="$AGENT_HOST_SECRET"
kubectl -n compute-power-zone set env deployment/ai-hub-agent \
  --from=secret/ai-hub-agent-pairing
kubectl -n compute-power-zone patch deployment ai-hub-agent --type merge \
  -p '{"spec":{"strategy":{"type":"Recreate","rollingUpdate":null}}}'
kubectl -n compute-power-zone set image deployment/ai-hub-agent \
  agent=ctt-repository-cn-guangzhou.cr.volces.com/compute-power-zone/ai-hub-agent:1.0.0
kubectl -n compute-power-zone scale deployment/ai-hub-agent --replicas=1
kubectl -n compute-power-zone rollout status deployment/ai-hub-agent --timeout=180s
```

在 AI Hub 更新 Release 附件 `catalog.json` 对应的目录项，以 `external` 模式接入 `http://ai-hub-agent-svc.compute-power-zone.svc:3100`，配对密钥填写刚生成的 `$AGENT_HOST_SECRET` 值（也就是 Secret 中的同一个值）。数据库和数据卷保持原配置。`Recreate` 可避免 SQLite 在升级期间由新旧两个 Pod 同时写入。

若使用市场托管的 `kubernetes` 模式，按上文安装步骤由 plugin-deployer 创建工作负载；现有手工 Deployment 使用上述 `external` 接入方式。选择其中一种部署方式管理同一个插件。

`process` 包由上述 GitHub Release 工作流在目标平台执行 `npm ci` 和 `make VERSION=<版本>` 构建，产物为 `agent-<版本>-<GOOS>-<GOARCH>.zip`。Go 启动器自带 Node 运行时、生产依赖和前端资源；目录的 `artifacts` 使用 GitHub Release 资产地址，安装不读取本地构建目录。Agent 进程仅支持独立 SQLite 会话库，包需满足市场的 150 MiB 大小限制。

切换前停止旧 Agent，备份旧数据，并在安装 process 插件前运行：

```bash
python3 scripts/migrate-data.py /old/agent/data /path/to/ai-hub/data/extensions/agent/data /backup/agent-before-plugin
```

迁移脚本校验 SQLite 完整性、会话及消息数量和其他文件哈希；目标目录与备份目录必须不存在。若使用自定义 `extensions.directory` 或外部服务数据卷，替换目标路径。完成后安装并启用插件。不要同时运行旧、新服务；回滚时停止插件并一起恢复程序、注册信息和数据备份。

## 验证

```bash
npm run typecheck
npm run build
npm test
go test ./...
curl http://127.0.0.1:3100/api/v1/health

# 原生 process 包生命周期测试（需允许本地监听）
AGENT_TEST_PACKAGE="$PWD/dist/agent-1.0.0-$(go env GOOS)-$(go env GOARCH).zip" make test-package
```

AI Hub 宿主侧的可选集成测试在 **AI Hub 仓库**执行，并通过 `AI_HUB_AGENT_SOURCE` 指定本仓库的绝对路径：

```bash
AI_HUB_AGENT_SOURCE=/path/to/agent AI_HUB_AGENT_TEST_EXTERNAL=1 \
  go test ./common/extensions -run TestAgentExternalService -count=1 -v
```

# pi-fleet

> 把一台本地 [pi](https://pi.dev) 扩展成**分布式控制平面**：用统一工具调度多台机器上的进程、远程 pi 实例和机器人。

## 状态

Phase 0 + 1 已实战验证（2 台远程机器 jp/sg）：

- ✅ **shell adapter**：SSH/本地多机命令执行、文件部署（`fleet_exec` / `fleet_deploy`）
- ✅ **pi-rpc adapter**：远程 pi 智能委派（controller 经 SSH+RPC 驱动远程 pi，`fleet_node`）
- ⏳ **robot adapter**：接口骨架，待 herms 接入

远程 pi 节点的 API key 经环境变量注入（`$VAR` 引用），不落盘 fleet.json。

## 它解决什么

- **多机管理**：从一台 pi 管理分布在多台机器上的工作负载。
- **多通信方式**：不强绑 SSH。transport（ssh / local / tcp / websocket / docker / …）与 adapter（shell / pi-rpc / robot / …）正交解耦，自由组合。
- **多机运行 pi**：远程机器可运行独立 pi 实例，controller 经 RPC 协议委派智能任务并回收结果。

## 安装

```bash
pi install git:github.com/wrp-wrp/pi-fleet
```

## 配置

创建 `~/.pi/agent/fleet.json`（参考 [`examples/fleet.json`](examples/fleet.json)）：

```jsonc
{
  "nodes": {
    "gpu-box":  { "transport": "ssh", "host": "user@gpu-host", "adapter": "pi-rpc", "model": "anthropic/claude-sonnet-4", "cwd": "/workspace" },
    "edge-1":   { "transport": "ssh", "host": "user@edge1", "adapter": "shell", "cwd": "/srv/app" },
    "herms-01": { "transport": "websocket", "url": "ws://192.168.1.50:8080", "adapter": "robot" },
    "local-a":  { "transport": "local", "adapter": "pi-rpc", "model": "openai/gpt-4o" }
  }
}
```

SSH 节点依赖免密登录（SSH key）。改配置后用 `/fleet:reload` 热加载，无需重启 pi。

### pi-rpc 节点：环境变量注入

远程 pi 节点的 API key 通过 `env` 字段注入，值用 `$VAR` 引用 controller 的环境变量（**key 不落盘 fleet.json**）：

```jsonc
"sg": {
  "transport": "ssh", "host": "root@1.2.3.4", "adapter": "pi-rpc",
  "provider": "ppio", "model": "deepseek/deepseek-v4-flash-0731",
  "tools": ["read", "bash"],
  "env": {
    "PPIO_API_KEY": "$PPIO_API_KEY",   // 从 controller 环境变量解析
    "PATH": "/usr/local/bin:/usr/bin:/bin", // 远程 pi 可能不在默认 PATH
    "PI_OFFLINE": "1"                       // 跳过启动联网检查
  }
}
```

远程机器需先装 pi（`npm install -g @earendil-works/pi-coding-agent`，node ≥ 22）并放入对应的 provider 定义（`~/.pi/agent/models.json`）。

## 用法

启动 pi 后直接对话，LLM 会自动用 fleet 工具：

```
> 列一下我的 fleet 节点状态
> 在 edge-1 上跑 nvidia-smi
> 把这份代码同步到 edge-1:/srv/app/
> 让 gpu-box 上的 pi 帮我修 src/api.ts 里的 bug
```

注册的工具：

| 工具 | 作用 |
|------|------|
| `fleet_list` | 列出所有节点 + 实时状态 |
| `fleet_exec` | 在节点执行命令（pi-rpc 节点自动降级委托 agent） |
| `fleet_deploy` | 同步本地文件到节点 |
| `fleet_node` | 委派智能任务到远程 pi 实例 |

斜杠命令（直接操作，不经 LLM）：

| 命令 | 作用 |
|------|------|
| `/fleet:exec <node> <cmd>` | 直接在节点跑命令 |
| `/fleet:prompt <node> <task>` | 给远程 pi 派任务，显示过程+结果卡片 |
| `/fleet:context <node>` | 查看远程 pi 的对话上下文（历史） |
| `/fleet:list` / `/fleet:reload` | 查看状态 / 重载配置 |

## 架构

核心是 **Transport × Adapter 正交解耦**：

```
传输层（怎么连）           协议层（连上后说什么）
ssh / local / tcp / ws   ×   shell / pi-rpc / robot
```

- **transport** 提供原始 IO：`exec`（跑命令）/ `spawn`（拿 stdio）/ `duplex`（双向消息）
- **adapter** 在其上构建节点语义，产出统一 `RemoteNode`
- 加新通信方式 = 写 transport；加新节点类型 = 写 adapter

完整设计见 [`docs/design.md`](docs/design.md)。

## 与 pi 的关系

- pi 是**运行时依赖**（npm 全局包），不进本仓库。
- 本仓库只放扩展代码。经 `pi install` 安装，不 fork pi 内核。
- 复用 pi 的 `registerTool`、`examples/extensions/ssh.ts`、RPC 协议与 subagents 并发机制。

## 开发

```bash
npm install        # 装 devDeps（含 pi 类型）
npm run typecheck  # tsc --noEmit
```

扩展直接以 TypeScript 加载（pi 用 tsx），无需编译。

## License

MIT

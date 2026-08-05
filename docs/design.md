# pi-fleet 设计文档

> 把一台本地 pi 扩展成**控制平面（controller）**，用统一工具接口调度多台机器上的进程、远程 pi 实例和机器人。

## 1. 目标

- **多机管理**：从一台 pi 管理分布在多台机器上的工作负载。
- **多通信方式**：不强绑 SSH。支持任意传输（SSH / 本地 / TCP / WebSocket / Docker / …），可扩展。
- **多机运行 pi**：远程机器可运行独立 pi 实例（带自己的 LLM、session、工具链），controller 经 RPC 驱动，委派智能任务并回收结果。
- **统一抽象**：远端是裸 shell、pi 实例还是机器人，LLM 都用同一组 `fleet_*` 工具操作，按能力自动降级。
- **契合 pi 哲学**：不 fork pi 内核，纯扩展实现。复用 `registerTool`、RPC 协议、`ssh.ts` 范例与 subagents 并发机制。

## 2. 架构总览

```
                ┌──────────────────────────────────────────┐
   你 ──对话──►  │  Controller: 本地 pi + pi-fleet 扩展      │
                │  LLM · fleet_* 工具 · 节点注册表 · 看板   │
                └────────────────────┬─────────────────────┘
                                     │ 统一 RemoteNode 接口
            ┌────────────────────────┼────────────────────────┐
            ▼                        ▼                        ▼
     Transport × Adapter       Transport × Adapter      Transport × Adapter
     (ssh + shell)             (ssh + pi-rpc)           (ws + robot)
            │                        │                        │
     普通远程机器                 远程 pi 实例                herms 机器人
     裸命令执行                  智能任务委派               运动控制 / 感知
```

## 3. 核心设计：Transport × Adapter 正交解耦

"支持各种通信方式"的关键。**怎么连到机器**（传输层）与**连上后用什么协议**（协议层）相互独立，自由组合。

### 3.1 传输层 Transport

建立到目标机器的连接，提供原始 IO 通道。声明支持的能力，不必全实现：

- `exec(cmd, opts)`：一次性执行命令，拿 stdout/exit。给 `shell` adapter。
- `spawn(cmd[], opts)`：拿长生命子进程的 stdin/stdout。给 `pi-rpc` adapter（启动 `pi --mode rpc`）。
- `duplex`：消息级双向通道。给 `robot` adapter / WS。

| Transport | 能力 | 用途 |
|-----------|------|------|
| ssh | exec, stdio | 远程机器（最常用） |
| local | exec, stdio | 本机进程 / tmux |
| tcp | stdio | 直连 RPC 端口 |
| websocket | duplex | 机器人、实时双向 |
| docker | exec, stdio | 容器内执行 |
| custom | 任意 | 你实现的传输 |

### 3.2 协议层 Adapter

在 transport 之上构建节点语义，产出统一 `RemoteNode`。adapter 声明所需 transport 能力，registry 做匹配校验。

| Adapter | 所需能力 | 产出能力 | 说明 |
|---------|----------|----------|------|
| shell | exec | exec (+fs via exec) | 裸命令，read/write/edit 经 cat/base64（同 ssh.ts） |
| pi-rpc | stdio | agent | 启动 `pi --mode rpc`，按 RPC 协议驱动 |
| robot | duplex 或 exec | robot | 机器人控制（herms 等） |
| custom | 自定义 | 自定义 | 用户扩展 |

### 3.3 节点 RemoteNode

统一视图，能力按需挂载：`exec` / `fs` / `agent` / `robot`。

**降级策略**：LLM 调 `fleet_exec` 时，节点有 `exec` 直接用；只有 `agent`（纯 pi-rpc）则翻译成 `prompt("run: <cmd>")` 委托远程 pi。

## 4. 多机运行 pi：PiRpcAdapter

### 4.1 通信路径

```
Controller ──SSH──► 远程机: spawn "pi --mode rpc --provider ... --model ..."
          stdin  ──JSONL 命令──►  pi (RPC server)
          stdout ◄──JSONL 事件──  pi
```

经 transport（通常 ssh）的 spawn 能力启动远程 `pi --mode rpc`。controller 端 RPC client 按 pi RPC 协议收发：`prompt`/`steer`/`follow_up`/`abort` 驱动 agent；`get_state`/`get_messages` 查询；订阅事件流（`agent_start`/`tool_execution_*`/`message_update`）转发给可观测层。

### 4.2 委派模式

- **同步**：`node.prompt("修这个 bug")` → 阻塞至完成，回传最终消息。
- **后台**：派发后返回 task id，事件流异步回传；经 `fleet_task_list`/`fleet_task_status` 查看，必要时 `steer`。
- **并行**：多节点同时 prompt，复用 subagents 并发机制（`max_concurrency`）。

### 4.3 传输无关性

PiRpcAdapter 只依赖 stdio 能力，故远程 pi 可经 SSH 隧道 / 本地子进程 / TCP / Docker exec。换 transport 只改 `fleet.json`，adapter 代码不变。

## 5. 节点注册表 fleet.json

```jsonc
// ~/.pi/agent/fleet.json
{
  "nodes": {
    "gpu-box":  { "transport": "ssh", "host": "user@gpu-host", "adapter": "pi-rpc", "model": "anthropic/claude-sonnet-4", "cwd": "/workspace" },
    "edge-1":   { "transport": "ssh", "host": "user@edge1", "adapter": "shell", "cwd": "/srv/app" },
    "herms-01": { "transport": "websocket", "url": "ws://192.168.1.50:8080", "adapter": "robot" },
    "local-a":  { "transport": "local", "adapter": "pi-rpc", "model": "openai/gpt-4o" }
  }
}
```

热加载：`/fleet:reload` 刷新。凭据走 keychain / ssh-agent，不落盘明文。

## 6. 注册给 LLM 的工具

| 工具 | 作用 |
|------|------|
| `fleet_list` | 列出所有节点 + 实时状态 |
| `fleet_exec` | 在指定节点执行命令/任务 |
| `fleet_deploy` | 同步文件/代码到节点（基于 fs） |
| `fleet_node` | 在 pi-rpc 节点开 agent 会话，派发智能任务 |
| `fleet_task_list` / `fleet_task_status` | 后台任务可观测性 |
| `robot_action` | 机器人高层动作 |

## 7. 与 pi 现有机制的契合

| 需求 | 复用的 pi 能力 |
|------|----------------|
| 注册 fleet 工具 | `pi.registerTool()` |
| 远程执行 | `examples/extensions/ssh.ts`（现成） |
| 远程智能节点 | `pi --mode rpc` + RPC 协议 |
| 并行派发 + 后台 | pi-subagents（已装） |
| 节点状态进上下文 | `pi.sendMessage()` / `appendEntry()` |
| 状态看板 | 扩展 status line / widget / overlay |

## 8. 分阶段实现路径

- **Phase 0｜最小可用**：`fleet.json` + `fleet_list` + `fleet_exec`（ssh + local transport，shell adapter）。本质是"多目标 ssh.ts"。
- **Phase 1｜远程智能节点**：PiRpcAdapter，RPC client，驱动远程 pi，同步/后台委派。
- **Phase 2｜机器人接入**：RobotAdapter + ws transport + `robot_action`，把 herms 纳入。
- **Phase 3｜编排层**：并行多节点委派、任务分解汇总、实时状态看板、断线重连。

## 9. 难点与风险

1. **连接可靠性**：SSH/RPC 断线、超时、重连。需心跳 + 自动重连。
2. **安全**：凭据走 keychain / ssh-agent；机器人动作需确认门。
3. **状态一致性**：远程真相 vs controller 视图漂移，定期对账。
4. **机器人语义抽象**：取决于 herms 能力模型。
5. **异步编排可观测性**：多后台节点在 TUI 清晰呈现（复用 subagents task 列表）。

## 10. 仓库边界

- pi 是**运行时依赖**（npm 全局包），不进本仓库。
- 本仓库只放扩展代码 + package.json 声明依赖。
- 经 `pi install git:github.com/wrp-wrp/pi-fleet` 一键安装。
- 除非改 pi 内核（目前不需要），不考虑 fork pi。

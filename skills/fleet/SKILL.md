---
name: fleet
description: Manage distributed machines, remote pi instances, and robots via pi-fleet. Use when the user asks to run commands on other machines, delegate tasks to remote pi agents, or control robots across a fleet of nodes.
---

# pi-fleet

pi-fleet 把本地 pi 扩展成控制平面，统一调度多台机器、远程 pi 实例和机器人。

## 何时使用

用户想跨多台机器/远程 pi/机器人操作时使用 fleet 工具：

- "在 gpu-box 上跑 `nvidia-smi`" → `fleet_exec`
- "把这份代码同步到 edge-1" → `fleet_deploy`
- "让远程 pi 帮我修这个 bug" → `fleet_node`
- "列一下我的机器状态" → `fleet_list`

## 工作流

1. 先 `fleet_list` 查看可用节点及其能力（kind: shell / pi-rpc / robot）。
2. 按节点能力选工具：
   - `shell` 节点 → `fleet_exec`（跑命令）/ `fleet_deploy`（传文件）
   - `pi-rpc` 节点 → `fleet_node`（委派智能任务给远程 pi agent）
   - `robot` 节点 → `robot_action`（Phase 2）
3. `fleet_exec` 对纯 pi-rpc 节点会自动降级，委托给远程 agent 执行命令。

## 节点配置

节点定义在 `~/.pi/agent/fleet.json`。结构见 `examples/fleet.json`。

热加载：`/fleet:reload` 命令刷新，无需重启 pi。

## 通信方式

每个节点 = transport（怎么连）× adapter（连上后说什么协议）：

- **transport**：ssh / local / tcp / websocket / docker / custom
- **adapter**：shell / pi-rpc / robot / custom

换通信方式只改 `fleet.json`，工具不变。

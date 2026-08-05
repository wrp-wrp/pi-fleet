import type {
	Adapter,
	Connection,
	NodeConfig,
	RemoteNode,
	RobotOp,
	TransportCapability,
} from "../types.js";

/**
 * 机器人适配器（骨架）。
 *
 * 把机器人控制接口（herms 等）封装成 RemoteNode.robot 能力。
 * 具体实现取决于机器人的通信协议与 SDK——待 herms 接口确认后填充。
 *
 * 设计要点：
 *   - 若机器人暴露 WebSocket/HTTP → 用 websocket transport 的 duplex 能力收发指令
 *   - 若机器人能 SSH 跑命令 → 用 ssh transport 的 exec 能力调用机器人 CLI
 *   - RobotOp 为开放接口，按机器人能力定义 move/grab/sense/...
 *   - requireConfirm 默认对危险动作开确认门（在 tools 层实现）
 *
 * TODO(Phase 2): 接入 herms 后实现具体动作映射。
 */
export class RobotAdapter implements Adapter {
	kind = "robot";
	requiredCapabilities: TransportCapability[] = ["duplex"];

	async create(id: string, conn: Connection, config: NodeConfig): Promise<RemoteNode> {
		// Phase 2：根据 config.driver / config.endpoint 初始化机器人客户端
		const robot: RobotOp = {
			// 占位：所有动作抛"未实现"，提醒先配置 herms 驱动
			async notImplemented() {
				throw new Error(
					`robot adapter: not implemented yet. ` +
						`Configure herms driver for node "${id}" (endpoint=${config.url ?? config.host}).`,
				);
			},
		};

		const node: RemoteNode = {
			id,
			kind: "robot",
			capabilities: ["robot"],
			async status() {
				// TODO: 心跳探测机器人在线状态
				return {
					online: false,
					kind: "robot",
					capabilities: ["robot"],
					detail: { endpoint: config.url ?? config.host, driver: config.driver, implemented: false },
				};
			},
			robot,
			async close() {
				await conn.close();
			},
		};
		return node;
	}
}

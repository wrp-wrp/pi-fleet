import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { FleetRegistry } from "./src/registry.js";
import { registerFleetTools } from "./src/tools.js";

/**
 * pi-fleet 扩展入口。
 *
 * 把本地 pi 扩展成分布式控制平面：经统一 fleet_* 工具调度多台机器上的
 * 进程、远程 pi 实例和机器人。节点 = transport × adapter，见 docs/design.md。
 */
export default function (pi: ExtensionAPI) {
	const registry = new FleetRegistry();

	// 注册 fleet_* 工具给 LLM
	registerFleetTools(pi, registry);

	// 启动时加载节点注册表
	pi.on("session_start", async (_event, ctx) => {
		await registry.load();
		const count = registry.listConfig().length;
		if (count > 0) {
			ctx.ui.setStatus("fleet", `fleet: ${count} nodes`);
			ctx.ui.notify(`pi-fleet loaded: ${count} nodes from ${registry.getConfigPath()}`, "info");
		} else {
			ctx.ui.notify(
				`pi-fleet: no nodes configured. Create ${registry.getConfigPath()} (see examples/fleet.json)`,
				"info",
			);
		}
	});

	// /fleet:reload —— 热加载节点配置
	pi.registerCommand("fleet:reload", {
		description: "Reload fleet.json node registry without restarting pi",
		handler: async (_args, ctx) => {
			await registry.close();
			await registry.load();
			const count = registry.listConfig().length;
			ctx.ui.notify(`fleet reloaded: ${count} nodes`, "info");
		},
	});

	// /fleet:list —— 查看节点状态
	pi.registerCommand("fleet:list", {
		description: "List fleet nodes and their online status",
		handler: async (_args, ctx) => {
			const nodes = await registry.listNodes();
			const lines = nodes.map(
				(n) =>
					`${n.status.online ? "●" : "○"} ${n.id}  [${n.status.kind}]  caps=[${n.status.capabilities.join(", ")}]`,
			);
			ctx.ui.notify(`Fleet (${nodes.length}):\n${lines.join("\n")}`, "info");
		},
	});

	// 关闭时清理连接
	pi.on("session_shutdown", async () => {
		await registry.close();
	});
}

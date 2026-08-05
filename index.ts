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

	// /fleet:exec <node> <command> —— 直接在节点跑命令（不经 LLM）
	pi.registerCommand("fleet:exec", {
		description: "直接在节点执行命令（不经 LLM）。用法: /fleet:exec <node> <command>",
		handler: async (args, ctx) => {
			const trimmed = (args ?? "").trim();
			const sp = trimmed.indexOf(" ");
			if (sp < 0) {
				ctx.ui.notify("用法: /fleet:exec <node> <command>", "error");
				return;
			}
			const node = trimmed.slice(0, sp);
			const cmd = trimmed.slice(sp + 1);
			try {
				const n = await registry.getNode(node);
				if (!n.exec) {
					ctx.ui.notify(`节点 ${node} 无 exec 能力`, "error");
					return;
				}
				const r = await n.exec(cmd, { timeout: 300 });
				const out = (
					`$ ${cmd}  [${node}] exit=${r.exitCode}\n${r.stdout}` +
					(r.stderr ? `\n[stderr]\n${r.stderr}` : "")
				).slice(0, 2000);
				ctx.ui.notify(out, r.exitCode === 0 ? "info" : "error");
			} catch (e) {
				ctx.ui.notify(`fleet:exec 失败: ${(e as Error).message}`, "error");
			}
		},
	});

	// /fleet:prompt <node> <task> —— 直接给远程 pi 派任务（不经 controller LLM）
	pi.registerCommand("fleet:prompt", {
		description: "直接给远程 pi 节点派任务（不经 controller LLM）。用法: /fleet:prompt <node> <task>",
		handler: async (args, ctx) => {
			const trimmed = (args ?? "").trim();
			const sp = trimmed.indexOf(" ");
			if (sp < 0) {
				ctx.ui.notify("用法: /fleet:prompt <node> <task>", "error");
				return;
			}
			const node = trimmed.slice(0, sp);
			const task = trimmed.slice(sp + 1);
			try {
				const n = await registry.getNode(node);
				if (!n.agent) {
					ctx.ui.notify(`节点 ${node} 无 agent 能力 (非 pi-rpc 节点)`, "error");
					return;
				}
				ctx.ui.notify(`→ 派发给 ${node} ...`, "info");
				const result = await n.agent.prompt(task);
				ctx.ui.notify(`[${node}]\n${result}`.slice(0, 2000), "info");
			} catch (e) {
				ctx.ui.notify(`fleet:prompt 失败: ${(e as Error).message}`, "error");
			}
		},
	});

	// 关闭时清理连接
	pi.on("session_shutdown", async () => {
		await registry.close();
	});
}

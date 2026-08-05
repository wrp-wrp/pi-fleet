import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
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

	// 渲染远程 pi 交互卡片（不进 controller LLM 上下文，仅 transcript 显示）
	pi.registerEntryRenderer<{ node: string; title: string; body: string; tools?: string[] }>(
		"fleet-remote",
		(entry, { expanded }, theme) => {
			const d = entry.data ?? { node: "", title: "", body: "" };
			const box = new Box(1, 1, (text: string) => theme.bg("customMessageBg", text));
			box.addChild(new Text(theme.fg("accent", `[${d.node}] ${d.title}`), 0, 0));
			const preview = expanded ? d.body : (d.body.split("\n")[0] ?? "").slice(0, 100);
			box.addChild(new Text(theme.fg("dim", preview), 0, 0));
			if (expanded && d.tools?.length) {
				box.addChild(new Text(theme.fg("dim", `tools: ${d.tools.join(", ")}`), 0, 0));
			}
			return box;
		},
	);

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

	// /fleet:prompt <node> <task> —— 直接给远程 pi 派任务，实时显示过程 + 结果卡片
	pi.registerCommand("fleet:prompt", {
		description: "直接给远程 pi 节点派任务（不经 controller LLM），显示过程与结果。用法: /fleet:prompt <node> <task>",
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
				const tools: string[] = [];
				ctx.ui.notify(`→ 派发给 ${node} ...`, "info");
				const result = await n.agent.prompt(task, {}, (evt: unknown) => {
					const e = evt as { type?: string; toolName?: string; args?: unknown };
					if (e.type === "tool_execution_start" && e.toolName) {
						tools.push(e.toolName);
						const arg = JSON.stringify(e.args ?? {}).slice(0, 80);
						ctx.ui.notify(`[${node}] ▸ ${e.toolName} ${arg}`, "info");
					}
				});
				pi.appendEntry("fleet-remote", { node, title: `任务: ${task.slice(0, 60)}`, body: result, tools });
			} catch (e) {
				ctx.ui.notify(`fleet:prompt 失败: ${(e as Error).message}`, "error");
			}
		},
	});

	// /fleet:context <node> —— 查看远程 pi 的对话上下文（历史消息）
	pi.registerCommand("fleet:context", {
		description: "查看远程 pi 节点的对话上下文（历史消息）。用法: /fleet:context <node>",
		handler: async (args, ctx) => {
			const node = (args ?? "").trim();
			if (!node) {
				ctx.ui.notify("用法: /fleet:context <node>", "error");
				return;
			}
			try {
				const n = await registry.getNode(node);
				if (!n.agent) {
					ctx.ui.notify(`节点 ${node} 无 agent 能力 (非 pi-rpc 节点)`, "error");
					return;
				}
				const msgs = (await n.agent.getMessages()) as Array<{
					role?: string;
					content?: Array<{ type: string; text?: string }>;
				}>;
				const lines: string[] = [];
				for (const m of msgs) {
					const role = m.role ?? "?";
					if (role === "user" || role === "assistant") {
						const text = (m.content ?? [])
							.filter((c) => c.type === "text")
							.map((c) => c.text ?? "")
							.join(" ")
							.trim();
						if (text) lines.push(`${role}: ${text.slice(0, 300)}`);
					}
				}
				const body = lines.length ? lines.join("\n") : "(空 session，尚无对话)";
				pi.appendEntry("fleet-remote", { node, title: `上下文 (${msgs.length} 条消息)`, body });
			} catch (e) {
				ctx.ui.notify(`fleet:context 失败: ${(e as Error).message}`, "error");
			}
		},
	});

	// 关闭时清理连接
	pi.on("session_shutdown", async () => {
		await registry.close();
	});
}

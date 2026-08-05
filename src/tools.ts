import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import type { FleetRegistry } from "./registry.js";

/** 统一构造带 details 的文本结果（AgentToolResult.details 必填） */
function textResult(
	text: string,
	details: unknown = {},
): { content: Array<{ type: "text"; text: string }>; details: unknown } {
	return { content: [{ type: "text", text }], details };
}

/**
 * 注册 fleet_* 工具给 LLM。所有工具经 FleetRegistry 获取节点。
 */
export function registerFleetTools(pi: ExtensionAPI, registry: FleetRegistry): void {
	pi.registerTool({
		name: "fleet_list",
		label: "Fleet: List Nodes",
		description:
			"List all fleet nodes from fleet.json with online status, kind, and capabilities. " +
			"Use first to discover available nodes before fleet_exec/fleet_node.",
		promptSnippet: "List fleet nodes and their status",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, onUpdate) {
			const nodes = await registry.listNodes();
			const lines = nodes.map((n) => {
				const s = n.status;
				const mark = s.online ? "●" : "○";
				const err = s.detail?.error ? `  err: ${s.detail.error}` : "";
				return `${mark} ${n.id}  [${s.kind}]  caps=[${s.capabilities.join(", ")}]${err}`;
			});
			const text = `Fleet nodes (${nodes.length}):\n${lines.join("\n")}`;
			onUpdate?.(textResult(text, { count: nodes.length }));
			return textResult(text, { nodes });
		},
	});

	pi.registerTool({
		name: "fleet_exec",
		label: "Fleet: Execute Command",
		description:
			"Execute a shell command on a fleet node by id. Returns stdout/stderr/exitCode. " +
			"For pi-rpc nodes (no exec), delegates to the remote pi agent instead.",
		promptSnippet: "Run a shell command on a fleet node",
		promptGuidelines: ["Use fleet_exec to run a shell command on a specific fleet node by id."],
		parameters: Type.Object({
			node: Type.String({ description: "Node id from fleet.json" }),
			command: Type.String({ description: "Shell command to execute on the node" }),
			timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (default: none)" })),
		}),
		async execute(_toolCallId, params, signal, onUpdate) {
			const node = await registry.getNode(params.node);
			if (!node.exec) {
				// 降级：pi-rpc 节点委托 agent
				if (node.agent) {
					const result = await node.agent.prompt(
						`Run this command and report its stdout/stderr/exit code:\n\n${params.command}`,
					);
					return textResult(result, { delegated: true });
				}
				return textResult(`node "${params.node}" has no exec or agent capability`, { error: "no_capability" });
			}
			const r = await node.exec(params.command, {
				timeout: params.timeout,
				signal,
				onData: (c) => onUpdate?.(textResult(c.toString())),
			});
			const text =
				`$ ${params.command}  [on ${params.node}]\n` +
				`exit=${r.exitCode}${r.timedOut ? " (timed out)" : ""}\n` +
				`--- stdout ---\n${r.stdout}` +
				(r.stderr ? `\n--- stderr ---\n${r.stderr}` : "");
			return textResult(text, r);
		},
	});

	pi.registerTool({
		name: "fleet_deploy",
		label: "Fleet: Deploy File",
		description: "Copy a local file to a fleet node (writes via node fs capability).",
		promptSnippet: "Deploy a local file to a fleet node",
		parameters: Type.Object({
			node: Type.String({ description: "Node id" }),
			localPath: Type.String({ description: "Local file path to read" }),
			remotePath: Type.String({ description: "Destination path on the node" }),
		}),
		async execute(_toolCallId, params) {
			const node = await registry.getNode(params.node);
			if (!node.fs) {
				return textResult(`node "${params.node}" has no fs capability`, { error: "no_fs" });
			}
			const content = await readFile(params.localPath);
			await node.fs.write(params.remotePath, content);
			return textResult(
				`Deployed ${params.localPath} → ${params.node}:${params.remotePath} (${content.length} bytes)`,
				{ bytes: content.length },
			);
		},
	});

	pi.registerTool({
		name: "fleet_node",
		label: "Fleet: Delegate to pi Node",
		description:
			"Delegate an intelligent task to a remote pi node (pi-rpc adapter). " +
			"Blocks until the remote agent finishes, returns its final answer. " +
			"Use for complex work that benefits from a full pi agent on the remote machine.",
		promptSnippet: "Delegate a task to a remote pi node",
		promptGuidelines: ["Use fleet_node to delegate complex tasks to a remote pi instance (pi-rpc node)."],
		parameters: Type.Object({
			node: Type.String({ description: "pi-rpc node id" }),
			task: Type.String({ description: "Task description for the remote pi agent" }),
		}),
		async execute(_toolCallId, params, _signal, onUpdate) {
			const node = await registry.getNode(params.node);
			if (!node.agent) {
				return textResult(
					`node "${params.node}" has no agent capability (not a pi-rpc node)`,
					{ error: "no_agent" },
				);
			}
			onUpdate?.(textResult(`→ delegating to ${params.node}…`, { phase: "delegating" }));
			const result = await node.agent.prompt(params.task);
			return textResult(`[${params.node}]\n${result}`, { node: params.node });
		},
	});
}

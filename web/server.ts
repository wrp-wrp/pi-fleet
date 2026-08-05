/**
 * pi-fleet web 控制台后端。
 *
 * 直接用 FleetRegistry（fleet 核心是库），经 WebSocket 暴露：
 *   list / exec / prompt(远程 pi，含事件流) / context(远程对话历史)
 * 浏览器当前端，复用 ~/.pi/agent/fleet.json 的节点配置。
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { FleetRegistry } from "../src/registry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = Number(process.env.PORT ?? 7531);

const registry = new FleetRegistry();
await registry.load();
console.log(`[pi-fleet web] ${registry.listConfig().length} nodes from ${registry.getConfigPath()}`);

function mime(p: string): string {
	if (p.endsWith(".html")) return "text/html; charset=utf-8";
	if (p.endsWith(".js")) return "text/javascript; charset=utf-8";
	if (p.endsWith(".css")) return "text/css; charset=utf-8";
	if (p.endsWith(".svg")) return "image/svg+xml";
	return "application/octet-stream";
}

const httpServer = createServer(async (req, res) => {
	const url = (req.url ?? "/").split("?")[0];
	const filePath = path.join(PUBLIC_DIR, url === "/" ? "index.html" : url);
	try {
		const data = await readFile(filePath);
		res.writeHead(200, { "Content-Type": mime(filePath) });
		res.end(data);
	} catch {
		res.writeHead(404);
		res.end("not found");
	}
});

const wss = new WebSocketServer({ server: httpServer });

function send(ws: WebSocket, obj: unknown): void {
	if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

wss.on("connection", (ws) => {
	console.log("[ws] client connected");
	ws.on("message", async (raw) => {
		let msg: { type: string; node?: string; cmd?: string; message?: string; timeout?: number };
		try {
			msg = JSON.parse(raw.toString());
		} catch {
			return;
		}
		const t = msg.type;
		try {
			if (t === "list") {
				send(ws, { type: "nodes", nodes: registry.listConfig() });
			} else if (t === "exec") {
				const node = await registry.getNode(msg.node!);
				if (!node.exec) {
					send(ws, { type: "error", message: `节点 ${msg.node} 无 exec 能力` });
					return;
				}
				const r = await node.exec(msg.cmd!, {
					timeout: msg.timeout ?? 300,
					onData: (c) => send(ws, { type: "exec_output", node: msg.node, chunk: c.toString() }),
				});
				send(ws, {
					type: "exec_done",
					node: msg.node,
					stdout: r.stdout,
					stderr: r.stderr,
					exitCode: r.exitCode,
				});
			} else if (t === "prompt") {
				const node = await registry.getNode(msg.node!);
				if (!node.agent) {
					send(ws, { type: "error", message: `节点 ${msg.node} 无 agent 能力 (非 pi-rpc)` });
					return;
				}
				const result = await node.agent.prompt(msg.message!, {}, (evt: unknown) => {
					send(ws, { type: "agent_event", node: msg.node, evt });
				});
				send(ws, { type: "agent_done", node: msg.node, text: result });
			} else if (t === "context") {
				const node = await registry.getNode(msg.node!);
				if (!node.agent) {
					send(ws, { type: "error", message: `节点 ${msg.node} 无 agent 能力` });
					return;
				}
				const messages = await node.agent.getMessages();
				send(ws, { type: "context", node: msg.node, messages });
			}
		} catch (e) {
			send(ws, { type: "error", message: (e as Error).message });
		}
	});
	ws.on("close", () => console.log("[ws] client disconnected"));
});

httpServer.listen(PORT, () => {
	console.log(`► pi-fleet web 控制台: http://localhost:${PORT}`);
});

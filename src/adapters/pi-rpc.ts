import type {
	Adapter,
	AgentOp,
	AgentPromptOptions,
	ChildProcessLike,
	Connection,
	NodeConfig,
	RemoteNode,
	TransportCapability,
} from "../types.js";

type RpcEvent = Record<string, unknown>;
type RpcResponse = { id?: number; type: "response"; command: string; success: boolean; error?: string };

/** 从 AgentMessage 提取纯文本 */
function extractText(message: unknown): string {
	const m = message as { content?: Array<{ type: string; text?: string }> };
	if (!m?.content) return "";
	return m.content
		.filter((c) => c.type === "text")
		.map((c) => c.text ?? "")
		.join("\n");
}

/**
 * pi RPC 协议客户端：经子进程 stdio 收发 JSONL。
 * 协议见 pi docs/rpc.md。按 \n 切行（不用 readline，它误切 U+2028/U+2029）。
 */
export class RpcClient {
	private child: ChildProcessLike;
	private buffer = "";
	private seq = 0;
	private pending = new Map<number, { resolve: (r: RpcResponse) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
	private listeners = new Set<(evt: RpcEvent) => void>();
	private closed = false;

	constructor(child: ChildProcessLike) {
		this.child = child;
		(child.stdout as NodeJS.ReadableStream).on("data", (chunk: Buffer) => this.onData(chunk));
		(child.stderr as NodeJS.ReadableStream).on("data", (chunk: Buffer) => {
			process.stderr.write(`[pi-rpc:${child.pid}] ${chunk.toString()}`);
		});
		child.exited.then((code) => {
			this.closed = true;
			for (const p of this.pending.values()) {
				clearTimeout(p.timer);
				p.reject(new Error(`pi rpc process exited (code=${code})`));
			}
			this.pending.clear();
		});
	}

	private onData(chunk: Buffer) {
		this.buffer += chunk.toString("utf-8");
		let idx: number;
		while ((idx = this.buffer.indexOf("\n")) >= 0) {
			const line = this.buffer.slice(0, idx).replace(/\r$/, "");
			this.buffer = this.buffer.slice(idx + 1);
			if (line.trim()) this.handleLine(line);
		}
	}

	private handleLine(line: string) {
		let msg: RpcEvent | RpcResponse;
		try {
			msg = JSON.parse(line) as RpcEvent | RpcResponse;
		} catch {
			return;
		}
		if (msg.type === "response" && typeof (msg as RpcResponse).id === "number") {
			const resp = msg as RpcResponse;
			const p = this.pending.get(resp.id!);
			if (p) {
				this.pending.delete(resp.id!);
				clearTimeout(p.timer);
				p.resolve(resp);
			}
		} else {
			for (const h of this.listeners) {
				try {
					h(msg as RpcEvent);
				} catch {
					/* listener 错误不影响协议 */
				}
			}
		}
	}

	/** 发送命令，等对应 response */
	send(cmd: Record<string, unknown>, timeoutMs = 30000): Promise<RpcResponse> {
		const id = ++this.seq;
		const obj = { id, ...cmd };
		return new Promise((resolve, reject) => {
			if (this.closed) {
				reject(new Error("pi rpc closed"));
				return;
			}
			const timer = setTimeout(() => {
				if (this.pending.has(id)) {
					this.pending.delete(id);
					reject(new Error(`rpc timeout: ${cmd.type ?? "command"}`));
				}
			}, timeoutMs);
			this.pending.set(id, { resolve, reject, timer });
			this.child.stdin.write(JSON.stringify(obj) + "\n");
		});
	}

	onEvent(handler: (evt: RpcEvent) => void): void {
		this.listeners.add(handler);
	}
	offEvent(handler: (evt: RpcEvent) => void): void {
		this.listeners.delete(handler);
	}

	/**
	 * 派发任务，阻塞至 agent_settled，回传最终 assistant 文本。
	 * 基础实现：收集 message_end 的文本，等 agent_settled 完成。
	 * TODO(Phase 1): 完善 tool 执行中间态转发、错误恢复。
	 */
	prompt(message: string, opts: AgentPromptOptions = {}, onProgress?: (event: unknown) => void): Promise<string> {
		return new Promise((resolve, reject) => {
			let finalText = "";
			const onEvent = (evt: RpcEvent) => {
				onProgress?.(evt);
				const t = evt.type as string;
				if (t === "message_end") {
					const msg = evt.message as { role?: string } | undefined;
					if (msg?.role === "assistant") finalText = extractText(evt.message);
				} else if (t === "agent_settled") {
					this.offEvent(onEvent);
					resolve(finalText);
				} else if (t === "error") {
					this.offEvent(onEvent);
					reject(new Error(String(evt.message ?? evt.reason ?? "rpc error")));
				}
			};
			this.onEvent(onEvent);
			const cmd: Record<string, unknown> = { type: "prompt", message };
			if (opts.streamingBehavior) cmd.streamingBehavior = opts.streamingBehavior;
			if (opts.images?.length) {
				cmd.images = opts.images.map((i) => ({ type: "image", data: i.data, mimeType: i.mimeType }));
			}
			this.send(cmd)
				.then((resp) => {
					if (!resp.success) {
						this.offEvent(onEvent);
						reject(new Error(`prompt rejected: ${resp.error ?? ""}`));
					}
				})
				.catch((e: Error) => {
					this.offEvent(onEvent);
					reject(e);
				});
		});
	}

	steer(message: string): Promise<void> {
		return this.send({ type: "steer", message }).then(() => undefined);
	}
	followUp(message: string): Promise<void> {
		return this.send({ type: "follow_up", message }).then(() => undefined);
	}
	abort(): Promise<void> {
		return this.send({ type: "abort" }).then(() => undefined);
	}
	getState(): Promise<unknown> {
		return this.send({ type: "get_state" }).then((r) => r as unknown);
	}
	getMessages(): Promise<unknown[]> {
		return this.send({ type: "get_messages" }).then(
			(r) => ((r as { data?: { messages?: unknown[] } }).data?.messages) ?? [],
		);
	}

	close(): void {
		this.closed = true;
		try {
			this.child.stdin.end();
		} catch {
			/* already closed */
		}
		try {
			this.child.kill("SIGTERM");
		} catch {
			/* already dead */
		}
	}
}

/**
 * PiRpcAdapter：在 transport 的 stdio 能力上启动 `pi --mode rpc`，
 * 经 RPC 协议驱动远程 pi 实例（多机运行 pi 的核心）。
 */
export class PiRpcAdapter implements Adapter {
	kind = "pi-rpc";
	requiredCapabilities: TransportCapability[] = ["stdio"];

	async create(id: string, conn: Connection, config: NodeConfig): Promise<RemoteNode> {
		if (!conn.spawn) throw new Error("pi-rpc adapter: transport missing spawn");

		// 构造远程 pi 启动命令，注入环境变量
		// 值若为 "$VAR" 则从 controller 环境变量解析（key 不落盘 fleet.json）
		// 以 KEY='val' 前缀元素注入，ssh 远程 shell 解析为进程环境
		// TODO(安全): key 会短暂出现在远程 ps，后续改用 SendEnv / stdin 传递
		const cmd: string[] = [];
		if (config.env) {
			for (const [k, v] of Object.entries(config.env)) {
				let val = v;
				if (typeof v === "string" && v.startsWith("$")) val = process.env[v.slice(1)] ?? "";
				cmd.push(`${k}='${val}'`);
			}
		}
		cmd.push("pi", "--mode", "rpc");
		if (config.provider) cmd.push("--provider", config.provider);
		if (config.model) cmd.push("--model", config.model);
		if (config.tools?.length) cmd.push("--tools", config.tools.join(","));
		if (config.args?.length) cmd.push(...config.args);

		const child = conn.spawn(cmd);
		const client = new RpcClient(child);

		const agent: AgentOp = {
			prompt: (msg, opts, onProgress) => client.prompt(msg, opts, onProgress),
			steer: (msg) => client.steer(msg),
			followUp: (msg) => client.followUp(msg),
			abort: () => client.abort(),
			getState: () => client.getState(),
			getMessages: () => client.getMessages(),
		};

		const node: RemoteNode = {
			id,
			kind: "pi-rpc",
			capabilities: ["agent"],
			async status() {
				try {
					const st = await client.getState();
					return { online: true, kind: "pi-rpc", capabilities: ["agent"], detail: st as Record<string, unknown> };
				} catch (e) {
					return {
						online: false,
						kind: "pi-rpc",
						capabilities: [],
						detail: { error: (e as Error).message },
					};
				}
			},
			agent,
			async close() {
				client.close();
				await conn.close();
			},
		};
		return node;
	}
}

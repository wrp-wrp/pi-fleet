import { readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type {
	Adapter,
	FleetConfig,
	NodeConfig,
	NodeStatus,
	RemoteNode,
	Transport,
} from "./types.js";
import { SshTransport } from "./transports/ssh.js";
import { LocalTransport } from "./transports/local.js";
import { ShellAdapter } from "./adapters/shell.js";
import { PiRpcAdapter } from "./adapters/pi-rpc.js";
import { RobotAdapter } from "./adapters/robot.js";

const DEFAULT_FLEET_PATH = path.join(os.homedir(), ".pi", "agent", "fleet.json");

/**
 * 节点注册表：加载 fleet.json，按 transport × adapter 组合实例化 RemoteNode。
 * 支持运行时注册自定义 transport/adapter（扩展点）。
 */
export class FleetRegistry {
	private nodes = new Map<string, RemoteNode>();
	private transports = new Map<string, () => Transport>();
	private adapters = new Map<string, () => Adapter>();
	private readonly configPath: string;
	private config: FleetConfig = { nodes: {} };

	constructor(configPath: string = DEFAULT_FLEET_PATH) {
		this.configPath = configPath;
		this.registerBuiltins();
	}

	private registerBuiltins(): void {
		this.registerTransport("ssh", () => new SshTransport());
		this.registerTransport("local", () => new LocalTransport());
		this.registerAdapter("shell", () => new ShellAdapter());
		this.registerAdapter("pi-rpc", () => new PiRpcAdapter());
		this.registerAdapter("robot", () => new RobotAdapter());
	}

	/** 扩展点：注册自定义传输 */
	registerTransport(name: string, factory: () => Transport): void {
		this.transports.set(name, factory);
	}

	/** 扩展点：注册自定义协议适配器 */
	registerAdapter(name: string, factory: () => Adapter): void {
		this.adapters.set(name, factory);
	}

	getConfigPath(): string {
		return this.configPath;
	}

	async load(): Promise<void> {
		try {
			const raw = await readFile(this.configPath, "utf-8");
			this.config = JSON.parse(raw) as FleetConfig;
		} catch {
			this.config = { nodes: {} };
		}
	}

	/** 配置中的所有节点（不实例化） */
	listConfig(): Array<{ id: string } & NodeConfig> {
		return Object.entries(this.config.nodes).map(([id, c]) => ({ id, ...c }));
	}

	/** 获取或实例化一个节点 */
	async getNode(id: string): Promise<RemoteNode> {
		const cached = this.nodes.get(id);
		if (cached) return cached;

		const cfg = this.config.nodes[id];
		if (!cfg) throw new Error(`fleet: unknown node "${id}". Check ${this.configPath}.`);

		const tFactory = this.transports.get(cfg.transport);
		const aFactory = this.adapters.get(cfg.adapter);
		if (!tFactory) throw new Error(`fleet: unknown transport "${cfg.transport}"`);
		if (!aFactory) throw new Error(`fleet: unknown adapter "${cfg.adapter}"`);

		const transport = tFactory();
		const adapter = aFactory();
		const conn = await transport.connect(cfg);

		// 能力校验：adapter 所需必须被 transport 提供
		for (const cap of adapter.requiredCapabilities) {
			if (!transport.capabilities.includes(cap)) {
				await conn.close();
				throw new Error(
					`fleet: node "${id}" adapter "${cfg.adapter}" requires transport capability "${cap}", ` +
						`but "${cfg.transport}" provides [${transport.capabilities.join(", ")}]`,
				);
			}
		}

		const node = await adapter.create(id, conn, cfg);
		this.nodes.set(id, node);
		return node;
	}

	/** 所有节点状态概览。
	 *  pi-rpc 节点不主动实例化（SSH 启动远程 pi 很重），只对轻量节点探测在线。
	 *  pi-rpc 节点标记“按需连接”，实际连接在 getNode()/使用时才建立。 */
	async listNodes(): Promise<Array<{ id: string; status: NodeStatus }>> {
		const ids = Object.keys(this.config.nodes);
		return Promise.all(
			ids.map(async (id) => {
				const cfg = this.config.nodes[id];
				// pi-rpc 实例化需 SSH 启动远程 pi（重），概览时跳过
				if (cfg.adapter === "pi-rpc") {
					return {
						id,
						status: {
							online: true,
							kind: "pi-rpc",
							capabilities: ["agent"],
							detail: { host: cfg.host, model: cfg.model, note: "按需连接" },
						},
					};
				}
				try {
					const node = await this.getNode(id);
					const status = await node.status();
					return { id, status };
				} catch (e) {
					return {
						id,
						status: {
							online: false,
							kind: cfg.adapter,
							capabilities: [],
							detail: { error: (e as Error).message },
						},
					};
				}
			}),
		);
	}

	async close(): Promise<void> {
		await Promise.all([...this.nodes.values()].map((n) => n.close().catch(() => {})));
		this.nodes.clear();
	}
}

/**
 * pi-fleet 核心类型契约
 *
 * Transport × Adapter 正交解耦：
 *   - Transport 负责"怎么连到机器"（提供 exec / spawn / duplex 原始能力）
 *   - Adapter   负责"连上后用什么协议对话"（产出统一 RemoteNode）
 */

// ---------------------------------------------------------------------------
// 传输层能力与原始 IO
// ---------------------------------------------------------------------------

export type TransportCapability = "exec" | "stdio" | "duplex";

export interface ExecOptions {
	/** 工作目录（覆盖节点默认 cwd） */
	cwd?: string;
	/** 超时（秒） */
	timeout?: number;
	/** 额外环境变量 */
	env?: Record<string, string>;
	/** 取消信号 */
	signal?: AbortSignal;
	/** 流式输出回调 */
	onData?: (chunk: Buffer) => void;
}

export interface ExecResult {
	stdout: string;
	stderr: string;
	exitCode: number | null;
	timedOut?: boolean;
	aborted?: boolean;
}

export interface SpawnOptions {
	cwd?: string;
	env?: Record<string, string>;
	signal?: AbortSignal;
}

/** 长生命子进程的 stdio 句柄（给 pi-rpc adapter 启动 `pi --mode rpc` 用） */
export interface ChildProcessLike {
	pid: number;
	stdin: {
		write(data: string | Buffer): boolean;
		end(): void;
	};
	stdout: NodeJS.ReadableStream;
	stderr: NodeJS.ReadableStream;
	kill(signal?: NodeJS.Signals): void;
	/** 进程退出码（null 表示被信号杀死） */
	exited: Promise<number | null>;
}

/** 消息级双向通道（给 websocket transport / robot adapter 用） */
export interface DuplexConnection {
	send(data: string | Buffer): void;
	onMessage(handler: (data: Buffer) => void): void;
	onClose(handler: () => void): void;
	close(): void;
}

/** transport 连上后提供的能力集合（按 transport 实现部分可选） */
export interface Connection {
	/** 一次性执行命令 */
	exec?(cmd: string, opts?: ExecOptions): Promise<ExecResult>;
	/** 启动长生命子进程，拿 stdio */
	spawn?(cmd: string[], opts?: SpawnOptions): ChildProcessLike;
	/** 双向消息通道 */
	duplex?: DuplexConnection;
	/** 关闭连接 */
	close(): Promise<void>;
}

export interface Transport {
	kind: string;
	capabilities: TransportCapability[];
	/** 用节点配置建立连接 */
	connect(config: NodeConfig): Promise<Connection>;
}

// ---------------------------------------------------------------------------
// 协议层 Adapter 与统一节点 RemoteNode
// ---------------------------------------------------------------------------

export interface FsOp {
	read(path: string): Promise<Buffer>;
	write(path: string, content: string | Buffer): Promise<void>;
	edit?(path: string, oldText: string, newText: string): Promise<void>;
	access?(path: string): Promise<boolean>;
}

export interface AgentPromptOptions {
	images?: Array<{ data: string; mimeType: string }>;
	/** agent 流式时如何处理：steer / followUp */
	streamingBehavior?: "steer" | "followUp";
}

export interface AgentOp {
	/** 派发任务，阻塞至远程 agent 完成，回传最终文本 */
	prompt(message: string, opts?: AgentPromptOptions): Promise<string>;
	/** 插入 steering 消息（agent 运行中调整方向） */
	steer(message: string): Promise<void>;
	/** 排队后续消息（agent 完成后处理） */
	followUp(message: string): Promise<void>;
	/** 中止当前 agent 操作 */
	abort(): Promise<void>;
	/** 查询远程 agent 状态 */
	getState(): Promise<unknown>;
}

/** 机器人能力——具体动作由 adapter 按 SDK 填充，这里只占位 */
export type RobotOp = Record<string, (...args: unknown[]) => Promise<unknown>>;

export interface NodeStatus {
	online: boolean;
	kind: string;
	capabilities: string[];
	detail?: Record<string, unknown>;
}

/** 所有节点对 LLM 呈现的统一视图，能力按需挂载 */
export interface RemoteNode {
	id: string;
	kind: string;
	capabilities: string[];
	status(): Promise<NodeStatus>;
	exec?(cmd: string, opts?: ExecOptions): Promise<ExecResult>;
	fs?: FsOp;
	agent?: AgentOp;
	robot?: RobotOp;
	close(): Promise<void>;
}

export interface Adapter {
	kind: string;
	/** 声明所需 transport 能力，registry 校验 */
	requiredCapabilities: TransportCapability[];
	/** 在 connection 之上构建 RemoteNode */
	create(id: string, conn: Connection, config: NodeConfig): Promise<RemoteNode>;
}

// ---------------------------------------------------------------------------
// 节点与 fleet 配置
// ---------------------------------------------------------------------------

export interface NodeConfig {
	/** 传输方式：ssh / local / tcp / websocket / docker / custom */
	transport: string;
	/** 协议适配器：shell / pi-rpc / robot / custom */
	adapter: string;
	// --- transport 特定字段 ---
	/** ssh: user@host */
	host?: string;
	/** local/ssh: 默认工作目录 */
	cwd?: string;
	/** websocket/tcp: 连接 URL */
	url?: string;
	/** tcp: 端口（与 host 配合） */
	port?: number;
	/** docker: 容器名/ID */
	container?: string;
	// --- adapter 特定字段 ---
	/** pi-rpc: 模型，如 "anthropic/claude-sonnet-4" */
	model?: string;
	/** pi-rpc: provider */
	provider?: string;
	/** pi-rpc: 远程 pi 启动时允许的工具 */
	tools?: string[];
	/** pi-rpc: 远程 pi 启动参数 */
	args?: string[];
	// --- 通用 ---
	env?: Record<string, string>;
	/** 启用后该节点动作需经确认门（机器人默认 true） */
	requireConfirm?: boolean;
	/** 允许任意 transport/adapter 自定义字段 */
	[key: string]: unknown;
}

export interface FleetConfig {
	nodes: Record<string, NodeConfig>;
}

import { spawn } from "node:child_process";
import type {
	ChildProcessLike,
	Connection,
	ExecOptions,
	ExecResult,
	NodeConfig,
	SpawnOptions,
	Transport,
	TransportCapability,
} from "../types.js";
import { runChild, toChildProcessLike } from "../util.js";

/**
 * 本地传输：在本机执行命令 / 启动子进程。
 * 用于单机多 pi 实例、tmux 会话管理、本地进程控制。
 */
export class LocalTransport implements Transport {
	kind = "local";
	capabilities: TransportCapability[] = ["exec", "stdio"];

	connect(config: NodeConfig): Promise<Connection> {
		const cwd = config.cwd;

		const connection: Connection = {
			async exec(cmd: string, opts: ExecOptions = {}): Promise<ExecResult> {
				const child = spawn(cmd, {
					shell: true,
					cwd: opts.cwd ?? cwd,
					stdio: ["ignore", "pipe", "pipe"],
					env: { ...process.env, ...opts.env },
				});
				return runChild(child, opts);
			},
			spawn(cmdArray: string[], opts: SpawnOptions = {}): ChildProcessLike {
				const child = spawn(cmdArray[0], cmdArray.slice(1), {
					cwd: opts.cwd ?? cwd,
					stdio: ["pipe", "pipe", "pipe"],
					env: { ...process.env, ...opts.env },
				});
				return toChildProcessLike(child);
			},
			async close(): Promise<void> {
				/* 无长连接 */
			},
		};
		return Promise.resolve(connection);
	}
}

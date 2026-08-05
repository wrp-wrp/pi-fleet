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
 * SSH 传输：每次命令独立 ssh，无长连接。
 * 提供 exec（跑命令）与 spawn（启动远程子进程，如 `pi --mode rpc`）。
 * 依赖 SSH key 免密登录。
 */
export class SshTransport implements Transport {
	kind = "ssh";
	capabilities: TransportCapability[] = ["exec", "stdio"];

	connect(config: NodeConfig): Promise<Connection> {
		if (!config.host) {
			return Promise.reject(new Error('ssh transport: "host" required (e.g. "user@host")'));
		}
		const remote = config.host;
		const remoteCwd = config.cwd;
		const wrap = (cmd: string) => (remoteCwd ? `cd ${JSON.stringify(remoteCwd)} && ${cmd}` : cmd);

		const connection: Connection = {
			async exec(cmd: string, opts: ExecOptions = {}): Promise<ExecResult> {
				const child = spawn("ssh", [remote, wrap(cmd)], {
					stdio: ["ignore", "pipe", "pipe"],
					env: { ...process.env, ...opts.env },
				});
				return runChild(child, opts);
			},
			spawn(cmdArray: string[], opts: SpawnOptions = {}): ChildProcessLike {
				// ssh 把后续参数拼成一条远程命令字符串
				const child = spawn("ssh", [remote, cmdArray.join(" ")], {
					stdio: ["pipe", "pipe", "pipe"],
					env: { ...process.env, ...opts.env },
				});
				return toChildProcessLike(child);
			},
			async close(): Promise<void> {
				/* 每次命令独立 ssh，无需保持连接 */
			},
		};
		return Promise.resolve(connection);
	}
}

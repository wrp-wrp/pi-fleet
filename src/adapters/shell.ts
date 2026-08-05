import type {
	Adapter,
	Connection,
	NodeConfig,
	RemoteNode,
	TransportCapability,
} from "../types.js";

/**
 * Shell 适配器：在 transport 的 exec 能力上构建裸命令节点。
 * 提供 exec + fs（read/write/access 经 cat/base64/test 实现，二进制安全）。
 * 思路同 pi 自带 examples/extensions/ssh.ts。
 */
export class ShellAdapter implements Adapter {
	kind = "shell";
	requiredCapabilities: TransportCapability[] = ["exec"];

	async create(id: string, conn: Connection, config: NodeConfig): Promise<RemoteNode> {
		const exec = conn.exec ?? (() => { throw new Error("shell adapter: transport missing exec"); });

		const node: RemoteNode = {
			id,
			kind: "shell",
			capabilities: ["exec", "fs"],

			async status() {
				try {
					const r = await exec("echo __pi_fleet_ok__", { timeout: 15 });
					const online = r.exitCode === 0 && r.stdout.includes("__pi_fleet_ok__");
					return {
						online,
						kind: "shell",
						capabilities: online ? ["exec", "fs"] : [],
						detail: { host: config.host, cwd: config.cwd },
					};
				} catch (e) {
					return {
						online: false,
						kind: "shell",
						capabilities: [],
						detail: { error: (e as Error).message },
					};
				}
			},

			exec: (cmd, opts) => exec(cmd, opts),

			fs: {
				read: async (p) => {
					const r = await exec(`base64 ${JSON.stringify(p)}`);
					if (r.exitCode !== 0) throw new Error(`fs.read "${p}" failed: ${r.stderr || r.stdout}`);
					return Buffer.from(r.stdout.trim(), "base64");
				},
				write: async (p, content) => {
					const b64 = Buffer.from(content).toString("base64");
					const r = await exec(`printf %s ${JSON.stringify(b64)} | base64 -d > ${JSON.stringify(p)}`);
					if (r.exitCode !== 0) throw new Error(`fs.write "${p}" failed: ${r.stderr}`);
				},
				access: async (p) => {
					try {
						const r = await exec(`test -e ${JSON.stringify(p)}`);
						return r.exitCode === 0;
					} catch {
						return false;
					}
				},
			},

			async close() {
				await conn.close();
			},
		};
		return node;
	}
}

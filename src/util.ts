import { type ChildProcess as NodeChildProcess } from "node:child_process";
import type { ChildProcessLike, ExecOptions, ExecResult } from "./types.js";

/**
 * 运行一个已 spawn 的子进程：收集 stdout/stderr、转发 onData、处理 timeout/signal。
 * transport 的 exec() 共用此逻辑。
 */
export function runChild(child: NodeChildProcess, opts: ExecOptions = {}): Promise<ExecResult> {
	return new Promise((resolve, reject) => {
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		let timedOut = false;

		const timer = opts.timeout
			? setTimeout(() => {
					timedOut = true;
					child.kill("SIGTERM");
				}, opts.timeout * 1000)
			: undefined;

		child.stdout?.on("data", (d: Buffer) => {
			stdoutChunks.push(d);
			opts.onData?.(d);
		});
		child.stderr?.on("data", (d: Buffer) => {
			stderrChunks.push(d);
			opts.onData?.(d);
		});

		const onAbort = () => child.kill("SIGTERM");
		opts.signal?.addEventListener("abort", onAbort, { once: true });

		child.on("error", (e) => {
			if (timer) clearTimeout(timer);
			opts.signal?.removeEventListener("abort", onAbort);
			reject(e);
		});
		child.on("close", (code) => {
			if (timer) clearTimeout(timer);
			opts.signal?.removeEventListener("abort", onAbort);
			if (opts.signal?.aborted) {
				resolve({ stdout: "", stderr: "", exitCode: code ?? null, aborted: true });
			} else if (timedOut) {
				resolve({
					stdout: Buffer.concat(stdoutChunks).toString(),
					stderr: Buffer.concat(stderrChunks).toString(),
					exitCode: null,
					timedOut: true,
				});
			} else {
				resolve({
					stdout: Buffer.concat(stdoutChunks).toString(),
					stderr: Buffer.concat(stderrChunks).toString(),
					exitCode: code ?? null,
				});
			}
		});
	});
}

/** 把 Node ChildProcess 适配为 pi-fleet 的 ChildProcessLike（给 spawn 能力用） */
export function toChildProcessLike(child: NodeChildProcess): ChildProcessLike {
	return {
		pid: child.pid ?? -1,
		stdin: {
			write: (data) => child.stdin?.write(data) ?? false,
			end: () => child.stdin?.end(),
		},
		stdout: child.stdout as unknown as NodeJS.ReadableStream,
		stderr: child.stderr as unknown as NodeJS.ReadableStream,
		kill: (signal) => child.kill(signal),
		exited: new Promise<number | null>((resolve) => {
			child.on("close", (c) => resolve(c ?? null));
		}),
	};
}

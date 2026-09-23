/**
 * Model Highlight Footer  (v4: 优化版)
 *
 * 底部状态栏三行：
 *   第1行   ~/cwd (branch) • session
 *   第2行   🫧 模型 │ 🧠 thinking │ ▰▰▰▱▱▱▱▱▱▱ 38%/128k │ ¥0.864 │ ↑5.2k ↓1.1k │ ⏱ 3.2s
 *   第3行   其他扩展 status
 *
 * v4 新增/优化：
 *   - 响应耗时：正在跑显示 ⏳，跑完显示 ⏱ 3.2s
 *   - 汇率：读 CNY_RATE 环境变量（默认 7.2），与 cny-display.py 一致
 *   - 加载自检：try/catch 兜底 + 启动通知；/model-bar status 查看诊断
 *   - 钱：始终显示（0 也显示 ¥0.000），黄色粗体
 *   - 上下文进度条：始终显示（未知显示 ?），<70% 绿 / 70-90% 黄 / >90% 红
 *
 * 启用：放 ~/.pi/agent/extensions/ 自动加载；当前会话 /reload 或重启 pi
 * 命令：/model-bar            开关（关掉恢复默认 footer）
 *       /model-bar status    显示诊断信息
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { relative, resolve, sep, isAbsolute } from "node:path";

// ---------- provider → 图标 ----------
const PROVIDER_ICON: Record<string, string> = {
	anthropic: "🤖",
	openai: "⚡",
	google: "✨",
	gemini: "✨",
	deepseek: "🐋",
	xai: "✕",
	openrouter: "🛰",
	mistral: "🌬",
	groq: "⚡",
	kimi: "🌙",
	"kimi-coding": "🌙",
	ppio: "🫧",
};

// ---------- thinking level → 专属主题色 ----------
const THINKING_COLOR: Record<string, string> = {
	off: "thinkingOff",
	minimal: "thinkingMinimal",
	low: "thinkingLow",
	medium: "thinkingMedium",
	high: "thinkingHigh",
	xhigh: "thinkingXhigh",
	max: "thinkingMax",
};

// ---------- 工具函数 ----------

// 与默认 footer 一致的 token 格式化
function formatTokens(c: number): string {
	if (c < 1000) return String(c);
	if (c < 10000) return `${(c / 1000).toFixed(1)}k`;
	if (c < 1000000) return `${Math.round(c / 1000)}k`;
	if (c < 10000000) return `${(c / 1000000).toFixed(1)}M`;
	return `${Math.round(c / 1000000)}M`;
}

// cwd → ~/... 缩写
function formatCwd(cwd: string, home?: string): string {
	if (!home) return cwd;
	const r = relative(resolve(home), resolve(cwd));
	const inside = r === "" || (r !== ".." && !r.startsWith(`..${sep}`) && !isAbsolute(r));
	if (!inside) return cwd;
	return r === "" ? "~" : `~${sep}${r}`;
}

// 汇率：CNY_RATE 环境变量，默认 7.2（与 cny-display.py 一致）
function cnyRate(): number {
	const v = parseFloat(process.env.CNY_RATE ?? "");
	return Number.isFinite(v) && v > 0 ? v : 7.2;
}

// 上下文进度条：10 格 ▰▱
function progressBar(percent: number | null): string {
	if (percent === null) return "░".repeat(10);
	const filled = Math.round(Math.min(100, Math.max(0, percent)) / 10);
	return "▰".repeat(filled) + "▱".repeat(10 - filled);
}

// 进度条颜色：<70 绿 / 70-90 黄 / >90 红
function barColor(percent: number | null): string {
	if (percent === null) return "dim";
	if (percent >= 90) return "error";
	if (percent >= 70) return "warning";
	return "success";
}

// ---------- usage 统计 ----------
interface Totals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

// 累加全 session（含压缩前历史 / tool usage / summary），与默认 footer 一致
function computeTotals(ctx: ExtensionContext): { totals: Totals; hitRate?: number } {
	const totals: Totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
	let hitRate: number | undefined;
	const sm = ctx.sessionManager as any;
	const entries = sm.getEntries?.() ?? sm.getBranch?.() ?? [];
	for (const e of entries) {
		let u: any;
		if (e?.type === "message" && e.message?.role === "assistant") {
			u = e.message.usage;
			if (u) {
				const pt = (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
				hitRate = pt > 0 ? ((u.cacheRead ?? 0) / pt) * 100 : hitRate;
			}
		} else if (e?.type === "message" && e.message?.role === "toolResult") {
			u = e.message.usage;
		} else if (e?.type === "branch_summary" || e?.type === "compaction") {
			u = e.usage;
		}
		if (!u) continue;
		totals.input += u.input ?? 0;
		totals.output += u.output ?? 0;
		totals.cacheRead += u.cacheRead ?? 0;
		totals.cacheWrite += u.cacheWrite ?? 0;
		totals.cost += u.cost?.total ?? 0;
	}
	return { totals, hitRate };
}

// ---------- 主扩展 ----------
export default function (pi: ExtensionAPI) {
	let tuiRef: { requestRender: () => void } | undefined;
	let warnedHighCtx = false;
	let bootNotified = false;

	// 响应耗时
	let turnStartAt = 0;
	let lastTurnMs: number | null = null;

	function installFooter(ctx: ExtensionContext) {
		ctx.ui.setFooter((tui: any, theme: any, footerData: any) => {
			tuiRef = tui;
			const unsub = footerData.onBranchChange(() => tui.requestRender());
			return {
				dispose: unsub,
				invalidate() {},
				render(width: number): string[] {
					const model = ctx.model;
					const { totals, hitRate } = computeTotals(ctx);
					const usage = ctx.getContextUsage();
					const ctxWindow = usage?.contextWindow ?? (model as any)?.contextWindow ?? 0;
					const percent = usage?.percent ?? null;

					// ---- 第 1 行：cwd (branch) • session ----
					const sm = ctx.sessionManager as any;
					let pwd = formatCwd(ctx.cwd, process.env.HOME || process.env.USERPROFILE);
					const branch = footerData.getGitBranch?.();
					if (branch) pwd = `${pwd} (${branch})`;
					const sname = sm.getSessionName?.();
					if (sname) pwd = `${pwd} • ${sname}`;
					const pwdLine = truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "..."));

					// ---- 第 2 行：高亮状态条 ----
					const segs: string[] = [];

					// ① 模型：图标 + accent 粗体
					const icon = (model && PROVIDER_ICON[String(model.provider)]) || "🧠";
					segs.push(`${icon} ` + theme.fg("accent", theme.bold(model?.id ?? "no-model")));

					// ② 思考强度：专属色
					const level = String(ctx.thinkingLevel ?? "off");
					if ((model as any)?.reasoning) {
						segs.push(theme.fg(THINKING_COLOR[level] ?? "thinkingLow", `🧠 ${level}`));
					}

					// ③ 上下文进度条：始终显示（未知显示 ?），动态变色
					const bar = progressBar(percent);
					const pctTxt = percent === null ? "?" : `${Math.round(percent)}%`;
					const winTxt = ctxWindow ? `/${formatTokens(ctxWindow)}` : "";
					segs.push(theme.fg(barColor(percent), `${bar} ${pctTxt}${winTxt}`));

					// ④ 钱：¥(USD×汇率) 始终显示，黄色粗体醒目
					segs.push(theme.fg("warning", theme.bold(`¥${(totals.cost * cnyRate()).toFixed(3)}`)));

					// ⑤ token 统计：dim
					const tokParts: string[] = [];
					if (totals.input) tokParts.push(`↑${formatTokens(totals.input)}`);
					if (totals.output) tokParts.push(`↓${formatTokens(totals.output)}`);
					if (totals.cacheRead) tokParts.push(`R${formatTokens(totals.cacheRead)}`);
					if (totals.cacheWrite) tokParts.push(`W${formatTokens(totals.cacheWrite)}`);
					if ((totals.cacheRead > 0 || totals.cacheWrite > 0) && hitRate !== undefined) {
						tokParts.push(`CH${hitRate.toFixed(1)}%`);
					}
					if (tokParts.length) segs.push(theme.fg("dim", tokParts.join(" ")));

					// ⑥ 响应耗时：正在跑 ⏳ / 完成 ⏱ X.Xs
					if (turnStartAt > 0) {
						segs.push(theme.fg("accent", "⏳"));
					} else if (lastTurnMs !== null) {
						segs.push(theme.fg("dim", `⏱ ${(lastTurnMs / 1000).toFixed(1)}s`));
					}

					const sep = theme.fg("dim", " │ ");
					const line2 = truncateToWidth(segs.join(sep), width);

					// ---- 第 3 行：扩展 status（如有）----
					const lines = [pwdLine, line2];
					const ext = footerData.getExtensionStatuses?.();
					if (ext && ext.size > 0) {
						const s = Array.from(ext.values())
							.join(" ")
							.replace(/[\r\n\t]+/g, " ")
							.replace(/ +/g, " ")
							.trim();
						lines.push(truncateToWidth(s, width, theme.fg("dim", "...")));
					}
					return lines;
				},
			};
		});
	}

	// ---------- 启动安装（仅 TUI）+ 自检 ----------
	pi.on("session_start", (_e, ctx) => {
		if (ctx.mode !== "tui") return;
		warnedHighCtx = false;
		lastTurnMs = null;
		try {
			installFooter(ctx);
			if (!bootNotified && ctx.hasUI) {
				bootNotified = true;
				ctx.ui.notify("✅ 高亮状态栏已接管 footer（钱/进度条/耗时）", "info");
			}
		} catch (err) {
			console.error("[model-highlight] 加载失败:", err);
			if (ctx.hasUI) {
				ctx.ui.notify(`model-highlight 加载失败: ${(err as Error).message}`, "error");
			}
		}
	});

	// ---------- 模型切换：提示 + 重绘 ----------
	pi.on("model_select", (e, ctx) => {
		if (e.source !== "restore" && ctx.hasUI) {
			ctx.ui.notify(`模型 → ${e.model.provider}/${e.model.id}`, "info");
		}
		warnedHighCtx = false;
		tuiRef?.requestRender();
	});

	// ---------- thinking 切换：重绘 ----------
	pi.on("thinking_level_select", () => {
		tuiRef?.requestRender();
	});

	// ---------- 响应耗时 ----------
	pi.on("turn_start", () => {
		turnStartAt = Date.now();
		tuiRef?.requestRender(); // 立即显示 ⏳
	});

	pi.on("turn_end", () => {
		if (turnStartAt > 0) {
			lastTurnMs = Date.now() - turnStartAt;
			turnStartAt = 0;
		}
		tuiRef?.requestRender();
	});

	// ---------- context 过高提醒一次 ----------
	pi.on("turn_end", (_e, ctx) => {
		if (!ctx.hasUI) return;
		const u = ctx.getContextUsage();
		if (u && u.percent !== null && u.percent >= 90 && !warnedHighCtx) {
			warnedHighCtx = true;
			ctx.ui.notify(`Context 已用 ${Math.round(u.percent)}%，建议 /compact`, "warning");
		}
	});

	// ---------- 会话结束清理 ----------
	pi.on("session_shutdown", () => {
		tuiRef = undefined;
	});

	// ---------- 命令：开关 / 诊断 ----------
	pi.registerCommand("model-bar", {
		description: "开关模型高亮状态栏；`/model-bar status` 查看诊断",
		handler: async (args, ctx) => {
			if (args === "status") {
				const u = ctx.getContextUsage();
				const model = ctx.model;
				const status = [
					`接管 footer: ${tuiRef ? "是 ✓" : "否（当前为默认 footer）"}`,
					`模型: ${model ? `${model.provider}/${model.id}` : "无"}`,
					`thinking: ${ctx.thinkingLevel ?? "off"}`,
					`汇率 CNY_RATE: ${cnyRate()}${process.env.CNY_RATE ? "" : "（默认 7.2）"}`,
					`context: ${u?.percent !== null && u?.percent !== undefined ? `${Math.round(u.percent)}%` : "未知"} / ${u?.contextWindow ?? "?"}`,
					`上次响应: ${lastTurnMs !== null ? `${(lastTurnMs / 1000).toFixed(1)}s` : "无"}`,
				];
				ctx.ui.notify(status.join("  ·  "), "info");
				return;
			}
			if (tuiRef) {
				ctx.ui.setFooter(undefined);
				tuiRef = undefined;
				ctx.ui.notify("已恢复默认 footer", "info");
			} else {
				installFooter(ctx);
				ctx.ui.notify("模型高亮状态栏已开启", "info");
			}
		},
	});
}

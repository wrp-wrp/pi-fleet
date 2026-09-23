/**
 * LaTeX Math Renderer (v1)
 *
 * 把回复中的 LaTeX 公式（$$...$$ 块级、$...$ 行内）在终端里渲染成
 * Unicode 美化公式（带代码样式背景，视觉上区别于正文）。
 *
 * 实现：pi.registerMarkdownTransformer —— 显示层转换，不改动原始消息。
 * 支持：\frac \sqrt \sum \int \nabla \partial 希腊字母 上下标 矩阵等。
 *
 * 启用：放 ~/.pi/agent/extensions/ 自动加载；当前会话 /reload 或重启 pi
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ---------- Unicode 映射 ----------
const GREEK: Record<string, string> = {
	alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε",
	zeta: "ζ", eta: "η", theta: "θ", iota: "ι", kappa: "κ",
	lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π",
	rho: "ρ", sigma: "σ", tau: "τ", upsilon: "υ", phi: "φ",
	chi: "χ", psi: "ψ", omega: "ω",
	Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ",
	Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
	nabla: "∇", partial: "∂", infty: "∞", emptyset: "∅",
};

const OPS: Record<string, string> = {
	times: "×", cdot: "·", pm: "±", mp: "∓",
	leq: "≤", geq: "≥", le: "≤", ge: "≥", neq: "≠", approx: "≈", equiv: "≡",
	rightarrow: "→", leftarrow: "←", leftarrow_lt: "←", Rightarrow: "⇒", Leftarrow: "⇐",
	mapsto: "↦", sim: "∼", propto: "∝", mid: "|",
	in: "∈", notin: "∉", subset: "⊂", supset: "⊃",
	subseteq: "⊆", supseteq: "⊇", cup: "∪", cap: "∩",
	oplus: "⊕", otimes: "⊗", sum: "Σ", prod: "Π",
	int: "∫", oint: "∮", sqrt: "√",
	ldots: "…", cdots: "⋯", vdots: "⋮", ddots: "⋱",
	forall: "∀", exists: "∃", neg: "¬", wedge: "∧", vee: "∨",
	mid: "|", vert: "|", parallel: "‖",
};

const SUPS: Record<string, string> = {
	"0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
	"5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
	"+": "⁺", "−": "⁻", "=": "⁼", "(": "⁽", ")": "⁾",
	n: "ⁿ", i: "ⁱ", T: "ᵀ", "*": "∗", k: "ᵏ", a: "ᵃ", b: "ᵇ", e: "ᵉ", d: "ᵈ", m: "ᵐ", o: "ᵒ", r: "ʳ", s: "ˢ", t: "ᵗ", u: "ᵘ", v: "ᵛ", w: "ʷ", x: "ˣ", y: "ʸ", l: "ˡ", c: "ᶜ", f: "ᶠ", g: "ᵍ", h: "ʰ", j: "ʲ", p: "ᵖ", z: "ᶻ",
};

const SUBS: Record<string, string> = {
	"0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄",
	"5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
	"+": "₊", "−": "₋", "(": "₍", ")": "₎",
	i: "ᵢ", j: "ⱼ", n: "ₙ", k: "ₖ", x: "ₓ", t: "ₜ",
	o: "ₒ", r: "ᵣ", m: "ₘ", l: "ₗ", p: "ₚ", s: "ₛ", v: "ᵥ", a: "ₐ", e: "ₑ", h: "ₕ", u: "ᵤ", w: "w", z: "z", c: "c", d: "d", f: "f", g: "g", b: "b",
};

// ---------- 工具函数 ----------
function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 平衡括号提取：从 pos 开始找 {…} 的内容（支持嵌套），返回 [content, nextPos]
function extractBrace(s: string, pos: number): [string, number] | null {
	if (s[pos] !== "{") return null;
	let depth = 0;
	for (let i = pos; i < s.length; i++) {
		if (s[i] === "{") depth++;
		else if (s[i] === "}") {
			depth--;
			if (depth === 0) return [s.slice(pos + 1, i), i + 1];
		}
	}
	return null;
}

// 提取一个"参数"：{…} 或单字符
function extractArg(s: string, pos: number): [string, number] | null {
	// 跳过空白
	while (pos < s.length && /\s/.test(s[pos])) pos++;
	const br = extractBrace(s, pos);
	if (br) return br;
	if (pos < s.length && !/[\\\s]/.test(s[pos])) return [s[pos], pos + 1];
	return null;
}

// 提取 \frac{a}{b} 或 \frac a b；\binom{n}{k} 二项式系数
function convertFrac(s: string): string {
	// 循环处理所有 frac/binom（支持嵌套：内层已先转换）
	let prev = "";
	while (prev !== s) {
		prev = s;
		for (const cmd of ["dfrac", "tfrac", "frac", "binom"]) {
			let idx: number;
			while ((idx = s.indexOf("\\" + cmd)) !== -1) {
				const afterCmd = idx + cmd.length + 1;
				const a = extractArg(s, afterCmd);
				if (!a) { s = s.slice(0, idx) + "?" + s.slice(idx + cmd.length + 1); break; }
				const b = extractArg(s, a[1]);
				if (!b) { s = s.slice(0, idx) + "?" + s.slice(idx + cmd.length + 1); break; }
				const sym = cmd === "binom" ? `C(${a[0]},${b[0]})` : `(${a[0]})/(${b[0]})`;
				s = s.slice(0, idx) + sym + s.slice(b[1]);
			}
		}
	}
	return s;
}

// 提取 \sqrt{...} 或 \sqrt{...}[n]
function convertSqrt(s: string): string {
	return s.replace(/\\sqrt\[([^\]]*)\]\s*\{([^{}]*)\}/g, (_, n, body) => `${n}√(${body})`)
	        .replace(/\\sqrt\s*\{([^{}]*)\}/g, (_, body) => `√(${body})`);
}

// 上标 / 下标（支持嵌套 {…} 与单字符，先内层递归已处理）
function convertScript(s: string): string {
	// 只有全部字符都有映射才用 Unicode 上/下标；否则用 ^(...) 记号
	const supAll = (t: string) => t.split("").every(c => SUPS[c] !== undefined);
	const subAll = (t: string) => t.split("").every(c => SUBS[c] !== undefined);
	const sup = (t: string) => t.split("").map(c => SUPS[c] ?? "").join("");
	const sub = (t: string) => t.split("").map(c => SUBS[c] ?? "").join("");
	// 处理 ^{…} 与 _{…}（嵌套内容先由外层循环处理）
	let prev = "";
	while (prev !== s) {
		prev = s;
		s = s.replace(/\^\{([^{}]+)\}/g, (_, inner) => {
			return supAll(inner) ? sup(inner) : `^(${inner})`;
		});
		s = s.replace(/_\{([^{}]+)\}/g, (_, inner) => {
			return subAll(inner) ? sub(inner) : `_(${inner})`;
		});
	}
	// 单字符 ^x / _x
	s = s.replace(/\^([A-Za-z0-9+\-=\*])(?!\w)/g, (_, c) => SUPS[c] ?? c);
	s = s.replace(/_([A-Za-z0-9+\-=])(?!\w)/g, (_, c) => SUBS[c] ?? c);
	return s;
}


// 矩阵 \begin{bmatrix}...\end{bmatrix} → 单行表示
function convertMatrix(s: string): string {
	return s.replace(/\\begin\{bmatrix\}([\s\S]*?)\\end\{bmatrix\}/g, (_, inner) => {
		const rows = inner.split(/\\\\/).map((r: string) => r.replace(/\s+/g, " ").trim());
		const cols = rows.map((r: string) => r.split("&").map((c: string) => c.trim()));
		const maxCols = Math.max(...cols.map((c: string[]) => c.length));
		// 每列宽度对齐
		const widths: number[] = [];
		for (let j = 0; j < maxCols; j++) {
			widths[j] = Math.max(...cols.map(c => (c[j] ?? "").length));
		}
		const lines = cols.map((row: string[]) =>
			row.map((c, j) => c.padStart(widths[j] ?? 0)).join("  ")
		);
		// 多行矩阵整体加括号（行首行尾用 ┌┐/└┘，中间用 │，无多余空行）
		if (lines.length > 1) {
			return lines.map((l, i) => {
				if (i === 0) return `┌ ${l} ┐`;
				if (i === lines.length - 1) return `└ ${l} ┘`;
				return `│ ${l} │`;
			}).join("\n");
		}
		return `[ ${lines[0]} ]`;
	});
}

// 单行矩阵（小矩阵用 inline 形式）
function convertSmallMatrix(s: string): string {
	return s.replace(/\\begin\{pmatrix\}([\s\S]*?)\\end\{pmatrix\}/g, (_, inner) => {
		return "(" + inner.replace(/\\\\/g, "; ").replace(/&/g, " ").trim() + ")";
	}).replace(/\\begin\{vmatrix\}([\s\S]*?)\\end\{vmatrix\}/g, (_, inner) => {
		return "|" + inner.replace(/\\\\/g, "; ").replace(/&/g, " ").trim() + "|";
	});
}

// 命令转换：\sum_{i=1}^{n} → Σ(i=1..n)
function convertCommands(s: string): string {
	// 求和/积分等带上下限的
	s = s.replace(/\\sum\s*_\{([^{}]*)\}\s*\^\{([^{}]*)\}/g, (_, lo, hi) => `Σ[${lo}..${hi}]`)
	     .replace(/\\sum\s*_\{([^{}]*)\}/g, (_, lo) => `Σ[${lo}]`)
	     .replace(/\\prod\s*_\{([^{}]*)\}\s*\^\{([^{}]*)\}/g, (_, lo, hi) => `Π[${lo}..${hi}]`)
	     .replace(/\\int\s*_\{([^{}]*)\}\s*\^\{([^{}]*)\}/g, (_, lo, hi) => `∫[${lo},${hi}]`)
	     .replace(/\\int\s*_\{([^{}]*)\}/g, (_, lo) => `∫[${lo}]`)
	     .replace(/\\int\s*\^\{([^{}]*)\}/g, (_, hi) => `∫^[${hi}]`)
	     .replace(/\\sum\s*_([^{}\\s])\s*\^([^{}\\s])/g, (_, lo, hi) => `Σ[${lo}..${hi}]`)
	     .replace(/\\int\s*_([0-9a-zA-Z]+)\s*\^([0-9a-zA-Z]+)/g, (_, lo, hi) => `∫[${lo},${hi}]`)
	     .replace(/\\int\s*_([0-9a-zA-Z]+)/g, (_, lo) => `∫[${lo}]`)
	     .replace(/\\int\s*\^([0-9a-zA-Z]+)/g, (_, hi) => `∫^[${hi}]`);
	// 希腊字母（长命令先替换，避免 \in 抢先 \int 等）
	for (const [cmd, sym] of Object.entries(GREEK).sort((a, b) => b[0].length - a[0].length)) {
		s = s.split(`\\${cmd}`).join(sym);
	}
	// 运算符
	for (const [cmd, sym] of Object.entries(OPS).sort((a, b) => b[0].length - a[0].length)) {
		s = s.split(`\\${cmd}`).join(sym);
	}
	return s;
}

// 清理残留 LaTeX 语法
function cleanup(s: string): string {
	return s
		.replace(/\\left/g, "").replace(/\\right/g, "")
		.replace(/\\big/g, "").replace(/\\Big/g, "")
		.replace(/\\quad/g, "  ").replace(/\\qquad/g, "    ")
		.replace(/\\,|\\;/g, " ").replace(/\\:/g, " ")
		.replace(/\\!/g, "")
		.replace(/\\text\{([^{}]*)\}/g, "$1")
		.replace(/\\mathrm\{([^{}]*)\}/g, "$1")
		.replace(/\\mathbf\{([^{}]*)\}/g, "$1")
		.replace(/\\mathbb\{([^{}]*)\}/g, (_, c) => {
			const BB: Record<string, string> = { R: "ℝ", N: "ℕ", Z: "ℤ", Q: "ℚ", C: "ℂ", P: "ℙ", E: "𝔼" };
			return BB[c] ?? c;
		})
		.replace(/\\mathit\{([^{}]*)\}/g, "$1")
		.replace(/\\operatorname\{([^{}]*)\}/g, "$1")
		.replace(/\\{/g, "{").replace(/\\}/g, "}")
		.replace(/\{\}/g, "")
		.replace(/\\\s+/g, " ")
		// 每行内压缩连续空格，但保留换行（矩阵多行不合并）；
		// 矩阵行（含 ┌│└）不压缩空格，保持列对齐
		.split("\n").map(l => {
			if (/[┌│└]/.test(l)) return l.replace(/\s+$/g, "").replace(/^\s+/, "");
			return l.replace(/\s+/g, " ").trim();
		}).join("\n")
		.trim();
}

// 主转换：一段 LaTeX → Unicode 美化
function latexToUnicode(src: string): string {
	let s = src
		.replace(/^\s+|\s+$/g, "")
		.replace(/^\\\[|\\\]$/g, "")
		.trim();
	s = convertSmallMatrix(s);
	s = convertMatrix(s);
	s = convertFrac(s);
	s = convertSqrt(s);
	s = convertCommands(s);
	s = convertScript(s);
	s = cleanup(s);
	return s;
}

// 是否应该处理（跳过 streaming 中间态，避免闪烁）
function shouldTransform(messageType: string, isStreaming: boolean): boolean {
	if (isStreaming) return false;
	if (messageType === "assistant-thinking") return false;
	return true;
}

// ---------- 扩展入口 ----------
export default function (pi: ExtensionAPI) {
	try {
		pi.registerMarkdownTransformer((markdown, { messageType, isStreaming }) => {
			if (!shouldTransform(messageType, isStreaming)) return markdown;

			let out = markdown;

			// 块级公式 $$...$$
			out = out.replace(/\$\$\s*([\s\S]*?)\s*\$\$/g, (_, formula) => {
				const u = latexToUnicode(formula);
				return `\n\`\`\`math\n${u}\n\`\`\`\n`;
			});

			// 行内公式 $...$（避免误伤 $$、LaTeX 命令里的 $ 等）
			// 表格行（含 |）内的公式只转 Unicode 不加反引号，避免破坏表格结构
			out = out.split("\n").map(line => {
				if (!line.includes("$")) return line;
				const isTableRow = line.includes("|");
				const wrapped = line.replace(/(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)/g, (_, formula) => {
					const u = latexToUnicode(formula);
					return isTableRow ? u : `\`${u}\``;
				});
				return wrapped;
			}).join("\n");

			return out;
		});

		console.log("[math-render] LaTeX → Unicode renderer loaded");
	} catch (e) {
		console.error("[math-render] failed to load:", e);
	}
}

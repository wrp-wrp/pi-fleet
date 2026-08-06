#!/usr/bin/env python3
"""
把 pi + pi-spark 的费用从美元($数值)真实换算成人民币(¥数值 × 汇率)。
仅改显示，不动计费逻辑。幂等（从 .cny.bak 恢复原始再应用，可重复运行）。
`pi update` / `pi update --extensions` 后重跑一次。

汇率默认 7.2，可用环境变量覆盖：CNY_RATE=7.25 python3 cny-display.py
"""
import os
import shutil
import subprocess
from pathlib import Path

HOME = Path.home()
RATE = float(os.environ.get("CNY_RATE", "7.2"))  # USD → CNY


def find_pi_dist():
	try:
		out = subprocess.run(
			["npm", "root", "-g"], capture_output=True, text=True, check=True
		).stdout.strip()
		base = Path(out) / "@earendil-works/pi-coding-agent/dist"
		return base if base.is_dir() else None
	except Exception:
		return None


def groups():
	pi_dist = find_pi_dist()
	g = []
	if pi_dist:
		g.append(
			(
				pi_dist,
				{
					"modes/interactive/components/footer.js": ["usageTotals.cost"],
					"modes/interactive/interactive-mode.js": [
						"miss.missedCost",
						"stats.cost",
						"entry.cost",
						"cacheWaste.missedCost",
					],
					"core/export-html/template.js": ["totalCost"],
				},
			)
		)
	else:
		print("⚠️  找不到 pi dist")
	spark = HOME / ".pi/agent/npm/node_modules/pi-spark/src"
	if spark.is_dir():
		g.append((spark, {"utils/format.ts": ["cost"]}))
	return g


def patch_file(path, vars):
	if not path.exists():
		print(f"  ⚠️ 缺失: {path}（跳过）")
		return 0
	bak = path.with_suffix(path.suffix + ".cny.bak")
	if bak.exists():
		shutil.copy(bak, path)  # 恢复原始，保证幂等
	else:
		shutil.copy(path, bak)  # 首次备份
	txt = path.read_text(encoding="utf-8")
	n = 0
	for v in vars:
		# `$${var.toFixed(` → `¥${(var*RATE).toFixed(`
		old = f"$${{{v}.toFixed("
		new = f"¥${{({v}*{RATE}).toFixed("
		n += txt.count(old)
		txt = txt.replace(old, new)
	path.write_text(txt, encoding="utf-8")
	return n


def main():
	print(f"汇率: 1 USD = {RATE} CNY（CNY_RATE 可改）")
	total = 0
	for base, targets in groups():
		print(f"\n# {base}")
		for rel, vars in targets.items():
			n = patch_file(base / rel, vars)
			print(f"  {'✅' if n else '—'} {rel}: {n} 处")
			total += n
	print(f"\n完成。共替换 {total} 处。【重启 pi】生效。")


if __name__ == "__main__":
	main()

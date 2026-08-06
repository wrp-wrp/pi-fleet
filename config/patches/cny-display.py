#!/usr/bin/env python3
"""
把 pi + pi-spark 的费用符号 $ 改为 ¥（仅显示）。
幂等，可重复运行。`pi update` 或 `pi update --extensions` 后重跑一次即可。

自动探测 pi 安装目录（npm root -g），本机 / nvm / 任何机器通用。
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path

HOME = Path.home()


def find_pi_dist():
	"""经 npm root -g 找 pi 的 dist 目录。"""
	try:
		out = subprocess.run(
			["npm", "root", "-g"], capture_output=True, text=True, check=True
		).stdout.strip()
		base = Path(out) / "@earendil-works/pi-coding-agent/dist"
		return base if base.is_dir() else None
	except Exception:
		return None


# (base, {相对文件: [变量]})，替换 `$${var.toFixed(` → `¥${var.toFixed(`
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
		print("⚠️  找不到 pi dist（npm root -g 下无 pi-coding-agent）")
	# pi-spark 的 formatCost（footer 用它显示 cost）
	spark = HOME / ".pi/agent/npm/node_modules/pi-spark/src"
	if spark.is_dir():
		g.append((spark, {"utils/format.ts": ["cost"]}))
	return g


def patch_file(path, vars):
	if not path.exists():
		print(f"  ⚠️ 缺失: {path}（pi/spark 版本变了？跳过）")
		return 0
	bak = path.with_suffix(path.suffix + ".cny.bak")
	if not bak.exists():
		shutil.copy(path, bak)
	txt = path.read_text(encoding="utf-8")
	n = 0
	for v in vars:
		old = f"$${{{v}.toFixed("
		new = f"¥${{{v}.toFixed("
		n += txt.count(old)
		txt = txt.replace(old, new)
	path.write_text(txt, encoding="utf-8")
	return n


def main():
	total = 0
	for base, targets in groups():
		print(f"\n# {base}")
		for rel, vars in targets.items():
			n = patch_file(base / rel, vars)
			print(f"  {'✅' if n else '—'} {rel}: {n} 处")
			total += n
	print(f"\n完成。共替换 {total} 处。")
	print("【重启 pi】生效；`pi update` / `pi update --extensions` 后重跑本脚本。")


if __name__ == "__main__":
	main()

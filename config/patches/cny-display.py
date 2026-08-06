#!/usr/bin/env python3
"""
将 pi 底部状态栏 / 统计 / HTML 导出中的费用符号从 $ 改为 ¥。
可重复运行（幂等）。每次 `pi update` 后再跑一次即可。

原理：pi 没有内置货币符号设置，$ 是硬编码在 dist 里的。
本脚本把 `${<变量>.toFixed(` 前的货币符号 $ 替换为 ¥，仅改显示，不改逻辑。
"""
import os, sys

BASE = os.path.expanduser(
    "~/.npm-global/lib/node_modules/@earendil-works/pi-coding-agent/dist"
)

# 文件 -> 要替换的"成本变量"列表（每个变量在文件里唯一）
TARGETS = {
    "modes/interactive/components/footer.js": ["usageTotals.cost"],
    "modes/interactive/interactive-mode.js": [
        "miss.missedCost",
        "stats.cost",
        "entry.cost",
        "cacheWaste.missedCost",
    ],
    "core/export-html/template.js": ["totalCost"],
}


def main():
    if not os.path.isdir(BASE):
        print(f"❌ 找不到 pi 安装目录: {BASE}")
        print("   如果 pi 装在别处，请改本脚本的 BASE。")
        sys.exit(1)

    total = 0
    for rel, vars in TARGETS.items():
        path = os.path.join(BASE, rel)
        if not os.path.exists(path):
            print(f"⚠️  缺失文件: {rel}（pi 版本可能变了，跳过）")
            continue
        # 仅在无备份时备份，保留原始 $ 版本
        bak = path + ".cny.bak"
        if not os.path.exists(bak):
            import shutil
            shutil.copy(path, bak)
        txt = open(path, encoding="utf-8").read()
        n = 0
        for v in vars:
            old = f"$${{{v}.toFixed("
            new = f"¥${{{v}.toFixed("
            n += txt.count(old)
            txt = txt.replace(old, new)
        open(path, "w", encoding="utf-8").write(txt)
        status = "✅" if n else "—（已是¥，无需改动）"
        print(f"{status} {rel}: {n} 处")
        total += n
    print(f"\n完成。共替换 {total} 处。")
    print("提示：需要【重启 pi】才生效；`pi update` 后重新运行本脚本。")


if __name__ == "__main__":
    main()

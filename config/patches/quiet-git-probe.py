#!/usr/bin/env python3
"""
静默 pi-memory-extension 的 git 探测报错。

问题：pi-memory.ts 用 execSync("git rev-parse --show-toplevel") 查找仓库根，
非 git 目录下 git 会把 "fatal: not a git repository" 打到 stderr，污染 pi 界面。
修法：给该 execSync 调用加 stdio: ["ignore", "pipe", "ignore"]，逻辑与返回值不变。

可重复运行（幂等）。扩展更新后再跑一次即可。
"""
import os
import sys

PATH = os.path.expanduser(
    "~/.pi/agent/npm/node_modules/pi-memory-extension/pi-memory.ts"
)

OLD = '''execSync("git rev-parse --show-toplevel", {
      cwd: from,
      encoding: "utf-8",
      timeout: 3000,
    })'''

NEW = '''execSync("git rev-parse --show-toplevel", {
      cwd: from,
      encoding: "utf-8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    })'''


def main():
    if not os.path.exists(PATH):
        print(f"❌ 找不到文件: {PATH}")
        sys.exit(1)
    txt = open(PATH, encoding="utf-8").read()
    if '"ignore", "pipe", "ignore"' in txt:
        print("—（已打过补丁，无需改动）")
        return
    n = txt.count(OLD)
    if n == 0:
        print("⚠️  未找到目标代码（扩展版本可能变了，请检查）")
        sys.exit(1)
    txt = txt.replace(OLD, NEW)
    open(PATH, "w", encoding="utf-8").write(txt)
    print(f"✅ 已静默 {n} 处 git stderr 输出。重启 pi 生效。")


if __name__ == "__main__":
    main()

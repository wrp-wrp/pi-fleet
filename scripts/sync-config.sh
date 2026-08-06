#!/usr/bin/env bash
# 把 pi-fleet 仓库的 config/ 软链到 ~/.pi/agent/
# 跨机器同步 pi 配置（不含凭据/sessions/包）
# 用法: ./scripts/sync-config.sh
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$REPO/config"
DST="$HOME/.pi/agent"

if [ ! -d "$SRC" ]; then
	echo "✗ 找不到 $SRC（确认在 pi-fleet 仓库内运行）" >&2
	exit 1
fi

mkdir -p "$DST"
linked=0
while IFS= read -r -d '' file; do
	rel="${file#$SRC/}"
	target="$DST/$rel"
	mkdir -p "$(dirname "$target")"
	# 备份已存在的真实文件（非软链），避免覆盖本地改动
	if [ -e "$target" ] && [ ! -L "$target" ]; then
		bak="$target.bak.$(date +%s)"
		mv "$target" "$bak"
		echo "  ↳ 备份 existing → $(basename "$target").bak.*"
	fi
	ln -sfn "$file" "$target"
	echo "✓ $rel"
	linked=$((linked + 1))
done < <(find "$SRC" -type f -print0)

echo ""
echo "已软链 $linked 个配置到 $DST"
echo "下一步："
echo "  1. pi update --extensions     # 按 settings.json 的 packages 装/更新插件"
echo "  2. 配凭据：export PPIO_API_KEY=...  或填 ~/.pi/agent/auth.json"
echo "  3. pi                         # 启动"

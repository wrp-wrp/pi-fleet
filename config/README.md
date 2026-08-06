# pi 配置同步

本目录是 pi 用户配置（`~/.pi/agent/` 的可同步部分），随 pi-fleet 仓库跨机器同步。
让 india / jp / sg 等机器都有**一致的 pi 环境**。

## 包含

| 文件 | 作用 |
|------|------|
| `settings.json` | **插件列表（packages）+ 默认模型 + 主题** ← 同步核心 |
| `models.json` | 自定义 provider 定义（key 用 `$ENV` 引用，不含明文） |
| `fleet.json` | pi-fleet 节点配置 |
| `subagents.json` + `subagents/` | 子代理配置与定义 |
| `extension-settings/` | 插件配置（pi-tree、pi-ui-tweaks） |
| `extensions/pi-permission-system/config.json` | 安全 gate policy |
| `auto-update.json` | 插件自动更新设置 |
| `patches/` | 自定义补丁脚本 |

## 不包含（敏感 / 机器特定）

- `auth.json` —— 凭据（OAuth token / API key），**各自配，不进 git**
- `sessions/` —— 会话历史
- `git/` `npm/` —— 插件包本身（靠 `pi update --extensions` 按 settings.json 装）
- `models-store.json` —— pi 自动刷新的缓存

## 部署到新机器

```bash
# 1. 装 pi（需 node ≥ 22）
npm install -g @earendil-works/pi-coding-agent

# 2. 拉本仓库 + 软链配置
git clone git@github.com:wrp-wrp/pi-fleet.git ~/pi-fleet
cd ~/pi-fleet && ./scripts/sync-config.sh

# 3. 按配置装插件
pi update --extensions

# 4. 配凭据（各自）
export PPIO_API_KEY=...        # 或填 ~/.pi/agent/auth.json

# 5. 启动
pi
```

## 改配置后同步到其他机器

本机改了配置（软链指向这里）→ `git commit && git push` → 其他机器 `git pull` 即生效（插件增删再 `pi update --extensions`）。

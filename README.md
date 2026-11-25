# DSH 插件实习项目

本仓库用于交付 DeepSeek Harness 的插件源码、测试、运行证据和实验报告。项目范围包括必选 A 搜索工具与 turn 日志、B1 识图、B2 上下文压缩、B3 Deep Research，以及 B3 的人工确认和自动审阅重写。

## 已验证的上游基线

- 上游版本为 `dsh-v0.2.2-rc.5`，固定 commit 为 `9c2670d3bce5275e0d1610272958121af87787bb`。[上游 commit](https://github.com/deepseek-ai/deepseek-harness/commit/9c2670d3bce5275e0d1610272958121af87787bb)
- 在 Windows 使用 Node.js `24.18.0` 和 pnpm `11.28.5` 完成依赖安装。完整构建通过，10 个构建检查全部成功。
- [Web profile 配置导出](evidence/web-baseline/DSH-web-profile.yml)和[简化插件树](evidence/web-baseline/DSH-web-plugin-tree.md)记录了原生 Web profile 的配置。在插件接入后，用演示时的同一 profile 和 patch 参数重新导出交付版插件树。

## 从源码启动原生 Web

在交付仓库根目录运行。以下命令使用 Windows PowerShell 和 Corepack。

```powershell
New-Item -ItemType Directory -Force -Path .\upstream | Out-Null
git clone --depth 1 --branch dsh-v0.2.2-rc.5 https://github.com/deepseek-ai/deepseek-harness.git .\upstream\deepseek-harness
if ($LASTEXITCODE -ne 0) { throw 'DeepSeek Harness clone failed.' }

$revision = git -C .\upstream\deepseek-harness rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or $revision -ne '9c2670d3bce5275e0d1610272958121af87787bb') {
    throw 'Unexpected DeepSeek Harness revision.'
}

Set-Location -LiteralPath .\upstream\deepseek-harness
Get-Content -LiteralPath .\SAFETY.md
```

读完 `SAFETY.md` 后，在上游源码目录安装、构建和启动。

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm run build
corepack pnpm run dsh web --no-open
```

已有同一 commit 的检出时，可以直接进入该目录。若依赖和构建产物已就绪，也可以执行 `.\node_modules\.bin\pnpm.CMD run dsh web --no-open` 启动。

打开终端打印的地址，在 Web 中选择工作区，再通过「设置 → 模型」配置模型，或从启动终端提供 `DEEPSEEK_API_KEY`。在上游源码目录运行 `corepack pnpm run dsh --profile web --dump-config` 可导出原生配置。

## 目录结构

```text
plugin/                 插件源码和 profile patch
tests/                  插件测试及实验样例
evidence/web-baseline/   上游 Web profile 配置和插件树
experiments/            B1–B3 对照数据和实验报告
WORKFLOW.md             本地开发记录与 AI 协作复盘
```

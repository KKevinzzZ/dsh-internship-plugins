# DSH 插件实习项目

本仓库用于交付 DeepSeek Harness 的插件源码、测试和实验报告。项目范围包括必选 A 搜索工具与 turn 日志、B1 识图、B2 上下文压缩、B3 Deep Research，以及 B3 的人工确认和自动审阅重写。

## 首次准备

上游要求 Node.js `24.9.0` 或更高版本，并指定使用 pnpm `11.28.5`。以下命令使用 Windows PowerShell。从交付仓库根目录把上游克隆到同级目录。已有检出时直接核对版本即可。

```powershell
git clone --depth 1 --branch dsh-v0.2.2-rc.5 https://github.com/deepseek-ai/deepseek-harness.git ..\deepseek-harness
git -C ..\deepseek-harness rev-parse HEAD
```

确认 commit 为 `9c2670d3bce5275e0d1610272958121af87787bb` 并读完 `SAFETY.md` 后，进入上游源码目录构建。

```powershell
Set-Location '..\deepseek-harness'
pnpm install --frozen-lockfile
pnpm run build
```

## 启动 Web 并添加插件

在 `deepseek-harness` 源码目录启动 Web。`custom_search_tool` 使用启动终端的 `DEEPSEEK_API_KEY` 直连 DeepSeek Search API。内置搜索沿用 DSH profile 的配置。

```powershell
pnpm dsh web --port 0
```

`--port 0` 让系统选一个可用端口。如果浏览器没有自动打开，就打开终端 `dsh web:` 后打印的完整地址。

在 Web 侧栏选择「插件 → 添加插件」，在「包名或地址」里输入 `link:` 加上交付仓库 `plugin` 目录的绝对路径。把下面的路径换成你的实际路径。

```text
link:C:/projects/dsh-internship-plugins/plugin
```

点击「安装」，完成后点「立即启用」。Web 会把安装记录保存在当前 profile。启用后，选择工作区并新建标准模式会话，即可测试 `custom_search_tool`。

### 演示完整 turn 日志

在 Web 侧栏打开「插件」，进入 `dsh-internship-plugin` 的详情，开启「Turn 事件日志」组件。等它显示「运行中」后再发起搜索，启动 Web 的终端会逐行打印 `[turn-trace]` 事件。该组件默认关闭，演示结束后可以在同一页面关闭。

### 导出 Web profile

在 Web 启用插件后，从上游源码目录运行以下命令，查看当前 Web profile 的完整配置。

```powershell
pnpm dsh --profile web --dump-config
```

## 已验证的上游基线

- 上游版本为 `dsh-v0.2.2-rc.5`，固定 commit 为 `9c2670d3bce5275e0d1610272958121af87787bb`。[上游 commit](https://github.com/deepseek-ai/deepseek-harness/commit/9c2670d3bce5275e0d1610272958121af87787bb)
- 在 Windows 使用 Node.js `24.18.0` 和 pnpm `11.28.5` 完成依赖安装。完整构建通过，10 个构建检查全部成功。

## 实际 Web 插件树

根据安装插件后的 Web profile 导出整理，保留搜索和 turn 日志相关节点。

```text
Web profile
├─ dsh-base
│  ├─ tools
│  ├─ web （DSH 原生搜索与抓取配置）
│  ├─ web-search-deepseek
│  └─ web-deepseek-api
├─ dsh-web-app
│  └─ preset-standard
│     └─ tool-web （web_search、web_fetch）
└─ dsh-internship-plugin
   ├─ internship-custom-search （通过 ctx.tools 注册工具，直连 DeepSeek Search API）
   └─ internship-turn-trace （终端事件日志，默认关闭）
```

## 目录结构

```text
plugin/                 插件源码和 profile patch
tests/                  插件测试及实验样例
experiments/            B1–B3 对照数据和实验报告
WORKFLOW.md             本地开发记录与 AI 协作复盘
```

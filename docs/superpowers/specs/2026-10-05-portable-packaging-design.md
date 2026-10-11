# 便携版打包与 GitHub 发布 设计规格

- 状态：已记录，暂不实施（后续再执行）
- 日期：2026-10-05
- 项目：Meta 分析初筛系统

## 1. 目标

把当前「后端 + 前端」的本地 Web 应用，打包成**便携绿色文件夹**，发布到 GitHub Release，让用户解压即用，并能直接进文件夹查看项目数据。

## 2. 已确认决策

| # | 决策 |
|---|---|
| Q1 | 目标平台：Windows + macOS 两个都要 |
| Q2 | 内置 Node 运行时（免装环境） |
| Q3 | 用户数据放在便携文件夹内部 `data/` |
| Q4 | 双击启动器自动开浏览器；关闭启动器窗口 = 停止服务 |
| Q5 | GitHub 发布：源码 + 手动上传 Release zip（暂不做 CI 自动构建） |

## 3. 打包产物

- `Meta分析初筛系统-win-x64.zip`
- `Meta分析初筛系统-macos-arm64.zip`

解压后目录：

```
Meta分析初筛系统/
  start.bat          # Windows 启动器
  start.command      # macOS 启动器
  node/              # 内置 Node 20 LTS
  server/
    index.cjs        # esbuild 打包后的后端单文件
    node_modules/
      better-sqlite3 # 原生模块（需匹配 Node 20 ABI）
  web/               # 前端构建产物
  data/              # 用户数据（首次运行自动创建）
  README.txt         # 使用说明
```

## 4. 运行方式

- 双击启动器：以 `META_DATA_DIR=./data`、`WEB_DIST=./web` 启动后端，自动打开 `http://127.0.0.1:8787`。
- 关闭启动器窗口 = 停止服务。

## 5. 源码改动

- `apps/server/src/index.ts`：前端静态目录改为优先读 `WEB_DIST`，未设置回退到开发态 `../web/dist`。
- 数据目录 `META_DATA_DIR`、端口 `PORT`/`HOST` 已支持，无需改。

## 6. 构建脚本

新增 `scripts/package.mjs`，`package.json` 增加 `"package": "node scripts/package.mjs"`：

1. `pnpm build`。
2. esbuild 打包后端为 `server/index.cjs`（`better-sqlite3` 保持 external）。
3. 复制前端产物到 `web/`。
4. 下载 Node 20 LTS 运行时（win-x64 / darwin-arm64）。
5. 生成 `start.bat` / `start.command` / `README.txt`。
6. 打成两个 zip。

## 7. 关键技术风险

- `better-sqlite3` 是原生模块，二进制必须匹配内置 Node 20 的 ABI；打包脚本需用 `prebuild-install` 按 `--runtime node --target 20.x --platform --arch` 下载对应预编译二进制，不能复制本机 Node 22 的二进制。

## 8. 范围与后续

- 本次记录为发布计划，暂不实施。
- 桌面应用（Electron）作为后续可选项，不纳入当前计划。
- CI 自动构建（GitHub Actions）后续可加。

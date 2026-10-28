# 智能科研助手（Smart Research Assistant）

基于 **seekdb 向量数据库** 的科研知识管理与语义检索工具，使用 Qoder 完成全流程开发，并通过 Qoder Sites 发布到公网。

## 功能

- 语义搜索：自然语言查询，seekdb 自动向量化 + HNSW 余弦相似度检索
- 知识库管理：浏览 / 分类过滤 / 新增知识条目（写入 seekdb 自动向量化）
- 检索记录：每次检索落库 `search_logs` 表，页面可视化展示使用痕迹
- 仪表盘：条目总数、分类分布、标签云、最近更新（实时来自 seekdb）

## 技术架构

```
浏览器(https Qoder Sites)
   │  同源请求 /functions/v1/app/*
   ▼
Qoder Sites Function (Deno edge, functions/handler.ts)  ← HTTPS 代理，避免 mixed content
   │  http://<ECS公网IP>:3001/api/*
   ▼
API 服务器 (Node, server/index.mjs, seekdb-js SDK v1.4.0)
   │  MySQL 协议 127.0.0.1:2881
   ▼
seekdb (Docker: oceanbase/seekdb)  ← 向量存储 / 自动向量化 / HNSW 索引
```

- 前端：React 19 + TypeScript + Tailwind CSS 4 + shadcn/ui，构建产物在 `dist/`
- 后端：`server/index.mjs`（Node HTTP + seekdb-js SDK）
- 代理：`functions/handler.ts`（Qoder Sites Function，服务端转发到后端）
- 数据库：seekdb（collection `knowledge_base` + 标量表 `search_logs`）

## 运行说明

### 环境依赖

- Node.js `^22.13.0 || >=24.0.0`
- Docker（用于运行 seekdb）
- seekdb-js SDK `1.4.0`（`package.json` 已声明）

### 方式一：本地完整运行（真实 seekdb）

```sh
# 1. 启动 seekdb（仅本机监听 2881）
docker run -d --name seekdb -p 127.0.0.1:2881:2881 oceanbase/seekdb

# 2. 安装依赖并启动 API 服务器（端口 3001，首次启动自动建库导入示例数据）
npm ci
node server/index.mjs

# 3. 启动前端（另开终端），前端在 localhost 下直连 http://localhost:3001
npm run dev
```

自检：`curl http://127.0.0.1:3001/api/status` 返回 `{"connected":true,...}`。

### 方式二：公网部署（发布站点真实调用 seekdb）

```sh
# 1. 在一台有公网 IP 的 Linux 服务器（如阿里云 ECS）上以 root 执行一键脚本：
bash deploy/setup-ecs.sh
#    脚本会安装 Docker + seekdb + Node22，并以 systemd 托管 API 服务器

# 2. 在云控制台安全组放行 TCP 3001（不要放行 2881）

# 3. 将公网 IP 写入 functions/handler.ts 的 API_ORIGIN 常量

# 4. 构建前端并按 Qoder Sites 流程发布（webDirectory: dist, functionDirectory: functions, spa: true）
npm run build
```

发布后，站点所有检索 / 入库 / 检索记录请求经同源 Function 转发到该服务器上的 seekdb。
后端不可达时前端自动回退到内置演示数据，页面保持可用。

### seekdb 连接配置

| 配置项 | 值 |
| --- | --- |
| host / port | 127.0.0.1:2881（服务器本机） |
| user / password | root / 空（占位，无敏感凭据） |
| database | research_assistant |
| collection | knowledge_base |
| 检索记录表 | search_logs |

## 验证材料指引

1. 打开发布站点 → 语义搜索 → 输入「向量数据库」→ 返回按余弦相似度排序的结果（seekdb 实时检索）
2. 添加知识 → 提交 → 知识库列表与仪表盘计数实时增加（数据已写入 seekdb）
3. 搜索页「检索记录」卡片展示历史查询、命中数与最高相似度（seekdb `search_logs` 表）

---

# Qoder Sites React starter（模板原文）

A React, TypeScript, Vite and Tailwind frontend with a bundled Shadcn component catalog. Vite produces static files in `dist/`. Server behavior belongs in the optional Qoder Sites Function, not a Node or framework server.

## Develop

Use a Node version accepted by `package.json` (`^22.13.0 || >=24.0.0`). Select an installed compatible runtime and keep it selected for installation, development and build:

```sh
npm ci
npm run dev
```

Use the loopback URL printed by Vite. Edit `src/App.tsx`, `src/globals.css` and the title/description in `index.html`. Replace the sample page with the requested product before presenting a first meaningful preview. Import existing UI primitives from `@/components/ui/<component>` and compose them for the site's design. The neutral starter theme is a starting point, not the finished visual direction.

For production output:

```sh
npm run build
npm run preview
```

The build fixes `NODE_ENV=production` before loading Vite, independently of the terminal environment. It checks the frontend and bundled component types and emits `dist/index.html` and assets. `npm run preview` serves this output locally. Reuse passing checks while source is unchanged; no additional unit-test suite or browser QA is required by the template.

## Optional Function

The default page is entirely static and does not call a Function. For server behavior, adapt the public, credential-free example in `functions/handler.ts`. `functions/index.ts` is the Deno deployment entry point. Check `deno --version` before using a separate terminal for:

```sh
npm run check:function
npm run dev:function
```

If Deno is unavailable, the static frontend can still build and run. Keep Function validation pending until Deno or an equivalent existing Function checker is available; `npm run build` checks the frontend only. Local proxy requests also need a running compatible Function server.

The local service binds to `127.0.0.1:8000`; Vite development and built preview proxy `/functions/v1/app` to it, preserving the path. Probe with an available HTTP tool or Node `fetch`; with `curl` installed, for example:

```sh
curl --fail 'http://127.0.0.1:5173/functions/v1/app?name=Visitor'
```

Use Vite's actual port if it differs. The same frontend request after deployment is routed by Qoder Sites. Local proxy configuration is not production routing. Keep local-only servers and fixtures in `dev/`, outside both publication directories. The included Function has no dependencies; add self-contained runtime imports as required. Frontend npm dependencies are not automatically installed in Functions.

## Publish with Qoder Sites

Open a local conversation in this project and follow the `sites-hosting` skill. Workspace registration is optional. Use the directory returned by `get_context` with:

- `webDirectory: "dist"` after the build.
- `spa: false` for the default single page; use `true` when adding client-side deep routes that need fallback.
- `functionDirectory: "functions"` only if the application uses the Function. Omit it for static-only delivery.

The Sites tools prepare artifacts and generate the publication descriptor; publish completed hosted work by default, unless the user explicitly requests a preview first or defers publication. Do not upload the project root, `node_modules`, `dev`, or source as the web artifact. A successful build or release does not prove an external integration works.

For a new database-backed React page, follow the installed `sites-building` Skill's `references/function-backend.md`. Its assembled `assets/function-backend/` example includes `Notes.tsx`, Function routes and a schema using the platform's private database credentials. For a runnable records-and-attachments workbench, use that Skill's `references/records-example.md`; its setup command assembles a new project from this starter and keeps local fixtures outside deployment outputs. Preserve and adapt its application identity and ownership checks before exposing private records. `references/database.md`, `assets/database-react/App.tsx` and `assets/database-function/` are for existing legacy allocations only. These optional assets stay in the Skill rather than being copied into every static project.

For database or Storage, follow the corresponding `sites-building` references and `sites-management` capability workflow. For AI, follow `sites-build-agent-app` and keep Cloud Agents access in the Function. Application credentials belong in server-side Sites Settings; frontend environment variables are public. This starter does not implement visitor login, database permissions, Cloud resource coordination or QCA sessions; add those only for the requested feature using the existing skills.

See `PROVENANCE.md` and `vendor/` for source attribution and the preserved stylesheet license.

After copying the starter, rename `gitignore.template` to `.gitignore` before installing dependencies. This keeps the file available in npm and bundled CLI resources.

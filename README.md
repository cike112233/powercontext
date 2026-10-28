# 智能科研助手（Smart Research Assistant）

面向学生与研究者的科研知识管理 + 语义检索工具，使用 **Qoder 完成全流程开发**，通过 **Qoder Sites** 发布到公网。

- 线上站点：<https://smart-research-assistant-fw82jxidbol.qoder.zone>
- 代码仓库：<https://github.com/cike112233/powercontext>（分支 `main`）

## 功能

- 语义搜索：自然语言查询 → 服务端向量化 → 余弦相似度排序返回真实数据库中的知识条目
- 知识入库：表单提交后由服务端校验字段并写入 `knowledge_entries` 表，立即可被检索到
- 检索记录：每次检索写入 `search_logs` 表，页面展示查询词、命中条数、最高相似度与时间（真实使用痕迹）
- 知识库管理：浏览、分类过滤、关键词筛选，数据实时来自数据库
- 仪表盘：条目总数、分类分布、标签云、最近更新，全部由服务端数据计算
- 移动端适配：侧边栏折叠为抽屉，顶部提供切换按钮

## 技术架构

线上（当前发布站点）：

```
浏览器 (https Qoder Sites 静态站点)
   │  同源请求 /functions/v1/app/api/*
   ▼
Qoder Sites Function (Deno, functions/index.ts + functions/routes.mjs)
   │  平台注入数据库凭据（QODER_DATABASE，前端与仓库中均无凭据）
   ▼
Qoder Sites 私有数据库
   ├─ app.knowledge_entries  知识条目（id/title/content/category/tags/source/created_at）
   └─ app.search_logs        检索记录（query/category/result_count/top_score/created_at）
```

服务端检索实现（`functions/routes.mjs`）：中文按字符二元组、英文按词切分 → 128 维 TF-IDF 加权哈希向量（L2 归一化）→ 余弦相似度打分 → Top-K 排序 → 写入检索记录。候选集支持按分类做标量过滤。

本地 / 自托管（seekdb 向量数据库模式）：

```
浏览器 (Vite dev)
   │  /functions/v1/app/api/*  →  vite 代理 127.0.0.1:8000
   ▼
dev/function-local.mjs （同一套 functions/routes.mjs 路由代码）
   │  SEEKDB_API_ORIGIN=http://127.0.0.1:3001 时转发到 ↓
   ▼
server/index.mjs (Node + seekdb-js SDK v1.4.0)
   │  MySQL 协议 127.0.0.1:2881
   ▼
seekdb (Docker: oceanbase/seekdb)  ← collection knowledge_base（自动向量化 + HNSW 索引）
                                     + 标量表 search_logs（检索记录）
```

- 前端：React 19 + TypeScript + Tailwind CSS 4 + shadcn/ui，构建产物 `dist/`
- 线上后端：Qoder Sites Function（`functions/index.ts` 为 Deno 入口，`functions/routes.mjs` 为业务路由）
- seekdb 集成：`lib/seekdb.ts`（SDK 封装）、`server/index.mjs`（seekdb API 服务）、`scripts/init-seekdb.mjs`（数据初始化）、`deploy/setup-ecs.sh`（seekdb 一键部署脚本）
- 本地自检：`dev/function-test.mjs`（直接调用真实路由代码，27 项断言）、`dev/function-local.mjs`（内存数据库）

## 运行说明

### 环境依赖

- Node.js `^22.13.0 || >=24.0.0`
- Docker（仅 seekdb 本地模式需要）
- seekdb-js SDK `1.4.0`（`package.json` 已声明）

### 方式一：直接访问线上站点（无需任何本地环境）

打开 <https://smart-research-assistant-fw82jxidbol.qoder.zone>，语义搜索、添加知识、检索记录均为真实数据库读写。

### 方式二：本地运行（内存数据库，零外部依赖）

```sh
npm ci
npm run test:function     # 路由自检：27 项断言（检索、入库、记录、校验、错误码）
npm run dev:function      # 127.0.0.1:8000 运行真实 functions/routes.mjs
npm run dev               # 另开终端；vite 代理 /functions/v1/app -> 8000
```

此时前端与线上走完全相同的调用路径和相同的业务路由代码，数据存放在内存数据库（本地示例数据，来自 `dev/seed-entries.json`）。

### 方式三：本地运行真实 seekdb

```sh
# 1. 启动 seekdb（仅本机监听 2881）
docker run -d --name seekdb -p 127.0.0.1:2881:2881 oceanbase/seekdb

# 2. 启动 seekdb API 服务器（端口 3001，首次启动自动建 collection 并导入示例数据）
npm run dev:seekdb

# 3. 让本地 Function 层把 /api/* 转发到 seekdb 服务
SEEKDB_API_ORIGIN=http://127.0.0.1:3001 npm run dev:function

# 4. 启动前端
npm run dev
```

自检：`curl http://127.0.0.1:3001/api/status` 返回 `{"connected":true,"backend":"seekdb",...}`；
页面顶部状态条会显示「后端: seekdb 向量数据库（本地实例）」。

### 方式四：自托管 seekdb 供公网访问

```sh
# 在有公网 IP 的 Linux 服务器上以 root 执行（安装 Docker + seekdb + Node22，systemd 托管 API）
bash deploy/setup-ecs.sh
# 云控制台安全组只放行 TCP 3001，不要放行 2881
```

之后可将 Function 改为转发到该服务器地址（需自行配置服务端 Secret，仓库中只保留占位值）。

### seekdb 连接配置（本地模式，均为占位值，不含真实凭据）

| 配置项 | 值 |
| --- | --- |
| host / port | 127.0.0.1:2881（本机） |
| user / password | root / 空（占位，无敏感凭据） |
| database | research_assistant |
| collection | knowledge_base |
| 检索记录表 | search_logs |

线上模式的数据库凭据由 Qoder Sites 平台在部署时注入到 Function 运行环境，不出现在前端产物、仓库或任何配置文件中。

## 线上数据表（已应用的迁移 SQL）

```sql
CREATE TABLE app.knowledge_entries (
  id text PRIMARY KEY,
  title text NOT NULL,
  content text NOT NULL,
  category text NOT NULL,
  tags jsonb NOT NULL,
  source text,
  created_at timestamptz NOT NULL
);
CREATE TABLE app.search_logs (
  id uuid PRIMARY KEY,
  query text NOT NULL,
  category text NOT NULL,
  result_count integer NOT NULL,
  top_score integer NOT NULL,   -- 相似度以基点存储（0-10000）
  created_at timestamptz NOT NULL
);
CREATE INDEX knowledge_entries_category_idx ON app.knowledge_entries (category);
CREATE INDEX search_logs_created_at_idx ON app.search_logs (created_at);
```

## 线上接口（同源）

```
GET  /functions/v1/app/api/status   后端连接状态、条目数、向量算法
GET  /functions/v1/app/api/list     知识库列表（?category=paper 过滤）
GET  /functions/v1/app/api/logs     检索记录（最近 20 条）
POST /functions/v1/app/api/search   {"query","category","topK"} → 向量检索 + 写入检索记录
POST /functions/v1/app/api/add      {"title","content","category","tags","source"} → 入库
```

示例（POST 需带站点同源 Origin 头，网关会校验）：

```sh
curl 'https://smart-research-assistant-fw82jxidbol.qoder.zone/functions/v1/app/api/status'
```

## 验证材料指引

1. 打开站点首页：仪表盘显示「实时数据连接」徽标，条目总数与分类统计来自数据库实时查询
2. 语义搜索：输入「如何用向量数据库做科研知识管理」→ 首条命中《基于 seekdb 的科研知识管理系统设计》，
   每条结果显示服务端计算的余弦相似度（如 0.3028），页面顶部显示「实时向量检索已连接 — 服务端语义检索模式」
   与后端类型、数据表名、数据量
3. 检索记录：搜索后页面下方「检索记录（真实使用痕迹）」立即新增一条，包含查询词、命中条数、
   最高相似度与本地时间；刷新页面后依然存在（数据来自 `app.search_logs` 表）
4. 添加知识：提交表单 → 提示「已写入数据库」→ 知识库页条数增加 → 再次语义搜索可检索到该新条目
5. 代码可验证：`functions/routes.mjs` 为线上业务路由，`dev/function-test.mjs` 为本地自检
   （`npm run test:function` 输出 27 项断言全部通过），seekdb 集成见 `server/index.mjs` 与 `lib/seekdb.ts`

## Qoder 开发记录

本项目全程使用 Qoder 开发：需求拆解、UI 组件实现、seekdb SDK 集成、Function 业务路由编写、
数据库迁移（建表 + 索引）、发布与线上验证、以及多次评审反馈的修复（移动端导航、组件 Hook 误用、
控制台报错、静态站点无法承载真实后端 → 改为 Sites Function + 私有数据库架构）均在 Qoder 会话中完成，
提交历史见仓库 `main` 分支。

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

The default page is entirely static and does not call a Function. For server behavior, this project uses `functions/index.ts` (Deno entry point) plus `functions/routes.mjs` (business routes). The platform injects `functions/_qoder/` before deployment; that directory is intentionally absent from the repository. For credential-free local runs use:

```sh
npm run test:function     # route self-check with an in-memory database (Node, no Deno needed)
npm run dev:function      # serve the same routes on 127.0.0.1:8000
```

If Deno is available, `deno check functions/index.ts` additionally type-checks the deployment entry point; it requires the platform-supplied `_qoder/` modules and therefore cannot resolve locally.

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

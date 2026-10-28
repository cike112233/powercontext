import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Database,
  ExternalLink,
  BookOpen,
  Code2,
  Sparkles,
  Users,
  Target,
  Lightbulb,
} from "lucide-react";

export function AboutPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">关于项目</h1>
        <p className="text-muted-foreground">智能科研助手 — 让学习、科研和工作更高效</p>
      </div>

      {/* Project Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            项目概述
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">
            <strong className="text-foreground">智能科研助手</strong>是一个面向研究者和学生的知识管理工具，
            旨在解决科研过程中文献资料难以查找、知识碎片化、信息检索效率低等问题。
            项目全程使用 Qoder 开发，通过 Qoder Sites 发布：线上由 Sites Function 在服务端完成向量化、
            余弦相似度检索与检索记录落库（数据存放在平台注入凭据的私有数据库中，前端不含任何凭据）；
            同时保留基于 seekdb 向量数据库的本地/自托管运行模式（seekdb-js SDK v1.4.0）。
          </p>
          <div className="flex flex-wrap gap-2">
            <Badge>Qoder</Badge>
            <Badge>Qoder Sites Function</Badge>
            <Badge>seekdb</Badge>
            <Badge>React</Badge>
            <Badge>TypeScript</Badge>
            <Badge>Tailwind CSS</Badge>
          </div>
        </CardContent>
      </Card>

      {/* Problem & Solution */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5" />
              解决的问题
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex gap-2">
                <span className="text-destructive font-bold">·</span>
                科研文献和笔记分散在多个平台，难以统一管理
              </li>
              <li className="flex gap-2">
                <span className="text-destructive font-bold">·</span>
                关键词搜索无法理解语义，遗漏相关文献
              </li>
              <li className="flex gap-2">
                <span className="text-destructive font-bold">·</span>
                知识之间缺乏关联，难以发现跨领域联系
              </li>
              <li className="flex gap-2">
                <span className="text-destructive font-bold">·</span>
                重复整理报表和资料，浪费时间
              </li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lightbulb className="h-5 w-5" />
              解决方案
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex gap-2">
                <span className="text-green-600 font-bold">·</span>
                统一知识库：集中管理论文、笔记、想法和实验记录
              </li>
              <li className="flex gap-2">
                <span className="text-green-600 font-bold">·</span>
                语义搜索：服务端向量检索理解自然语言查询意图
              </li>
              <li className="flex gap-2">
                <span className="text-green-600 font-bold">·</span>
                智能关联：通过向量相似度自动发现相关知识
              </li>
              <li className="flex gap-2">
                <span className="text-green-600 font-bold">·</span>
                可追溯：每次检索写入 search_logs，形成真实使用痕迹
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* Technical Architecture */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Code2 className="h-5 w-5" />
            技术架构
          </CardTitle>
          <CardDescription>线上：Qoder Sites Function + 私有数据库；本地/自托管：seekdb 向量数据库</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border p-4">
              <div className="mb-2 flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/30">
                  <Database className="h-4 w-4 text-blue-600" />
                </div>
                <h4 className="font-semibold text-sm">服务端向量检索</h4>
              </div>
              <ul className="space-y-1 text-xs text-muted-foreground">
                <li>· functions/routes.mjs 业务路由</li>
                <li>· 平台注入数据库凭据（前端零凭据）</li>
                <li>· 128 维哈希词袋嵌入 + 余弦相似度</li>
                <li>· 检索记录写入 search_logs</li>
                <li>· seekdb 模式：HNSW 索引 + 自动向量化</li>
              </ul>
            </div>
            <div className="rounded-lg border p-4">
              <div className="mb-2 flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/30">
                  <Sparkles className="h-4 w-4 text-purple-600" />
                </div>
                <h4 className="font-semibold text-sm">前端应用</h4>
              </div>
              <ul className="space-y-1 text-xs text-muted-foreground">
                <li>· React 19 + TypeScript</li>
                <li>· Tailwind CSS 4</li>
                <li>· shadcn/ui 组件库</li>
                <li>· 响应式设计</li>
              </ul>
            </div>
            <div className="rounded-lg border p-4">
              <div className="mb-2 flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900/30">
                  <ExternalLink className="h-4 w-4 text-green-600" />
                </div>
                <h4 className="font-semibold text-sm">部署与发布</h4>
              </div>
              <ul className="space-y-1 text-xs text-muted-foreground">
                <li>· Qoder Sites 静态托管 + Function</li>
                <li>· 私有数据库（凭据平台注入）</li>
                <li>· Vite 构建优化</li>
                <li>· 同源 API，无跨域与混合内容问题</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 数据结构与验证方式 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            真实数据结构与验证方式
          </CardTitle>
          <CardDescription>
            以下 SQL 为线上实际执行的迁移语句（Qoder Sites 私有数据库，app schema）
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h4 className="mb-2 text-sm font-semibold">线上数据表（已应用迁移）</h4>
            <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-xs font-mono">
{`CREATE TABLE app.knowledge_entries (
  id          text PRIMARY KEY,
  title       text NOT NULL,
  content     text NOT NULL,
  category    text NOT NULL,
  tags        jsonb NOT NULL,
  source      text,
  created_at  timestamptz NOT NULL
);
CREATE TABLE app.search_logs (
  id            uuid PRIMARY KEY,
  query         text NOT NULL,
  category      text NOT NULL,
  result_count  integer NOT NULL,
  top_score     integer NOT NULL,   -- 相似度以基点存储（0-10000）
  created_at    timestamptz NOT NULL
);
CREATE INDEX knowledge_entries_category_idx ON app.knowledge_entries (category);
CREATE INDEX search_logs_created_at_idx ON app.search_logs (created_at);`}
            </pre>
          </div>
          <div>
            <h4 className="mb-2 text-sm font-semibold">服务端检索接口（同源）</h4>
            <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-xs font-mono">
{`GET  /functions/v1/app/api/status   后端连接状态与条目数
GET  /functions/v1/app/api/list     知识库列表（?category=paper 可过滤）
GET  /functions/v1/app/api/logs     检索记录（真实使用痕迹）
POST /functions/v1/app/api/search   向量语义检索 + 写入检索记录
POST /functions/v1/app/api/add      知识入库（服务端校验并持久化）`}
            </pre>
          </div>
          <div>
            <h4 className="mb-2 text-sm font-semibold">seekdb 本地/自托管模式（server 模式，seekdb-js v1.4.0）</h4>
            <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-xs font-mono">
{`// server/index.mjs：连接 seekdb 并使用自动向量化 collection
const client = new SeekdbClient({
  host: "127.0.0.1", port: 2881,
  user: "root", password: "",        // 占位配置，不提交真实凭据
  database: "research_assistant",
});
if (!(await client.hasCollection("knowledge_base"))) {
  collection = await client.createCollection({ name: "knowledge_base" });
  await collection.add({ ids, documents, metadatas });   // 自动向量化写入
  await collection.refresh_index();                      // 构建 HNSW 索引
} else {
  collection = await client.getCollection({ name: "knowledge_base" });
}
const res = await collection.query({
  queryTexts: query, nResults: topK,
  include: ["documents", "metadatas", "distances"],
});
// 同时用 MySQL 协议标量表 search_logs 记录每次检索（使用痕迹）
await client.execute(
  "INSERT INTO search_logs (query, category, result_count, top_score) VALUES (?,?,?,?)",
  [query, category, resultCount, topScore],
);`}
            </pre>
          </div>
          <div className="rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-950/20">
            <p className="text-xs text-green-800 dark:text-green-400">
              <strong>如何验证：</strong>
              在“语义搜索”页输入自然语言查询并搜索，页面顶部会显示实时后端连接状态与数据量，
              结果卡片显示服务端返回的真实余弦相似度；页面下方“检索记录”会立即出现刚才的查询词、
              命中条数、最高相似度与时间戳（数据来自数据库 search_logs 表，刷新后依然存在）。
              在“添加知识”页提交的条目会写入数据库，可在“知识库”页看到条数增加，并能被后续语义搜索检索到。
            </p>
          </div>
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950/20">
            <p className="text-xs text-blue-800 dark:text-blue-400">
              <strong>代码仓库：</strong>
              <a className="underline" href="https://github.com/cike112233/powercontext" target="_blank" rel="noreferrer">
                github.com/cike112233/powercontext
              </a>
              （functions/routes.mjs 线上业务路由、server/index.mjs 与 lib/seekdb.ts 的 seekdb 集成、
              dev/function-test.mjs 路由自检、deploy/setup-ecs.sh seekdb 一键部署脚本）
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Team Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            项目信息
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">竞赛名称</div>
              <div className="text-sm font-medium">2026 OceanBase 数据库大赛</div>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">赛题方向</div>
              <div className="text-sm font-medium">用 Qoder 做一个让学习、科研和工作更高效的项目</div>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">核心技术</div>
              <div className="text-sm font-medium">Qoder Sites Function + 私有数据库 / seekdb 向量数据库</div>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">开发工具</div>
              <div className="text-sm font-medium">Qoder AI 辅助开发</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

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
            项目基于 seekdb 向量数据库实现核心语义搜索功能，通过 Qoder Sites 部署发布。
          </p>
          <div className="flex flex-wrap gap-2">
            <Badge>Qoder</Badge>
            <Badge>seekdb</Badge>
            <Badge>React</Badge>
            <Badge>TypeScript</Badge>
            <Badge>Tailwind CSS</Badge>
            <Badge>Qoder Sites</Badge>
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
                语义搜索：seekdb 向量检索理解自然语言查询意图
              </li>
              <li className="flex gap-2">
                <span className="text-green-600 font-bold">·</span>
                智能关联：通过向量相似度自动发现相关知识
              </li>
              <li className="flex gap-2">
                <span className="text-green-600 font-bold">·</span>
                高效检索：HNSW 索引实现毫秒级向量检索
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
          <CardDescription>基于 seekdb + Qoder Sites 的完整技术栈</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border p-4">
              <div className="mb-2 flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/30">
                  <Database className="h-4 w-4 text-blue-600" />
                </div>
                <h4 className="font-semibold text-sm">seekdb 向量数据库</h4>
              </div>
              <ul className="space-y-1 text-xs text-muted-foreground">
                <li>· MySQL 协议兼容</li>
                <li>· HNSW 向量索引</li>
                <li>· 128 维嵌入向量</li>
                <li>· 余弦相似度检索</li>
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
                <li>· Qoder Sites 托管</li>
                <li>· Vite 构建优化</li>
                <li>· 静态资源 CDN</li>
                <li>· 全球加速访问</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* seekdb Integration Details */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            seekdb 集成说明
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h4 className="mb-2 text-sm font-semibold">数据库表结构</h4>
            <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-xs font-mono">
{`CREATE TABLE knowledge_base (
  id          VARCHAR(64) PRIMARY KEY,
  title       VARCHAR(255) NOT NULL,
  content     TEXT NOT NULL,
  category    VARCHAR(32) NOT NULL,
  tags        JSON,
  source      VARCHAR(255),
  embedding   VECTOR(128),
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_category (category),
  VECTOR INDEX idx_embedding (embedding) ALGORITHM=HNSW
);`}
            </pre>
          </div>
          <div>
            <h4 className="mb-2 text-sm font-semibold">语义搜索查询</h4>
            <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-xs font-mono">
{`-- 将查询文本向量化后执行相似度检索
SELECT id, title, content, category, tags,
       1 - (embedding <=> :query_vector) AS similarity
FROM knowledge_base
WHERE category = :category  -- 可选标量过滤
ORDER BY embedding <=> :query_vector
LIMIT :top_k;`}
            </pre>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/20">
            <p className="text-xs text-amber-800 dark:text-amber-400">
              <strong>说明：</strong>本演示项目使用模拟数据展示 seekdb 的集成方式。
              实际部署时，将 seekdb 连接配置为环境变量，通过 Qoder Sites Function 层调用 seekdb API 实现完整的向量存储和检索功能。
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
              <div className="text-sm font-medium">seekdb 向量数据库 + Qoder Sites</div>
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

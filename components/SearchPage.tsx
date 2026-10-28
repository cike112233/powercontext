import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  Sparkles,
  Database,
  Loader2,
  FileText,
  StickyNote,
  Lightbulb,
  BookOpen,
  FlaskConical,
  ArrowRight,
  Info,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { CATEGORY_LABELS, type Category, type SearchResult } from "@/lib/types";

const API_BASE = "http://localhost:3001";

const CATEGORY_ICONS: Record<Category, React.ElementType> = {
  paper: FileText,
  note: StickyNote,
  idea: Lightbulb,
  reference: BookOpen,
  experiment: FlaskConical,
};

interface SeekdbStatus {
  connected: boolean;
  count: number;
  collection: string;
}

export function SearchPage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [seekdbStatus, setSeekdbStatus] = useState<SeekdbStatus | null>(null);
  const [mode, setMode] = useState<"live" | "demo">("demo");

  // 检查 seekdb 连接状态
  useEffect(() => {
    fetch(`${API_BASE}/api/status`)
      .then((r) => r.json())
      .then((data) => {
        if (data.connected) {
          setSeekdbStatus(data);
          setMode("live");
        }
      })
      .catch(() => {
        setMode("demo");
      });
  }, []);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setSearched(true);

    if (mode === "live") {
      // 真实 seekdb 搜索
      try {
        const res = await fetch(`${API_BASE}/api/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: query.trim(),
            category: category !== "all" ? category : undefined,
            topK: 5,
          }),
        });
        const data = await res.json();
        if (data.results) {
          setResults(
            data.results.map((r: any) => ({
              entry: {
                id: r.id,
                title: r.title,
                content: r.content,
                category: r.category,
                tags: r.tags,
                source: r.source,
                createdAt: "",
                updatedAt: "",
              },
              score: r.score,
              highlights: [],
            }))
          );
        } else {
          setResults([]);
        }
      } catch {
        setResults([]);
      }
    } else {
      // 演示模式：使用 seekdb SDK 的模拟调用
      // 实际代码见 lib/seekdb.ts 和 server/index.mjs
      await new Promise((r) => setTimeout(r, 600));
      const demoResults = getDemoResults(query.trim(), category);
      setResults(demoResults);
    }

    setLoading(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">语义搜索</h1>
        <p className="text-muted-foreground">
          基于 seekdb 向量数据库的自然语言检索
        </p>
      </div>

      {/* seekdb 状态指示 */}
      <Card className={mode === "live" ? "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/20" : "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20"}>
        <CardContent className="flex items-center gap-3 p-4">
          {mode === "live" ? (
            <>
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              <div>
                <p className="font-medium text-green-800 dark:text-green-400">
                  seekdb 已连接 — 实时向量检索模式
                </p>
                <p className="text-sm text-green-600 dark:text-green-500">
                  Collection: {seekdbStatus?.collection} | 数据量: {seekdbStatus?.count} 条 | HNSW 索引
                </p>
              </div>
            </>
          ) : (
            <>
              <AlertCircle className="h-5 w-5 text-amber-600" />
              <div>
                <p className="font-medium text-amber-800 dark:text-amber-400">
                  演示模式 — seekdb SDK 已集成，连接本地实例可切换为实时模式
                </p>
                <p className="text-sm text-amber-600 dark:text-amber-500">
                  启动 seekdb: <code className="rounded bg-amber-100 px-1 dark:bg-amber-900/30">docker run -d -p 2881:2881 oceanbase/seekdb</code>
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Search Interface */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            自然语言查询
          </CardTitle>
          <CardDescription>
            {mode === "live"
              ? "seekdb 将查询文本向量化，通过 HNSW 索引进行余弦相似度检索"
              : "输入自然语言问题，体验 seekdb 语义搜索效果（演示数据）"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            placeholder="例如：向量数据库如何用于科研知识管理？"
            value={query}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setQuery(e.target.value)}
            className="min-h-[80px] resize-none"
            onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSearch();
              }
            }}
          />
          <div className="flex flex-col gap-3 sm:flex-row">
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-full sm:w-[200px]">
                <SelectValue placeholder="全部分类" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部分类</SelectItem>
                {(Object.keys(CATEGORY_LABELS) as Category[]).map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {CATEGORY_LABELS[cat]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={handleSearch} disabled={loading || !query.trim()} className="sm:flex-1">
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {mode === "live" ? "seekdb 检索中..." : "搜索中..."}
                </>
              ) : (
                <>
                  <Search className="mr-2 h-4 w-4" />
                  语义搜索
                </>
              )}
            </Button>
          </div>

          {/* seekdb SDK 代码展示 */}
          <div className="rounded-lg border bg-muted/50 p-3">
            <button
              onClick={() => setShowCode(!showCode)}
              className="flex w-full items-center justify-between text-sm font-medium"
            >
              <span className="flex items-center gap-2">
                <Database className="h-4 w-4" />
                seekdb SDK 调用代码（TypeScript）
              </span>
              <ArrowRight className={`h-4 w-4 transition-transform ${showCode ? "rotate-90" : ""}`} />
            </button>
            {showCode && (
              <pre className="mt-2 overflow-x-auto rounded bg-background p-3 text-xs font-mono leading-relaxed">
{`// lib/seekdb.ts - 使用 seekdb-js SDK v1.4.0
import { SeekdbClient } from "seekdb";

// 1. 连接 seekdb 服务器
const client = new SeekdbClient({
  host: "127.0.0.1", port: 2881,
  user: "root", password: "",
  database: "research_assistant",
});

// 2. 获取 collection（自动向量化）
const collection = await client.getCollection({
  name: "knowledge_base"
});

// 3. 语义搜索 - seekdb 自动将查询文本向量化
const results = await collection.query({
  queryTexts: "${query || "向量数据库"}",
  nResults: 5,
  where: ${category !== "all" ? `{ category: "${category}" }` : "undefined"},
  include: ["documents", "metadatas", "distances"],
});

// 4. 结果按余弦相似度排序返回`}
              </pre>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {loading && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Loader2 className="mb-3 h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              {mode === "live" ? "seekdb HNSW 索引检索中..." : "计算向量相似度..."}
            </p>
          </CardContent>
        </Card>
      )}

      {!loading && searched && results.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Sparkles className="h-4 w-4" />
            找到 {results.length} 条相关结果
            {mode === "live" ? "（seekdb 实时检索）" : "（演示模式）"}
          </div>
          {results.map((result, index) => {
            const Icon = CATEGORY_ICONS[result.entry.category];
            return (
              <Card key={result.entry.id} className="transition-shadow hover:shadow-md">
                <CardContent className="p-5">
                  <div className="flex items-start gap-4">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                      {index + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-semibold">{result.entry.title}</h3>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge variant="outline">{CATEGORY_LABELS[result.entry.category]}</Badge>
                          <Badge
                            className={
                              result.score > 0.7
                                ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                : result.score > 0.4
                                ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                                : "bg-muted text-muted-foreground"
                            }
                          >
                            {(result.score * 100).toFixed(0)}% 匹配
                          </Badge>
                        </div>
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">{result.entry.content}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {result.entry.tags.map((tag: string) => (
                          <Badge key={tag} variant="secondary" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                      <div className="mt-3">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>语义相似度</span>
                          <span>{(result.score * 100).toFixed(1)}%</span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary transition-all"
                            style={{ width: `${result.score * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {!loading && searched && results.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Search className="mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">未找到相关结果，请尝试其他查询</p>
          </CardContent>
        </Card>
      )}

      {/* seekdb 技术说明 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="h-5 w-5" />
            seekdb 向量检索技术说明
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">seekdb SDK 集成</h4>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li>· 使用 seekdb-js v1.4.0 官方 SDK</li>
                <li>· Server 模式连接 (127.0.0.1:2881)</li>
                <li>· 自动向量化（内置 default-embed 模型）</li>
                <li>· HNSW 向量索引，余弦相似度计算</li>
              </ul>
            </div>
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">核心 API 调用</h4>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li>· <code className="rounded bg-muted px-1 text-xs">client.createCollection()</code> 创建集合</li>
                <li>· <code className="rounded bg-muted px-1 text-xs">collection.add()</code> 自动向量化插入</li>
                <li>· <code className="rounded bg-muted px-1 text-xs">collection.query()</code> 语义搜索</li>
                <li>· <code className="rounded bg-muted px-1 text-xs">collection.hybridSearch()</code> 混合检索</li>
              </ul>
            </div>
          </div>
          <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950/20">
            <p className="text-xs text-blue-800 dark:text-blue-400">
              <strong>源码位置：</strong>
              <code className="rounded bg-blue-100 px-1 dark:bg-blue-900/30">lib/seekdb.ts</code>（SDK 封装层）|
              <code className="rounded bg-blue-100 px-1 dark:bg-blue-900/30">server/index.mjs</code>（API 服务器）|
              <code className="rounded bg-blue-100 px-1 dark:bg-blue-900/30">scripts/init-seekdb.mjs</code>（数据初始化）
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// 演示模式数据（当 seekdb 未启动时使用）
function getDemoResults(queryText: string, categoryFilter: string): SearchResult[] {
  const entries = [
    { id: "2", title: "向量数据库在 RAG 系统中的应用", content: "RAG（检索增强生成）系统结合向量数据库实现语义检索。核心流程：文档分块与向量化、向量存储与索引、查询向量化与相似度检索。seekdb 支持 MySQL 协议，降低了使用门槛。", category: "note" as Category, tags: ["RAG", "向量数据库", "seekdb", "语义搜索"], score: 0.92 },
    { id: "3", title: "基于 seekdb 的科研知识管理系统设计", content: "设计一个基于 seekdb 的科研知识管理系统。系统利用 seekdb 的向量存储能力，将论文、笔记等文本转化为向量存储。用户输入自然语言查询时，系统计算查询向量与知识库向量的余弦相似度。", category: "idea" as Category, tags: ["seekdb", "知识管理", "语义搜索"], score: 0.88 },
    { id: "8", title: "seekdb 向量检索性能调优笔记", content: "seekdb 支持 HNSW 和 IVF 两种向量索引算法。HNSW 适合高召回率场景，IVF 适合大规模数据集。维度≤128 用 HNSW，维度>512 用 IVF-PQ。", category: "note" as Category, tags: ["seekdb", "向量检索", "HNSW", "IVF"], score: 0.85 },
    { id: "1", title: "OceanBase 分布式数据库架构分析", content: "OceanBase 是一个原生分布式关系数据库，采用 Shared-Nothing 架构。核心组件包括 RootService、OBServer 和 Zone。数据通过 Paxos 协议实现多副本一致性。", category: "paper" as Category, tags: ["分布式数据库", "OceanBase", "Paxos"], score: 0.62 },
    { id: "6", title: "PowerContext 构建 AI Agent 实践", content: "PowerContext 提供了构建 AI Agent 的完整框架。核心概念包括 Context、Tool、Memory。通过 HTTP API 和 MCP 协议可以与外部服务集成。", category: "note" as Category, tags: ["PowerContext", "AI Agent", "MCP"], score: 0.45 },
  ];

  let filtered = entries;
  if (categoryFilter !== "all") {
    filtered = entries.filter((e) => e.category === categoryFilter);
  }

  // 简单的相关性排序
  const lower = queryText.toLowerCase();
  filtered.sort((a, b) => {
    const aMatch = a.title.toLowerCase().includes(lower) || a.content.toLowerCase().includes(lower) ? 1 : 0;
    const bMatch = b.title.toLowerCase().includes(lower) || b.content.toLowerCase().includes(lower) ? 1 : 0;
    if (aMatch !== bMatch) return bMatch - aMatch;
    return b.score - a.score;
  });

  return filtered.slice(0, 5).map((e) => ({
    entry: {
      id: e.id,
      title: e.title,
      content: e.content,
      category: e.category,
      tags: e.tags,
      createdAt: "",
      updatedAt: "",
    },
    score: e.score,
    highlights: [],
  }));
}

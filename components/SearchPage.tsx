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
  History,
} from "lucide-react";
import { CATEGORY_LABELS, type Category, type SearchResult } from "@/lib/types";
import { api, type SearchLogRow } from "@/lib/api";

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

// 内嵌知识库 - 演示模式完全自包含，不依赖外部服务
const KNOWLEDGE_BASE: Array<{
  id: string;
  title: string;
  content: string;
  category: Category;
  tags: string[];
  keywords: string[];
}> = [
  {
    id: "1",
    title: "OceanBase 分布式数据库架构分析",
    content:
      "OceanBase 是一个原生分布式关系数据库，采用 Shared-Nothing 架构。核心组件包括 RootService（负责集群管理）、OBServer（负责数据存储与计算）和 Zone（物理隔离单元）。数据通过 Paxos 协议实现多副本强一致性，支持自动故障切换和在线扩容。OceanBase 在 TPC-C 测试中打破世界纪录，证明了其在 OLTP 领域的卓越性能。",
    category: "paper",
    tags: ["分布式数据库", "OceanBase", "Paxos", "Shared-Nothing"],
    keywords: ["oceanbase", "分布式", "数据库", "paxos", "架构", "副本", "一致性", "扩容", "tpcc", "oltp"],
  },
  {
    id: "2",
    title: "向量数据库在 RAG 系统中的应用",
    content:
      "RAG（检索增强生成）系统结合向量数据库实现语义检索，是当前大模型应用的核心架构。核心流程包括：文档分块与向量化（使用 Embedding 模型将文本转为高维向量）、向量存储与索引（seekdb 支持 HNSW 索引实现高效近似最近邻搜索）、查询向量化与相似度检索（计算余弦相似度找到最相关的文档片段）。seekdb 兼容 MySQL 协议，大幅降低了使用门槛。",
    category: "note",
    tags: ["RAG", "向量数据库", "seekdb", "语义搜索", "Embedding"],
    keywords: ["rag", "向量", "数据库", "检索", "增强", "生成", "embedding", "hnsw", "余弦", "相似度", "seekdb", "mysql"],
  },
  {
    id: "3",
    title: "基于 seekdb 的科研知识管理系统设计",
    content:
      "设计一个基于 seekdb 的科研知识管理系统。系统利用 seekdb 的向量存储能力，将论文、笔记、实验记录等知识转化为向量存储。用户输入自然语言查询时，系统计算查询向量与知识库向量的余弦相似度，返回最相关的结果。支持混合检索（向量搜索 + 标量过滤），可以按分类、标签、时间等维度精确筛选。",
    category: "idea",
    tags: ["seekdb", "知识管理", "语义搜索", "科研", "混合检索"],
    keywords: ["seekdb", "知识", "管理", "系统", "科研", "论文", "向量", "查询", "筛选", "标签", "混合"],
  },
  {
    id: "4",
    title: "Transformer 注意力机制详解",
    content:
      "Transformer 架构的核心是自注意力机制（Self-Attention），它允许模型在处理每个 token 时关注序列中的所有其他位置。Multi-Head Attention 将输入分成多个头并行计算注意力，捕获不同子空间的语义关系。位置编码（Positional Encoding）弥补了 Transformer 缺乏序列顺序感知的问题。该架构是 GPT、BERT 等大模型的基础。",
    category: "paper",
    tags: ["Transformer", "注意力机制", "深度学习", "NLP"],
    keywords: ["transformer", "注意力", "attention", "self-attention", "multi-head", "位置编码", "gpt", "bert", "token", "序列"],
  },
  {
    id: "5",
    title: "MySQL 索引优化与查询性能调优",
    content:
      "MySQL 索引是提升查询性能的关键。B+Tree 索引适合等值查询和范围查询，Hash 索引仅支持等值查询但速度更快。联合索引遵循最左前缀原则。EXPLAIN 命令可以分析查询执行计划，帮助识别全表扫描和索引失效问题。seekdb 作为 OceanBase 的向量数据库扩展，兼容 MySQL 协议，可以使用标准 MySQL 客户端工具进行连接和操作。",
    category: "reference",
    tags: ["MySQL", "索引", "性能优化", "B+Tree", "seekdb"],
    keywords: ["mysql", "索引", "优化", "b+tree", "hash", "explain", "查询", "性能", "seekdb", "oceanbase", "兼容"],
  },
  {
    id: "6",
    title: "PowerContext 构建 AI Agent 实践",
    content:
      "PowerContext 提供了构建 AI Agent 的完整框架，核心概念包括 Context（上下文管理）、Tool（工具调用）和 Memory（记忆存储）。通过 HTTP API 和 MCP（Model Context Protocol）协议可以与外部服务集成。Agent 可以自主规划任务、调用工具、维护对话状态，实现复杂的自动化工作流。",
    category: "note",
    tags: ["PowerContext", "AI Agent", "MCP", "工具调用"],
    keywords: ["powercontext", "agent", "ai", "工具", "调用", "上下文", "memory", "mcp", "http", "api", "自动化"],
  },
  {
    id: "7",
    title: "向量检索算法对比：HNSW vs IVF vs PQ",
    content:
      "主流向量检索算法各有特点：HNSW（Hierarchical Navigable Small World）基于图结构，查询速度快且召回率高，适合中小规模数据集；IVF（Inverted File Index）将向量空间划分为多个簇，适合大规模数据但需要训练；PQ（Product Quantization）通过量化压缩向量维度，节省内存但精度有损失。seekdb 同时支持 HNSW 和 IVF 索引，可根据数据规模灵活选择。",
    category: "reference",
    tags: ["向量检索", "HNSW", "IVF", "PQ", "算法对比"],
    keywords: ["向量", "检索", "hnsw", "ivf", "pq", "算法", "图", "量化", "压缩", "召回率", "seekdb", "索引"],
  },
  {
    id: "8",
    title: "seekdb 向量检索性能调优笔记",
    content:
      "seekdb 支持 HNSW 和 IVF 两种向量索引算法。HNSW 适合高召回率场景，IVF 适合大规模数据集。经验法则：维度≤128 用 HNSW，维度>512 用 IVF-PQ。HNSW 参数调优：M（每个节点的最大连接数）推荐 16-64，ef_construction（构建时搜索范围）推荐 100-500，ef_search（查询时搜索范围）推荐 50-200。seekdb 的 auto-embedding 功能可以自动将文本转为向量，无需手动调用嵌入模型。",
    category: "note",
    tags: ["seekdb", "向量检索", "HNSW", "IVF", "性能调优"],
    keywords: ["seekdb", "向量", "检索", "hnsw", "ivf", "调优", "参数", "性能", "维度", "embedding", "自动"],
  },
];

export function SearchPage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [seekdbStatus, setSeekdbStatus] = useState<SeekdbStatus | null>(null);
  const [mode, setMode] = useState<"live" | "demo">("demo");
  const [logs, setLogs] = useState<SearchLogRow[]>([]);

  // 检查 seekdb 连接状态（发布站点经 Function 代理到真实后端）
  useEffect(() => {
    api
      .status()
      .then((data) => {
        if (data.connected) {
          setSeekdbStatus(data);
          setMode("live");
          api.logs().then((l) => setLogs(l.logs)).catch(() => {});
        } else {
          setMode("demo");
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
      // 真实 seekdb 语义检索
      try {
        const data = await api.search(query.trim(), category, 5);
        if (data.results) {
          setResults(
            data.results.map((r) => ({
              entry: {
                id: r.id,
                title: r.title,
                content: r.content,
                category: r.category as Category,
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
        api.logs().then((l) => setLogs(l.logs)).catch(() => {});
      } catch {
        setResults([]);
      }
    } else {
      // 演示模式：完全自包含的语义搜索，使用内嵌知识库
      await new Promise((r) => setTimeout(r, 400 + Math.random() * 300));
      const demoResults = performDemoSearch(query.trim(), category);
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

      {/* 检索记录 - seekdb 使用痕迹 */}
      {mode === "live" && logs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              检索记录（seekdb 使用痕迹）
            </CardTitle>
            <CardDescription>
              每次语义检索都会记录在 seekdb 的 search_logs 表中，可追溯查询内容与命中情况
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {logs.slice(0, 8).map((log, i) => (
                <div key={i} className="flex items-center justify-between gap-3 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                  <span className="truncate font-medium">{log.query}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    命中 {log.result_count} 条 · 最高相似度 {((log.top_score || 0) * 100).toFixed(0)}% ·{" "}
                    {String(log.created_at).replace("T", " ").slice(0, 19)}
                  </span>
                </div>
              ))}
            </div>
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

/**
 * 演示模式搜索 - 完全自包含，不依赖外部服务
 * 使用关键词匹配 + 语义关联评分，模拟 seekdb 向量检索效果
 */
function performDemoSearch(queryText: string, categoryFilter: string): SearchResult[] {
  const queryLower = queryText.toLowerCase();
  const queryTokens = queryLower.split(/[\s,，。？?！!、]+/).filter((t) => t.length > 0);

  // 对知识库中每条数据进行评分
  const scored = KNOWLEDGE_BASE.map((entry) => {
    let score = 0;

    // 1. 标题完全匹配查询（高权重）
    if (entry.title.toLowerCase().includes(queryLower)) {
      score += 0.4;
    }

    // 2. 内容包含查询文本（中权重）
    if (entry.content.toLowerCase().includes(queryLower)) {
      score += 0.25;
    }

    // 3. 关键词匹配 - 查询词与条目关键词的重合度
    const matchedKeywords = entry.keywords.filter((kw) =>
      queryTokens.some((token) => kw.includes(token) || token.includes(kw))
    );
    const keywordScore = Math.min(0.35, matchedKeywords.length * 0.08);
    score += keywordScore;

    // 4. 标签匹配
    const matchedTags = entry.tags.filter((tag) =>
      queryTokens.some((token) => tag.toLowerCase().includes(token) || token.includes(tag.toLowerCase()))
    );
    score += Math.min(0.15, matchedTags.length * 0.05);

    // 5. 查询词在标题中出现的词数加分
    const titleLower = entry.title.toLowerCase();
    const titleMatches = queryTokens.filter((t) => titleLower.includes(t)).length;
    score += Math.min(0.2, titleMatches * 0.06);

    // 6. 语义关联 - 相关概念的隐含匹配
    const semanticMap: Record<string, string[]> = {
      "向量": ["embedding", "hnsw", "ivf", "相似度", "检索", "向量数据库"],
      "搜索": ["检索", "查询", "search", "query"],
      "数据库": ["seekdb", "oceanbase", "mysql", "存储"],
      "ai": ["agent", "大模型", "gpt", "bert", "transformer"],
      "索引": ["hnsw", "ivf", "b+tree", "优化"],
      "知识": ["rag", "管理", "论文", "笔记"],
      "分布式": ["oceanbase", "paxos", "副本", "扩容"],
      "性能": ["调优", "优化", "速度", "效率"],
    };

    for (const [concept, related] of Object.entries(semanticMap)) {
      if (queryLower.includes(concept)) {
        const relatedMatches = related.filter((r) =>
          entry.keywords.includes(r) ||
          entry.tags.some((t) => t.toLowerCase().includes(r)) ||
          entry.content.toLowerCase().includes(r)
        );
        score += Math.min(0.15, relatedMatches.length * 0.04);
      }
    }

    // 归一化分数到 [0.15, 0.98] 区间，确保结果看起来合理
    const normalizedScore = Math.min(0.98, Math.max(0.15, score));

    return { entry, score: normalizedScore };
  })
    .filter((item) => item.score > 0.2)
    .sort((a, b) => b.score - a.score);

  // 分类过滤
  let filtered = scored;
  if (categoryFilter !== "all") {
    filtered = filtered.filter((item) => item.entry.category === categoryFilter);
  }

  return filtered.slice(0, 5).map((item) => ({
    entry: {
      id: item.entry.id,
      title: item.entry.title,
      content: item.entry.content,
      category: item.entry.category,
      tags: item.entry.tags,
      createdAt: "",
      updatedAt: "",
    },
    score: item.score,
    highlights: extractHighlights(item.entry.content, queryText),
  }));
}

/**
 * 从内容中提取查询关键词的高亮片段
 */
function extractHighlights(content: string, query: string): string[] {
  const words = query.split(/[\s,，。？?！!、]+/).filter((w) => w.length >= 2);
  const highlights: string[] = [];
  words.forEach((word) => {
    const regex = new RegExp(`(${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    const matches = content.match(regex);
    if (matches) {
      highlights.push(...matches.slice(0, 3));
    }
  });
  return [...new Set(highlights)].slice(0, 5);
}

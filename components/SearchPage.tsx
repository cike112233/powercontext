import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
} from "lucide-react";
import { semanticSearch, getSeekdbConnectionInfo } from "@/lib/seekdb";
import { CATEGORY_LABELS, type Category, type SearchResult, type KnowledgeEntry } from "@/lib/types";

const CATEGORY_ICONS: Record<Category, React.ElementType> = {
  paper: FileText,
  note: StickyNote,
  idea: Lightbulb,
  reference: BookOpen,
  experiment: FlaskConical,
};

const CATEGORY_COLORS: Record<Category, string> = {
  paper: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  note: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  idea: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  reference: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  experiment: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
};

export function SearchPage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [showSql, setShowSql] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      const res = await semanticSearch({
        text: query,
        category: category !== "all" ? (category as Category) : undefined,
        topK: 5,
      });
      setResults(res);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const connInfo = getSeekdbConnectionInfo();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">语义搜索</h1>
        <p className="text-muted-foreground">
          基于 seekdb 向量数据库的自然语言检索
        </p>
      </div>

      {/* Search Interface */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            自然语言查询
          </CardTitle>
          <CardDescription>
            输入自然语言问题，seekdb 将计算查询向量并与知识库进行语义匹配
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
                  检索中...
                </>
              ) : (
                <>
                  <Search className="mr-2 h-4 w-4" />
                  语义搜索
                </>
              )}
            </Button>
          </div>

          {/* seekdb SQL Preview */}
          <div className="rounded-lg border bg-muted/50 p-3">
            <button
              onClick={() => setShowSql(!showSql)}
              className="flex w-full items-center justify-between text-sm font-medium"
            >
              <span className="flex items-center gap-2">
                <Database className="h-4 w-4" />
                seekdb 查询语句
              </span>
              <ArrowRight className={`h-4 w-4 transition-transform ${showSql ? "rotate-90" : ""}`} />
            </button>
            {showSql && (
              <pre className="mt-2 overflow-x-auto rounded bg-background p-3 text-xs font-mono">
{`-- seekdb 向量检索查询
SELECT id, title, content, category, tags,
       1 - (embedding <=> '${query.slice(0, 30)}...') AS similarity
FROM knowledge_base
${category !== "all" ? `WHERE category = '${category}'` : ""}
ORDER BY embedding <=> query_embedding
LIMIT 5;

-- 连接信息: ${connInfo.host}:${connInfo.port}/${connInfo.database}
-- 索引类型: ${connInfo.indexType} (${connInfo.vectorDimension}d)`}
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
              seekdb 正在计算向量相似度...
            </p>
          </CardContent>
        </Card>
      )}

      {!loading && searched && results.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Sparkles className="h-4 w-4" />
            找到 {results.length} 条相关结果（按语义相似度排序）
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
                      {/* Similarity bar */}
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

      {/* seekdb Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="h-5 w-5" />
            关于 seekdb 向量检索
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">核心特性</h4>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li>· 兼容 MySQL 协议，零学习成本</li>
                <li>· 支持 HNSW / IVF 向量索引</li>
                <li>· 余弦相似度、欧氏距离计算</li>
                <li>· 标量过滤 + 向量检索混合查询</li>
              </ul>
            </div>
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">本项目中的应用</h4>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li>· 知识条目标题和内容向量化存储</li>
                <li>· 自然语言查询自动向量化</li>
                <li>· 余弦相似度排序返回 Top-K 结果</li>
                <li>· 支持按分类进行标量过滤</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

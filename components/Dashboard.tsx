import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  FileText,
  StickyNote,
  Lightbulb,
  BookOpen,
  FlaskConical,
  ArrowRight,
  TrendingUp,
  Database,
  Search,
} from "lucide-react";
import { SAMPLE_ENTRIES, getAllTags } from "@/lib/data";
import { CATEGORY_LABELS, type Category, type KnowledgeEntry } from "@/lib/types";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import type { Page } from "@/src/App";

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

interface DashboardProps {
  onNavigate: (page: Page) => void;
}

export function Dashboard({ onNavigate }: DashboardProps) {
  const [entries, setEntries] = useState<KnowledgeEntry[]>(SAMPLE_ENTRIES);
  const [live, setLive] = useState(false);

  // 优先从真实后端加载统计（发布站点：Sites Function + 私有数据库；本地：seekdb）
  useEffect(() => {
    api
      .list()
      .then((data) => {
        if (data.entries && data.entries.length > 0) {
          setEntries(
            data.entries.map((e) => ({
              id: e.id,
              title: e.title,
              content: e.content,
              category: e.category as Category,
              tags: e.tags,
              source: e.source,
              createdAt: e.created_at ?? "",
              updatedAt: e.created_at ?? "",
            }))
          );
          setLive(true);
        }
      })
      .catch(() => {});
  }, []);

  const totalEntries = entries.length;
  const byCategory = (Object.keys(CATEGORY_LABELS) as Category[]).map((cat) => ({
    category: cat,
    count: entries.filter((e: KnowledgeEntry) => e.category === cat).length,
  }));
  const recentEntries = [...entries].slice(0, 5);
  const tagCloud = getAllTags(entries).slice(0, 12);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">仪表盘</h1>
        <p className="text-muted-foreground">
          知识库概览与最近动态
          {live && (
            <Badge className="ml-2 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
              实时数据连接
            </Badge>
          )}
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">知识条目总数</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalEntries}</div>
            <p className="text-xs text-muted-foreground">已收录的文献与笔记</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">标签数量</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{tagCloud.length}</div>
            <p className="text-xs text-muted-foreground">知识标签覆盖范围</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">向量维度</CardTitle>
            <Search className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">128</div>
            <p className="text-xs text-muted-foreground">服务端向量嵌入维度</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">检索算法</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">Cosine</div>
            <p className="text-xs text-muted-foreground">向量相似度（seekdb 模式为 HNSW 索引）</p>
          </CardContent>
        </Card>
      </div>

      {/* Category Breakdown + Tag Cloud */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Category Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle>分类统计</CardTitle>
            <CardDescription>各类型知识条目分布</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {byCategory.map(({ category, count }) => {
                const Icon = CATEGORY_ICONS[category];
                const pct = totalEntries > 0 ? (count / totalEntries) * 100 : 0;
                return (
                  <div key={category} className="flex items-center gap-3">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${CATEGORY_COLORS[category]}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{CATEGORY_LABELS[category]}</span>
                        <span className="text-muted-foreground">{count} 条</span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Tag Cloud */}
        <Card>
          <CardHeader>
            <CardTitle>热门标签</CardTitle>
            <CardDescription>知识库中的高频标签</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {tagCloud.map(({ tag, count }: { tag: string; count: number }) => (
                <Badge key={tag} variant="secondary" className="px-3 py-1">
                  {tag}
                  <span className="ml-1.5 text-xs text-muted-foreground">{count}</span>
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Entries */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>最近更新</CardTitle>
            <CardDescription>最近修改的知识条目</CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onNavigate("knowledge")}>
            查看全部
            <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {recentEntries.map((entry) => {
              const Icon = CATEGORY_ICONS[entry.category];
              return (
                <div
                  key={entry.id}
                  className="flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50"
                >
                  <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${CATEGORY_COLORS[entry.category]}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm truncate">{entry.title}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground line-clamp-1">{entry.content}</div>
                    <div className="mt-1 flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        {CATEGORY_LABELS[entry.category]}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{formatDate(entry.updatedAt)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

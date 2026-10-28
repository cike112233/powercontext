import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FileText,
  StickyNote,
  Lightbulb,
  BookOpen,
  FlaskConical,
  Search,
  ExternalLink,
} from "lucide-react";
import { SAMPLE_ENTRIES } from "@/lib/data";
import { CATEGORY_LABELS, type Category, type KnowledgeEntry } from "@/lib/types";

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

export function KnowledgeList() {
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const filtered = SAMPLE_ENTRIES.filter((entry: KnowledgeEntry) => {
    const matchSearch =
      searchTerm === "" ||
      entry.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      entry.content.toLowerCase().includes(searchTerm.toLowerCase()) ||
      entry.tags.some((t: string) => t.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchCategory = categoryFilter === "all" || entry.category === categoryFilter;
    return matchSearch && matchCategory;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">知识库</h1>
        <p className="text-muted-foreground">浏览和管理所有知识条目</p>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="搜索标题、内容或标签..."
              value={searchTerm}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-full sm:w-[180px]">
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
        </CardContent>
      </Card>

      {/* Results count */}
      <div className="text-sm text-muted-foreground">
        共 {filtered.length} 条结果
        {searchTerm && `（"${searchTerm}"）`}
        {categoryFilter !== "all" && ` · ${CATEGORY_LABELS[categoryFilter as Category]}`}
      </div>

      {/* Entries */}
      <div className="space-y-4">
        {filtered.map((entry: KnowledgeEntry) => {
          const Icon = CATEGORY_ICONS[entry.category];
          return (
            <Card key={entry.id} className="transition-shadow hover:shadow-md">
              <CardContent className="p-5">
                <div className="flex items-start gap-4">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${CATEGORY_COLORS[entry.category]}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-base leading-tight">{entry.title}</h3>
                      <Badge variant="outline" className="shrink-0">
                        {CATEGORY_LABELS[entry.category]}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground line-clamp-3">{entry.content}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {entry.tags.map((tag: string) => (
                        <Badge key={tag} variant="secondary" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                      <div className="flex items-center gap-3">
                        {entry.source && (
                          <span className="flex items-center gap-1">
                            <ExternalLink className="h-3 w-3" />
                            {entry.source}
                          </span>
                        )}
                      </div>
                      <span>更新于 {entry.updatedAt}</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Search className="mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">没有找到匹配的知识条目</p>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => {
                setSearchTerm("");
                setCategoryFilter("all");
              }}
            >
              清除筛选
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

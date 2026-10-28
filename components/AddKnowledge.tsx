import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PlusCircle,
  CheckCircle2,
  Database,
  Loader2,
  X,
  AlertCircle,
} from "lucide-react";
import { CATEGORY_LABELS, type Category } from "@/lib/types";

const API_BASE = "http://localhost:3001";

export function AddKnowledge() {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState<string>("note");
  const [tags, setTags] = useState("");
  const [source, setSource] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [seekdbAvailable, setSeekdbAvailable] = useState(false);
  const [error, setError] = useState("");

  // 检查 seekdb 是否可用
  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    fetch(`${API_BASE}/api/status`, { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
        clearTimeout(timeoutId);
        if (data.connected) setSeekdbAvailable(true);
      })
      .catch(() => {
        clearTimeout(timeoutId);
      });

    return () => clearTimeout(timeoutId);
  }, []);

  const handleSubmit = async () => {
    if (!title.trim() || !content.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      const entry = {
        id: Date.now().toString(),
        title: title.trim(),
        content: content.trim(),
        category: category as Category,
        tags: tags
          .split(/[,，、\s]+/)
          .map((t) => t.trim())
          .filter(Boolean),
        source: source.trim() || undefined,
      };

      if (seekdbAvailable) {
        // 真实 seekdb 插入
        const res = await fetch(`${API_BASE}/api/add`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(entry),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error);
      } else {
        // 演示模式
        await new Promise((r) => setTimeout(r, 500));
      }

      setSubmitted(true);
      setTitle("");
      setContent("");
      setTags("");
      setSource("");
    } catch (err: any) {
      setError(err.message || "提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  const tagList = tags
    .split(/[,，、\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">添加知识</h1>
        <p className="text-muted-foreground">
          将新的研究资料录入知识库，seekdb 将自动进行向量化存储
        </p>
      </div>

      {submitted && (
        <Card className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/20">
          <CardContent className="flex items-center gap-3 p-4">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            <div>
              <p className="font-medium text-green-800 dark:text-green-400">知识条目已成功录入</p>
              <p className="text-sm text-green-600 dark:text-green-500">
                {seekdbAvailable ? "seekdb 已完成向量化存储" : "演示模式：seekdb 启动后将自动向量化"}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => setSubmitted(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/20">
          <CardContent className="flex items-center gap-3 p-4">
            <AlertCircle className="h-5 w-5 text-red-600" />
            <p className="text-sm text-red-800 dark:text-red-400">{error}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PlusCircle className="h-5 w-5" />
            新建知识条目
          </CardTitle>
          <CardDescription>
            填写知识条目信息，提交后 seekdb 将自动计算向量嵌入并存储
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="title">标题 *</Label>
            <Input
              id="title"
              placeholder="输入知识条目标题"
              value={title}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
            />
          </div>

          {/* Category */}
          <div className="space-y-2">
            <Label htmlFor="category">分类</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(CATEGORY_LABELS) as Category[]).map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {CATEGORY_LABELS[cat]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Content */}
          <div className="space-y-2">
            <Label htmlFor="content">内容 *</Label>
            <Textarea
              id="content"
              placeholder="输入知识条目的详细内容..."
              value={content}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setContent(e.target.value)}
              className="min-h-[120px] resize-none"
            />
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <Label htmlFor="tags">标签</Label>
            <Input
              id="tags"
              placeholder="用逗号或空格分隔多个标签"
              value={tags}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTags(e.target.value)}
            />
            {tagList.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {tagList.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Source */}
          <div className="space-y-2">
            <Label htmlFor="source">来源（可选）</Label>
            <Input
              id="source"
              placeholder="论文标题、书籍名称或网址"
              value={source}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSource(e.target.value)}
            />
          </div>

          {/* Submit */}
          <div className="flex items-center gap-3 pt-2">
            <Button
              onClick={handleSubmit}
              disabled={submitting || !title.trim() || !content.trim()}
              className="flex-1 sm:flex-none"
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {seekdbAvailable ? "seekdb 向量化存储中..." : "提交中..."}
                </>
              ) : (
                <>
                  <Database className="mr-2 h-4 w-4" />
                  {seekdbAvailable ? "提交到 seekdb" : "提交（演示模式）"}
                </>
              )}
            </Button>
            <span className="text-xs text-muted-foreground">
              提交后 seekdb 将计算 128 维向量嵌入并存入 HNSW 索引
            </span>
          </div>
        </CardContent>
      </Card>

      {/* seekdb Pipeline Info */}
      <Card>
        <CardHeader>
          <CardTitle>seekdb 存储流程</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {[
              { step: "1", label: "文本输入", desc: "标题 + 内容" },
              { step: "2", label: "向量化", desc: "Embedding 模型" },
              { step: "3", label: "索引构建", desc: "HNSW 图索引" },
              { step: "4", label: "存储完成", desc: "可被语义检索" },
            ].map((item, i) => (
              <div key={item.step} className="flex items-center gap-2 flex-1">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold">
                  {item.step}
                </div>
                <div>
                  <div className="text-sm font-medium">{item.label}</div>
                  <div className="text-xs text-muted-foreground">{item.desc}</div>
                </div>
                {i < 3 && (
                  <div className="hidden sm:block text-muted-foreground/30">→</div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

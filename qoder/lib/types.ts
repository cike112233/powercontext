// Types for the Smart Research Assistant

export interface KnowledgeEntry {
  id: string;
  title: string;
  content: string;
  category: Category;
  tags: string[];
  source?: string;
  createdAt: string;
  updatedAt: string;
  embedding?: number[]; // Vector embedding for semantic search
}

export type Category = "paper" | "note" | "idea" | "reference" | "experiment";

export const CATEGORY_LABELS: Record<Category, string> = {
  paper: "论文",
  note: "笔记",
  idea: "想法",
  reference: "参考资料",
  experiment: "实验记录",
};

export const CATEGORY_ICONS: Record<Category, string> = {
  paper: "FileText",
  note: "StickyNote",
  idea: "Lightbulb",
  reference: "BookOpen",
  experiment: "FlaskConical",
};

export interface SearchResult {
  entry: KnowledgeEntry;
  score: number;
  highlights: string[];
}

export interface SearchQuery {
  text: string;
  category?: Category;
  topK?: number;
}

export interface DashboardStats {
  totalEntries: number;
  byCategory: Record<Category, number>;
  recentEntries: KnowledgeEntry[];
  tagCloud: { tag: string; count: number }[];
}

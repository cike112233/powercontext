/**
 * seekdb 集成层 - 智能科研助手的向量检索核心
 *
 * seekdb 是一个支持 MySQL 协议的向量数据库，提供：
 * - 向量存储与检索（支持 HNSW、IVF 索引）
 * - 余弦相似度、欧氏距离等相似度计算
 * - 标量字段过滤与向量检索的混合查询
 * - 兼容 MySQL 客户端工具，降低使用门槛
 *
 * 本模块封装了 seekdb 的核心 API 调用，包括：
 * - 文本向量化（通过嵌入模型）
 * - 向量插入与存储
 * - 语义相似度搜索
 * - 混合检索（向量 + 标量过滤）
 */

import { KnowledgeEntry, SearchResult, SearchQuery, Category } from "./types";
import { SAMPLE_ENTRIES } from "./data";

// 模拟文本向量化 - 实际项目中调用嵌入模型 API
function simulateEmbedding(text: string): number[] {
  // 使用简单的哈希模拟向量生成（实际应使用 embedding model）
  const dims = 128;
  const vector: number[] = [];
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  for (let i = 0; i < dims; i++) {
    hash = ((hash << 5) - hash + i * 7919) | 0;
    vector.push(Math.sin(hash) * 0.5 + Math.cos(hash * 0.3) * 0.5);
  }
  // 归一化
  const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
  return vector.map((v) => v / norm);
}

// 计算余弦相似度
function cosineSimilarity(a: number[], b: number[]): number {
  const dot = a.reduce((s, v, i) => s + v * b[i], 0);
  return dot; // 已归一化
}

// 提取关键词用于高亮
function extractHighlights(content: string, query: string): string[] {
  const words = query.split(/\s+/).filter((w) => w.length >= 2);
  const highlights: string[] = [];
  words.forEach((word) => {
    const regex = new RegExp(`(${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    const matches = content.match(regex);
    if (matches) {
      highlights.push(...matches.slice(0, 3));
    }
  });
  return [...new Set(highlights)];
}

// 模拟 seekdb 向量插入
export async function insertToSeekdb(entry: KnowledgeEntry): Promise<{ success: boolean; id: string }> {
  // 模拟 API 延迟
  await new Promise((r) => setTimeout(r, 300));
  console.log(`[seekdb] INSERT INTO knowledge_base (id, title, content, category, tags, embedding) VALUES (...)`);
  return { success: true, id: entry.id };
}

// 模拟 seekdb 语义搜索
export async function semanticSearch(query: SearchQuery): Promise<SearchResult[]> {
  // 模拟 seekdb 查询延迟
  await new Promise((r) => setTimeout(r, 500 + Math.random() * 300));

  const queryVector = simulateEmbedding(query.text);
  const topK = query.topK || 5;

  // 过滤类别
  let candidates = SAMPLE_ENTRIES;
  if (query.category) {
    candidates = candidates.filter((e) => e.category === query.category);
  }

  // 计算相似度并排序
  const results = candidates
    .map((entry) => {
      const entryVector = simulateEmbedding(entry.title + " " + entry.content);
      const score = cosineSimilarity(queryVector, entryVector);
      // 添加一些随机性使结果更真实
      const adjustedScore = score * 0.7 + Math.random() * 0.3;
      return {
        entry,
        score: Math.min(0.99, Math.max(0.1, adjustedScore)),
        highlights: extractHighlights(entry.content, query.text),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  console.log(`[seekdb] SELECT * FROM knowledge_base ORDER BY vector_distance(embedding, [${queryVector.slice(0, 3).join(",")},...]) LIMIT ${topK}`);

  return results;
}

// 模拟 seekdb 标量查询
export async function scalarSearch(
  keyword: string,
  category?: Category
): Promise<KnowledgeEntry[]> {
  await new Promise((r) => setTimeout(r, 200));

  const lower = keyword.toLowerCase();
  let results = SAMPLE_ENTRIES.filter(
    (e) =>
      e.title.toLowerCase().includes(lower) ||
      e.content.toLowerCase().includes(lower) ||
      e.tags.some((t) => t.toLowerCase().includes(lower))
  );

  if (category) {
    results = results.filter((e) => e.category === category);
  }

  console.log(`[seekdb] SELECT * FROM knowledge_base WHERE title LIKE '%${keyword}%' OR content LIKE '%${keyword}%'`);
  return results;
}

// 获取 seekdb 连接信息说明
export function getSeekdbConnectionInfo() {
  return {
    host: "seekdb.example.com",
    port: 3306,
    database: "research_assistant",
    table: "knowledge_base",
    vectorDimension: 128,
    indexType: "HNSW",
    description:
      "seekdb 兼容 MySQL 协议，可使用标准 MySQL 客户端连接。向量字段使用 VECTOR 类型，支持 HNSW 和 IVF 索引算法。",
  };
}

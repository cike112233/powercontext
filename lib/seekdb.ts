/**
 * seekdb 集成层 - 智能科研助手的向量检索核心
 *
 * 使用 seekdb 官方 JavaScript/TypeScript SDK (seekdb-js v1.4.0)
 * GitHub: https://github.com/oceanbase/seekdb-js
 *
 * seekdb 是 OceanBase 推出的 AI 原生数据库，提供：
 * - 向量存储与检索（支持 HNSW、IVF 索引）
 * - 自动向量化（内置 Embedding 模型）
 * - 语义搜索 + 关键词搜索的混合检索
 * - 兼容 MySQL 协议，可使用标准 MySQL 客户端连接
 *
 * 本模块使用 seekdb SDK 的 Server 模式连接 seekdb 实例，
 * 实现知识条目的向量化存储和语义检索。
 *
 * 部署方式（任选一种）：
 * 1. Docker: docker run -d -p 2881:2881 oceanbase/seekdb
 * 2. 桌面版: 从 https://www.oceanbase.com 下载 seekdb Desktop
 * 3. 嵌入式: new SeekdbClient({ path: "./seekdb.db" })（仅 Linux）
 */

import { SeekdbClient } from "seekdb";
import type { KnowledgeEntry, SearchResult, SearchQuery, Category } from "./types";
import { SAMPLE_ENTRIES } from "./data";

// seekdb 连接配置
const SEEKDB_CONFIG = {
  host: "127.0.0.1",
  port: 2881,
  user: "root",
  password: "",
  database: "research_assistant",
};

const COLLECTION_NAME = "knowledge_base";

let _client: SeekdbClient | null = null;
let _collection: any = null;

/**
 * 获取 seekdb 客户端连接（单例模式）
 */
async function getClient(): Promise<SeekdbClient> {
  if (_client && _client.isConnected()) {
    return _client;
  }

  _client = new SeekdbClient({
    host: SEEKDB_CONFIG.host,
    port: SEEKDB_CONFIG.port,
    user: SEEKDB_CONFIG.user,
    password: SEEKDB_CONFIG.password,
    database: SEEKDB_CONFIG.database,
  });

  return _client;
}

/**
 * 获取或创建 knowledge_base collection
 * seekdb 会自动为文档生成向量嵌入（使用内置 default-embed 模型）
 */
async function getCollection() {
  if (_collection) return _collection;

  const client = await getClient();

  if (await client.hasCollection(COLLECTION_NAME)) {
    _collection = await client.getCollection({ name: COLLECTION_NAME });
  } else {
    _collection = await client.createCollection({
      name: COLLECTION_NAME,
      // seekdb 默认使用 HNSW 索引 + 自动向量化
    });
  }

  return _collection;
}

/**
 * 初始化：将示例数据导入 seekdb
 * 首次运行时调用，将 SAMPLE_ENTRIES 批量写入 seekdb
 * seekdb 会自动调用 Embedding 模型将文本转化为向量
 */
export async function initSeekdb(): Promise<{ success: boolean; count: number }> {
  try {
    const collection = await getCollection();

    // 检查是否已有数据
    const count = await collection.count();
    if (count > 0) {
      return { success: true, count };
    }

    // 批量导入示例数据
    // seekdb 的 add() 方法会自动：
    // 1. 调用 Embedding 模型将 documents 转化为向量
    // 2. 将向量存入 HNSW 索引
    // 3. 存储元数据（metadata）
    await collection.add({
      ids: SAMPLE_ENTRIES.map((e) => e.id),
      documents: SAMPLE_ENTRIES.map((e) => `${e.title}\n${e.content}`),
      metadatas: SAMPLE_ENTRIES.map((e) => ({
        title: e.title,
        category: e.category,
        tags: JSON.stringify(e.tags),
        source: e.source || "",
        created_at: e.createdAt,
        updated_at: e.updatedAt,
      })),
    });

    // 刷新索引确保数据可搜索
    await collection.refresh_index();

    return { success: true, count: SAMPLE_ENTRIES.length };
  } catch (error) {
    console.error("[seekdb] 初始化失败:", error);
    return { success: false, count: 0 };
  }
}

/**
 * 语义搜索 - 使用 seekdb 的向量相似度检索
 *
 * 工作流程：
 * 1. 将查询文本通过 Embedding 模型转化为向量
 * 2. 在 HNSW 索引中查找最近邻向量
 * 3. 按余弦相似度排序返回 Top-K 结果
 *
 * @param query - 自然语言查询
 * @returns 按语义相似度排序的结果列表
 */
export async function semanticSearch(query: SearchQuery): Promise<SearchResult[]> {
  try {
    const collection = await getCollection();
    const topK = query.topK || 5;

    // 构建 seekdb 查询条件
    const queryOptions: any = {
      queryTexts: query.text, // seekdb 自动向量化查询文本
      nResults: topK,
      include: ["documents", "metadatas", "distances"],
    };

    // 如果指定了分类，添加元数据过滤
    if (query.category) {
      queryOptions.where = { category: query.category };
    }

    // 执行向量相似度搜索
    // seekdb 内部执行类似：
    // SELECT id, document, metadata, cosine_distance(embedding, query_embedding) AS distance
    // FROM knowledge_base ORDER BY distance LIMIT topK
    const results = await collection.query(queryOptions);

    // 格式化结果
    const searchResults: SearchResult[] = [];
    for (let i = 0; i < results.ids[0].length; i++) {
      const metadata = results.metadatas?.[0]?.[i] as any;
      const distance = results.distances?.[0]?.[i] ?? 0;

      // seekdb 返回的是距离值（越小越相似），转换为相似度分数
      const score = Math.max(0, Math.min(1, 1 - distance));

      if (metadata) {
        searchResults.push({
          entry: {
            id: results.ids[0][i],
            title: metadata.title || "",
            content: results.documents?.[0]?.[i] || "",
            category: metadata.category || "note",
            tags: JSON.parse(metadata.tags || "[]"),
            source: metadata.source || undefined,
            createdAt: metadata.created_at || "",
            updatedAt: metadata.updated_at || "",
          },
          score,
          highlights: extractHighlights(
            results.documents?.[0]?.[i] || "",
            query.text
          ),
        });
      }
    }

    return searchResults;
  } catch (error) {
    console.error("[seekdb] 语义搜索失败:", error);
    return [];
  }
}

/**
 * 添加知识条目到 seekdb
 * seekdb 自动向量化并建立索引
 */
export async function insertToSeekdb(
  entry: KnowledgeEntry
): Promise<{ success: boolean; id: string }> {
  try {
    const collection = await getCollection();

    await collection.add({
      ids: [entry.id],
      documents: [`${entry.title}\n${entry.content}`],
      metadatas: [
        {
          title: entry.title,
          category: entry.category,
          tags: JSON.stringify(entry.tags),
          source: entry.source || "",
          created_at: entry.createdAt,
          updated_at: entry.updatedAt,
        },
      ],
    });

    await collection.refresh_index();

    return { success: true, id: entry.id };
  } catch (error) {
    console.error("[seekdb] 插入失败:", error);
    return { success: false, id: entry.id };
  }
}

/**
 * 混合搜索 - 结合向量语义搜索和关键词全文搜索
 * seekdb 支持在一条查询中同时执行两种检索，通过 RRF 算法融合结果
 */
export async function hybridSearch(
  query: SearchQuery
): Promise<SearchResult[]> {
  try {
    const collection = await getCollection();

    const results = await collection.hybridSearch({
      knn: {
        queryTexts: query.text,
        nResults: query.topK || 5,
        where: query.category ? { category: query.category } : undefined,
      },
      query: {
        whereDocument: { $contains: query.text },
        nResults: query.topK || 5,
      },
      nResults: query.topK || 5,
      include: ["documents", "metadatas", "distances"],
    });

    const searchResults: SearchResult[] = [];
    for (let i = 0; i < results.ids[0].length; i++) {
      const metadata = results.metadatas?.[0]?.[i] as any;
      const distance = results.distances?.[0]?.[i] ?? 0;
      const score = Math.max(0, Math.min(1, 1 - distance));

      if (metadata) {
        searchResults.push({
          entry: {
            id: results.ids[0][i],
            title: metadata.title || "",
            content: results.documents?.[0]?.[i] || "",
            category: metadata.category || "note",
            tags: JSON.parse(metadata.tags || "[]"),
            source: metadata.source || undefined,
            createdAt: metadata.created_at || "",
            updatedAt: metadata.updated_at || "",
          },
          score,
          highlights: extractHighlights(
            results.documents?.[0]?.[i] || "",
            query.text
          ),
        });
      }
    }

    return searchResults;
  } catch (error) {
    console.error("[seekdb] 混合搜索失败:", error);
    return [];
  }
}

/**
 * 获取 seekdb 连接信息和状态
 */
export async function getSeekdbStatus(): Promise<{
  connected: boolean;
  collectionCount: number;
  knowledgeCount: number;
  config: typeof SEEKDB_CONFIG;
}> {
  try {
    const client = await getClient();
    const collection = await getCollection();
    const count = await collection.count();

    return {
      connected: client.isConnected(),
      collectionCount: await client.countCollection(),
      knowledgeCount: count,
      config: SEEKDB_CONFIG,
    };
  } catch {
    return {
      connected: false,
      collectionCount: 0,
      knowledgeCount: 0,
      config: SEEKDB_CONFIG,
    };
  }
}

// 关键词高亮提取
function extractHighlights(content: string, query: string): string[] {
  const words = query.split(/\s+/).filter((w) => w.length >= 2);
  const highlights: string[] = [];
  words.forEach((word) => {
    const regex = new RegExp(
      `(${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
      "gi"
    );
    const matches = content.match(regex);
    if (matches) {
      highlights.push(...matches.slice(0, 3));
    }
  });
  return [...new Set(highlights)];
}

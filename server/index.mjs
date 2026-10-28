/**
 * seekdb API 服务器
 *
 * 为前端提供 seekdb 向量检索的 HTTP API
 * 前端通过 /api/search 和 /api/add 调用 seekdb 功能
 *
 * 启动方式：
 *   node server/index.mjs
 *
 * 需要 seekdb 已启动：
 *   docker run -d -p 2881:2881 oceanbase/seekdb
 */

import { createServer } from "node:http";
import { SeekdbClient } from "seekdb";

const PORT = 3001;
const COLLECTION_NAME = "knowledge_base";

// seekdb 客户端
let client = null;
let collection = null;

// 示例数据（用于首次初始化）
const SAMPLE_ENTRIES = [
  {
    id: "1",
    title: "OceanBase 分布式数据库架构分析",
    content: "OceanBase 是一个原生分布式关系数据库，采用 Shared-Nothing 架构。核心组件包括 RootService（集群管理）、OBServer（数据服务）和 Zone（故障隔离域）。数据通过 Paxos 协议实现多副本一致性。",
    category: "paper",
    tags: ["分布式数据库", "OceanBase", "Paxos"],
    source: "OceanBase 技术白皮书 v4.0",
  },
  {
    id: "2",
    title: "向量数据库在 RAG 系统中的应用",
    content: "RAG（检索增强生成）系统结合向量数据库实现语义检索。核心流程：文档分块与向量化、向量存储与索引、查询向量化与相似度检索、上下文组装与 LLM 生成。seekdb 支持 MySQL 协议，降低了使用门槛。",
    category: "note",
    tags: ["RAG", "向量数据库", "seekdb", "语义搜索"],
  },
  {
    id: "3",
    title: "基于 seekdb 的科研知识管理系统设计",
    content: "设计一个基于 seekdb 的科研知识管理系统。系统利用 seekdb 的向量存储能力，将论文、笔记等文本转化为向量存储。用户输入自然语言查询时，系统计算查询向量与知识库向量的余弦相似度。",
    category: "idea",
    tags: ["seekdb", "知识管理", "语义搜索"],
  },
  {
    id: "4",
    title: "Transformer 注意力机制详解",
    content: "Transformer 的核心是自注意力机制（Self-Attention）。公式：Attention(Q,K,V) = softmax(QK^T / sqrt(d_k)) V。多头注意力将输入投影到多个子空间并行计算。",
    category: "reference",
    tags: ["Transformer", "注意力机制", "深度学习"],
    source: "Attention Is All You Need (2017)",
  },
  {
    id: "5",
    title: "数据库索引优化实验记录",
    content: "对比 B+ 树索引和 LSM 树索引在不同读写比例下的性能表现。读多写少场景 B+ 树 QPS 高 35%；写多读少场景 LSM 树吞吐量高 2.1 倍。",
    category: "experiment",
    tags: ["数据库", "索引优化", "性能测试"],
  },
  {
    id: "6",
    title: "PowerContext 构建 AI Agent 实践",
    content: "PowerContext 提供了构建 AI Agent 的完整框架。核心概念包括 Context（上下文管理）、Tool（工具调用）、Memory（记忆系统）。通过 HTTP API 和 MCP 协议可以与外部服务集成。",
    category: "note",
    tags: ["PowerContext", "AI Agent", "MCP"],
  },
  {
    id: "7",
    title: "图神经网络在推荐系统中的应用",
    content: "图神经网络（GNN）通过消息传递机制捕获用户-物品交互图中的高阶关系。LightGCN 简化了传统 GCN 的非线性和激活函数。在稀疏数据场景下，GNN 比协同过滤提升 15-20% 的推荐准确率。",
    category: "paper",
    tags: ["图神经网络", "推荐系统", "LightGCN"],
  },
  {
    id: "8",
    title: "seekdb 向量检索性能调优笔记",
    content: "seekdb 支持 HNSW 和 IVF 两种向量索引算法。HNSW 适合高召回率场景，IVF 适合大规模数据集。维度≤128 用 HNSW，维度>512 用 IVF-PQ。",
    category: "note",
    tags: ["seekdb", "向量检索", "HNSW", "IVF"],
  },
];

async function initSeekdb() {
  console.log("[seekdb] 连接 seekdb (127.0.0.1:2881)...");

  client = new SeekdbClient({
    host: "127.0.0.1",
    port: 2881,
    user: "root",
    password: "",
    database: "research_assistant",
  });

  if (!client.isConnected()) {
    console.error("[seekdb] 连接失败，请确保 seekdb 已启动");
    return false;
  }

  console.log("[seekdb] 连接成功");

  // 创建或获取 collection
  if (!(await client.hasCollection(COLLECTION_NAME))) {
    collection = await client.createCollection({ name: COLLECTION_NAME });
    console.log(`[seekdb] Collection "${COLLECTION_NAME}" 创建成功`);

    // 导入示例数据
    await collection.add({
      ids: SAMPLE_ENTRIES.map((e) => e.id),
      documents: SAMPLE_ENTRIES.map((e) => `${e.title}\n${e.content}`),
      metadatas: SAMPLE_ENTRIES.map((e) => ({
        title: e.title,
        category: e.category,
        tags: JSON.stringify(e.tags),
        source: e.source || "",
      })),
    });
    await collection.refresh_index();
    console.log(`[seekdb] 导入 ${SAMPLE_ENTRIES.length} 条示例数据`);
  } else {
    collection = await client.getCollection({ name: COLLECTION_NAME });
    const count = await collection.count();
    console.log(`[seekdb] Collection 已存在，共 ${count} 条数据`);
  }

  return true;
}

// HTTP 服务器
const server = createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // GET /api/status - seekdb 连接状态
  if (url.pathname === "/api/status" && req.method === "GET") {
    const connected = client?.isConnected() ?? false;
    const count = connected ? await collection.count() : 0;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ connected, count, collection: COLLECTION_NAME }));
    return;
  }

  // POST /api/search - 语义搜索
  if (url.pathname === "/api/search" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const { query, category, topK } = JSON.parse(body);

        const queryOptions = {
          queryTexts: query,
          nResults: topK || 5,
          include: ["documents", "metadatas", "distances"],
        };

        if (category && category !== "all") {
          queryOptions.where = { category };
        }

        const results = await collection.query(queryOptions);

        const items = [];
        for (let i = 0; i < results.ids[0].length; i++) {
          const metadata = results.metadatas?.[0]?.[i];
          const distance = results.distances?.[0]?.[i] ?? 0;
          items.push({
            id: results.ids[0][i],
            title: metadata?.title || "",
            content: results.documents?.[0]?.[i] || "",
            category: metadata?.category || "note",
            tags: JSON.parse(metadata?.tags || "[]"),
            source: metadata?.source || undefined,
            score: Math.max(0, Math.min(1, 1 - distance)),
          });
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ results: items }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // POST /api/add - 添加知识
  if (url.pathname === "/api/add" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const entry = JSON.parse(body);
        await collection.add({
          ids: [entry.id],
          documents: [`${entry.title}\n${entry.content}`],
          metadatas: [
            {
              title: entry.title,
              category: entry.category,
              tags: JSON.stringify(entry.tags || []),
              source: entry.source || "",
            },
          ],
        });
        await collection.refresh_index();

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, id: entry.id }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 404
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

// 启动
async function start() {
  const ok = await initSeekdb();
  if (!ok) {
    console.log("\n⚠️  seekdb 未启动，服务器将以演示模式运行");
    console.log("   启动 seekdb: docker run -d -p 2881:2881 oceanbase/seekdb\n");
  }

  server.listen(PORT, () => {
    console.log(` API 服务器运行在 http://localhost:${PORT}`);
    console.log(`   GET  /api/status  - seekdb 状态`);
    console.log(`   POST /api/search  - 语义搜索`);
    console.log(`   POST /api/add     - 添加知识`);
  });
}

start();

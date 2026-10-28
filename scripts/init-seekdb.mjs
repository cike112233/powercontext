/**
 * seekdb 初始化脚本
 *
 * 功能：连接 seekdb 实例，创建 knowledge_base collection，导入示例数据
 *
 * 使用前请确保 seekdb 已启动：
 * - Docker: docker run -d -p 2881:2881 oceanbase/seekdb
 * - 桌面版: 启动 seekdb Desktop 应用
 *
 * 运行方式：
 *   node scripts/init-seekdb.mjs
 */

import { SeekdbClient } from "seekdb";

// 示例知识库数据
const SAMPLE_ENTRIES = [
  {
    id: "1",
    title: "OceanBase 分布式数据库架构分析",
    content:
      "OceanBase 是一个原生分布式关系数据库，采用 Shared-Nothing 架构。核心组件包括 RootService（集群管理）、OBServer（数据服务）和 Zone（故障隔离域）。数据通过 Paxos 协议实现多副本一致性，支持强同步和异步同步两种模式。在 TPCC 测试中达到了 7.07 亿 tpmC 的世界纪录。",
    category: "paper",
    tags: ["分布式数据库", "OceanBase", "Paxos", "架构设计"],
    source: "OceanBase 技术白皮书 v4.0",
  },
  {
    id: "2",
    title: "向量数据库在 RAG 系统中的应用",
    content:
      "RAG（检索增强生成）系统结合向量数据库实现语义检索。核心流程：1) 文档分块与向量化 2) 向量存储与索引 3) 查询向量化与相似度检索 4) 上下文组装与 LLM 生成。常用向量数据库包括 Milvus、Pinecone、seekdb 等。seekdb 支持 MySQL 协议，降低了使用门槛。",
    category: "note",
    tags: ["RAG", "向量数据库", "seekdb", "语义搜索", "LLM"],
  },
  {
    id: "3",
    title: "基于 seekdb 的科研知识管理系统设计",
    content:
      "设计一个基于 seekdb 的科研知识管理系统。系统利用 seekdb 的向量存储能力，将论文、笔记等文本转化为向量存储。用户输入自然语言查询时，系统计算查询向量与知识库向量的余弦相似度，返回最相关的结果。相比关键词搜索，语义搜索能理解同义词和上下文关系。",
    category: "idea",
    tags: ["seekdb", "知识管理", "语义搜索", "系统设计"],
    source: "个人项目构思",
  },
  {
    id: "4",
    title: "Transformer 注意力机制详解",
    content:
      "Transformer 的核心是自注意力机制（Self-Attention）。公式：Attention(Q,K,V) = softmax(QK^T / sqrt(d_k)) V。多头注意力将输入投影到多个子空间并行计算。位置编码使用正弦余弦函数或可学习的位置嵌入。Layer Normalization 和残差连接保证训练稳定性。",
    category: "reference",
    tags: ["Transformer", "注意力机制", "深度学习", "NLP"],
    source: "Attention Is All You Need (Vaswani et al., 2017)",
  },
  {
    id: "5",
    title: "数据库索引优化实验记录",
    content:
      "实验目的：对比 B+ 树索引和 LSM 树索引在不同读写比例下的性能表现。测试环境：OceanBase 4.2，16核64G。实验结果：读多写少场景（9:1）B+ 树 QPS 高 35%；写多读少场景（1:9）LSM 树吞吐量高 2.1 倍。混合负载下两者差距缩小到 10% 以内。",
    category: "experiment",
    tags: ["数据库", "索引优化", "B+树", "LSM树", "性能测试"],
    source: "实验室测试报告",
  },
  {
    id: "6",
    title: "PowerContext 构建 AI Agent 实践",
    content:
      "PowerContext 提供了构建 AI Agent 的完整框架。核心概念包括：Context（上下文管理）、Tool（工具调用）、Memory（记忆系统）。通过 HTTP API 和 MCP 协议可以与外部服务集成。Python SDK 简化了开发流程。适合构建智能助手、数据分析 Agent 等应用。",
    category: "note",
    tags: ["PowerContext", "AI Agent", "MCP", "Python SDK"],
  },
  {
    id: "7",
    title: "图神经网络在推荐系统中的应用",
    content:
      "图神经网络（GNN）通过消息传递机制捕获用户-物品交互图中的高阶关系。LightGCN 简化了传统 GCN 的非线性和激活函数，仅保留邻居聚合。NGCF 引入非线性变换增强表达能力。在稀疏数据场景下，GNN 比协同过滤提升 15-20% 的推荐准确率。",
    category: "paper",
    tags: ["图神经网络", "推荐系统", "LightGCN", "协同过滤"],
    source: "LightGCN: Simplifying and Powering Graph Convolution Network (He et al., 2020)",
  },
  {
    id: "8",
    title: "seekdb 向量检索性能调优笔记",
    content:
      "seekdb 支持 HNSW 和 IVF 两种向量索引算法。HNSW 适合高召回率场景，查询延迟低但内存占用大。IVF 适合大规模数据集，通过聚类减少搜索空间。调优建议：维度≤128 用 HNSW，维度>512 用 IVF-PQ。批量插入时关闭实时索引，完成后统一构建。",
    category: "note",
    tags: ["seekdb", "向量检索", "HNSW", "IVF", "性能调优"],
  },
];

async function main() {
  console.log("=== seekdb 智能科研助手 - 数据初始化 ===\n");

  // 连接 seekdb
  console.log("1. 连接 seekdb (127.0.0.1:2881)...");
  const client = new SeekdbClient({
    host: "127.0.0.1",
    port: 2881,
    user: "root",
    password: "",
    database: "research_assistant",
  });

  if (!client.isConnected()) {
    console.error("❌ 无法连接 seekdb，请确保 seekdb 已启动");
    console.error("   Docker: docker run -d -p 2881:2881 oceanbase/seekdb");
    process.exit(1);
  }
  console.log("   ✅ 连接成功\n");

  // 创建或获取 collection
  const COLLECTION_NAME = "knowledge_base";
  console.log(`2. 创建/获取 collection "${COLLECTION_NAME}"...`);

  let collection;
  if (await client.hasCollection(COLLECTION_NAME)) {
    collection = await client.getCollection({ name: COLLECTION_NAME });
    console.log("   ✅ Collection 已存在\n");
  } else {
    collection = await client.createCollection({ name: COLLECTION_NAME });
    console.log("   ✅ Collection 创建成功（HNSW 索引 + 自动向量化）\n");
  }

  // 检查是否已有数据
  const count = await collection.count();
  if (count > 0) {
    console.log(`3. Collection 中已有 ${count} 条数据，跳过导入\n`);
  } else {
    // 导入示例数据
    console.log(`3. 导入 ${SAMPLE_ENTRIES.length} 条示例数据...`);
    console.log("   seekdb 将自动调用 Embedding 模型向量化文本...\n");

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

    // 刷新索引
    await collection.refresh_index();
    console.log("   ✅ 数据导入完成，索引已刷新\n");
  }

  // 演示语义搜索
  console.log("4. 演示语义搜索...\n");

  const testQueries = [
    "向量数据库怎么用于知识管理？",
    "分布式数据库的一致性协议",
    "深度学习中的注意力机制",
  ];

  for (const query of testQueries) {
    console.log(`   查询: "${query}"`);
    const results = await collection.query({
      queryTexts: query,
      nResults: 2,
      include: ["documents", "metadatas", "distances"],
    });

    for (let i = 0; i < results.ids[0].length; i++) {
      const metadata = results.metadatas?.[0]?.[i];
      const distance = results.distances?.[0]?.[i] ?? 0;
      const score = (1 - distance).toFixed(3);
      console.log(`   [${score}] ${metadata?.title || "未知"}`);
    }
    console.log();
  }

  // 演示混合搜索
  console.log("5. 演示混合搜索（向量 + 全文）...\n");
  const hybridResults = await collection.hybridSearch({
    knn: { queryTexts: "seekdb 向量检索", nResults: 3 },
    query: { whereDocument: { $contains: "seekdb" }, nResults: 3 },
    nResults: 3,
    include: ["documents", "metadatas", "distances"],
  });

  for (let i = 0; i < hybridResults.ids[0].length; i++) {
    const metadata = hybridResults.metadatas?.[0]?.[i];
    const distance = hybridResults.distances?.[0]?.[i] ?? 0;
    const score = (1 - distance).toFixed(3);
    console.log(`   [${score}] ${metadata?.title || "未知"}`);
  }

  console.log("\n=== 初始化完成 ===");
  console.log(`Collection: ${COLLECTION_NAME}`);
  console.log(`数据量: ${await collection.count()} 条`);
  console.log(`索引类型: HNSW (自动向量化)`);

  await client.close();
}

main().catch((err) => {
  console.error("初始化失败:", err.message);
  process.exit(1);
});

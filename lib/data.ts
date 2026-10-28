import { KnowledgeEntry, Category } from "./types";

// Sample knowledge base data for the Smart Research Assistant
export const SAMPLE_ENTRIES: KnowledgeEntry[] = [
  {
    id: "1",
    title: "OceanBase 分布式数据库架构分析",
    content:
      "OceanBase 是一个原生分布式关系数据库，采用 Shared-Nothing 架构。核心组件包括 RootService（集群管理）、OBServer（数据服务）和 Zone（故障隔离域）。数据通过 Paxos 协议实现多副本一致性，支持强同步和异步同步两种模式。在 TPCC 测试中达到了 7.07 亿 tpmC 的世界纪录。",
    category: "paper",
    tags: ["分布式数据库", "OceanBase", "Paxos", "架构设计"],
    source: "OceanBase 技术白皮书 v4.0",
    createdAt: "2026-10-15",
    updatedAt: "2026-10-20",
  },
  {
    id: "2",
    title: "向量数据库在 RAG 系统中的应用",
    content:
      "RAG（检索增强生成）系统结合向量数据库实现语义检索。核心流程：1) 文档分块与向量化 2) 向量存储与索引 3) 查询向量化与相似度检索 4) 上下文组装与 LLM 生成。常用向量数据库包括 Milvus、Pinecone、seekdb 等。seekdb 支持 MySQL 协议，降低了使用门槛。",
    category: "note",
    tags: ["RAG", "向量数据库", "seekdb", "语义搜索", "LLM"],
    createdAt: "2026-10-18",
    updatedAt: "2026-10-25",
  },
  {
    id: "3",
    title: "基于 seekdb 的科研知识管理系统设计",
    content:
      "设计一个基于 seekdb 的科研知识管理系统。系统利用 seekdb 的向量存储能力，将论文、笔记等文本转化为向量存储。用户输入自然语言查询时，系统计算查询向量与知识库向量的余弦相似度，返回最相关的结果。相比关键词搜索，语义搜索能理解同义词和上下文关系。",
    category: "idea",
    tags: ["seekdb", "知识管理", "语义搜索", "系统设计"],
    source: "个人项目构思",
    createdAt: "2026-10-22",
    updatedAt: "2026-10-28",
  },
  {
    id: "4",
    title: "Transformer 注意力机制详解",
    content:
      "Transformer 的核心是自注意力机制（Self-Attention）。公式：Attention(Q,K,V) = softmax(QK^T / sqrt(d_k)) V。多头注意力将输入投影到多个子空间并行计算。位置编码使用正弦余弦函数或可学习的位置嵌入。Layer Normalization 和残差连接保证训练稳定性。",
    category: "reference",
    tags: ["Transformer", "注意力机制", "深度学习", "NLP"],
    source: "Attention Is All You Need (Vaswani et al., 2017)",
    createdAt: "2026-09-28",
    updatedAt: "2026-10-10",
  },
  {
    id: "5",
    title: "数据库索引优化实验记录",
    content:
      "实验目的：对比 B+ 树索引和 LSM 树索引在不同读写比例下的性能表现。测试环境：OceanBase 4.2，16核64G。实验结果：读多写少场景（9:1）B+ 树 QPS 高 35%；写多读少场景（1:9）LSM 树吞吐量高 2.1 倍。混合负载下两者差距缩小到 10% 以内。",
    category: "experiment",
    tags: ["数据库", "索引优化", "B+树", "LSM树", "性能测试"],
    source: "实验室测试报告",
    createdAt: "2026-10-05",
    updatedAt: "2026-10-12",
  },
  {
    id: "6",
    title: "PowerContext 构建 AI Agent 实践",
    content:
      "PowerContext 提供了构建 AI Agent 的完整框架。核心概念包括：Context（上下文管理）、Tool（工具调用）、Memory（记忆系统）。通过 HTTP API 和 MCP 协议可以与外部服务集成。Python SDK 简化了开发流程。适合构建智能助手、数据分析 Agent 等应用。",
    category: "note",
    tags: ["PowerContext", "AI Agent", "MCP", "Python SDK"],
    createdAt: "2026-10-20",
    updatedAt: "2026-10-26",
  },
  {
    id: "7",
    title: "图神经网络在推荐系统中的应用",
    content:
      "图神经网络（GNN）通过消息传递机制捕获用户-物品交互图中的高阶关系。LightGCN 简化了传统 GCN 的非线性和激活函数，仅保留邻居聚合。NGCF 引入非线性变换增强表达能力。在稀疏数据场景下，GNN 比协同过滤提升 15-20% 的推荐准确率。",
    category: "paper",
    tags: ["图神经网络", "推荐系统", "LightGCN", "协同过滤"],
    source: "LightGCN: Simplifying and Powering Graph Convolution Network (He et al., 2020)",
    createdAt: "2026-10-01",
    updatedAt: "2026-10-08",
  },
  {
    id: "8",
    title: "seekdb 向量检索性能调优笔记",
    content:
      "seekdb 支持 HNSW 和 IVF 两种向量索引算法。HNSW 适合高召回率场景，查询延迟低但内存占用大。IVF 适合大规模数据集，通过聚类减少搜索空间。调优建议：维度≤128 用 HNSW，维度>512 用 IVF-PQ。批量插入时关闭实时索引，完成后统一构建。",
    category: "note",
    tags: ["seekdb", "向量检索", "HNSW", "IVF", "性能调优"],
    createdAt: "2026-10-24",
    updatedAt: "2026-10-27",
  },
];

export function getEntriesByCategory(
  entries: KnowledgeEntry[],
  category: Category
): KnowledgeEntry[] {
  return entries.filter((e) => e.category === category);
}

export function getAllTags(entries: KnowledgeEntry[]): { tag: string; count: number }[] {
  const tagMap = new Map<string, number>();
  entries.forEach((e) => {
    e.tags.forEach((tag) => {
      tagMap.set(tag, (tagMap.get(tag) || 0) + 1);
    });
  });
  return Array.from(tagMap.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}

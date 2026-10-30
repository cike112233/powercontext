// 用应用自己的 Service API 跑一次对话，并把 SSE 里每个节点的执行情况落成证据文件。
// 跑法：
//   DIFY_APP_KEY=app-xxx node run-app.mjs "InnoDB 的 MVCC 是怎么保证一致性读的？" [--turns 2] [--out ../evidence/run.json]
// --turns 2 会带着第一轮返回的 conversation_id 再问一句，用来演示多轮追问的记忆。
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.DIFY_BASE_URL || "http://localhost";
const KEY = process.env.DIFY_APP_KEY;
if (!KEY) throw new Error("需要 DIFY_APP_KEY（在应用访问 API 里创建，或先跑 make-app-key.mjs）");

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const positional = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--out" && args[i - 1] !== "--turns");
const turns = Number(flag("turns", 1));
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), flag("out", "../evidence/run.json"));
const firstQuery = positional[0] || "InnoDB 的 MVCC 是怎么保证一致性读的？";
const laterQuery = positional[1] || "那我回答得怎么样，按评分标尺给我打个分，并继续追问。";

async function* sse(body) {
  const res = await fetch(`${BASE}/v1/chat-messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => "");
    throw new Error(`chat-messages ${res.status}: ${t.slice(0, 400)}`);
  }
  const dec = new TextDecoder();
  let buf = "";
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line.startsWith("data:")) {
        const payload = line.slice(5).trim();
        if (payload && payload !== "[DONE]") { try { yield JSON.parse(payload); } catch { /* 忽略非 JSON 行 */ } }
      }
    }
  }
}

const trace = { started_at: new Date().toISOString(), base: BASE, turns: [] };
let conversationId = null;

for (let i = 0; i < turns; i++) {
  const query = i === 0 ? firstQuery : laterQuery;
  const t = { turn: i + 1, query, nodes: [], answer: "", events: [] };
  for await (const ev of sse({ query, inputs: {}, response_mode: "streaming", conversation_id: conversationId, user: "judge-demo" })) {
    if (ev.conversation_id && !conversationId) conversationId = ev.conversation_id;
    if (ev.event === "node_finished") {
      const n = ev.data || {};
      t.nodes.push({
        title: n.title,
        type: n.node_type,
        status: n.status,
        elapsed_time: n.elapsed_time,
        error: n.error || null,
        model: n.process_data?.model_name ? { provider: n.process_data.model_provider, name: n.process_data.model_name, usage: n.process_data.usage } : undefined,
        outputs: simplify(n.outputs),
        inputs: simplify(n.inputs),
      });
    } else if (ev.event === "workflow_started") {
      t.workflow_run_id = ev.data?.id;
    } else if (ev.event === "message_end") {
      t.message_end = { answer: (ev.data || {}).answer || ev.answer || "", metadata: simplify(ev.data?.metadata || {}) };
    } else if (ev.event === "message") {
      t.answer += ev.answer || "";
    } else if (ev.event === "workflow_finished" || ev.event === "error") {
      t.events.push({ event: ev.event, status: ev.data?.status, error: ev.data?.error || ev.message || null, elapsed_time: ev.data?.elapsed_time });
    }
  }
  trace.turns.push(summarize(t));
  console.log(`\n===== 第 ${t.turn} 轮：${query}`);
  for (const n of t.nodes) {
    console.log(` - [${n.status}] ${n.title} (${n.type}) ${n.elapsed_time ?? "?"}s${n.error ? " err=" + n.error.slice(0, 120) : ""}`);
  }
  const s = t.summary;
  console.log(
    ` 检索小结：知识库命中 ${s.知识库检索?.hits ?? "?"} 条（Top1 score ${s.知识库检索?.top_score ?? "-"}）；` +
      `工具命中 ${s.seekdb工具?.hits ?? "?"} 条（mode=${s.seekdb工具?.mode ?? "-"}，took_ms=${s.seekdb工具?.took_ms ?? "-"}，` +
      `含执行计划 ${s.seekdb工具?.has_explain ? "是" : "否"}）`,
  );
  if (t.answer) console.log(" 回答：\n" + t.answer);
  const failed = t.nodes.find((n) => n.status === "fail");
  if (failed) console.log(" 失败节点详情:", JSON.stringify(failed).slice(0, 600));
}

// 把两条检索通道的命中数/分数/耗时抽出来，既方便看，也直接进证据文件
function summarize(t) {
  const kr = t.nodes.find((n) => n.type === "knowledge-retrieval");
  const tool = t.nodes.find((n) => n.type === "tool");
  const segs = Array.isArray(kr?.outputs?.result) ? kr.outputs.result : [];
  let toolJson = null;
  try {
    const raw = tool?.outputs?.json?.[0] ?? JSON.parse(tool?.outputs?.text || "null");
    toolJson = raw;
  } catch {
    /* 工具输出不是 JSON 时留空 */
  }
  t.summary = {
    知识库检索: {
      hits: segs.length,
      top_score:
        segs[0]?.score != null
          ? Number(segs[0].score).toFixed(3)
          : segs[0]?.metadata?.score != null
            ? Number(segs[0].metadata.score).toFixed(3)
            : null,
      titles: segs.map((s) => s.title),
      elapsed_time: kr?.elapsed_time,
    },
    seekdb工具: {
      hits: toolJson?.results?.length ?? null,
      mode: toolJson?.mode,
      took_ms: toolJson?.took_ms,
      embed_ms: toolJson?.embed_ms,
      has_explain: Boolean(toolJson?.explain),
      top_channels: (toolJson?.results || []).map((r) => `${r.channels} rrf=${r.rrf}`),
      elapsed_time: tool?.elapsed_time,
    },
    生效模式: t.nodes.find((n) => n.type === "code")?.outputs?.mode_label ?? null,
    answer_length: (t.answer || "").length,
  };
  return t;
}

writeFileSync(out, JSON.stringify(trace, null, 1), "utf8");
console.log(`\n[run] 追踪已写入 ${out}；conversation_id=${conversationId}`);

function simplify(v, depth = 0) {
  if (v === null || v === undefined) return v;
  if (typeof v === "string") return v.length > 600 ? v.slice(0, 600) + `…(${v.length} 字符)` : v;
  if (typeof v !== "object") return v;
  if (Array.isArray(v)) return v.slice(0, 12).map((x) => simplify(x, depth + 1));
  const o = {};
  for (const [k, x] of Object.entries(v)) o[k] = simplify(x, depth + 1);
  return o;
}

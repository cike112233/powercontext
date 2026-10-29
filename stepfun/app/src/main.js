import { load, embed, embedBatch, backend, detectGPU, DIM } from "./embedder.js";
import * as api from "./api.js";

const $ = (id) => document.getElementById(id);
const DATA_URL = "/data/zh-retrieval-eval.json";

let modelReady = false;

function setChip(el, ok, html) {
  const color = ok === true ? "var(--ok)" : ok === false ? "var(--warn)" : "#666";
  el.innerHTML = `<span class="dot" style="background:${color}"></span>${html}`;
}

// ── 后端状态 ────────────────────────────────────────────────
async function refreshStatus() {
  try {
    const s = await api.status();
    setChip($("chip-db"), s.connected, `后端 seekdb：已连接 · 库内文档 <b>${s.count ?? 0}</b> 条 · dim ${s.dim}`);
  } catch (e) {
    setChip($("chip-db"), false, `后端 seekdb：不可达（${e.message}）`);
  }
}

// ── 加载模型 ────────────────────────────────────────────────
async function onLoadModel() {
  $("load-model").disabled = true;
  const gpu = await detectGPU();
  $("load-log").textContent = `检测 GPU：${gpu.ok ? `可用（${gpu.vendor || "?"} / ${gpu.architecture || "?"}）` : `不可用 → 降级 WASM（${gpu.reason}）`}；正在加载模型…`;
  const preferGPU = $("device").value === "gpu";
  const dtype = $("dtype").value;
  try {
    const r = await load({ preferGPU, dtype });
    modelReady = true;
    setChip($("chip-infer"), true, `推理引擎：<b>${r.backend.toUpperCase()}</b> · dtype <b>${r.dtype}</b> · 加载 ${Math.round(r.loadMs)}ms · ${DIM}维`);
    $("load-log").textContent = `✅ 模型就绪（${r.backend}/${r.dtype}），加载耗时 ${Math.round(r.loadMs)}ms。`;
  } catch (e) {
    setChip($("chip-infer"), false, "推理引擎：加载失败");
    $("load-log").textContent = `❌ 加载失败：${e.message}`;
  } finally {
    $("load-model").disabled = false;
  }
}

function needModel() {
  if (!modelReady) {
    $("load-log").textContent = "⚠️ 请先点击「加载模型」。";
    return false;
  }
  return true;
}

// ── 导入评测语料 ────────────────────────────────────────────
async function onSeed() {
  if (!needModel()) return;
  $("seed").disabled = true;
  const { corpus } = await (await fetch(DATA_URL)).json();
  $("seed-log").textContent = `向量化 ${corpus.length} 篇文档…`;
  for (let i = 0; i < corpus.length; i++) {
    const d = corpus[i];
    const { vector } = await embed(d.text);
    await api.addDoc({ id: d.id, title: d.title, document: d.text, embedding: vector, meta: { source: "eval-corpus" } });
    $("seed-bar").style.width = `${Math.round(((i + 1) / corpus.length) * 100)}%`;
    $("seed-log").textContent = `已写入 ${i + 1}/${corpus.length}（${d.id} ${d.title}）`;
  }
  $("seed-log").textContent = `✅ 语料导入完成：${corpus.length} 篇已写入 seekdb。`;
  $("seed").disabled = false;
  await refreshStatus();
}

// ── 手动添加 ────────────────────────────────────────────────
async function onManualAdd() {
  if (!needModel()) return;
  const title = $("m-title").value.trim();
  const document = $("m-doc").value.trim();
  if (!document) { $("add-log").textContent = "⚠️ 正文不能为空。"; return; }
  $("add-log").textContent = "端侧向量化中…";
  const { vector, ms } = await embed(document);
  const r = await api.addDoc({ title: title || "未命名", document, embedding: vector, meta: { source: "manual" } });
  $("add-log").textContent = r.success ? `✅ 已添加（id=${r.id}，推理 ${Math.round(ms)}ms）。` : `❌ ${r.error}`;
  $("m-title").value = ""; $("m-doc").value = "";
  await refreshStatus();
}

// ── 检索 ────────────────────────────────────────────────────
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

function renderResults(results, qms) {
  const box = $("results");
  if (!results.length) { box.innerHTML = `<div class="hit">无结果，请先导入语料。</div>`; return; }
  box.innerHTML = results.map((r, i) => {
    const inFts = r.fts > 0, inVec = r.vec > 0;
    const channel = inFts && inVec ? `<span class="tag both">双通道命中</span>` : inFts ? `<span class="tag fts">仅全文</span>` : `<span class="tag vec">仅向量</span>`;
    const snippet = r.document.length > 160 ? r.document.slice(0, 160) + "…" : r.document;
    return `<div class="hit">
      <div class="top"><div class="title">${esc(r.title || "（无标题）")}</div><div class="id">#${esc(r.id)}</div></div>
      <div class="text">${esc(snippet)}</div>
      <div class="scores">
        <span class="tag rank">排名 #${i + 1}</span>
        <span class="tag rrf">RRF ${r.rrf.toFixed(4)}</span>
        <span class="tag fts">全文 ${r.fts.toFixed(3)}</span>
        <span class="tag vec">向量 ${r.vec.toFixed(3)}</span>
        ${channel}
      </div></div>`;
  }).join("");
  $("search-log").textContent = `✅ ${results.length} 条结果 · 查询向量推理 ${Math.round(qms)}ms · ${backend().backend}/${backend().dtype}`;
}

async function onSearch() {
  if (!needModel()) return;
  const q = $("query").value.trim();
  if (!q) { $("search-log").textContent = "⚠️ 请输入查询。"; return; }
  $("search").disabled = true;
  $("search-log").textContent = "端侧生成查询向量…";
  const { vector, ms } = await embed(q);
  const limit = Number($("limit").value);
  const { results } = await api.search({ queryText: q, queryVector: vector, limit });
  renderResults(results, ms);
  if ($("show-explain").checked) {
    const { plan } = await api.explain({ queryText: q, queryVector: vector });
    $("explain").style.display = "block";
    $("explain").textContent = typeof plan === "string" ? plan : JSON.stringify(plan, null, 2);
  } else {
    $("explain").style.display = "none";
  }
  $("search").disabled = false;
}

// ── 导出端侧向量 ────────────────────────────────────────────
async function onExport() {
  if (!needModel()) return;
  $("export").disabled = true;
  const dataset = await (await fetch(DATA_URL)).json();
  const total = dataset.corpus.length + dataset.queries.length;
  let done = 0;
  const out = { dim: DIM, dtype: backend().dtype, backend: backend().backend, docs: [], queries: [] };
  $("export-log").textContent = "向量化语料…";
  for (const d of dataset.corpus) {
    const { vector } = await embed(d.text);
    out.docs.push({ id: d.id, title: d.title, vector });
    done++; $("export-bar").style.width = `${Math.round((done / total) * 100)}%`;
  }
  $("export-log").textContent = "向量化查询…";
  for (const q of dataset.queries) {
    const { vector } = await embed(q.text);
    out.queries.push({ id: q.id, text: q.text, relevant: q.relevant, k: q.k, vector });
    done++; $("export-bar").style.width = `${Math.round((done / total) * 100)}%`;
  }
  const blob = new Blob([JSON.stringify(out)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "stepfun-embeddings.json"; a.click();
  URL.revokeObjectURL(url);
  $("export-log").textContent = `✅ 已导出 stepfun-embeddings.json（${out.docs.length} docs + ${out.queries.length} queries，${backend().backend}/${backend().dtype}）。`;
  $("export").disabled = false;
}

// ── 绑定 ────────────────────────────────────────────────────
$("load-model").onclick = onLoadModel;
$("refresh-status").onclick = refreshStatus;
$("seed").onclick = onSeed;
$("manual-add").onclick = onManualAdd;
$("search").onclick = onSearch;
$("query").addEventListener("keydown", (e) => { if (e.key === "Enter") onSearch(); });
$("export").onclick = onExport;

// 供自动化评测脚本调用（端侧向量 + 真实 seekdb 混合检索）
window.__kb = { embed, embedBatch, load, backend, api, DIM };

refreshStatus();

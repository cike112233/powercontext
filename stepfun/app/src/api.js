// 与后端 seekdb API 通信
const BASE = "/api";

export async function status() {
  const r = await fetch(`${BASE}/status`);
  return r.json();
}

export async function addDoc({ id, title, document, embedding, meta }) {
  const r = await fetch(`${BASE}/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, title, document, embedding, meta }),
  });
  return r.json();
}

export async function search({ queryText, queryVector, limit = 5, mode = "hybrid" }) {
  const r = await fetch(`${BASE}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ queryText, queryVector, limit, mode }),
  });
  return r.json();
}

export async function explain({ queryText, queryVector }) {
  const r = await fetch(`${BASE}/explain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ queryText, queryVector }),
  });
  return r.json();
}

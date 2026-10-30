#!/usr/bin/env python3
# 模式路由自检：把 DSL 里「模式路由」代码节点的源码原样抽出来，在本地跑一遍话术表。
#
# 为什么单独要这个脚本：检索开关（纯向量 / 全文 / 证据）是写在用户自然语言里的，
# 早先的版本用 "kw in query" 判断，一句「向量数据库怎么选型」就会被误判成纯向量检索，
# 消融对照当场失真。现在改成"只认句首 + 弱关键词必须紧跟分隔符"，这套边界就得有回归测试，
# 不能靠每次都跑一遍 Dify（一轮 LLM 要 6-8 秒，还受模型发挥影响）。
#
# 这里不复制一份逻辑，而是直接从 dify/dsl/interview-coach.yml 里读出代码节点源码执行，
# 保证"测的就是 DSL 里跑的那段"。改完 DSL 直接重跑本脚本即可。
#
# 跑法：python3 dify/scripts/routing-selftest.py          # 打印话术表
#       python3 dify/scripts/routing-selftest.py --save   # 同时写 dify/evidence/mode-routing-selftest.txt
import io
import os
import sys
import textwrap

HERE = os.path.dirname(os.path.abspath(__file__))
DSL = os.path.normpath(os.path.join(HERE, "..", "dsl", "interview-coach.yml"))
OUT = os.path.normpath(os.path.join(HERE, "..", "evidence", "mode-routing-selftest.txt"))

try:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
except Exception:
    pass

CASES = [
    # (用户输入, 期望 mode, 期望 explain, 说明)
    ("纯向量：TIME_WAIT 为什么要等 2MSL", "vector", "false", "README 演示话术 1：开关写在句首"),
    ("全文：如何用 EXPLAIN 判断走没走索引？", "fts", "true", "README 演示话术 2：句子里本来就带 EXPLAIN，同时算索取证据"),
    ("证据：哪些写法会导致索引失效？", "hybrid", "true", "索取执行计划，且「证据：」不该进检索句子"),
    ("哪些写法会导致索引失效？给我看这轮的检索证据", "hybrid", "true", "证据写在句尾同样生效，整句留作检索词"),
    ("纯全文：maxLifetime 和哪个服务端参数有关系", "fts", "false", "强关键词的另一种写法"),
    ("关键词：redo log 和 binlog 为什么要两阶段提交", "fts", "false", "全文别名"),
    ("向量数据库怎么选型", "hybrid", "false", "回归：弱关键词在句首但后面不是分隔符，不许误触发"),
    ("全文索引和倒排的关系是什么", "hybrid", "false", "回归：同上，「全文索引」是题目内容不是开关"),
    ("InnoDB 的 MVCC 是怎么保证一致性读的？", "hybrid", "false", "默认混合"),
    ("explain 一下这条 SQL", "hybrid", "true", "英文开关也能识别，且不会被当噪声截掉"),
]


def load_node_code():
    """不引第三方 yaml 库：按缩进把「模式路由」节点的 code: |- 块切出来并去掉公共缩进。"""
    with open(DSL, encoding="utf-8") as f:
        lines = f.read().split("\n")
    start = None
    for i, ln in enumerate(lines):
        if ln.strip() == "code: |-":
            start = i
            break
    if start is None:
        raise SystemExit("DSL 里没找到 code: |- 块（模式路由节点被改坏了吗？）")
    key_indent = len(lines[start]) - len(lines[start].lstrip())
    body = []
    for ln in lines[start + 1:]:
        indent = len(ln) - len(ln.lstrip())
        if ln.strip() and indent <= key_indent:
            break  # 缩进回到 key 一级，说明块结束了
        body.append(ln)
    code = textwrap.dedent("\n".join(body)).rstrip()
    if "def main" not in code:
        raise SystemExit("抽出来的代码块里没有 def main")
    return code


def main():
    code = load_node_code()
    ns = {}
    exec(compile(code, "<dsl 模式路由节点>", "exec"), ns)
    fn = ns["main"]

    rows = []
    bad = 0
    for q, want_mode, want_explain, why in CASES:
        got = fn(q)
        ok = got["mode"] == want_mode and got["explain"] == want_explain
        bad += 0 if ok else 1
        rows.append(
            "%-4s %-3s  mode=%-7s explain=%-5s clean=%-34r  <= %s\n     %s"
            % ("PASS" if ok else "FAIL", "", got["mode"], got["explain"], got["clean_query"], q, why)
        )

    head = [
        "seekdb 面试陪练官 —— 「模式路由」代码节点回归（测的就是 DSL 里那段源码，不是副本）",
        "来源：%s" % os.path.relpath(DSL, os.path.join(HERE, "..", "..")),
        "跑法：python3 dify/scripts/routing-selftest.py --save",
        "",
    ]
    tail = [
        "",
        "结论：%d 条话术全部符合预期（%d 条）。开关只认句首；「向量数据库怎么选型」「全文索引和…」"
        "这类把关键词写在句子中间的问法一律保持混合检索，消融对照不会因为误触发而失真。"
        % (len(CASES) - bad, len(CASES)) if bad == 0
        else "结论：有 %d 条不符合预期，见上面 FAIL。" % bad,
    ]
    text = "\n".join(head + rows + tail)
    print(text)

    if "--save" in sys.argv:
        with open(OUT, "w", encoding="utf-8") as f:
            f.write(text + "\n")
        print("\n[selftest] 写入 %s" % OUT)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())

# SDD 规格：订单计费模块重构

> 本文件是任务的**规格来源**。流水线在 `init` 阶段解析本文件，把每条规格写入
> 数据库 `project_specs` 表，并作为任务上下文的组成部分提供给模型。
> 规格条目 ID、目标符号与验收约束都必须是机器可读的。

## 任务

任务 ID：`TASK-PRICING-REFACTOR`

把 `billing/legacy_pricing.py` 中重复实现的"阶梯折扣 + 运费"计算逻辑合并为
单一实现，消除三处重复代码。

## 规格条目

### SPEC-001 统一阶梯折扣计算

- category: refactor
- target_symbol: billing.legacy_pricing.tiered_discount
- status: pending
- detail: |
  `tiered_discount`、`discounted_total`、`compute_invoice` 三处各自实现了一遍
  相同的阶梯折扣判断。抽取单一实现供三者复用，保留 `tiered_discount` 的公开
  签名与返回值。

### SPEC-002 统一运费与区域附加费计算

- category: refactor
- target_symbol: billing.legacy_pricing.shipping_fee
- status: pending
- detail: |
  `shipping_fee` 与 `compute_invoice` 各自实现了免运费门槛与区域附加费。
  抽取单一实现供两者复用，保留 `shipping_fee` 的公开签名与返回值。

### SPEC-003 行为必须完全保持不变

- category: constraint
- target_symbol: billing.legacy_pricing
- status: pending
- detail: |
  本任务是纯重构：任何输入下 `tiered_discount`、`discounted_total`、
  `shipping_fee`、`compute_invoice` 的返回值都必须与重构前完全一致，
  包括四舍五入位数与边界值（0、300、500、2000、5000）。
  `tests/pricing_baseline.json` 记录了重构前的行为基线，
  `tests/test_pricing_behavior.py` 会在修改后逐项比对。

### SPEC-004 公开接口与模块结构不得破坏

- category: constraint
- target_symbol: billing.legacy_pricing
- status: pending
- detail: |
  不得删除、重命名或改变下列公开对象的签名与默认值：
  `TIER_THRESHOLDS`、`FREE_SHIPPING_THRESHOLD`、`REGION_RATES`、
  `REGION_SURCHARGE`、`InvoiceLine`、`Invoice`、`tiered_discount`、
  `discounted_total`、`shipping_fee`、`compute_invoice`。
  不得引入除标准库以外的新依赖。

## 验收

- 单元测试全部通过：`python -m pytest -q`
- 行为快照一致：`tests/test_pricing_behavior.py` 必须通过
- 公开接口保持：`tests/test_pricing.py` 必须通过

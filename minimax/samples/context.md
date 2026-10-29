# 任务上下文: 订单计费模块阶梯折扣与运费逻辑重构（纯重构，行为不变）

- 任务 ID: `TASK-PRICING-REFACTOR`
- 上下文空间 (Scope): `scp_6z7n49g6rnc5g23w3efynmnj0c`
- 数据库后端: sqlite (C:\Users\张\.minimax\sessions\mvs_a62d996604594cce9782a8d8fb546713\workspace\minimax\records\sdd_pipeline.db)
- 规格来源: `docs/sdd/requirements.md`
- 代码来源: `billing/` (已索引到 `code_symbols` 表)
- 测试来源: `tests/` (结果写入 `test_results` 表)

## 规格条目 SPEC-001

**SPEC-001 统一阶梯折扣计算**

- 类别: refactor
- 目标符号: `billing.legacy_pricing.tiered_discount`
- 状态: pending

`tiered_discount`、`discounted_total`、`compute_invoice` 三处各自实现了一遍
相同的阶梯折扣判断。抽取单一实现供三者复用，保留 `tiered_discount` 的公开
签名与返回值。

> 来源: db:project_specs#SPEC-001

## 规格条目 SPEC-002

**SPEC-002 统一运费与区域附加费计算**

- 类别: refactor
- 目标符号: `billing.legacy_pricing.shipping_fee`
- 状态: pending

`shipping_fee` 与 `compute_invoice` 各自实现了免运费门槛与区域附加费。
抽取单一实现供两者复用，保留 `shipping_fee` 的公开签名与返回值。

> 来源: db:project_specs#SPEC-002

## 规格条目 SPEC-003

**SPEC-003 行为必须完全保持不变**

- 类别: constraint
- 目标符号: `billing.legacy_pricing`
- 状态: pending

本任务是纯重构：任何输入下 `tiered_discount`、`discounted_total`、
`shipping_fee`、`compute_invoice` 的返回值都必须与重构前完全一致，
包括四舍五入位数与边界值（0、300、500、2000、5000）。
`tests/pricing_baseline.json` 记录了重构前的行为基线，
`tests/test_pricing_behavior.py` 会在修改后逐项比对。

> 来源: db:project_specs#SPEC-003

## 规格条目 SPEC-004

**SPEC-004 公开接口与模块结构不得破坏**

- 类别: constraint
- 目标符号: `billing.legacy_pricing`
- 状态: pending

不得删除、重命名或改变下列公开对象的签名与默认值：
`TIER_THRESHOLDS`、`FREE_SHIPPING_THRESHOLD`、`REGION_RATES`、
`REGION_SURCHARGE`、`InvoiceLine`、`Invoice`、`tiered_discount`、
`discounted_total`、`shipping_fee`、`compute_invoice`。
不得引入除标准库以外的新依赖。

> 来源: db:project_specs#SPEC-004

## 待修改代码 legacy_pricing.Invoice

文件: `billing/legacy_pricing.py`  符号: `legacy_pricing.Invoice` (class)

```python
class Invoice:
    lines: list[InvoiceLine] = field(default_factory=list)
    region: str = "domestic"
    discount: float = 0.0
    shipping: float = 0.0

    @property
    def subtotal(self) -> float:
        return round(sum(line.amount for line in self.lines), 2)

    @property
    def total(self) -> float:
        return round(self.subtotal - self.discount + self.shipping, 2)
```

> 来源: db:code_symbols#legacy_pricing.Invoice

## 待修改代码 legacy_pricing.InvoiceLine

文件: `billing/legacy_pricing.py`  符号: `legacy_pricing.InvoiceLine` (class)

```python
class InvoiceLine:
    sku: str
    quantity: int
    unit_price: float

    @property
    def amount(self) -> float:
        return round(self.quantity * self.unit_price, 2)
```

> 来源: db:code_symbols#legacy_pricing.InvoiceLine

## 待修改代码 legacy_pricing._discount_rate

文件: `billing/legacy_pricing.py`  符号: `legacy_pricing._discount_rate` (function)

```python
def _discount_rate(amount: float) -> float:
    if amount >= TIER_THRESHOLDS[0][0]:
        return TIER_THRESHOLDS[0][1]
    if amount >= TIER_THRESHOLDS[1][0]:
        return TIER_THRESHOLDS[1][1]
    if amount >= TIER_THRESHOLDS[2][0]:
        return TIER_THRESHOLDS[2][1]
    return 0.0
```

> 来源: db:code_symbols#legacy_pricing._discount_rate

## 待修改代码 legacy_pricing._shipping_base

文件: `billing/legacy_pricing.py`  符号: `legacy_pricing._shipping_base` (function)

```python
def _shipping_base(amount: float, region: str) -> float:
    if amount >= FREE_SHIPPING_THRESHOLD:
        return 0.0
    return REGION_RATES.get(region, REGION_RATES["domestic"])
```

> 来源: db:code_symbols#legacy_pricing._shipping_base

## 待修改代码 legacy_pricing.compute_invoice

文件: `billing/legacy_pricing.py`  符号: `legacy_pricing.compute_invoice` (function)

```python
def compute_invoice(lines: Iterable[InvoiceLine], region: str = "domestic") -> Invoice:
    """Build a full invoice for the given lines."""
    collected = list(lines)
    subtotal = round(sum(line.amount for line in collected), 2)
    discount = round(subtotal * _discount_rate(subtotal), 2)
    base = _shipping_base(subtotal, region)
    shipping = round(base + REGION_SURCHARGE.get(region, 0.0), 2)
    return Invoice(lines=collected, region=region, discount=discount, shipping=shipping)
```

> 来源: db:code_symbols#legacy_pricing.compute_invoice

## 待修改代码 legacy_pricing.discounted_total

文件: `billing/legacy_pricing.py`  符号: `legacy_pricing.discounted_total` (function)

```python
def discounted_total(amount: float, region: str = "domestic") -> float:
    """Return the discounted amount, ignoring shipping."""
    discount = round(amount * _discount_rate(amount), 2)
    surcharge = REGION_SURCHARGE.get(region, 0.0)
    return round(amount - discount + surcharge, 2)
```

> 来源: db:code_symbols#legacy_pricing.discounted_total

## 待修改代码 legacy_pricing.shipping_fee

文件: `billing/legacy_pricing.py`  符号: `legacy_pricing.shipping_fee` (function)

```python
def shipping_fee(amount: float, region: str = "domestic") -> float:
    """Return the shipping fee for an order."""
    base = _shipping_base(amount, region)
    surcharge = REGION_SURCHARGE.get(region, 0.0)
    return round(base + surcharge, 2)
```

> 来源: db:code_symbols#legacy_pricing.shipping_fee

## 待修改代码 legacy_pricing.tiered_discount

文件: `billing/legacy_pricing.py`  符号: `legacy_pricing.tiered_discount` (function)

```python
def tiered_discount(amount: float) -> float:
    """Return the discount amount for a gross order amount."""
    return round(amount * _discount_rate(amount), 2)
```

> 来源: db:code_symbols#legacy_pricing.tiered_discount

## 测试现状

| 测试 | 状态 | 耗时(ms) | 时间 |
| --- | --- | ---: | --- |
| tests/test_pricing.py::TestComputeInvoice::test_international_small_order | PASSED | 0 | 2026-10-29T06:26:57+00:00 |
| tests/test_pricing.py::TestComputeInvoice::test_large_order_gets_discount_and_free_shipping | PASSED | 0 | 2026-10-29T06:26:57+00:00 |
| tests/test_pricing.py::TestComputeInvoice::test_multiple_lines_are_summed | PASSED | 0 | 2026-10-29T06:26:57+00:00 |
| tests/test_pricing.py::TestComputeInvoice::test_small_order | PASSED | 0 | 2026-10-29T06:26:57+00:00 |
| tests/test_pricing.py::TestDiscountedTotal::test_no_discount_below_first_tier | PASSED | 0 | 2026-10-29T06:26:57+00:00 |
| tests/test_pricing.py::TestDiscountedTotal::test_region_surcharge_is_added | PASSED | 0 | 2026-10-29T06:26:57+00:00 |
| tests/test_pricing.py::TestDiscountedTotal::test_top_tier | PASSED | 0 | 2026-10-29T06:26:57+00:00 |
| tests/test_pricing.py::TestDiscountedTotal::test_unknown_region_falls_back | PASSED | 0 | 2026-10-29T06:26:57+00:00 |
| tests/test_pricing.py::TestShippingFee::test_below_threshold_charges_region_rate | PASSED | 0 | 2026-10-29T06:26:57+00:00 |
| tests/test_pricing.py::TestShippingFee::test_free_shipping_above_threshold | PASSED | 0 | 2026-10-29T06:26:57+00:00 |
| tests/test_pricing.py::TestShippingFee::test_unknown_region_uses_domestic_rate | PASSED | 0 | 2026-10-29T06:26:57+00:00 |
| tests/test_pricing.py::TestTieredDiscount::test_discount_is_monotonic | PASSED | 0 | 2026-10-29T06:26:57+00:00 |
| tests/test_pricing.py::TestTieredDiscount::test_tier_boundaries[0.0-0.0] | PASSED | 0 | 2026-10-29T06:26:57+00:00 |
| tests/test_pricing.py::TestTieredDiscount::test_tier_boundaries[100.0-0.0] | PASSED | 0 | 2026-10-29T06:26:57+00:00 |
| tests/test_pricing.py::TestTieredDiscount::test_tier_boundaries[12345.67-617.28] | PASSED | 0 | 2026-10-29T06:26:57+00:00 |
| tests/test_pricing.py::TestTieredDiscount::test_tier_boundaries[1999.99-20.0] | PASSED | 0 | 2026-10-29T06:26:57+00:00 |
| tests/test_pricing.py::TestTieredDiscount::test_tier_boundaries[2000.0-60.0] | PASSED | 0 | 2026-10-29T06:26:57+00:00 |
| tests/test_pricing.py::TestTieredDiscount::test_tier_boundaries[499.99-0.0] | PASSED | 0 | 2026-10-29T06:26:57+00:00 |
| tests/test_pricing.py::TestTieredDiscount::test_tier_boundaries[4999.99-150.0] | PASSED | 0 | 2026-10-29T06:26:57+00:00 |
| tests/test_pricing.py::TestTieredDiscount::test_tier_boundaries[500.0-5.0] | PASSED | 0 | 2026-10-29T06:26:57+00:00 |
| tests/test_pricing.py::TestTieredDiscount::test_tier_boundaries[5000.0-250.0] | PASSED | 0 | 2026-10-29T06:26:57+00:00 |
| tests/test_pricing_behavior.py::test_behaviour_matches_committed_baseline | PASSED | 0 | 2026-10-29T06:26:57+00:00 |
| tests/test_pricing_behavior.py::test_snapshot_is_not_empty | PASSED | 0 | 2026-10-29T06:26:57+00:00 |

> 来源: db:test_results

## 验收方式

1. `python -m pytest -q` - 全部单元测试
2. `python -m pytest tests/test_pricing_behavior.py -q` - 行为快照与重构前基线逐项比对
3. `python -m pytest tests/test_pricing.py -q` - 公开接口与旧口吻用例

> 来源: file:docs/sdd/requirements.md

## 关联记录 SPEC-001

- **code**: [billing/legacy_pricing.py#tiered_discount]
def tiered_discount(amount: float) -> float:
    """Return the discount amount for a gross order amount."""
    return round(amount * _discount_rate(amount), 2)
- **specification**: [docs/sdd/requirements.md#SPEC-002]
`shipping_fee` 与 `compute_invoice` 各自实现了免运费门槛与区域附加费。
抽取单一实现供两者复用，保留 `shipping_fee` 的公开签名与返回值。
目标符号: billing.legacy_pricing.shipping_fee
- **specification**: [docs/sdd/requirements.md#SPEC-001]
`tiered_discount`、`discounted_total`、`compute_invoice` 三处各自实现了一遍
相同的阶梯折扣判断。抽取单一实现供三者复用，保留 `tiered_discount` 的公开
签名与返回值。
目标符号: billing.legacy_pricing.tiered_discount
- **specification**: [docs/sdd/requirements.md#SPEC-004]
不得删除、重命名或改变下列公开对象的签名与默认值：
`TIER_THRESHOLDS`、`FREE_SHIPPING_THRESHOLD`、`REGION_RATES`、
`REGION_SURCHARGE`、`InvoiceLine`、`Invoice`、`tiered_discount`、
`discounted_total`、`shipping_fee`、`compute_invoice`。
不得引入除标准库以外的新依赖。
目标符号: billing.legacy_pricing
- **code**: [billing/legacy_pricing.py#_shipping_base]
def _shipping_base(amount: float, region: str) -> float:
    if amount >= FREE_SHIPPING_THRESHOLD:
        return 0.0
    return REGION_RATES.get(region, REGION_RATES["domestic"])
- **specification**: [docs/sdd/requirements.md#SPEC-003]
本任务是纯重构：任何输入下 `tiered_discount`、`discounted_total`、
`shipping_fee`、`compute_invoice` 的返回值都必须与重构前完全一致，
包括四舍五入位数与边界值（0、300、500、2000、5000）。
`tests/pricing_baseline.json` 记录了重构前的行为基线，
`tests/test_pricing_behavior.py` 会在修改后逐项比对。
目标符号: billing.legacy_pricing
- **code**: [billing/legacy_pricing.py#Invoice]
class Invoice:
    lines: list[InvoiceLine] = field(default_factory=list)
    region: str = "domestic"
    discount: float = 0.0
    shipping: float = 0.0

    @property
    def subtotal(self) -> float:
        return round(sum(line.amount for line in self.lines), 2)

    @property
    def total(self) -> float:
        return round(self.subtotal - self.discount + self.shipping, 2)
- **code**: [billing/legacy_pricing.py#_discount_rate]
def _discount_rate(amount: float) -> float:
    if amount >= TIER_THRESHOLDS[0][0]:
        return TIER_THRESHOLDS[0][1]
    if amount >= TIER_THRESHOLDS[1][0]:
        return TIER_THRESHOLDS[1][1]
    if amount >= TIER_THRESHOLDS[2][0]:
        return TIER_THRESHOLDS[2][1]
    return 0.0
- **code**: [billing/legacy_pricing.py#discounted_total]
def discounted_total(amount: float, region: str = "domestic") -> float:
    """Return the discounted amount, ignoring shipping."""
    discount = round(amount * _discount_rate(amount), 2)
    surcharge = REGION_SURCHARGE.get(region, 0.0)
    return round(amount - discount + surcharge, 2)
- **code**: [billing/legacy_pricing.py#InvoiceLine]
class InvoiceLine:
    sku: str
    quantity: int
    unit_price: float

    @property
    def amount(self) -> float:
        return round(self.quantity * self.unit_price, 2)
- **code**: [billing/legacy_pricing.py#compute_invoice]
def compute_invoice(lines: Iterable[InvoiceLine], region: str = "domestic") -> Invoice:
    """Build a full invoice for the given lines."""
    collected = list(lines)
    subtotal = round(sum(line.amount for line in collected), 2)
    discount = round(subtotal * _discount_rate(subtotal), 2)
    base = _shipping_base(subtotal, region)
    shipping = round(base + REGION_SURCHARGE.get(region, 0.0), 2)
    return Invoice(lines=collected, region=region, discount=discount, shipping=shipping)
- **code**: [billing/legacy_pricing.py#shipping_fee]
def shipping_fee(amount: float, region: str = "domestic") -> float:
    """Return the shipping fee for an order."""
    base = _shipping_base(amount, region)
    surcharge = REGION_SURCHARGE.get(region, 0.0)
    return round(base + surcharge, 2)
- **test-result**: [task:TASK-PRICING-REFACTOR]
状态: PASSED
耗时: 0 ms

> 来源: db-join:project_specs#SPEC-001 x pc_memory_entry_versions@scp_6z7n49g6rnc5g23w3efynmnj0c

## 关联记录 SPEC-002

- **code**: [billing/legacy_pricing.py#tiered_discount]
def tiered_discount(amount: float) -> float:
    """Return the discount amount for a gross order amount."""
    return round(amount * _discount_rate(amount), 2)
- **specification**: [docs/sdd/requirements.md#SPEC-002]
`shipping_fee` 与 `compute_invoice` 各自实现了免运费门槛与区域附加费。
抽取单一实现供两者复用，保留 `shipping_fee` 的公开签名与返回值。
目标符号: billing.legacy_pricing.shipping_fee
- **specification**: [docs/sdd/requirements.md#SPEC-001]
`tiered_discount`、`discounted_total`、`compute_invoice` 三处各自实现了一遍
相同的阶梯折扣判断。抽取单一实现供三者复用，保留 `tiered_discount` 的公开
签名与返回值。
目标符号: billing.legacy_pricing.tiered_discount
- **specification**: [docs/sdd/requirements.md#SPEC-004]
不得删除、重命名或改变下列公开对象的签名与默认值：
`TIER_THRESHOLDS`、`FREE_SHIPPING_THRESHOLD`、`REGION_RATES`、
`REGION_SURCHARGE`、`InvoiceLine`、`Invoice`、`tiered_discount`、
`discounted_total`、`shipping_fee`、`compute_invoice`。
不得引入除标准库以外的新依赖。
目标符号: billing.legacy_pricing
- **code**: [billing/legacy_pricing.py#_shipping_base]
def _shipping_base(amount: float, region: str) -> float:
    if amount >= FREE_SHIPPING_THRESHOLD:
        return 0.0
    return REGION_RATES.get(region, REGION_RATES["domestic"])
- **specification**: [docs/sdd/requirements.md#SPEC-003]
本任务是纯重构：任何输入下 `tiered_discount`、`discounted_total`、
`shipping_fee`、`compute_invoice` 的返回值都必须与重构前完全一致，
包括四舍五入位数与边界值（0、300、500、2000、5000）。
`tests/pricing_baseline.json` 记录了重构前的行为基线，
`tests/test_pricing_behavior.py` 会在修改后逐项比对。
目标符号: billing.legacy_pricing
- **code**: [billing/legacy_pricing.py#Invoice]
class Invoice:
    lines: list[InvoiceLine] = field(default_factory=list)
    region: str = "domestic"
    discount: float = 0.0
    shipping: float = 0.0

    @property
    def subtotal(self) -> float:
        return round(sum(line.amount for line in self.lines), 2)

    @property
    def total(self) -> float:
        return round(self.subtotal - self.discount + self.shipping, 2)
- **code**: [billing/legacy_pricing.py#_discount_rate]
def _discount_rate(amount: float) -> float:
    if amount >= TIER_THRESHOLDS[0][0]:
        return TIER_THRESHOLDS[0][1]
    if amount >= TIER_THRESHOLDS[1][0]:
        return TIER_THRESHOLDS[1][1]
    if amount >= TIER_THRESHOLDS[2][0]:
        return TIER_THRESHOLDS[2][1]
    return 0.0
- **code**: [billing/legacy_pricing.py#discounted_total]
def discounted_total(amount: float, region: str = "domestic") -> float:
    """Return the discounted amount, ignoring shipping."""
    discount = round(amount * _discount_rate(amount), 2)
    surcharge = REGION_SURCHARGE.get(region, 0.0)
    return round(amount - discount + surcharge, 2)
- **code**: [billing/legacy_pricing.py#InvoiceLine]
class InvoiceLine:
    sku: str
    quantity: int
    unit_price: float

    @property
    def amount(self) -> float:
        return round(self.quantity * self.unit_price, 2)
- **code**: [billing/legacy_pricing.py#compute_invoice]
def compute_invoice(lines: Iterable[InvoiceLine], region: str = "domestic") -> Invoice:
    """Build a full invoice for the given lines."""
    collected = list(lines)
    subtotal = round(sum(line.amount for line in collected), 2)
    discount = round(subtotal * _discount_rate(subtotal), 2)
    base = _shipping_base(subtotal, region)
    shipping = round(base + REGION_SURCHARGE.get(region, 0.0), 2)
    return Invoice(lines=collected, region=region, discount=discount, shipping=shipping)
- **code**: [billing/legacy_pricing.py#shipping_fee]
def shipping_fee(amount: float, region: str = "domestic") -> float:
    """Return the shipping fee for an order."""
    base = _shipping_base(amount, region)
    surcharge = REGION_SURCHARGE.get(region, 0.0)
    return round(base + surcharge, 2)
- **test-result**: [task:TASK-PRICING-REFACTOR]
状态: PASSED
耗时: 0 ms

> 来源: db-join:project_specs#SPEC-002 x pc_memory_entry_versions@scp_6z7n49g6rnc5g23w3efynmnj0c

## 关联记录 SPEC-003

- **code**: [billing/legacy_pricing.py#tiered_discount]
def tiered_discount(amount: float) -> float:
    """Return the discount amount for a gross order amount."""
    return round(amount * _discount_rate(amount), 2)
- **specification**: [docs/sdd/requirements.md#SPEC-002]
`shipping_fee` 与 `compute_invoice` 各自实现了免运费门槛与区域附加费。
抽取单一实现供两者复用，保留 `shipping_fee` 的公开签名与返回值。
目标符号: billing.legacy_pricing.shipping_fee
- **specification**: [docs/sdd/requirements.md#SPEC-001]
`tiered_discount`、`discounted_total`、`compute_invoice` 三处各自实现了一遍
相同的阶梯折扣判断。抽取单一实现供三者复用，保留 `tiered_discount` 的公开
签名与返回值。
目标符号: billing.legacy_pricing.tiered_discount
- **specification**: [docs/sdd/requirements.md#SPEC-004]
不得删除、重命名或改变下列公开对象的签名与默认值：
`TIER_THRESHOLDS`、`FREE_SHIPPING_THRESHOLD`、`REGION_RATES`、
`REGION_SURCHARGE`、`InvoiceLine`、`Invoice`、`tiered_discount`、
`discounted_total`、`shipping_fee`、`compute_invoice`。
不得引入除标准库以外的新依赖。
目标符号: billing.legacy_pricing
- **code**: [billing/legacy_pricing.py#_shipping_base]
def _shipping_base(amount: float, region: str) -> float:
    if amount >= FREE_SHIPPING_THRESHOLD:
        return 0.0
    return REGION_RATES.get(region, REGION_RATES["domestic"])
- **specification**: [docs/sdd/requirements.md#SPEC-003]
本任务是纯重构：任何输入下 `tiered_discount`、`discounted_total`、
`shipping_fee`、`compute_invoice` 的返回值都必须与重构前完全一致，
包括四舍五入位数与边界值（0、300、500、2000、5000）。
`tests/pricing_baseline.json` 记录了重构前的行为基线，
`tests/test_pricing_behavior.py` 会在修改后逐项比对。
目标符号: billing.legacy_pricing
- **code**: [billing/legacy_pricing.py#Invoice]
class Invoice:
    lines: list[InvoiceLine] = field(default_factory=list)
    region: str = "domestic"
    discount: float = 0.0
    shipping: float = 0.0

    @property
    def subtotal(self) -> float:
        return round(sum(line.amount for line in self.lines), 2)

    @property
    def total(self) -> float:
        return round(self.subtotal - self.discount + self.shipping, 2)
- **code**: [billing/legacy_pricing.py#_discount_rate]
def _discount_rate(amount: float) -> float:
    if amount >= TIER_THRESHOLDS[0][0]:
        return TIER_THRESHOLDS[0][1]
    if amount >= TIER_THRESHOLDS[1][0]:
        return TIER_THRESHOLDS[1][1]
    if amount >= TIER_THRESHOLDS[2][0]:
        return TIER_THRESHOLDS[2][1]
    return 0.0
- **code**: [billing/legacy_pricing.py#discounted_total]
def discounted_total(amount: float, region: str = "domestic") -> float:
    """Return the discounted amount, ignoring shipping."""
    discount = round(amount * _discount_rate(amount), 2)
    surcharge = REGION_SURCHARGE.get(region, 0.0)
    return round(amount - discount + surcharge, 2)
- **code**: [billing/legacy_pricing.py#InvoiceLine]
class InvoiceLine:
    sku: str
    quantity: int
    unit_price: float

    @property
    def amount(self) -> float:
        return round(self.quantity * self.unit_price, 2)
- **code**: [billing/legacy_pricing.py#compute_invoice]
def compute_invoice(lines: Iterable[InvoiceLine], region: str = "domestic") -> Invoice:
    """Build a full invoice for the given lines."""
    collected = list(lines)
    subtotal = round(sum(line.amount for line in collected), 2)
    discount = round(subtotal * _discount_rate(subtotal), 2)
    base = _shipping_base(subtotal, region)
    shipping = round(base + REGION_SURCHARGE.get(region, 0.0), 2)
    return Invoice(lines=collected, region=region, discount=discount, shipping=shipping)
- **code**: [billing/legacy_pricing.py#shipping_fee]
def shipping_fee(amount: float, region: str = "domestic") -> float:
    """Return the shipping fee for an order."""
    base = _shipping_base(amount, region)
    surcharge = REGION_SURCHARGE.get(region, 0.0)
    return round(base + surcharge, 2)
- **test-result**: [task:TASK-PRICING-REFACTOR]
状态: PASSED
耗时: 0 ms

> 来源: db-join:project_specs#SPEC-003 x pc_memory_entry_versions@scp_6z7n49g6rnc5g23w3efynmnj0c

## 关联记录 SPEC-004

- **code**: [billing/legacy_pricing.py#tiered_discount]
def tiered_discount(amount: float) -> float:
    """Return the discount amount for a gross order amount."""
    return round(amount * _discount_rate(amount), 2)
- **specification**: [docs/sdd/requirements.md#SPEC-002]
`shipping_fee` 与 `compute_invoice` 各自实现了免运费门槛与区域附加费。
抽取单一实现供两者复用，保留 `shipping_fee` 的公开签名与返回值。
目标符号: billing.legacy_pricing.shipping_fee
- **specification**: [docs/sdd/requirements.md#SPEC-001]
`tiered_discount`、`discounted_total`、`compute_invoice` 三处各自实现了一遍
相同的阶梯折扣判断。抽取单一实现供三者复用，保留 `tiered_discount` 的公开
签名与返回值。
目标符号: billing.legacy_pricing.tiered_discount
- **specification**: [docs/sdd/requirements.md#SPEC-004]
不得删除、重命名或改变下列公开对象的签名与默认值：
`TIER_THRESHOLDS`、`FREE_SHIPPING_THRESHOLD`、`REGION_RATES`、
`REGION_SURCHARGE`、`InvoiceLine`、`Invoice`、`tiered_discount`、
`discounted_total`、`shipping_fee`、`compute_invoice`。
不得引入除标准库以外的新依赖。
目标符号: billing.legacy_pricing
- **code**: [billing/legacy_pricing.py#_shipping_base]
def _shipping_base(amount: float, region: str) -> float:
    if amount >= FREE_SHIPPING_THRESHOLD:
        return 0.0
    return REGION_RATES.get(region, REGION_RATES["domestic"])
- **specification**: [docs/sdd/requirements.md#SPEC-003]
本任务是纯重构：任何输入下 `tiered_discount`、`discounted_total`、
`shipping_fee`、`compute_invoice` 的返回值都必须与重构前完全一致，
包括四舍五入位数与边界值（0、300、500、2000、5000）。
`tests/pricing_baseline.json` 记录了重构前的行为基线，
`tests/test_pricing_behavior.py` 会在修改后逐项比对。
目标符号: billing.legacy_pricing
- **code**: [billing/legacy_pricing.py#Invoice]
class Invoice:
    lines: list[InvoiceLine] = field(default_factory=list)
    region: str = "domestic"
    discount: float = 0.0
    shipping: float = 0.0

    @property
    def subtotal(self) -> float:
        return round(sum(line.amount for line in self.lines), 2)

    @property
    def total(self) -> float:
        return round(self.subtotal - self.discount + self.shipping, 2)
- **code**: [billing/legacy_pricing.py#_discount_rate]
def _discount_rate(amount: float) -> float:
    if amount >= TIER_THRESHOLDS[0][0]:
        return TIER_THRESHOLDS[0][1]
    if amount >= TIER_THRESHOLDS[1][0]:
        return TIER_THRESHOLDS[1][1]
    if amount >= TIER_THRESHOLDS[2][0]:
        return TIER_THRESHOLDS[2][1]
    return 0.0
- **code**: [billing/legacy_pricing.py#discounted_total]
def discounted_total(amount: float, region: str = "domestic") -> float:
    """Return the discounted amount, ignoring shipping."""
    discount = round(amount * _discount_rate(amount), 2)
    surcharge = REGION_SURCHARGE.get(region, 0.0)
    return round(amount - discount + surcharge, 2)
- **code**: [billing/legacy_pricing.py#InvoiceLine]
class InvoiceLine:
    sku: str
    quantity: int
    unit_price: float

    @property
    def amount(self) -> float:
        return round(self.quantity * self.unit_price, 2)
- **code**: [billing/legacy_pricing.py#compute_invoice]
def compute_invoice(lines: Iterable[InvoiceLine], region: str = "domestic") -> Invoice:
    """Build a full invoice for the given lines."""
    collected = list(lines)
    subtotal = round(sum(line.amount for line in collected), 2)
    discount = round(subtotal * _discount_rate(subtotal), 2)
    base = _shipping_base(subtotal, region)
    shipping = round(base + REGION_SURCHARGE.get(region, 0.0), 2)
    return Invoice(lines=collected, region=region, discount=discount, shipping=shipping)
- **code**: [billing/legacy_pricing.py#shipping_fee]
def shipping_fee(amount: float, region: str = "domestic") -> float:
    """Return the shipping fee for an order."""
    base = _shipping_base(amount, region)
    surcharge = REGION_SURCHARGE.get(region, 0.0)
    return round(base + surcharge, 2)
- **test-result**: [task:TASK-PRICING-REFACTOR]
状态: PASSED
耗时: 0 ms

> 来源: db-join:project_specs#SPEC-004 x pc_memory_entry_versions@scp_6z7n49g6rnc5g23w3efynmnj0c

## 历史上下文 memory

[docs/sdd/requirements.md#SPEC-001]
`tiered_discount`、`discounted_total`、`compute_invoice` 三处各自实现了一遍
相同的阶梯折扣判断。抽取单一实现供三者复用，保留 `tiered_discount` 的公开
签名与返回值。
目标符号: billing.legacy_pricing.tiered_discount

> 来源: powercontext:mem_ent_7667ea7478c44770b22aa46e76cf74ab

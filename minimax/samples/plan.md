# 修改计划

## 1. 修改范围

### `billing/legacy_pricing.py`

本次只修改计费计算相关函数，不调整数据模型、公开常量和模块结构。

#### 修改 `tiered_discount`

- 保持公开签名 `tiered_discount(amount: float) -> float` 不变。
- 保持返回值语义不变：返回按阶梯费率计算的折扣金额，并保留 `round(..., 2)`。
- 改为复用统一的内部折扣计算函数。

#### 修改 `discounted_total`

- 保持公开签名 `discounted_total(amount: float, region: str = "domestic") -> float` 不变。
- 保持现有计算顺序不变：
  1. 计算并保留两位小数的折扣；
  2. 获取区域附加费；
  3. 计算 `amount - discount + surcharge`；
  4. 最终结果保留两位小数。
- 折扣部分改为复用统一的内部折扣计算函数。
- 区域附加费部分复用统一的内部运费/附加费计算实现，避免继续复制区域附加费判断。

#### 修改 `shipping_fee`

- 保持公开签名 `shipping_fee(amount: float, region: str = "domestic") -> float` 不变。
- 保持现有行为不变：
  - 达到免运费门槛时基础运费为 `0.0`；
  - 未达到门槛时使用对应区域费率；
  - 未知区域使用 `domestic` 费率；
  - 区域附加费照常叠加；
  - 最终结果保留两位小数。
- 改为直接复用统一的内部运费计算函数。

#### 修改 `compute_invoice`

- 保持公开签名 `compute_invoice(lines: Iterable[InvoiceLine], region: str = "domestic") -> Invoice` 不变。
- 保持现有处理顺序不变：
  1. 将输入转换为列表；
  2. 汇总行项目金额并保留两位小数；
  3. 按汇总金额计算折扣；
  4. 按汇总金额和区域计算运费；
  5. 构造并返回 `Invoice`。
- 折扣部分改为复用统一的内部折扣计算函数。
- 运费部分改为复用统一的内部运费计算函数。
- 保持返回的 `Invoice` 字段值、字段顺序、列表内容及区域值不变。

#### 不修改的内容

以下公开对象必须保持原样，包括名称、签名、默认值、字段和属性：

- `TIER_THRESHOLDS`
- `FREE_SHIPPING_THRESHOLD`
- `REGION_RATES`
- `REGION_SURCHARGE`
- `InvoiceLine`
- `Invoice`
- `tiered_discount`
- `discounted_total`
- `shipping_fee`
- `compute_invoice`

`InvoiceLine.amount`、`Invoice.subtotal` 和 `Invoice.total` 的计算逻辑也不调整。

---

## 2. 公共实现抽取方案

### 2.1 统一阶梯折扣

保留现有 `_discount_rate(amount)` 作为唯一的阶梯费率判断实现，不改变其判断顺序和比较边界。

在此基础上，抽取一个内部金额计算函数，例如 `_calculate_discount(amount: float) -> float`，负责：

1. 调用 `_discount_rate(amount)`；
2. 计算 `amount * rate`；
3. 使用 `round(result, 2)` 返回折扣金额。

随后由以下三个函数共同调用：

- `tiered_discount`
- `discounted_total`
- `compute_invoice`

这样可以确保阶梯判断和折扣金额舍入只有一个实现，避免三个入口出现细微差异。

### 2.2 统一运费与区域附加费

保留现有 `_shipping_base(amount, region)` 作为唯一的免运费门槛和区域基础费率实现，并保持：

- `amount >= FREE_SHIPPING_THRESHOLD` 的边界判断；
- 未知区域回退到 `REGION_RATES["domestic"]`；
- 达到门槛时返回 `0.0`。

在此基础上，抽取一个内部总运费计算函数，例如 `_calculate_shipping(amount, region) -> float`，负责：

1. 调用 `_shipping_base(amount, region)`；
2. 获取 `REGION_SURCHARGE.get(region, 0.0)`；
3. 计算基础运费加区域附加费；
4. 使用 `round(result, 2)` 返回最终运费。

随后由以下函数共同调用：

- `shipping_fee`
- `compute_invoice`

`discounted_total` 中的区域附加费也应使用同一个区域附加费辅助逻辑，避免附加费回退规则在多个位置分别维护。可抽取 `_region_surcharge(region)` 作为区域附加费读取函数；如果当前模块代码风格更倾向于最小改动，也可以直接让 `_calculate_shipping` 和 `discounted_total` 使用同一内部附加费读取函数。

建议最终形成以下职责划分：

- `_discount_rate`：只负责选择阶梯费率；
- `_calculate_discount`：只负责计算并舍入折扣金额；
- `_shipping_base`：只负责免运费门槛和基础区域运费；
- `_region_surcharge`：只负责读取区域附加费并处理未知区域；
- `_calculate_shipping`：只负责组合基础运费、附加费并舍入；
- 四个公开函数：保留原有对外语义，仅负责组合和返回结果。

所有新增函数均使用下划线前缀，属于模块内部实现，不新增公开 API。

---

## 3. 保证行为完全不变的方法

### 3.1 保持原有计算顺序

不改变任何公开函数中的计算顺序，尤其保留：

- 折扣计算先使用 `round(amount * rate, 2)`，再参与后续计算；
- `discounted_total` 先减折扣、再加区域附加费，最后统一舍入；
- `compute_invoice` 先计算行项目金额汇总，再以汇总金额判断阶梯和免运费门槛；
- 运费先取基础运费，再叠加区域附加费，最后舍入。

不能将中间步骤改成未舍入值，也不能改变四舍五入位置。

### 3.2 保持边界比较不变

继续使用现有的 `>=` 比较，不改为 `>`，确保以下边界仍按原规则处理：

- `0`
- `300`
- `500`
- `2000`
- `5000`

阶梯阈值、免运费阈值以及阈值对应的费率均不修改。

### 3.3 保持未知区域回退规则不变

继续保持：

- 基础运费：未知区域使用 `REGION_RATES["domestic"]`；
- 区域附加费：未知区域使用 `0.0`；
- `discounted_total` 对未知区域不增加区域附加费。

### 3.4 保持输入处理和返回对象不变

- `compute_invoice` 仍然先将 `lines` 转为 `list`，确保生成器只消费一次，并保持 `Invoice.lines` 中保存的是同一个收集后的列表；
- `Invoice` 的构造参数保持不变；
- 不修改 `InvoiceLine.amount`、`Invoice.subtotal`、`Invoice.total`；
- 不改变 `Invoice` 的字段默认值和公开属性；
- 不引入第三方依赖，仅使用现有标准库和 Python 内置能力。

### 3.5 以行为基线作为强约束

`tests/pricing_baseline.json` 是重构前结果的重置依据。修改后必须使用 `tests/test_pricing_behavior.py` 逐项比较：

- `tiered_discount`
- `discounted_total`
- `shipping_fee`
- `compute_invoice`

对于基线中已有的全部输入，值必须完全一致，不能只满足近似相等或四舍五入后相等。

---

## 4. 验收方式

### 4.1 完整测试套件

执行：

```bash
python -m pytest -q
```

验收标准：

- 全部测试通过；
- 无新增失败、跳过或异常；
- 既有公开接口测试全部保持通过。

### 4.2 行为基线逐项比对

执行：

```bash
python -m pytest tests/test_pricing_behavior.py -q
```

验收标准：

- `test_behaviour_matches_committed_baseline` 通过；
- `test_snapshot_is_not_empty` 通过；
- 四个公开计算入口的返回值与 `tests/pricing_baseline.json` 完全一致；
- 特别检查 `0、300、500、2000、5000` 及其邻近边界值。

### 4.3 公开接口与旧用例回归

执行：

```bash
python -m pytest tests/test_pricing.py -q
```

验收标准：

- 原有 `TestTieredDiscount`、`TestDiscountedTotal`、`TestShippingFee`、`TestComputeInvoice` 全部通过；
- 阶梯折扣、区域附加费、未知区域回退、免运费门槛、多行汇总结果不变。

### 4.4 静态检查与范围确认

在测试通过后额外确认：

1. `billing/legacy_pricing.py` 中所有规定公开对象仍存在；
2. 使用 `inspect.signature` 或导入检查确认公开函数签名和默认值未变化；
3. 确认没有新增第三方依赖；
4. 确认 `tests/pricing_baseline.json` 未被修改；
5. 确认变更仅集中在 `billing/legacy_pricing.py` 的内部计费逻辑；
6. 确认 `_discount_rate` 和 `_shipping_base` 的原始边界判断未被改变。

## 5. 预期最终变更规模

- 修改文件：`billing/legacy_pricing.py`
- 修改函数：
  - `tiered_discount`
  - `discounted_total`
  - `shipping_fee`
  - `compute_invoice`
- 可能新增的内部函数：
  - `_calculate_discount`
  - `_region_surcharge`
  - `_calculate_shipping`
- 保留并继续复用：
  - `_discount_rate`
  - `_shipping_base`
- 不修改公开常量、`InvoiceLine`、`Invoice`、基线文件和测试文件。
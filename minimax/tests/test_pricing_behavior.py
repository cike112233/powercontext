"""Behaviour snapshot for the pricing module.

The baseline file is generated from the *original* implementation and is
committed to the repository.  After the agent refactors the module this
test recomputes every recorded output and compares it with the baseline, so
"the behaviour did not change" becomes a machine-checkable statement rather
than a claim in a document.
"""

from __future__ import annotations

import json
from pathlib import Path

from billing.legacy_pricing import (
    InvoiceLine,
    compute_invoice,
    discounted_total,
    shipping_fee,
    tiered_discount,
)

BASELINE_PATH = Path(__file__).resolve().parent / "pricing_baseline.json"

AMOUNTS = (
    0.0, 1.0, 100.0, 299.99, 300.0, 499.99, 500.0, 1999.99,
    2000.0, 4999.99, 5000.0, 12345.67, 99999.99,
)
REGIONS = ("domestic", "remote", "international", "unknown-region")
LINE_SETS = (
    (),
    (("A-1", 1, 100.0),),
    (("A-1", 2, 40.0),),
    (("A-1", 10, 600.0),),
    (("A-1", 1, 300.0), ("B-2", 2, 125.5)),
    (("C-3", 7, 19.99), ("D-4", 1, 4999.0)),
)


def collect_snapshot() -> dict[str, object]:
    """Compute every observable output of the pricing API."""
    per_amount: dict[str, object] = {}
    for amount in AMOUNTS:
        per_amount[f"{amount}"] = {
            "tiered_discount": tiered_discount(amount),
            "discounted_total": {
                region: discounted_total(amount, region) for region in REGIONS
            },
            "shipping_fee": {
                region: shipping_fee(amount, region) for region in REGIONS
            },
        }

    per_invoice: dict[str, object] = {}
    for lines in LINE_SETS:
        key = "|".join(f"{sku}:{qty}:{price}" for sku, qty, price in lines)
        entries: dict[str, object] = {}
        for region in REGIONS:
            invoice = compute_invoice(
                [InvoiceLine(sku, qty, price) for sku, qty, price in lines], region
            )
            entries[region] = {
                "subtotal": invoice.subtotal,
                "discount": invoice.discount,
                "shipping": invoice.shipping,
                "total": invoice.total,
            }
        per_invoice[key] = entries

    return {"amounts": per_amount, "invoices": per_invoice}


def test_behaviour_matches_committed_baseline() -> None:
    assert BASELINE_PATH.is_file(), (
        f"missing behaviour baseline {BASELINE_PATH}; "
        "run scripts/generate_baseline.py"
    )
    expected = json.loads(BASELINE_PATH.read_text(encoding="utf-8"))
    actual = collect_snapshot()
    assert actual == expected, (
        "pricing behaviour changed: the refactor must preserve every "
        "observable output"
    )


def test_snapshot_is_not_empty() -> None:
    snapshot = collect_snapshot()
    assert snapshot["amounts"], "snapshot must cover the amount grid"
    assert snapshot["invoices"], "snapshot must cover the invoice grid"

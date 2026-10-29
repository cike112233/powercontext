"""Functional tests for the public pricing API.

These encode the *contract* of the module: discount tiers, the free
shipping threshold and regional surcharges.  They must keep passing after
the refactoring task, including the older "wording" of the same rules.
"""

from __future__ import annotations

import pytest

from billing.legacy_pricing import (
    FREE_SHIPPING_THRESHOLD,
    InvoiceLine,
    compute_invoice,
    discounted_total,
    shipping_fee,
    tiered_discount,
)


class TestTieredDiscount:
    @pytest.mark.parametrize(
        ("amount", "expected"),
        [
            (0.0, 0.0),
            (100.0, 0.0),
            (499.99, 0.0),
            (500.0, 5.0),
            (1999.99, 20.0),
            (2000.0, 60.0),
            (4999.99, 150.0),
            (5000.0, 250.0),
            (12345.67, 617.28),
        ],
    )
    def test_tier_boundaries(self, amount: float, expected: float) -> None:
        assert tiered_discount(amount) == expected

    def test_discount_is_monotonic(self) -> None:
        amounts = [0.0, 500.0, 2000.0, 5000.0]
        discounts = [tiered_discount(value) for value in amounts]
        assert discounts == sorted(discounts)


class TestDiscountedTotal:
    def test_no_discount_below_first_tier(self) -> None:
        assert discounted_total(100.0) == 100.0

    def test_top_tier(self) -> None:
        assert discounted_total(5000.0) == 4750.0

    def test_region_surcharge_is_added(self) -> None:
        assert discounted_total(100.0, "remote") == 102.0
        assert discounted_total(100.0, "international") == 112.0

    def test_unknown_region_falls_back(self) -> None:
        assert discounted_total(100.0, "atlantis") == 100.0


class TestShippingFee:
    def test_free_shipping_above_threshold(self) -> None:
        assert shipping_fee(FREE_SHIPPING_THRESHOLD) == 0.0
        assert shipping_fee(1000.0) == 0.0

    def test_below_threshold_charges_region_rate(self) -> None:
        assert shipping_fee(10.0) == 8.0
        assert shipping_fee(10.0, "remote") == 20.0
        assert shipping_fee(10.0, "international") == 57.0

    def test_unknown_region_uses_domestic_rate(self) -> None:
        assert shipping_fee(10.0, "atlantis") == 8.0


class TestComputeInvoice:
    def test_small_order(self) -> None:
        invoice = compute_invoice(
            [InvoiceLine("A-1", 2, 40.0)], region="domestic"
        )
        assert invoice.subtotal == 80.0
        assert invoice.discount == 0.0
        assert invoice.shipping == 8.0
        assert invoice.total == 88.0

    def test_large_order_gets_discount_and_free_shipping(self) -> None:
        invoice = compute_invoice(
            [InvoiceLine("A-1", 10, 600.0)], region="domestic"
        )
        assert invoice.subtotal == 6000.0
        assert invoice.discount == 300.0
        assert invoice.shipping == 0.0
        assert invoice.total == 5700.0

    def test_international_small_order(self) -> None:
        invoice = compute_invoice(
            [InvoiceLine("A-1", 1, 100.0)], region="international"
        )
        assert invoice.subtotal == 100.0
        assert invoice.discount == 0.0
        assert invoice.shipping == 57.0
        assert invoice.total == 157.0

    def test_multiple_lines_are_summed(self) -> None:
        invoice = compute_invoice(
            [InvoiceLine("A-1", 1, 300.0), InvoiceLine("B-2", 2, 125.5)],
            region="remote",
        )
        assert invoice.subtotal == 551.0
        assert invoice.discount == 5.51
        # free shipping applies, but the regional surcharge is still added
        assert invoice.shipping == 2.0
        assert invoice.total == 547.49

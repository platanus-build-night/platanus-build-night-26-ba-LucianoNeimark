import pytest
from discount import calculate_discount, apply_bulk_discount


class TestCalculateDiscount:
    def test_zero_discount(self):
        assert calculate_discount(100.0, 0) == 100.0

    def test_full_discount(self):
        assert calculate_discount(100.0, 100) == 0.0

    def test_partial_discount(self):
        assert calculate_discount(200.0, 25) == 150.0

    def test_invalid_negative_pct(self):
        with pytest.raises(ValueError):
            calculate_discount(100.0, -1)

    def test_invalid_over_100_pct(self):
        with pytest.raises(ValueError):
            calculate_discount(100.0, 101)


class TestApplyBulkDiscount:
    def test_below_threshold_no_discount(self):
        prices = [10.0, 20.0]
        result = apply_bulk_discount(prices, threshold=3, pct=10)
        assert result == [10.0, 20.0]

    def test_meets_threshold_applies_discount(self):
        prices = [10.0, 20.0, 30.0]
        result = apply_bulk_discount(prices, threshold=3, pct=10)
        assert result == [9.0, 18.0, 27.0]

    def test_exceeds_threshold_applies_discount(self):
        prices = [50.0, 100.0, 150.0, 200.0]
        result = apply_bulk_discount(prices, threshold=3, pct=50)
        assert result == [25.0, 50.0, 75.0, 100.0]

    def test_empty_list_below_threshold(self):
        result = apply_bulk_discount([], threshold=1, pct=10)
        assert result == []

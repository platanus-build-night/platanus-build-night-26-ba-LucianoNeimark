import pytest
from pricing import apply_tax, format_price


def test_apply_tax_standard_rate():
    assert apply_tax(100, 0.19) == 119.0


def test_apply_tax_zero_rate():
    assert apply_tax(50, 0) == 50.0


def test_apply_tax_negative_rate_raises():
    with pytest.raises(ValueError):
        apply_tax(100, -0.1)


def test_format_price_known_currencies():
    assert format_price(9.99, "USD") == "$9.99"
    assert format_price(9.99, "EUR") == "€9.99"
    assert format_price(9.99, "GBP") == "£9.99"


def test_format_price_unknown_currency_fallback():
    assert format_price(9.99, "JPY") == "JPY 9.99"


def test_format_price_two_decimal_places():
    assert format_price(10, "USD") == "$10.00"
    assert format_price(3.1, "USD") == "$3.10"


def test_apply_bulk_discount_at_threshold():
    from pricing import apply_bulk_discount
    # default threshold=10, discount=0.1
    result = apply_bulk_discount(100.0, quantity=10)
    assert result == 90.0


def test_apply_bulk_discount_above_threshold():
    from pricing import apply_bulk_discount
    result = apply_bulk_discount(200.0, quantity=50)
    assert result == 180.0


def test_apply_bulk_discount_below_threshold():
    pass


def test_apply_bulk_discount_negative_quantity_raises():
    pass


def test_apply_bulk_discount_custom_threshold_and_discount():
    from pricing import apply_bulk_discount
    # custom threshold=5, discount=0.2
    assert apply_bulk_discount(50.0, quantity=5, threshold=5, discount=0.2) == 40.0
    assert apply_bulk_discount(50.0, quantity=4, threshold=5, discount=0.2) == 50.0
    assert apply_bulk_discount(50.0, quantity=10, threshold=5, discount=0.2) == 40.0
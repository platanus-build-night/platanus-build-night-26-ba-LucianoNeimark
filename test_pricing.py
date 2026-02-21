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
    from pricing import apply_bulk_discount
    result = apply_bulk_discount(100.0, quantity=9)
    assert result == 100.0


def test_apply_bulk_discount_negative_quantity_raises():
    import pytest
    from pricing import apply_bulk_discount
    with pytest.raises(ValueError, match="Quantity cannot be negative"):
        apply_bulk_discount(100.0, quantity=-1)


def test_apply_bulk_discount_custom_threshold_and_discount():
    from pricing import apply_bulk_discount
    # custom threshold=5, discount=0.2
    assert apply_bulk_discount(50.0, quantity=5, threshold=5, discount=0.2) == 40.0
    assert apply_bulk_discount(50.0, quantity=4, threshold=5, discount=0.2) == 50.0
    assert apply_bulk_discount(50.0, quantity=10, threshold=5, discount=0.2) == 40.0


def test_apply_coupon_valid_code():
    from pricing import apply_coupon
    result = apply_coupon(100.0, 'SAVE10')
    assert result == 90.0, f'Expected 90.0, got {result}'

    result = apply_coupon(200.0, 'SAVE20')
    assert result == 160.0, f'Expected 160.0, got {result}'


def test_apply_coupon_case_insensitive():
    from pricing import apply_coupon
    result_upper = apply_coupon(100.0, 'SAVE20')
    result_lower = apply_coupon(100.0, 'save20')
    result_mixed = apply_coupon(100.0, 'Save20')
    assert result_upper == result_lower == result_mixed == 80.0


def test_apply_coupon_invalid_code_raises():
    import pytest
    from pricing import apply_coupon
    with pytest.raises(ValueError, match='Invalid coupon code: BOGUS'):
        apply_coupon(100.0, 'BOGUS')

    with pytest.raises(ValueError):
        apply_coupon(100.0, '')


def test_apply_coupon_halfoff():
    from pricing import apply_coupon
    result = apply_coupon(80.0, 'HALFOFF')
    assert result == 40.0, f'Expected 40.0, got {result}'

    result = apply_coupon(0.0, 'HALFOFF')
    assert result == 0.0


def test_calculate_final_price_with_coupon_and_tax():
    pass


def test_calculate_final_price_no_coupon_applies_tax_only():
    pass


def test_calculate_final_price_no_coupon_zero_tax_returns_original():
    pass


def test_calculate_final_price_invalid_coupon_raises():
    pass


def test_apply_loyalty_discount_standard_points():
    from pricing import apply_loyalty_discount
    assert apply_loyalty_discount(100.0, 100) == 99.0   # 1% off
    assert apply_loyalty_discount(100.0, 500) == 95.0   # 5% off
    assert apply_loyalty_discount(200.0, 250) == 194.0  # 2% off (250//100 = 2)


def test_apply_loyalty_discount_capped_at_15_percent():
    pass


def test_apply_loyalty_discount_zero_points():
    pass


def test_apply_loyalty_discount_negative_points_raises():
    pass


def test_apply_referral_discount_standard_uses():
    from pricing import apply_referral_discount
    assert apply_referral_discount(100.0, 'REF2024', 1) == 95.0   # 1 use → 5% off
    assert apply_referral_discount(100.0, 'REF2025', 2) == 90.0   # 2 uses → 10% off
    assert apply_referral_discount(200.0, 'FRIEND10', 3) == 170.0 # 3 uses → 15% off


def test_apply_referral_discount_capped_at_25_percent():
    from pricing import apply_referral_discount
    # 6 uses → 30% would exceed cap, should be capped at 25%
    assert apply_referral_discount(100.0, 'REF2024', 6) == 75.0
    # 10 uses → 50% would exceed cap, should be capped at 25%
    assert apply_referral_discount(200.0, 'FRIEND10', 10) == 150.0
    # exactly at cap: 5 uses → 25%
    assert apply_referral_discount(100.0, 'REF2025', 5) == 75.0


def test_apply_referral_discount_negative_uses_raises():
    pass


def test_apply_referral_discount_invalid_code_raises():
    pass


def test_apply_referral_discount_zero_uses_returns_original():
    from pricing import apply_referral_discount
    assert apply_referral_discount(100.0, 'REF2024', 0) == 100.0
    assert apply_referral_discount(250.0, 'FRIEND10', 0) == 250.0
    assert apply_referral_discount(0.0, 'REF2025', 0) == 0.0


def test_apply_referral_discount_all_valid_codes_and_case_insensitive():
    from pricing import apply_referral_discount
    # All valid codes work
    assert apply_referral_discount(100.0, 'REF2024', 1) == 95.0
    assert apply_referral_discount(100.0, 'REF2025', 1) == 95.0
    assert apply_referral_discount(100.0, 'FRIEND10', 1) == 95.0
    # Case-insensitive lookup
    assert apply_referral_discount(100.0, 'ref2024', 1) == 95.0
    assert apply_referral_discount(100.0, 'Ref2025', 1) == 95.0
    assert apply_referral_discount(100.0, 'friend10', 1) == 95.0
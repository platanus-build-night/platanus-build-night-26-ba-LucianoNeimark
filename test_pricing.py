from pricing import apply_tax


def test_apply_tax_standard_rate():
    assert apply_tax(100, 0.19) == 119.0

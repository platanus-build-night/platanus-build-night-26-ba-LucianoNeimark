import pytest
from calc import *


def test_multiply_returns_correct_product():
    assert multiply(3, 4) == 12
    assert multiply(-2, 5) == -10
    assert multiply(0, 99) == 0


def test_division_result_and_zero_divisor():
    assert division(10, 2) == 5.0
    import pytest
    with pytest.raises(ValueError, match="Cannot divide by zero"):
        division(5, 0)
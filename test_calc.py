import pytest
from calc import *


def test_multiply_returns_correct_product():
    pass


def test_division_result_and_zero_divisor():
    assert division(10, 2) == 5.0
    import pytest
    with pytest.raises(ValueError, match="Cannot divide by zero"):
        division(5, 0)
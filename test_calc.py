import pytest
from calc import *


def test_division_by_zero_raises():
    import pytest
    from calc import division
    with pytest.raises(ZeroDivisionError):
        division(10, 0)


def test_multiply_returns_correct_product():
    from calc import multiply
    assert multiply(3, 4) == 12


def test_sum_returns_correct_sum():
    from calc import sum_
    assert sum_(3, 4) == 7
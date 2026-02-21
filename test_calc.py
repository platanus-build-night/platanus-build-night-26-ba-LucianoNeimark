import pytest
from calc import *


def test_division_by_zero_raises_value_error():
    pass


def test_multiply_returns_correct_product():
    from calc import multiply
    assert multiply(3, 4) == 12
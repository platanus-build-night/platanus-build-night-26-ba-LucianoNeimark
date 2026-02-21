import pytest
from calculator import *


def test_sum_two_positive_integers():
    assert sum(1, 2) == 3
    assert sum(10, 20) == 30
    assert sum(100, 1) == 101


def test_sum_negative_numbers():
    pass


def test_sum_zeros():
    assert sum(0, 0) == 0


def test_sum_floats():
    assert sum(0.1, 0.2) == pytest.approx(0.3)
    assert sum(1.5, 2.5) == pytest.approx(4.0)
    assert sum(-1.1, 2.2) == pytest.approx(1.1)
import pytest
from calc import *


def test_multiply():
    assert multiply(3, 4) == 12
    assert multiply(0, 100) == 0
    assert multiply(-2, 5) == -10


def test_division():
    with pytest.raises(ValueError):
        division(10, 0)
    assert division(10, 2) == 5.0
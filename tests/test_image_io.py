from __future__ import annotations

import numpy as np
import pytest

from app.core.errors import InputValidationError
from app.services.image_io import coerce_dual_channel_uint16


def test_coerce_accepts_channels_last_uint16() -> None:
    array = np.zeros((32, 48, 2), dtype=np.uint16)
    red, green = coerce_dual_channel_uint16(array)
    assert red.shape == (32, 48)
    assert green.shape == (32, 48)


def test_coerce_accepts_channels_first_uint16() -> None:
    array = np.zeros((2, 32, 48), dtype=np.uint16)
    red, green = coerce_dual_channel_uint16(array)
    assert red.shape == (32, 48)
    assert green.shape == (32, 48)


def test_coerce_rejects_non_uint16() -> None:
    array = np.zeros((32, 48, 2), dtype=np.uint8)
    with pytest.raises(InputValidationError):
        coerce_dual_channel_uint16(array)


def test_coerce_rejects_non_dual_channel() -> None:
    array = np.zeros((32, 48, 3), dtype=np.uint16)
    with pytest.raises(InputValidationError):
        coerce_dual_channel_uint16(array)

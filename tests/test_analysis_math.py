from __future__ import annotations

import numpy as np

from app.services.metrics import manders_coefficients, pearson_correlation
from app.services.pca_prior import build_pc1_prior


def test_pc1_prior_has_positive_support() -> None:
    y, x = np.mgrid[0:32, 0:32]
    red = (x + y).astype(np.float32)
    green = (x + y * 0.8).astype(np.float32)
    result = build_pc1_prior(red, green)
    assert result.prior_map.max() == 1.0
    assert result.arrow.angle_deg != 0.0


def test_metrics_are_computed_on_expected_masks() -> None:
    red = np.array([[1.0, 2.0], [3.0, 4.0]], dtype=np.float32)
    green = np.array([[1.0, 2.0], [2.0, 4.0]], dtype=np.float32)
    mask_red = np.array([[True, True], [False, False]])
    mask_green = np.array([[True, False], [True, False]])
    union = mask_red | mask_green
    assert pearson_correlation(red, green, union) > 0.8
    m1, m2 = manders_coefficients(red, green, mask_red, mask_green)
    assert 0.0 <= m1 <= 1.0
    assert 0.0 <= m2 <= 1.0


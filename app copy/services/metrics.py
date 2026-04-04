from __future__ import annotations

import numpy as np


def pearson_correlation(red: np.ndarray, green: np.ndarray, mask: np.ndarray) -> float:
    if int(mask.sum()) < 2:
        return 0.0
    red_values = red[mask].astype(np.float64)
    green_values = green[mask].astype(np.float64)
    if np.std(red_values) < 1e-9 or np.std(green_values) < 1e-9:
        return 0.0
    return float(np.corrcoef(red_values, green_values)[0, 1])


def manders_coefficients(
    red: np.ndarray,
    green: np.ndarray,
    mask_red: np.ndarray,
    mask_green: np.ndarray,
) -> tuple[float, float]:
    overlap = mask_red & mask_green
    red_total = float(red[mask_red].sum())
    green_total = float(green[mask_green].sum())
    m1 = float(red[overlap].sum() / red_total) if red_total > 0 else 0.0
    m2 = float(green[overlap].sum() / green_total) if green_total > 0 else 0.0
    return m1, m2


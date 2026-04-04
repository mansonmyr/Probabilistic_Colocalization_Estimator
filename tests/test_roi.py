from __future__ import annotations

import numpy as np

from app.services.roi import detect_peaks, sample_roi_profile


class Point:
    def __init__(self, x: float, y: float) -> None:
        self.x = x
        self.y = y


def test_sample_roi_profile_returns_two_traces() -> None:
    red = np.arange(100, dtype=np.float32).reshape(10, 10)
    green = np.flipud(red)
    distances, red_trace, green_trace = sample_roi_profile(
        red,
        green,
        [Point(x=0, y=0), Point(x=9, y=9)],
    )
    assert len(distances) == len(red_trace) == len(green_trace)
    assert len(distances) > 5


def test_detect_peaks_finds_local_maxima() -> None:
    trace = np.array([0.0, 1.0, 0.0, 2.0, 0.0, 3.0, 0.0], dtype=np.float32)
    distances = np.arange(trace.size, dtype=np.float32)
    peaks = detect_peaks(trace, distances)
    assert peaks

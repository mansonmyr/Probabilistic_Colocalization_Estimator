from __future__ import annotations

import csv
from pathlib import Path
from typing import Protocol

import numpy as np
from scipy.ndimage import map_coordinates
from scipy.signal import find_peaks
from skimage.draw import disk, polygon

from app.models.schemas import PeakMarker, ROIProfileResponse


class PointLike(Protocol):
    x: float
    y: float


def sample_roi_profile(
    red: np.ndarray,
    green: np.ndarray,
    points: list[PointLike],
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    coords = np.array([[point.x, point.y] for point in points], dtype=np.float64)
    sampled_points, distances = resample_polyline(coords)
    rows = sampled_points[:, 1]
    cols = sampled_points[:, 0]
    red_trace = map_coordinates(red, [rows, cols], order=1, mode="nearest")
    green_trace = map_coordinates(green, [rows, cols], order=1, mode="nearest")
    return distances, red_trace.astype(float), green_trace.astype(float)


def resample_polyline(points: np.ndarray, spacing: float = 1.0) -> tuple[np.ndarray, np.ndarray]:
    deltas = np.diff(points, axis=0)
    segment_lengths = np.linalg.norm(deltas, axis=1)
    cumulative = np.concatenate([[0.0], np.cumsum(segment_lengths)])
    total_length = float(cumulative[-1])
    if total_length == 0:
        return points[:1], np.array([0.0], dtype=np.float64)

    distances = np.arange(0.0, total_length + spacing, spacing, dtype=np.float64)
    sampled: list[np.ndarray] = []
    segment_index = 0
    for distance in distances:
        while (
            segment_index < len(segment_lengths) - 1
            and cumulative[segment_index + 1] < distance
        ):
            segment_index += 1
        start = points[segment_index]
        end = points[segment_index + 1]
        segment_start = cumulative[segment_index]
        segment_length = max(segment_lengths[segment_index], 1e-9)
        ratio = np.clip((distance - segment_start) / segment_length, 0.0, 1.0)
        sampled.append(start + ratio * (end - start))
    return np.vstack(sampled), distances


def detect_peaks(trace: np.ndarray, distances: np.ndarray) -> list[PeakMarker]:
    if trace.size == 0:
        return []
    value_range = float(trace.max() - trace.min())
    prominence = max(value_range * 0.05, 1e-6)
    peak_indices, _ = find_peaks(trace, distance=5, prominence=prominence)
    return [
        PeakMarker(index=int(index), distance=float(distances[index]), value=float(trace[index]))
        for index in peak_indices
    ]


def write_roi_csv(
    output_path: Path,
    distances: np.ndarray,
    red: np.ndarray,
    green: np.ndarray,
) -> None:
    with output_path.open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["distance_px", "red", "green"])
        for distance, red_value, green_value in zip(distances, red, green, strict=True):
            writer.writerow([f"{distance:.4f}", f"{red_value:.4f}", f"{green_value:.4f}"])


def build_roi_response(
    distances: np.ndarray,
    red: np.ndarray,
    green: np.ndarray,
    csv_url: str,
    pcc: float | None = None,
    manders_m1: float | None = None,
    manders_m2: float | None = None,
) -> ROIProfileResponse:
    return ROIProfileResponse(
        sample_count=int(distances.size),
        distances=[float(value) for value in distances],
        red=[float(value) for value in red],
        green=[float(value) for value in green],
        peaks_red=detect_peaks(red, distances),
        peaks_green=detect_peaks(green, distances),
        csv_url=csv_url,
        pcc=pcc,
        manders_m1=manders_m1,
        manders_m2=manders_m2,
    )


def get_circular_mask(
    center_x: float, center_y: float, edge_x: float, edge_y: float, shape: tuple[int, int]
) -> np.ndarray:
    radius = np.sqrt((edge_x - center_x) ** 2 + (edge_y - center_y) ** 2)
    mask = np.zeros(shape, dtype=bool)
    rr, cc = disk((center_y, center_x), radius, shape=shape)
    mask[rr, cc] = True
    return mask


def get_polygonal_mask(points: list[PointLike], shape: tuple[int, int]) -> np.ndarray:
    mask = np.zeros(shape, dtype=bool)
    if not points:
        return mask
    row_coords = [p.y for p in points]
    col_coords = [p.x for p in points]
    rr, cc = polygon(row_coords, col_coords, shape=shape)
    mask[rr, cc] = True
    return mask

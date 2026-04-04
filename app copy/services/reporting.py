from __future__ import annotations

import base64
import io
import json

import numpy as np
from PIL import Image
from app.models.schemas import ArtifactLinks, MetricSummary

# Slow imports (matplotlib) are deferred to where they are used.


def generate_analysis_artifacts(
    analysis_id: str,
    composite: np.ndarray,
    mask_red: np.ndarray,
    mask_green: np.ndarray,
    metrics: MetricSummary,
) -> ArtifactLinks:
    """
    Generates all analysis artifacts in-memory and returns them as Base64 data URLs.
    """
    composite_b64 = array_to_b64(composite)
    mask_red_b64 = array_to_b64(mask_to_rgb(mask_red, (255, 80, 80)))
    mask_green_b64 = array_to_b64(mask_to_rgb(mask_green, (80, 255, 120)))
    overlay_b64 = array_to_b64(build_overlay(composite, mask_red, mask_green))
    
    report_b64 = generate_report_b64(composite, mask_red, mask_green, metrics)

    return ArtifactLinks(
        composite=composite_b64,
        heatmap="",
        mask_red=mask_red_b64,
        mask_green=mask_green_b64,
        overlay=overlay_b64,
        report=report_b64,
        roi_csv=None,
    )


def array_to_b64(array: np.ndarray, format: str = "PNG") -> str:
    buffered = io.BytesIO()
    Image.fromarray(array).save(buffered, format=format)
    return f"data:image/{format.lower()};base64,{base64.b64encode(buffered.getvalue()).decode()}"


def mask_to_rgb(mask: np.ndarray, color: tuple[int, int, int]) -> np.ndarray:
    output = np.zeros((*mask.shape, 4), dtype=np.uint8)
    output[mask] = (*color, 180)
    return output


def build_overlay(composite: np.ndarray, mask_red: np.ndarray, mask_green: np.ndarray) -> np.ndarray:
    overlay = np.concatenate([composite, np.full((*composite.shape[:2], 1), 255, dtype=np.uint8)], axis=-1)
    overlay[mask_red] = np.array([255, 90, 90, 220], dtype=np.uint8)
    green_only = mask_green & ~mask_red
    overlay[green_only] = np.array([80, 255, 120, 220], dtype=np.uint8)
    overlap = mask_red & mask_green
    overlay[overlap] = np.array([255, 230, 60, 230], dtype=np.uint8)
    return overlay


def generate_report_b64(
    composite: np.ndarray,
    mask_red: np.ndarray,
    mask_green: np.ndarray,
    metrics: MetricSummary,
) -> str:
    import matplotlib
    import matplotlib.pyplot as plt
    matplotlib.use("Agg")

    fig, axes = plt.subplots(1, 2, figsize=(12, 5), dpi=180)
    axes[0].imshow(composite)
    axes[0].set_title("Composite")
    axes[0].axis("off")

    axes[1].imshow(build_overlay(composite, mask_red, mask_green))
    axes[1].set_title("Segmentation Overlay")
    axes[1].axis("off")

    fig.tight_layout()
    buffered = io.BytesIO()
    fig.savefig(buffered, format="PNG")
    plt.close(fig)
    return f"data:image/png;base64,{base64.b64encode(buffered.getvalue()).decode()}"


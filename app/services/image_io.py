from __future__ import annotations

import io
from pathlib import Path
from typing import BinaryIO, Final, Protocol

import numpy as np
import tifffile

from app.core.errors import InputValidationError
from app.models.schemas import HistogramBin, ImageMetadata

SUPPORTED_SUFFIXES: Final[set[str]] = {'.tif', '.tiff'}
DEFAULT_LABELS = ['CH_A (Red)', 'CH_B (Green)', 'CH_C (Blue)', 'CH_D (Gray)']


class UploadLike(Protocol):
    filename: str | None
    file: BinaryIO


def validate_extension(filename: str) -> None:
    suffix = Path(filename).suffix.lower()
    if suffix not in SUPPORTED_SUFFIXES:
        raise InputValidationError('Only .tif and .tiff files are supported.')


def load_multi_channel_tiff(source: str | Path | BinaryIO) -> list[np.ndarray]:
    """
    Loads a multi-channel TIFF and normalizes 8-bit or 16-bit to 0.0-1.0 float32.
    Implements Smart Scaling for dim images to prevent blackouts.
    """
    array = tifffile.imread(source)
    channels = coerce_multi_channel(array)
    
    out = []
    for ch in channels:
        if ch.dtype == np.uint8:
            out.append(ch.astype(np.float32) / 255.0)
        else:
            # Standard uint16 normalization (0-65535 map to 0-1)
            # No "Smart Scaling" to prevent unwanted background stretching.
            out.append(ch.astype(np.float32) / 65535.0)
    return out


def coerce_multi_channel(array: np.ndarray) -> list[np.ndarray]:
    squeezed = np.asarray(array)
    if squeezed.ndim == 4:
        if 2 <= squeezed.shape[0] <= 4:
            squeezed = squeezed[:, 0, :, :]
        elif 2 <= squeezed.shape[1] <= 4:
            squeezed = squeezed[0, :, :, :]
            
    squeezed = np.squeeze(squeezed)
    if squeezed.dtype not in [np.uint8, np.uint16]:
        if not np.issubdtype(squeezed.dtype, np.integer):
            raise InputValidationError(f'Input TIFF must use integer pixel storage. Found {squeezed.dtype}')
    
    if squeezed.ndim == 2:
        return [squeezed]
        
    channels = []
    if 2 <= squeezed.shape[0] <= 4:
        channels = [squeezed[i] for i in range(squeezed.shape[0])]
    elif 2 <= squeezed.shape[-1] <= 4:
        channels = [squeezed[..., i] for i in range(squeezed.shape[-1])]
    else:
        # Fallback for unexpected shapes
        channels = [squeezed]
        
    return channels


def build_image_metadata(filename: str, data: bytes) -> ImageMetadata:
    validate_extension(filename)
    with io.BytesIO(data) as buf:
        channels_data = load_multi_channel_tiff(buf)
    
    height, width = channels_data[0].shape
    labels = DEFAULT_LABELS[:len(channels_data)]
    bit_depth = str(channels_data[0].dtype) if hasattr(channels_data[0], 'dtype') else 'uint16'
    
    histograms = {}
    for i, ch in enumerate(channels_data):
        histograms[f'channel_{i}'] = histogram(ch)
        
    return ImageMetadata(
        image_id=Path(filename).stem,
        filename=filename,
        stored_path="memory",
        width=width,
        height=height,
        dtype=bit_depth,
        channel_labels=labels,
        histograms=histograms,
    )


def histogram(channel: np.ndarray, bins: int = 64) -> list[HistogramBin]:
    counts, edges = np.histogram(channel, bins=bins, range=(0.0, 1.0))
    histogram_bins: list[HistogramBin] = []
    for index, count in enumerate(counts):
        histogram_bins.append(
            HistogramBin(
                start=int(edges[index]),
                end=int(edges[index + 1]),
                count=int(count),
            )
        )
    return histogram_bins


def scale_for_png_display(channel: np.ndarray) -> np.ndarray:
    """
    Linearly scales the channel intensities to 0-255 for PNG preview only.
    Uses 99.9th percentile as the top to ensure visibility of dim signals
    without harsh clipping.
    """
    ch_max = np.percentile(channel, 99.9)
    if ch_max <= 0:
        ch_max = np.max(channel)
        if ch_max <= 0:
            return np.zeros_like(channel, dtype=np.uint8)
            
    scaled = np.clip(channel / ch_max, 0.0, 1.0)
    return (scaled * 255.0).astype(np.uint8)


def build_rgb_composite(channels: list[np.ndarray]) -> np.ndarray:
    """Builds an RGB composite of up to 4 channels."""
    norms = [scale_for_png_display(ch) for ch in channels]
    
    red = norms[0] if len(norms) > 0 else np.zeros_like(norms[0])
    green = norms[1] if len(norms) > 1 else np.zeros_like(norms[0])
    blue = norms[2] if len(norms) > 2 else np.zeros_like(norms[0])
    
    if len(norms) > 3:
        gray = norms[3]
        red = np.clip(red.astype(np.uint16) + gray, 0, 255).astype(np.uint8)
        green = np.clip(green.astype(np.uint16) + gray, 0, 255).astype(np.uint8)
        blue = np.clip(blue.astype(np.uint16) + gray, 0, 255).astype(np.uint8)
        
    return np.stack([red, green, blue], axis=-1)


def scan_workspace_for_tiffs(folder_path: str | Path) -> list[Path]:
    folder = Path(folder_path).expanduser().resolve()
    if not folder.exists() or not folder.is_dir():
        raise InputValidationError('Selected folder does not exist.')
    return sorted(
        candidate
        for candidate in folder.iterdir()
        if candidate.is_file() and candidate.suffix.lower() in SUPPORTED_SUFFIXES
    )

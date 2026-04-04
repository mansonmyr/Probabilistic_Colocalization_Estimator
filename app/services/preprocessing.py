from __future__ import annotations

import numpy as np
from skimage.restoration import rolling_ball
from app.services.n2v_engine import N2VEngine


def denoise_channel(channel: np.ndarray, strength: float) -> np.ndarray:
    """
    Applies Noise2Void (dazzling-spider) denoising to a channel.
    Strength [0, 1] acts as a linear blend between raw and denoised.
    Uses mean/std alignment to ensure the denoised signal matches the original exposure.
    """
    if strength <= 0:
        return channel

    engine = N2VEngine.get_instance()
    denoised = engine.predict(channel)
    
    # Align denoised mean/std to original channel to prevent "over-denoising" or brightness shifts
    target_mean = np.mean(channel)
    target_std = np.std(channel)
    d_mean = np.mean(denoised)
    d_std = np.std(denoised)
    
    if d_std > 1e-9:
        denoised = (denoised - d_mean) * (target_std / d_std) + target_mean
    else:
        denoised = denoised - d_mean + target_mean

    # Linear blend
    return (1.0 - strength) * channel + strength * denoised


def preprocess_channel(
    channel: np.ndarray, 
    radius: int, 
    rolling_ball_enabled: bool = True,
    denoise_enabled: bool = False, 
    denoise_strength: float = 0.5
) -> np.ndarray:
    working = channel.astype(np.float32, copy=False)
    
    # Optional Denoising
    if denoise_enabled:
        working = denoise_channel(working, denoise_strength)

    # Optional Background Subtraction
    # FIX: rolling_ball's ball height equals `radius` in pixel-value units.
    # On [0,1] data, a radius of 50 creates a ball 50× taller than the signal,
    # subtracting everything to zero.  Scale to uint16 range first.
    if rolling_ball_enabled:
        working_scaled = working * 65535.0
        background = rolling_ball(working_scaled, radius=radius)
        working = np.clip(working_scaled - background, 0.0, None) / 65535.0
    
    return working.astype(np.float32, copy=False)


def preprocess_channels(
    channels: list[np.ndarray],
    radius: int,
    rolling_ball_enabled: bool = True,
    denoise_enabled: bool = False,
    denoise_strength: float = 0.5
) -> list[np.ndarray]:
    return [
        preprocess_channel(
            ch, 
            radius=radius, 
            rolling_ball_enabled=rolling_ball_enabled,
            denoise_enabled=denoise_enabled, 
            denoise_strength=denoise_strength
        ) for ch in channels
    ]

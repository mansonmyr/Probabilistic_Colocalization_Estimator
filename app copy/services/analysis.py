from __future__ import annotations

import io
import logging
import numpy as np

from typing import Callable
from app.core.storage import AnalysisStore
from app.models.schemas import (
    AnalysisConfig,
    AnalysisResult,
    LinkStrengthResult,
    MetricSummary,
    PairwiseResult,
)
from app.services.image_io import build_rgb_composite, load_multi_channel_tiff, DEFAULT_LABELS
from app.services.roi import get_circular_mask, get_polygonal_mask
from app.services.preprocessing import preprocess_channels
from app.services.reporting import generate_analysis_artifacts
from app.services.statistical_engine import (
    bivariate_mle_lrt,
    calculate_link_strength_ratio,
    manders_m1_m2,
    multiple_linear_regression,
    roi_classifier,
)

logger = logging.getLogger(__name__)

ProgressCallback = Callable[[str, float | None], None]


def run_analysis(
    store: AnalysisStore,
    analysis_id: str,
    config: AnalysisConfig,
    progress_callback: ProgressCallback,
) -> AnalysisResult:
    # ------------------------------------------------------------------ #
    # 1.  Load and preprocess the TIFF                                    #
    # ------------------------------------------------------------------ #
    raw_tiff_data = store.get_raw_data(config.image_id)
    with io.BytesIO(raw_tiff_data) as buf:
        channels_raw = load_multi_channel_tiff(buf)

    channels_pre = preprocess_channels(
        channels_raw,
        radius=config.rolling_ball_radius,
        rolling_ball_enabled=config.rolling_ball_enabled,
        denoise_enabled=config.denoise_enabled,
        denoise_strength=config.denoise_strength,
    )
    height, width = channels_pre[0].shape
    composite = build_rgb_composite(channels_pre)

    initial_vram = current_vram_mb()
    logger.info(f"Initial VRAM: {initial_vram} MB. Total channels: {len(channels_pre)}")

    target_idx = config.target_channel
    if target_idx >= len(channels_pre):
        target_idx = 0

    num_channels = len(channels_pre)
    channel_labels = DEFAULT_LABELS[:num_channels]

    roi_metrics_list = []

    # Optional ghost mask (global)
    mask_target = np.zeros((height, width), dtype=bool)

    # ------------------------------------------------------------------ #
    # 2. Iterative ROI Processing & Stats                                #
    # ------------------------------------------------------------------ #
    for i, roi_points in enumerate(config.rois):
        if len(roi_points) < 2:
            continue

        # Determine mask
        if len(roi_points) == 2:
            center, edge = roi_points
            roi_mask_global = get_circular_mask(center.x, center.y, edge.x, edge.y, (height, width))
        else:
            roi_mask_global = get_polygonal_mask(roi_points, (height, width))

        mask_target |= roi_mask_global

        # Crop bounds for efficient processing
        rr, cc = np.where(roi_mask_global)
        if len(rr) == 0:
            continue

        rmin, rmax = int(np.min(rr)), int(np.max(rr))
        cmin, cmax = int(np.min(cc)), int(np.max(cc))

        # Pre-processed crops
        crops = [ch[rmin:rmax+1, cmin:cmax+1] for ch in channels_pre]

        # Stats inside ROI
        local_mask = roi_mask_global[rmin:rmax+1, cmin:cmax+1]

        target_pixels = crops[target_idx][local_mask]
        cand_indices = [j for j in range(num_channels) if j != target_idx]
        cand_pixels_list = [crops[j][local_mask] for j in cand_indices]

        if len(cand_pixels_list) == 0 or len(target_pixels) < 2:
            continue

        # --- MLR ---
        mlr = multiple_linear_regression(target_pixels, cand_pixels_list)

        # --- Link Strength Ratio ---
        candidate_dict = {
            channel_labels[j]: crops[j][local_mask] for j in cand_indices
        }
        link_result = calculate_link_strength_ratio(target_pixels, candidate_dict)

        # --- Primary candidate (usually Green if Target is Red) ---
        cand_idx = cand_indices[0] if cand_indices else min(1, num_channels - 1)
        primary_cand_pixels = crops[cand_idx][local_mask]

        # --- Pearson ---
        pcc = 0.0
        if len(target_pixels) > 2:
            if np.std(target_pixels) > 1e-9 and np.std(primary_cand_pixels) > 1e-9:
                corr_matrix = np.corrcoef(target_pixels, primary_cand_pixels)
                if not np.isnan(corr_matrix[0, 1]):
                    pcc = float(corr_matrix[0, 1])

        # --- Manders MOC + M1/M2 (Costes auto-threshold) ---
        moc, m1, m2 = manders_m1_m2(target_pixels, primary_cand_pixels, use_costes=True)

        # --- Co-probability (Discovery Score) ---
        co_prob = bivariate_mle_lrt(target_pixels, primary_cand_pixels)

        # --- Intensity Flux (std/mean, a measure of signal variability) ---
        target_mean = float(np.mean(target_pixels))
        intensity_flux = float(np.std(target_pixels) / (target_mean + 1e-10)) if target_mean > 1e-10 else 0.0
        intensity_flux = min(intensity_flux, 1.0)

        # --- Classifier ---
        link_ratio_for_clf = link_result["link_strength_ratio"] if link_result["link_strength_ratio"] is not None else 1.0
        cls_label = roi_classifier.predict(
            intensity_flux,
            pcc,
            mlr["r_squared"],
            link_ratio_for_clf,
        )

        # ------------------------------------------------------------------ #
        # 3. Pairwise Inter-Channel Analysis                                  #
        # ------------------------------------------------------------------ #
        pairwise_results = {}

        for ch1_idx in range(num_channels):
            for ch2_idx in range(ch1_idx + 1, num_channels):
                p1 = crops[ch1_idx][local_mask]
                p2 = crops[ch2_idx][local_mask]

                # Pairwise PCC
                p_pcc = 0.0
                if len(p1) > 2 and np.std(p1) > 1e-9 and np.std(p2) > 1e-9:
                    c_mat = np.corrcoef(p1, p2)
                    if not np.isnan(c_mat[0, 1]):
                        p_pcc = float(c_mat[0, 1])

                # Pairwise MOC + M1/M2 (Costes)
                p_moc, p_m1, p_m2 = manders_m1_m2(p1, p2, use_costes=True)

                # Pairwise Co-Prob
                p_co = bivariate_mle_lrt(p1, p2)

                pairwise_results[f"{ch1_idx}-{ch2_idx}"] = PairwiseResult(
                    pcc=p_pcc,
                    moc=p_moc,
                    m1=p_m1,
                    m2=p_m2,
                    co_probability=p_co,
                )

        mlr_res = {
            "r_squared": mlr["r_squared"],
            "betas": mlr["betas"],
            "p_values": mlr["p_values"],
        }

        from app.models.schemas import ROIMetrics, MLRResult
        roi_met = ROIMetrics(
            roi_index=i,
            pcc=pcc,
            moc=moc,
            m1=m1,
            m2=m2,
            co_probability=co_prob,
            mlr=MLRResult(**mlr_res),
            link_strength=LinkStrengthResult(
                strongest_link=link_result["strongest_link"],
                link_strength_ratio=link_result["link_strength_ratio"],
                all_betas=link_result["all_betas"],
                p_values=link_result["p_values"],
            ),
            classification=cls_label,
            pairwise_results=pairwise_results,
        )
        roi_metrics_list.append(roi_met)

    vram = current_vram_mb()
    progress_callback('Processed full image and ROIs', vram)

    # ------------------------------------------------------------------ #
    # 4. Finalize & Export                                                #
    # ------------------------------------------------------------------ #
    if roi_metrics_list:
        pcc_avg = sum(m.pcc for m in roi_metrics_list) / len(roi_metrics_list)
        moc_avg = sum(m.moc for m in roi_metrics_list) / len(roi_metrics_list)
        m1_avg = sum(m.m1 for m in roi_metrics_list) / len(roi_metrics_list)
        m2_avg = sum(m.m2 for m in roi_metrics_list) / len(roi_metrics_list)
        co_avg = sum(m.co_probability for m in roi_metrics_list) / len(roi_metrics_list)

        # Aggregate Pairwise
        global_pairwise = {}
        if roi_metrics_list[0].pairwise_results:
            keys = roi_metrics_list[0].pairwise_results.keys()
            for k in keys:
                pPCC = sum(m.pairwise_results[k].pcc for m in roi_metrics_list) / len(roi_metrics_list)
                pMOC = sum(m.pairwise_results[k].moc for m in roi_metrics_list) / len(roi_metrics_list)
                pM1 = sum(m.pairwise_results[k].m1 for m in roi_metrics_list) / len(roi_metrics_list)
                pM2 = sum(m.pairwise_results[k].m2 for m in roi_metrics_list) / len(roi_metrics_list)
                pCO = sum(m.pairwise_results[k].co_probability for m in roi_metrics_list) / len(roi_metrics_list)
                global_pairwise[k] = PairwiseResult(pcc=pPCC, moc=pMOC, m1=pM1, m2=pM2, co_probability=pCO)

        global_metrics = MetricSummary(
            pcc=pcc_avg,
            manders_m1=m1_avg,
            manders_m2=m2_avg,
            moc=moc_avg,
            confidence_score=co_avg,
            pairwise_results=global_pairwise,
        )
    else:
        global_metrics = MetricSummary(
            pcc=0.0, manders_m1=0.0, manders_m2=0.0, moc=0.0, confidence_score=0.0,
        )

    artifact_links = generate_analysis_artifacts(
        analysis_id=analysis_id,
        composite=composite,
        mask_red=mask_target,
        mask_green=np.zeros_like(mask_target),
        metrics=global_metrics,
    )

    status = store.complete_analysis(analysis_id, 'Analysis complete')
    result = AnalysisResult(
        status=status,
        image_size=(width, height),
        channel_labels=channel_labels,
        global_metrics=global_metrics,
        roi_metrics=roi_metrics_list,
        artifact_links=artifact_links,
        exports={'report': artifact_links.report},
    )
    store.set_result(analysis_id, result=result, runtime={})
    return result


def current_vram_mb() -> float | None:
    try:
        import torch
        if torch.cuda.is_available():
            return float(torch.cuda.memory_allocated() / (1024 * 1024))
        if (
            getattr(torch.backends, 'mps', None) is not None
            and torch.backends.mps.is_available()
            and hasattr(torch.mps, 'current_allocated_memory')
        ):
            return float(torch.mps.current_allocated_memory() / (1024 * 1024))
        return 0.0
    except Exception:
        return 0.0

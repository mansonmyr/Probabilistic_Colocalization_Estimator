from __future__ import annotations

import asyncio
import json
import httpx
import numpy as np
from io import BytesIO
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import Response, StreamingResponse
from PIL import Image

from app.core.errors import InputValidationError
from app.core.storage import AnalysisStore
from app.models.schemas import (
    AnalysisRequest,
    AnalysisResult,
    AnalysisStatus,
    DefaultConfigResponse,
    ImageMetadata,
    LocalImagePathRequest,
    PreprocessedPreviewRequest,
    ROIProfileRequest,
    ROIProfileResponse,
    WorkspaceFileCandidate,
    WorkspaceScanRequest,
    WorkspaceScanResponse,
    Point,
    TrainingData
)
from app.services.analysis import run_analysis
from app.services.image_io import (
    build_image_metadata,
    build_rgb_composite,
    load_multi_channel_tiff,
    scan_workspace_for_tiffs,
)
from app.services.preprocessing import preprocess_channels
from app.services.reporting import generate_analysis_artifacts
from app.services.metrics import manders_coefficients, pearson_correlation
from app.services.roi import (
    build_roi_response,
    get_circular_mask,
    get_polygonal_mask,
    sample_roi_profile,
)
from app.services.runtime_policy import detect_model_load_policy

router = APIRouter(prefix='/api')


def get_store() -> AnalysisStore:
    from app.main import store

    return store


@router.post('/images', response_model=ImageMetadata)
async def upload_image(
    file: UploadFile = File(...),
    storage: AnalysisStore = Depends(get_store),
) -> ImageMetadata:
    try:
        data = await file.read()
        metadata = build_image_metadata(file.filename or "upload.tiff", data)
    except (InputValidationError, FileNotFoundError, OSError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    storage.save_image(metadata, data)
    return metadata


@router.post('/images/from-path', response_model=ImageMetadata)
async def open_image_from_path(
    request: LocalImagePathRequest,
    storage: AnalysisStore = Depends(get_store),
) -> ImageMetadata:
    try:
        path = Path(request.image_path).expanduser().resolve()
        data = path.read_bytes()
        metadata = build_image_metadata(path.name, data)
    except (InputValidationError, FileNotFoundError, OSError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    storage.save_image(metadata, data)
    return metadata


@router.get('/images/{image_id}/preview')
async def image_preview(
    image_id: str,
    storage: AnalysisStore = Depends(get_store),
) -> Response:
    try:
        data = storage.get_raw_data(image_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Image not found.') from exc

    try:
        with BytesIO(data) as buf:
            channels = load_multi_channel_tiff(buf)
    except (InputValidationError, FileNotFoundError, OSError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    composite = build_rgb_composite(channels)
    buffer = BytesIO()
    Image.fromarray(composite).save(buffer, format='PNG')
    return Response(content=buffer.getvalue(), media_type='image/png')


@router.post('/images/{image_id}/preview/preprocessed')
async def preprocessed_preview(
    image_id: str,
    request: PreprocessedPreviewRequest,
    storage: AnalysisStore = Depends(get_store),
) -> Response:
    """
    Returns a preview PNG with preprocessing (background subtraction / denoising) applied.
    Allows the user to see the effect of preprocessing settings before running analysis.
    """
    try:
        data = storage.get_raw_data(image_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Image not found.') from exc

    try:
        with BytesIO(data) as buf:
            channels = load_multi_channel_tiff(buf)
    except (InputValidationError, FileNotFoundError, OSError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    channels_pre = preprocess_channels(
        channels,
        radius=request.rolling_ball_radius,
        rolling_ball_enabled=request.rolling_ball_enabled,
        denoise_enabled=request.denoise_enabled,
        denoise_strength=request.denoise_strength,
    )

    composite = build_rgb_composite(channels_pre)
    buffer = BytesIO()
    Image.fromarray(composite).save(buffer, format='PNG')
    return Response(content=buffer.getvalue(), media_type='image/png')


@router.get('/images/{image_id}/preview/channel/red')
async def channel_preview_red(
    image_id: str,
    storage: AnalysisStore = Depends(get_store),
) -> Response:
    """Return red channel preview with custom HEX color tint (#d64161)."""
    try:
        data = storage.get_raw_data(image_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Image not found.') from exc

    try:
        with BytesIO(data) as buf:
            channels = load_multi_channel_tiff(buf)
            red = channels[0]
    except (InputValidationError, FileNotFoundError, OSError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    import numpy as np
    from PIL import Image

    red_normalized = np.clip(red * 255.0, 0, 255).astype(np.uint8)
    tint_color = (214, 65, 97)
    rgb_array = np.stack([
        (red_normalized * tint_color[0] / 255).astype(np.uint8),
        (red_normalized * tint_color[1] / 255).astype(np.uint8),
        (red_normalized * tint_color[2] / 255).astype(np.uint8)
    ], axis=-1)

    img = Image.fromarray(rgb_array, mode='RGB')
    buffer = BytesIO()
    img.save(buffer, format='PNG')
    buffer.seek(0)
    return Response(content=buffer.getvalue(), media_type='image/png')


@router.get('/images/{image_id}/preview/channel/green')
async def channel_preview_green(
    image_id: str,
    storage: AnalysisStore = Depends(get_store),
) -> Response:
    """Return green channel preview with custom HEX color tint (#82b74b)."""
    try:
        data = storage.get_raw_data(image_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Image not found.') from exc

    try:
        with BytesIO(data) as buf:
            channels = load_multi_channel_tiff(buf)
            green = channels[1] if len(channels) > 1 else channels[0]
    except (InputValidationError, FileNotFoundError, OSError, IndexError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    import numpy as np
    from PIL import Image

    green_normalized = np.clip(green * 255.0, 0, 255).astype(np.uint8)
    tint_color = (130, 183, 75)
    rgb_array = np.stack([
        (green_normalized * tint_color[0] / 255).astype(np.uint8),
        (green_normalized * tint_color[1] / 255).astype(np.uint8),
        (green_normalized * tint_color[2] / 255).astype(np.uint8)
    ], axis=-1)

    img = Image.fromarray(rgb_array, mode='RGB')
    buffer = BytesIO()
    img.save(buffer, format='PNG')
    buffer.seek(0)
    return Response(content=buffer.getvalue(), media_type='image/png')


@router.get('/config/defaults', response_model=DefaultConfigResponse)
async def get_defaults() -> DefaultConfigResponse:
    import torch

    policy = detect_model_load_policy(torch)
    return DefaultConfigResponse(
        available_models=[],
        accelerator_label=policy.accelerator_label,
        warning=policy.warning,
    )


@router.post('/workspaces/scan', response_model=WorkspaceScanResponse)
async def scan_workspace(request: WorkspaceScanRequest) -> WorkspaceScanResponse:
    try:
        candidates = scan_workspace_for_tiffs(request.folder_path)
    except (InputValidationError, FileNotFoundError, OSError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return WorkspaceScanResponse(
        folder_path=request.folder_path,
        candidates=[
            WorkspaceFileCandidate(filename=candidate.name, image_path=str(candidate))
            for candidate in candidates
        ],
    )


@router.post('/analyses', response_model=AnalysisStatus, status_code=status.HTTP_202_ACCEPTED)
async def start_analysis(
    request: AnalysisRequest,
    storage: AnalysisStore = Depends(get_store),
) -> AnalysisStatus:
    analysis_id = uuid4().hex
    cfg = request.config
    status_obj = storage.create_analysis(analysis_id)
    asyncio.create_task(_run_analysis_async(storage, analysis_id, request))
    return status_obj


async def _run_analysis_async(
    storage: AnalysisStore,
    analysis_id: str,
    request: AnalysisRequest,
) -> None:
    storage.update_status(analysis_id, state='running', message='Preparing analysis')

    def progress(message: str, vram_used_mb: float | None) -> None:
        storage.update_status(
            analysis_id,
            state='running',
            message=message,
            vram_used_mb=vram_used_mb,
        )

    try:
        await asyncio.to_thread(run_analysis, storage, analysis_id, request.config, progress)
    except Exception as exc:  # pragma: no cover
        storage.fail_analysis(analysis_id, str(exc))


@router.get('/analyses/{analysis_id}', response_model=AnalysisResult)
async def get_analysis(
    analysis_id: str,
    storage: AnalysisStore = Depends(get_store),
) -> AnalysisResult:
    result = storage.get_result(analysis_id)
    if result is not None:
        return result
    try:
        stored = storage.get_analysis(analysis_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Analysis not found.') from exc
    if stored.status.state == 'failed':
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=stored.status.message,
        )
    return AnalysisResult(
        status=stored.status,
        image_size=(0, 0),
        channel_labels=('CH_A (Red)', 'CH_B (Green)'),
        tile_results=[],
        metrics=None,
        artifact_links=None,
        exports={},
    )


@router.get('/analyses/{analysis_id}/events')
async def stream_events(
    analysis_id: str,
    storage: AnalysisStore = Depends(get_store),
) -> StreamingResponse:
    async def event_generator() -> str:
        last_index = -1
        while True:
            try:
                events = storage.get_events(analysis_id, after_index=last_index)
            except KeyError:
                payload = json.dumps({'detail': 'Analysis not found.'})
                yield f"event: error\ndata: {payload}\n\n"
                return
            for event in events:
                last_index = event.event_index
                payload = json.dumps(model_to_dict(event, mode='json'))
                yield f"event: progress\ndata: {payload}\n\n"
                if event.state in {'completed', 'failed'}:
                    return
            await asyncio.sleep(0.5)

    return StreamingResponse(event_generator(), media_type='text/event-stream')


@router.post('/roi/profile', response_model=ROIProfileResponse)
async def profile_roi(
    request: ROIProfileRequest,
    storage: AnalysisStore = Depends(get_store),
) -> ROIProfileResponse:
    try:
        runtime = storage.get_runtime(request.analysis_id)
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail='Analysis runtime data not found.',
        ) from exc
    if not runtime:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail='Analysis runtime data not found.',
        )
    # Metrics calculation
    pcc = None
    m1 = None
    m2 = None

    trace_points = request.points
    if request.roi_type == 'circular':
        if len(request.points) >= 2:
            p1, p2 = request.points[0], request.points[1]
            mask = get_circular_mask(p1.x, p1.y, p2.x, p2.y, runtime['red'].shape)
            pcc = pearson_correlation(runtime['red'], runtime['green'], mask)
            m1, m2 = manders_coefficients(runtime['red'], runtime['green'], mask, mask)
            trace_points = [p1, p2]
    elif request.roi_type == 'polygonal':
        if len(request.points) >= 3:
            mask = get_polygonal_mask(request.points, runtime['red'].shape)
            pcc = pearson_correlation(runtime['red'], runtime['green'], mask)
            m1, m2 = manders_coefficients(runtime['red'], runtime['green'], mask, mask)
            trace_points = request.points + [request.points[0]]

    distances, red_trace, green_trace = sample_roi_profile(
        runtime['red'],
        runtime['green'],
        trace_points,
    )

    import base64
    import io
    import csv

    buffered = io.StringIO()
    writer = csv.writer(buffered)
    writer.writerow(["distance_px", "red", "green"])
    for d, r, g in zip(distances, red_trace, green_trace):
        writer.writerow([f"{d:.4f}", f"{r:.4f}", f"{g:.4f}"])

    csv_b64 = f"data:text/csv;base64,{base64.b64encode(buffered.getvalue().encode()).decode()}"

    result = storage.get_result(request.analysis_id)
    if result and result.artifact_links:
        result.artifact_links.roi_csv = csv_b64
        result.exports['roi_csv'] = csv_b64

    return build_roi_response(
        distances, red_trace, green_trace, csv_b64,
        pcc=pcc, manders_m1=m1, manders_m2=m2
    )


def model_to_dict(model: object, mode: str | None = None) -> dict[str, object]:
    if hasattr(model, 'model_dump'):
        kwargs = {'mode': mode} if mode is not None else {}
        return model.model_dump(**kwargs)
    return model.dict()
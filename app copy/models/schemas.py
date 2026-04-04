from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

try:
    from pydantic import field_validator
except ImportError:  # pydantic v1 fallback
    from pydantic import validator as field_validator


class HistogramBin(BaseModel):
    start: int
    end: int
    count: int


class ImageMetadata(BaseModel):
    image_id: str
    filename: str
    stored_path: str
    width: int
    height: int
    dtype: str
    channel_labels: list[str]
    histograms: dict[str, list[HistogramBin]]


class LocalImagePathRequest(BaseModel):
    image_path: str

    @field_validator('image_path')
    @classmethod
    def require_image_path(cls, value: str) -> str:
        if not value.strip():
            raise ValueError('must not be empty')
        return value


class WorkspaceScanRequest(BaseModel):
    folder_path: str

    @field_validator('folder_path')
    @classmethod
    def require_folder_path(cls, value: str) -> str:
        if not value.strip():
            raise ValueError('must not be empty')
        return value


class WorkspaceFileCandidate(BaseModel):
    filename: str
    image_path: str


class WorkspaceScanResponse(BaseModel):
    folder_path: str
    candidates: list[WorkspaceFileCandidate]


class Point(BaseModel):
    x: float
    y: float

class AnalysisConfig(BaseModel):
    image_id: str
    rolling_ball_enabled: bool = Field(default=True)
    rolling_ball_radius: int = Field(default=50, ge=1)
    target_channel: int = Field(default=0, ge=0)
    denoise_enabled: bool = Field(default=False)
    denoise_strength: float = Field(default=0.5, ge=0.0, le=1.0)
    rois: list[list[Point]] = Field(default_factory=list)

    @field_validator('image_id')
    @classmethod
    def ensure_non_empty(cls, value: str) -> str:
        if not value.strip():
            raise ValueError('must not be empty')
        return value


class PreprocessedPreviewRequest(BaseModel):
    rolling_ball_enabled: bool = Field(default=True)
    rolling_ball_radius: int = Field(default=50, ge=1)
    denoise_enabled: bool = Field(default=False)
    denoise_strength: float = Field(default=0.5, ge=0.0, le=1.0)


class AnalysisRequest(BaseModel):
    config: AnalysisConfig


class PairwiseResult(BaseModel):
    pcc: float
    moc: float
    m1: float
    m2: float
    co_probability: float

class MetricSummary(BaseModel):
    pcc: float
    manders_m1: float
    manders_m2: float
    moc: float
    confidence_score: float
    pairwise_results: dict[str, PairwiseResult] = Field(default_factory=dict)

class MLRResult(BaseModel):
    r_squared: float
    betas: list[float]
    p_values: list[float]

class LinkStrengthResult(BaseModel):
    strongest_link: str
    link_strength_ratio: float | None  # None for single-candidate (2-channel)
    all_betas: dict[str, float]
    p_values: dict[str, float]

class ROIMetrics(BaseModel):
    roi_index: int
    pcc: float
    moc: float
    m1: float
    m2: float
    co_probability: float
    mlr: MLRResult
    link_strength: LinkStrengthResult
    classification: str
    pairwise_results: dict[str, PairwiseResult] = Field(default_factory=dict)


class ArtifactLinks(BaseModel):
    composite: str
    heatmap: str
    mask_red: str
    mask_green: str
    overlay: str
    report: str
    roi_csv: str | None = None


class AnalysisStatus(BaseModel):
    analysis_id: str
    state: Literal['queued', 'running', 'completed', 'failed']
    message: str
    vram_used_mb: float | None = None
    accelerator_label: str | None = None
    created_at: datetime
    finished_at: datetime | None = None


class AnalysisResult(BaseModel):
    status: AnalysisStatus
    image_size: tuple[int, int]
    channel_labels: list[str]
    global_metrics: MetricSummary | None = None
    roi_metrics: list[ROIMetrics] = Field(default_factory=list)
    artifact_links: ArtifactLinks | None = None
    exports: dict[str, str] = Field(default_factory=dict)


class EventMessage(BaseModel):
    event_index: int
    state: str
    message: str
    vram_used_mb: float | None = None
    accelerator_label: str | None = None
    timestamp: datetime


class ROIProfileRequest(BaseModel):
    analysis_id: str
    points: list[Point]
    roi_type: Literal['line', 'circular', 'polygonal'] = 'line'

    @field_validator('points')
    @classmethod
    def require_minimum_points(cls, value: list[Point]) -> list[Point]:
        if len(value) < 2:
            raise ValueError('at least two points are required')
        return value

class TrainingData(BaseModel):
    pcc: float
    moc: float
    r_squared: float
    co_probability: float
    link_strength_ratio: float
    label: str


class PeakMarker(BaseModel):
    index: int
    distance: float
    value: float


class ROIProfileResponse(BaseModel):
    sample_count: int
    distances: list[float]
    red: list[float]
    green: list[float]
    peaks_red: list[PeakMarker]
    peaks_green: list[PeakMarker]
    csv_url: str
    pcc: float | None = None
    manders_m1: float | None = None
    manders_m2: float | None = None


class DefaultConfigResponse(BaseModel):
    available_models: list[str] = Field(default_factory=list)
    accelerator_label: str
    warning: str | None = None

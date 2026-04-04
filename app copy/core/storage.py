from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from threading import Lock
from typing import Any

from app.models.schemas import AnalysisResult, AnalysisStatus, EventMessage, ImageMetadata


@dataclass
class StoredAnalysis:
    status: AnalysisStatus
    result: AnalysisResult | None = None
    events: list[EventMessage] = field(default_factory=list)
    runtime: dict[str, Any] = field(default_factory=dict)


class AnalysisStore:
    def __init__(self) -> None:
        self._images: dict[str, ImageMetadata] = {}
        self._raw_data: dict[str, bytes] = {}  # Store raw TIFF bytes in-memory
        self._analyses: dict[str, StoredAnalysis] = {}
        self._lock = Lock()

    def save_image(self, metadata: ImageMetadata, data: bytes) -> None:
        with self._lock:
            self._images[metadata.image_id] = metadata
            self._raw_data[metadata.image_id] = data

    def get_raw_data(self, image_id: str) -> bytes:
        with self._lock:
            return self._raw_data[image_id]

    def get_image(self, image_id: str) -> ImageMetadata:
        with self._lock:
            return self._images[image_id]

    def create_analysis(self, analysis_id: str) -> AnalysisStatus:
        status = AnalysisStatus(
            analysis_id=analysis_id,
            state='queued',
            message='Queued for analysis',
            vram_used_mb=None,
            accelerator_label=None,
            created_at=datetime.now(timezone.utc),
            finished_at=None,
        )
        with self._lock:
            self._analyses[analysis_id] = StoredAnalysis(status=status)
            self._append_event_locked(analysis_id, 'queued', 'Queued for analysis')
        return status

    def list_analysis_ids(self) -> list[str]:
        with self._lock:
            return list(self._analyses.keys())

    def get_analysis(self, analysis_id: str) -> StoredAnalysis:
        with self._lock:
            return self._analyses[analysis_id]

    def update_status(self, analysis_id: str, **updates: Any) -> AnalysisStatus:
        with self._lock:
            stored = self._analyses[analysis_id]
            status_data = dump_model(stored.status)
            status_data.update(updates)
            stored.status = AnalysisStatus(**status_data)
            if message := updates.get('message'):
                self._append_event_locked(
                    analysis_id,
                    stored.status.state,
                    message,
                    vram_used_mb=stored.status.vram_used_mb,
                    accelerator_label=stored.status.accelerator_label,
                )
            return stored.status

    def set_result(self, analysis_id: str, result: AnalysisResult, runtime: dict[str, Any]) -> None:
        with self._lock:
            stored = self._analyses[analysis_id]
            stored.result = result
            stored.runtime = runtime

    def get_result(self, analysis_id: str) -> AnalysisResult | None:
        with self._lock:
            return self._analyses[analysis_id].result

    def get_runtime(self, analysis_id: str) -> dict[str, Any]:
        with self._lock:
            return self._analyses[analysis_id].runtime

    def get_events(self, analysis_id: str, after_index: int = -1) -> list[EventMessage]:
        with self._lock:
            return [
                event
                for event in self._analyses[analysis_id].events
                if event.event_index > after_index
            ]

    def fail_analysis(self, analysis_id: str, message: str) -> AnalysisStatus:
        return self.update_status(
            analysis_id,
            state='failed',
            message=message,
            finished_at=datetime.now(timezone.utc),
        )

    def complete_analysis(self, analysis_id: str, message: str) -> AnalysisStatus:
        return self.update_status(
            analysis_id,
            state='completed',
            message=message,
            finished_at=datetime.now(timezone.utc),
        )

    def _append_event_locked(
        self,
        analysis_id: str,
        state: str,
        message: str,
        vram_used_mb: float | None = None,
        accelerator_label: str | None = None,
    ) -> None:
        stored = self._analyses[analysis_id]
        event = EventMessage(
            event_index=len(stored.events),
            state=state,
            message=message,
            vram_used_mb=vram_used_mb if vram_used_mb is not None else stored.status.vram_used_mb,
            accelerator_label=accelerator_label
            if accelerator_label is not None
            else stored.status.accelerator_label,
            timestamp=datetime.now(timezone.utc),
        )
        stored.events.append(event)


def dump_model(model: Any) -> dict[str, Any]:
    if hasattr(model, 'model_dump'):
        return model.model_dump()
    return model.dict()

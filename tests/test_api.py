from __future__ import annotations

from io import BytesIO

import numpy as np
import pytest
import tifffile

pytest.importorskip('fastapi')
from fastapi.testclient import TestClient

from app.main import app
from app.services.runtime_policy import ModelLoadPolicy


def test_healthcheck() -> None:
    client = TestClient(app)
    response = client.get('/health')
    assert response.status_code == 200
    assert response.json() == {'status': 'ok'}


def test_upload_image_accepts_dual_channel_uint16_tiff() -> None:
    image = np.zeros((32, 32, 2), dtype=np.uint16)
    buffer = BytesIO()
    tifffile.imwrite(buffer, image)
    buffer.seek(0)

    client = TestClient(app)
    response = client.post(
        '/api/images',
        files={'file': ('example.tiff', buffer.getvalue(), 'image/tiff')},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload['dtype'] == 'uint16'
    assert payload['channel_labels'] == ['CH_A (Red)', 'CH_B (Green)']


def test_defaults_endpoint_returns_desktop_runtime_defaults(monkeypatch) -> None:
    client = TestClient(app)
    monkeypatch.setattr(
        'app.api.routes.detect_model_load_policy',
        lambda _torch: ModelLoadPolicy(
            accelerator='mps',
            device='mps',
            torch_dtype_name='float16',
            quantization_mode='fp16',
            generator_device='cpu',
            accelerator_label='Apple Silicon MPS',
            warning=None,
        ),
    )

    response = client.get('/api/config/defaults')
    assert response.status_code == 200
    payload = response.json()
    assert payload['accelerator_label'] == 'Apple Silicon MPS'
    assert payload['quantization_mode'] == 'fp16'


def test_workspace_scan_lists_tiff_candidates(tmp_path) -> None:
    tifffile.imwrite(tmp_path / 'sample.tiff', np.zeros((4, 4, 2), dtype=np.uint16))
    (tmp_path / 'notes.txt').write_text('ignore me\n', encoding='utf-8')

    client = TestClient(app)
    response = client.post('/api/workspaces/scan', json={'folder_path': str(tmp_path)})

    assert response.status_code == 200
    payload = response.json()
    assert payload['folder_path'] == str(tmp_path)
    assert payload['candidates'] == [
        {'filename': 'sample.tiff', 'image_path': str(tmp_path / 'sample.tiff')}
    ]

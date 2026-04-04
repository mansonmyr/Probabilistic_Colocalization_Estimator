from __future__ import annotations

from types import SimpleNamespace

from app.services.runtime_policy import detect_model_load_policy


def build_fake_torch(*, cuda: bool, mps: bool):
    return SimpleNamespace(
        cuda=SimpleNamespace(is_available=lambda: cuda),
        backends=SimpleNamespace(mps=SimpleNamespace(is_available=lambda: mps)),
        float16='float16',
        float32='float32',
    )


def test_detect_model_load_policy_prefers_mps_fp16_on_apple_silicon() -> None:
    torch = build_fake_torch(cuda=False, mps=True)
    policy = detect_model_load_policy(torch, system_name='Darwin', machine_name='arm64')
    assert policy.accelerator == 'mps'
    assert policy.quantization_mode == 'mlx-6bit'
    assert policy.device == 'mps'
    assert policy.generator_device == 'cpu'


def test_detect_model_load_policy_prefers_windows_int4_on_cuda() -> None:
    torch = build_fake_torch(cuda=True, mps=False)
    policy = detect_model_load_policy(torch, system_name='Windows', machine_name='AMD64')
    assert policy.accelerator == 'cuda'
    assert policy.quantization_mode == 'fp16'
    assert policy.device == 'cuda'


def test_detect_model_load_policy_falls_back_to_fp32_cpu() -> None:
    torch = build_fake_torch(cuda=False, mps=False)
    policy = detect_model_load_policy(torch, system_name='Linux', machine_name='x86_64')
    assert policy.accelerator == 'cpu'
    assert policy.quantization_mode == 'float32'
    assert policy.warning is not None

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal
import platform




@dataclass(frozen=True)
class ModelLoadPolicy:
    accelerator: Literal['mps', 'cuda', 'cpu']
    device: str
    torch_dtype_name: Literal['float16', 'float32']
    generator_device: str
    accelerator_label: str
    warning: str | None

    def torch_dtype(self, torch_module: Any) -> Any:
        return getattr(torch_module, self.torch_dtype_name)

    @property
    def cache_key(self) -> tuple[str, str, str]:
        return (
            self.accelerator,
            self.device,
            self.torch_dtype_name,
        )


def detect_model_load_policy(
    torch_module: Any,
    system_name: str | None = None,
    machine_name: str | None = None,
) -> ModelLoadPolicy:
    system = system_name or platform.system()
    machine = machine_name or platform.machine()
    has_cuda = bool(torch_module.cuda.is_available())
    has_mps = bool(
        hasattr(torch_module.backends, 'mps')
        and torch_module.backends.mps.is_available()
    )

    if system == 'Darwin' and machine in {'arm64', 'aarch64'} and has_mps:
        return ModelLoadPolicy(
            accelerator='mps',
            device='mps',
            torch_dtype_name='float16',
            generator_device='cpu',
            accelerator_label='Apple Silicon (MLX)',
            warning=None,
        )
    if system == 'Windows' and has_cuda:
        return ModelLoadPolicy(
            accelerator='cuda',
            device='cuda',
            torch_dtype_name='float16',
            generator_device='cuda',
            accelerator_label='NVIDIA CUDA (Transformers)',
            warning=None,
        )
    return ModelLoadPolicy(
        accelerator='cpu',
        device='cpu',
        torch_dtype_name='float32',
        generator_device='cpu',
        accelerator_label='CPU (Transformers)',
        warning='Running without GPU acceleration. Performance may be slow.',
    )

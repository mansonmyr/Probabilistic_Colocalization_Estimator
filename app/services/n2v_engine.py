from __future__ import annotations

import os
import yaml
import numpy as np
import torch
import torch.nn as nn
from pathlib import Path
from typing import Optional

class UNet(nn.Module):
    """
    A lightweight standard Bio-UNet implementation matching the dazzling-spider config.
    Architecture: UNet, Depth 2, 32 channels.
    """
    def __init__(self, in_channels=1, out_channels=1, depth=2, num_channels_init=32):
        super().__init__()
        self.encoder = nn.ModuleList()
        self.decoder = nn.ModuleList()
        self.pool = nn.MaxPool2d(2)

        # Encoder
        curr_channels = in_channels
        next_channels = num_channels_init
        for _ in range(depth):
            self.encoder.append(self._conv_block(curr_channels, next_channels))
            curr_channels = next_channels
            next_channels *= 2

        # Bottleneck
        self.bottleneck = self._conv_block(curr_channels, next_channels)
        
        # Decoder
        for _ in range(depth):
            curr_channels = next_channels
            next_channels //= 2
            self.decoder.append(nn.ConvTranspose2d(curr_channels, next_channels, 2, stride=2))
            self.decoder.append(self._conv_block(curr_channels, next_channels))

        # Output
        self.final = nn.Conv2d(next_channels, out_channels, 1)

    def _conv_block(self, in_c, out_c):
        return nn.Sequential(
            nn.Conv2d(in_c, out_c, 3, padding=1),
            nn.BatchNorm2d(out_c),
            nn.ReLU(inplace=True),
            nn.Conv2d(out_c, out_c, 3, padding=1),
            nn.BatchNorm2d(out_c),
            nn.ReLU(inplace=True)
        )

    def forward(self, x):
        skip_connections = []
        for stage in self.encoder:
            x = stage(x)
            skip_connections.append(x)
            x = self.pool(x)

        x = self.bottleneck(x)
        
        for i in range(0, len(self.decoder), 2):
            x = self.decoder[i](x)
            skip = skip_connections.pop()
            # Handle possible padding differences
            if x.shape != skip.shape:
                x = nn.functional.pad(x, [0, skip.shape[3]-x.shape[3], 0, skip.shape[2]-x.shape[2]])
            x = torch.cat((skip, x), dim=1)
            x = self.decoder[i+1](x)

        return self.final(x)

class N2VEngine:
    _instance: Optional[N2VEngine] = None

    def __init__(self):
        self.device = torch.device('mps' if torch.backends.mps.is_available() else 'cpu')
        self.model = None
        self.means = [0.0]
        self.stds = [1.0]
        self._load_model()

    @classmethod
    def get_instance(cls) -> N2VEngine:
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def _load_model(self):
        try:
            # Paths relative to the project root
            root = Path(__file__).parents[3]
            model_dir = root / "n2v-0.3.2" / "dazzling-spider"
            config_path = model_dir / "careamics.yaml"
            weight_path = model_dir / "weights.pth"

            if not config_path.exists() or not weight_path.exists():
                print(f"[N2V] Warning: Model files not found at {model_dir}")
                return

            # Parse CAREamics yaml
            with open(config_path, 'r') as f:
                cfg = yaml.safe_load(f)
            
            m_cfg = cfg['algorithm_config']['model']
            d_cfg = cfg['data_config']
            
            self.means = [float(m) for m in d_cfg.get('image_means', [0.0])]
            self.stds = [float(s) for s in d_cfg.get('image_stds', [1.0])]

            # Initialize U-Net
            self.model = UNet(
                in_channels=m_cfg['in_channels'],
                out_channels=m_cfg['num_classes'],
                depth=m_cfg['depth'],
                num_channels_init=m_cfg['num_channels_init']
            )

            # Load weights
            # Map storage to CPU if no GPU
            state_dict = torch.load(weight_path, map_location=self.device)
            self.model.load_state_dict(state_dict)
            self.model.to(self.device)
            self.model.eval()
            print(f"[N2V] Model 'dazzling-spider' loaded successfully on {self.device}")

        except Exception as e:
            print(f"[N2V] Error loading model: {e}")
            self.model = None

    def predict(self, image: np.ndarray) -> np.ndarray:
        """
        Denoise a single channel image.
        """
        if self.model is None:
            return image

        # Normalization
        # N2V works on float32
        data = image.astype(np.float32)
        norm_data = (data - self.means[0]) / self.stds[0]

        # Convert to tensor (B, C, H, W)
        input_tensor = torch.from_numpy(norm_data).unsqueeze(0).unsqueeze(0).to(self.device)

        with torch.no_grad():
            # Pad to power of 2 for U-Net
            h, w = input_tensor.shape[2:]
            ph = ((h - 1) // 16 + 1) * 16
            pw = ((w - 1) // 16 + 1) * 16
            pad_h = ph - h
            pad_w = pw - w
            
            if pad_h > 0 or pad_w > 0:
                input_tensor = nn.functional.pad(input_tensor, (0, pad_w, 0, pad_h), mode='reflect')

            output = self.model(input_tensor)
            
            # Crop back
            if pad_h > 0 or pad_w > 0:
                output = output[:, :, :h, :w]

        # Denormalize
        denoised = output.squeeze().cpu().numpy()
        denoised = (denoised * self.stds[0]) + self.means[0]

        return denoised.astype(np.float32)

# Noise2Void - CAREamics

## Data description

Laser scanning fluorescence microscopy imaging of actin in bovine pulmonary artery endothelial cells, acquired with a low signal-to-noise ratio. This dataset is a subset of Dataset 4, as described in the paper by Hagen, G.M. et al., 2021 (Fluorescence Microscopy Datasets for Training Deep Neural Networks, GigaScience). The data is available on Zenodo at https://zenodo.org/records/10925855.

## Algorithm description:

Noise2Void is a UNet-based self-supervised algorithm that uses blind-spot training to denoise images. In short, in every patches during training, random pixels are selected and their value replaced by a neighboring pixel value. The network is then trained to predict the original pixel value. The algorithm relies on the continuity of the signal (neighboring pixels have similar values) and the pixel-wise independence of the noise (the noise in a pixel is not correlated with the noise in neighboring pixels).

## Configuration

Noise2Void was trained using CAREamics (version 0.0.16) using the following configuration:

```yaml
algorithm_config:
  algorithm: n2v
  loss: n2v
  lr_scheduler:
    name: ReduceLROnPlateau
    parameters: {}
  model:
    architecture: UNet
    conv_dims: 2
    depth: 2
    final_activation: None
    in_channels: 1
    independent_channels: true
    n2v2: false
    num_channels_init: 32
    num_classes: 1
    use_batch_norm: true
  n2v_config:
    masked_pixel_percentage: 0.2
    name: N2VManipulate
    remove_center: true
    roi_size: 11
    strategy: uniform
    struct_mask_axis: none
    struct_mask_span: 5
  optimizer:
    name: Adam
    parameters: {}
data_config:
  axes: SYX
  batch_size: 32
  data_type: array
  image_means:
  - '1.7194048e+03'
  image_stds:
  - '1.3884455e+03'
  patch_size:
  - 64
  - 64
  target_means: []
  target_stds: []
  train_dataloader_params:
    num_workers: 4
    pin_memory: true
    shuffle: true
  transforms:
  - flip_x: true
    flip_y: false
    name: XYFlip
    p: 0.5
  val_dataloader_params:
    num_workers: 4
    pin_memory: true
experiment_name: hagen_n2v
training_config:
  checkpoint_callback:
    auto_insert_metric_name: false
    mode: min
    monitor: val_loss
    save_last: true
    save_top_k: 3
    save_weights_only: false
    verbose: false
  lightning_trainer_config:
    max_epochs: 10
version: 0.1.0

```

# Validation

In order to validate the model, we encourage users to acquire a test dataset with ground-truth data. Comparing the ground-truth data with the prediction allows unbiased evaluation of the model performances. This can be done for instance by using metrics such as PSNR, SSIM, orMicroSSIM. In the absence of ground-truth, inspecting the residual image (difference between input and predicted image) can be helpful to identify whether real signal is removed from the input image.

## References

Krull, A., Buchholz, T.O. and Jug, F., 2019. "Noise2Void - Learning denoising from single noisy images". In Proceedings of the IEEE/CVF conference on computer vision and pattern recognition (pp. 2129-2137). doi: 10.1109/cvpr.2019.00223

# Links

- [CAREamics repository](https://github.com/CAREamics/careamics)
- [CAREamics documentation](https://careamics.github.io/)

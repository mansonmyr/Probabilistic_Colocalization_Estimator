export type RuntimeMode = "local" | "remote";
export type LoadingPhase =
  | "idle"
  | "loading_local_image"
  | "uploading_remote_tiff"
  | "waiting_remote_queue"
  | "processing_remote"
  | "fetching_remote_result"
  | "fetching_stardist_rois";

export interface HistogramBin {
  start: number;
  end: number;
  count: number;
}

export interface ImageMetadata {
  image_id: string;
  filename: string;
  stored_path: string;
  width: number;
  height: number;
  dtype: string;
  channel_labels: string[];
  histograms: Record<string, HistogramBin[]>;
}

export interface AnalysisConfigInput {
  image_id: string;
  rolling_ball_enabled: boolean;
  rolling_ball_radius: number;
  target_channel: number;
  denoise_enabled: boolean;
  denoise_strength: number;
  rois: Point[][];
}

export interface PairwiseResult {
  pcc: number;
  moc: number;
  m1: number;
  m2: number;
  co_probability: number;
}

export interface MetricSummary {
  pcc: number;
  manders_m1: number;
  manders_m2: number;
  moc: number;
  confidence_score: number;
  pairwise_results?: Record<string, PairwiseResult>;
}

export interface MLRResult {
  r_squared: number;
  betas: number[];
  p_values: number[];
}

export interface LinkStrengthResult {
  strongest_link: string;
  link_strength_ratio: number | null;
  all_betas: Record<string, number>;
  p_values: Record<string, number>;
}

export interface ROIMetrics {
  roi_index: number;
  pcc: number;
  moc: number;
  m1: number;
  m2: number;
  co_probability: number;
  mlr: MLRResult;
  link_strength: LinkStrengthResult;
  classification: string;
  pairwise_results?: Record<string, PairwiseResult>;
}

export interface ArtifactLinks {
  composite: string;
  mask_red: string;
  mask_green: string;
  overlay: string;
  report: string;
  roi_csv?: string | null;
}

export interface AnalysisStatus {
  analysis_id: string;
  state: "queued" | "running" | "completed" | "failed";
  message: string;
  vram_used_mb: number | null;
  accelerator_label: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface AnalysisResult {
  status: AnalysisStatus;
  image_size: [number, number];
  channel_labels: string[];
  global_metrics?: MetricSummary | null;
  roi_metrics: ROIMetrics[];
  artifact_links?: ArtifactLinks | null;
  exports: Record<string, string>;
}

export interface Point {
  x: number;
  y: number;
}

export interface PeakMarker {
  index: number;
  distance: number;
  value: number;
}

export interface RoiProfileResponse {
  sample_count: number;
  distances: number[];
  red: number[];
  green: number[];
  peaks_red: PeakMarker[];
  peaks_green: PeakMarker[];
  csv_url: string;
  pcc?: number | null;
  manders_m1?: number | null;
  manders_m2?: number | null;
}

export interface ProgressEvent {
  event_index: number;
  state: string;
  message: string;
  vram_used_mb: number | null;
  accelerator_label: string | null;
  timestamp: string;
}

export interface DefaultConfig {
  accelerator_label: string;
  warning: string | null;
}

export interface WorkspaceFileCandidate {
  filename: string;
  image_path: string;
}

export interface WorkspaceScanResponse {
  folder_path: string;
  candidates: WorkspaceFileCandidate[];
}

export type ToolMode = "pan" | "zoom" | "circular" | "polygonal";

export interface DesktopRuntime {
  localApiUrl: string;
  remoteApiUrl: string | null;
  effectiveApiUrl: string;
  mode: RuntimeMode;
  platform: string;
  arch: string;
  isDesktop: boolean;
}

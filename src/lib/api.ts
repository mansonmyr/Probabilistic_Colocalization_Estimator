import { uploadImageToRemote } from "./desktop";
import type {
  AnalysisConfigInput,
  AnalysisResult,
  AnalysisStatus,
  ArtifactLinks,
  DefaultConfig,
  DesktopRuntime,
  ImageMetadata,
  LinkStrengthResult,
  Point,
  ProgressEvent,
  RoiProfileResponse,
  RuntimeMode,
  WorkspaceScanResponse
} from "./types";

interface ApiRuntimeState {
  localApiUrl: string;
  remoteApiUrl: string | null;
  effectiveApiUrl: string;
  mode: RuntimeMode;
}

let runtimeState: ApiRuntimeState = {
  localApiUrl: "",
  remoteApiUrl: null,
  effectiveApiUrl: "",
  mode: "local"
};

export function setApiRuntime(nextRuntime: Pick<
  DesktopRuntime,
  "localApiUrl" | "remoteApiUrl" | "effectiveApiUrl" | "mode"
>): void {
  const localApiUrl = normalizeUrl(nextRuntime.localApiUrl);
  const remoteApiUrl = normalizeNullableUrl(nextRuntime.remoteApiUrl);
  const mode = nextRuntime.mode;
  const effectiveApiUrl = normalizeUrl(
    nextRuntime.effectiveApiUrl || (mode === "remote" ? remoteApiUrl ?? "" : localApiUrl)
  );

  runtimeState = {
    localApiUrl,
    remoteApiUrl,
    effectiveApiUrl,
    mode
  };
}

export function getApiRuntime(): ApiRuntimeState {
  return { ...runtimeState };
}

function normalizeUrl(value: string): string {
  return String(value ?? "").trim().replace(/\/+$/, "");
}

function normalizeNullableUrl(value: string | null): string | null {
  const next = normalizeUrl(value ?? "");
  return next || null;
}

export function activeApiUrl(path: string): string {
  const runtime = getApiRuntime();
  const base = runtime.mode === "local" ? runtime.localApiUrl : runtime.remoteApiUrl;
  if (!base) {
    return path;
  }
  return `${base}${path}`;
}

function localApiUrl(path: string): string {
  return buildUrl(runtimeState.localApiUrl, path);
}

function buildUrl(base: string, path: string): string {
  const normalizedBase = normalizeUrl(base);
  return normalizedBase ? `${normalizedBase}${path}` : path;
}

function resolveAssetUrl(value: unknown): string {
  const raw = String(value ?? "");
  if (!raw) {
    return "";
  }
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    return raw;
  }
  if (raw.startsWith("/")) {
    return activeApiUrl(raw);
  }
  return raw;
}

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function uploadImage(file: File): Promise<ImageMetadata> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch(activeApiUrl("/api/images"), {
    method: "POST",
    body: formData
  });
  const payload = await parseJson<Record<string, unknown>>(response);
  return normalizeImage(payload);
}

export async function openImageFromPath(imagePath: string): Promise<ImageMetadata> {
  const response = await fetch(localApiUrl("/api/images/from-path"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ image_path: imagePath })
  });
  const payload = await parseJson<Record<string, unknown>>(response);
  return normalizeImage(payload);
}

export async function openImageSelection(imagePath: string): Promise<ImageMetadata> {
  if (runtimeState.mode === "remote") {
    if (!runtimeState.remoteApiUrl) {
      throw new Error("Remote API URL is not configured.");
    }
    return uploadImageToRemote({
      imagePath,
      remoteApiUrl: runtimeState.remoteApiUrl
    });
  }
  return openImageFromPath(imagePath);
}

export function getImagePreviewUrl(imageId: string): string {
  const safeId = encodeURIComponent(imageId);
  return activeApiUrl(`/api/images/${safeId}/preview`);
}

export function getChannelPreviewUrl(imageId: string, channel: 'red' | 'green'): string {
  const safeId = encodeURIComponent(imageId);
  return activeApiUrl(`/api/images/${safeId}/preview/channel/${channel}`);
}

export async function getPreprocessedPreview(
  imageId: string,
  config: {
    rolling_ball_enabled: boolean;
    rolling_ball_radius: number;
    denoise_enabled: boolean;
    denoise_strength: number;
  }
): Promise<string> {
  const safeId = encodeURIComponent(imageId);
  const response = await fetch(activeApiUrl(`/api/images/${safeId}/preview/preprocessed`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!response.ok) {
    throw new Error(`Preprocessed preview failed: ${response.status}`);
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

export async function scanWorkspace(folderPath: string): Promise<WorkspaceScanResponse> {
  const response = await fetch(localApiUrl("/api/workspaces/scan"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ folder_path: folderPath })
  });
  const payload = await parseJson<Record<string, unknown>>(response);
  return {
    folder_path: String(payload.folder_path),
    candidates: ((payload.candidates as Record<string, unknown>[]) ?? []).map((candidate) => ({
      filename: String(candidate.filename),
      image_path: String(candidate.image_path)
    }))
  };
}

export async function startAnalysis(config: AnalysisConfigInput): Promise<AnalysisStatus> {
  const response = await fetch(activeApiUrl("/api/analyses"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      config: {
        image_id: config.image_id,
        rolling_ball_enabled: config.rolling_ball_enabled,
        rolling_ball_radius: config.rolling_ball_radius,
        target_channel: config.target_channel,
        denoise_enabled: config.denoise_enabled,
        denoise_strength: config.denoise_strength,
        rois: config.rois
      }
    })
  });
  const payload = await parseJson<Record<string, unknown>>(response);
  return normalizeStatus(payload);
}

export async function getAnalysis(analysisId: string): Promise<AnalysisResult> {
  const response = await fetch(activeApiUrl(`/api/analyses/${analysisId}`));
  const payload = await parseJson<Record<string, unknown>>(response);
  return normalizeAnalysis(payload);
}

export async function requestRoiProfile(
  analysisId: string,
  points: Point[],
  roiType: string = "circular"
): Promise<RoiProfileResponse> {
  const response = await fetch(activeApiUrl("/api/roi/profile"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ analysis_id: analysisId, points, roi_type: roiType })
  });
  const payload = await parseJson<Record<string, unknown>>(response);
  return normalizeRoi(payload);
}

export async function getStardistRois(imageId: string, targetChannel: number = 0): Promise<Point[][]> {
  const response = await fetch(activeApiUrl(`/api/images/${imageId}/stardist?target_channel=${targetChannel}`));
  return await parseJson<Point[][]>(response);
}

export function connectProgress(
  analysisId: string,
  onEvent: (event: ProgressEvent) => void,
  onError?: () => void
): EventSource {
  const source = new EventSource(activeApiUrl(`/api/analyses/${analysisId}/events`));
  source.addEventListener("progress", (event) => {
    onEvent(normalizeProgress(JSON.parse((event as MessageEvent).data) as Record<string, unknown>));
  });
  source.onerror = () => {
    onError?.();
  };
  return source;
}

export async function getDefaults(): Promise<DefaultConfig> {
  const response = await fetch(activeApiUrl("/api/config/defaults"));
  const payload = await parseJson<Record<string, unknown>>(response);
  return {
    accelerator_label: String(payload.accelerator_label ?? "CPU"),
    warning: payload.warning == null ? null : String(payload.warning)
  };
}

function normalizeImage(payload: Record<string, unknown>): ImageMetadata {
  return {
    image_id: String(payload.image_id),
    filename: String(payload.filename),
    stored_path: String(payload.stored_path),
    width: Number(payload.width),
    height: Number(payload.height),
    dtype: String(payload.dtype),
    channel_labels: (payload.channel_labels as string[]) ?? [],
    histograms: payload.histograms as ImageMetadata["histograms"]
  };
}

function normalizeStatus(payload: Record<string, unknown>): AnalysisStatus {
  return {
    analysis_id: String(payload.analysis_id),
    state: payload.state as AnalysisStatus["state"],
    message: String(payload.message),
    vram_used_mb: payload.vram_used_mb == null ? null : Number(payload.vram_used_mb),
    accelerator_label: payload.accelerator_label == null ? null : String(payload.accelerator_label),
    created_at: String(payload.created_at ?? ""),
    finished_at: payload.finished_at == null ? null : String(payload.finished_at)
  };
}

function normalizeArtifactLinks(payload: Record<string, unknown>): ArtifactLinks {
  return {
    composite: resolveAssetUrl(payload.composite),
    mask_red: resolveAssetUrl(payload.mask_red),
    mask_green: resolveAssetUrl(payload.mask_green),
    overlay: resolveAssetUrl(payload.overlay),
    report: resolveAssetUrl(payload.report),
    roi_csv: payload.roi_csv == null ? null : resolveAssetUrl(payload.roi_csv)
  };
}

function normalizeLinkStrength(payload: Record<string, unknown>): LinkStrengthResult {
  return {
    strongest_link: String(payload.strongest_link ?? "N/A"),
    link_strength_ratio: payload.link_strength_ratio == null ? null : Number(payload.link_strength_ratio),
    all_betas: (payload.all_betas as Record<string, number>) ?? {},
    p_values: (payload.p_values as Record<string, number>) ?? {},
  };
}

function normalizeAnalysis(payload: Record<string, unknown>): AnalysisResult {
  return {
    status: normalizeStatus(payload.status as Record<string, unknown>),
    image_size: (payload.image_size as [number, number]) ?? [0, 0],
    channel_labels: (payload.channel_labels as string[]) ?? ["CH_A (Red)", "CH_B (Green)"],
    global_metrics: payload.global_metrics
      ? {
          pcc: Number((payload.global_metrics as Record<string, unknown>).pcc),
          manders_m1: Number((payload.global_metrics as Record<string, unknown>).manders_m1),
          manders_m2: Number((payload.global_metrics as Record<string, unknown>).manders_m2),
          moc: Number((payload.global_metrics as Record<string, unknown>).moc),
          confidence_score: Number((payload.global_metrics as Record<string, unknown>).confidence_score),
          pairwise_results: (payload.global_metrics as Record<string, unknown>).pairwise_results as any,
        }
      : null,
    roi_metrics: ((payload.roi_metrics as Record<string, unknown>[]) || []).map(r => ({
      roi_index: Number(r.roi_index),
      pcc: Number(r.pcc),
      moc: Number(r.moc),
      m1: Number(r.m1),
      m2: Number(r.m2),
      co_probability: Number(r.co_probability),
      mlr: {
        r_squared: Number((r.mlr as Record<string, unknown>).r_squared),
        betas: (r.mlr as Record<string, unknown>).betas as number[],
        p_values: (r.mlr as Record<string, unknown>).p_values as number[]
      },
      link_strength: normalizeLinkStrength(r.link_strength as Record<string, unknown>),
      classification: String(r.classification ?? "Unknown"),
      pairwise_results: r.pairwise_results as any,
    })),
    artifact_links: payload.artifact_links
      ? normalizeArtifactLinks(payload.artifact_links as Record<string, unknown>)
      : null,
    exports: (payload.exports as Record<string, string>) ?? {}
  };
}

function normalizeRoi(payload: Record<string, unknown>): RoiProfileResponse {
  return {
    sample_count: Number(payload.sample_count),
    distances: (payload.distances as number[]) ?? [],
    red: (payload.red as number[]) ?? [],
    green: (payload.green as number[]) ?? [],
    peaks_red: ((payload.peaks_red as Record<string, unknown>[]) ?? []).map((peak) => ({
      index: Number(peak.index),
      distance: Number(peak.distance),
      value: Number(peak.value)
    })),
    peaks_green: ((payload.peaks_green as Record<string, unknown>[]) ?? []).map((peak) => ({
      index: Number(peak.index),
      distance: Number(peak.distance),
      value: Number(peak.value)
    })),
    csv_url: resolveAssetUrl(payload.csv_url),
    pcc: payload.pcc == null ? null : Number(payload.pcc),
    manders_m1: payload.manders_m1 == null ? null : Number(payload.manders_m1),
    manders_m2: payload.manders_m2 == null ? null : Number(payload.manders_m2)
  };
}

function normalizeProgress(payload: Record<string, unknown>): ProgressEvent {
  return {
    event_index: Number(payload.event_index ?? 0),
    state: String(payload.state ?? "queued"),
    message: String(payload.message ?? ""),
    vram_used_mb: payload.vram_used_mb == null ? null : Number(payload.vram_used_mb),
    accelerator_label: payload.accelerator_label == null ? null : String(payload.accelerator_label),
    timestamp: String(payload.timestamp ?? "")
  };
}

import { startTransition, useEffect, useMemo, useRef, useState } from "react";

import { DiscoveryCanvas } from "./components/DiscoveryCanvas";
import { IntelligencePanel } from "./components/IntelligencePanel";
import { ProcessPanel } from "./components/ProcessPanel";
import {
  connectProgress,
  getAnalysis,
  getDefaults,
  getPreprocessedPreview,
  openImageSelection,
  getImagePreviewUrl,
  getChannelPreviewUrl,
  activeApiUrl,
  scanWorkspace,
  setApiRuntime,
  startAnalysis
} from "./lib/api";
import {
  getRuntimeConfig,
  openExperimentFolder,
  setRemoteApiUrl as persistRemoteApiUrl
} from "./lib/desktop";
import type {
  AnalysisConfigInput,
  AnalysisResult,
  AnalysisStatus,
  DefaultConfig,
  DesktopRuntime,
  ImageMetadata,
  LoadingPhase,
  Point,
  ToolMode,
  WorkspaceFileCandidate
} from "./lib/types";

const INITIAL_CONFIG: AnalysisConfigInput = {
  image_id: "",
  rolling_ball_enabled: true,
  rolling_ball_radius: 50,
  target_channel: 0,
  denoise_enabled: false,
  denoise_strength: 0.5,
  rois: [],
};

const FALLBACK_RUNTIME: DesktopRuntime = {
  localApiUrl: "",
  remoteApiUrl: null,
  effectiveApiUrl: "",
  mode: "local",
  platform: "browser",
  arch: "browser",
  isDesktop: false
};

const MIN_TOP_PANE_HEIGHT = 320;


export default function App() {
  const [image, setImage] = useState<ImageMetadata | null>(null);
  const [config, setConfig] = useState<AnalysisConfigInput>(INITIAL_CONFIG);
  const [defaults, setDefaults] = useState<DefaultConfig | null>(null);
  const [desktopRuntime, setDesktopRuntime] = useState<DesktopRuntime>(FALLBACK_RUNTIME);
  const [workspaceFolder, setWorkspaceFolder] = useState<string | null>(null);
  const [workspaceCandidates, setWorkspaceCandidates] = useState<WorkspaceFileCandidate[]>([]);
  const [selectedImagePath, setSelectedImagePath] = useState<string | null>(null);
  const [status, setStatus] = useState<AnalysisStatus | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [roiPoints, setRoiPoints] = useState<Point[]>([]);
  const [tool, setTool] = useState<ToolMode>("circular");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [remoteUrlDraft, setRemoteUrlDraft] = useState("");
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase>("idle");
  const [preprocessedPreviewUrl, setPreprocessedPreviewUrl] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  const mainColumnRef = useRef<HTMLDivElement | null>(null);
  const analysis_id = status?.analysis_id ?? null;
  const image_width = analysis?.image_size[0] ?? image?.width ?? 2048;
  const image_height = analysis?.image_size[1] ?? image?.height ?? 2048;
  const image_preview_url = image ? getImagePreviewUrl(image.image_id) : null;
  const isRemoteMode = desktopRuntime.mode === "remote";
  const runtimeSummary = useMemo(
    () => `${desktopRuntime.platform.toUpperCase()} · ${desktopRuntime.arch.toUpperCase()}`,
    [desktopRuntime.arch, desktopRuntime.platform]
  );
  const loadingMessage = describeLoadingPhase(loadingPhase, status?.message ?? null);

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    if (!analysis_id) {
      return;
    }
    const stream = connectProgress(
      analysis_id,
      (event) => {
        setStatus((current) =>
          current
            ? {
              ...current,
              state: event.state as AnalysisStatus["state"],
              message: event.message,
              vram_used_mb: event.vram_used_mb,
              accelerator_label: event.accelerator_label ?? current.accelerator_label,
            }
            : current
        );

        if (desktopRuntime.mode === "remote") {
          if (event.state === "queued") {
            setLoadingPhase("waiting_remote_queue");
          }
          if (event.state === "running") {
            setLoadingPhase("processing_remote");
          }
          if (event.state === "completed") {
            setLoadingPhase("fetching_remote_result");
          }
          if (event.state === "failed") {
            setLoadingPhase("idle");
          }
        }

        if (event.state === "completed") {
          void refreshAnalysis(analysis_id);
        }
        if (event.state === "failed") {
          setError(event.message);
          setBusy(false);
          setLoadingPhase("idle");
        }
      },
      () => {
        setBusy(false);
        setLoadingPhase("idle");
      }
    );
    return () => stream.close();
  }, [analysis_id, desktopRuntime.mode]);




  useEffect(() => {
    if (!isResizing) {
      return;
    }

    function onPointerMove(event: PointerEvent) {
      const container = mainColumnRef.current;
      if (!container) {
        return;
      }
      const rect = container.getBoundingClientRect();
      const offset = event.clientY - rect.top;
      const min = MIN_TOP_PANE_HEIGHT;
      const max = rect.height - MIN_TOP_PANE_HEIGHT;
      const clamped = Math.min(Math.max(offset, min), max);
      container.style.gridTemplateRows = `${clamped}px 1fr`;
    }

    function onPointerUp() {
      setIsResizing(false);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [isResizing]);

  async function bootstrap() {
    try {
      const runtimeConfig = await getRuntimeConfig();
      setDesktopRuntime(runtimeConfig);
      setApiRuntime(runtimeConfig);
      const defaultsResponse = await getDefaults();
      setDefaults(defaultsResponse);
      if (runtimeConfig.mode === "remote" && runtimeConfig.remoteApiUrl) {
        setRemoteUrlDraft(runtimeConfig.remoteApiUrl);
      }
    } catch (err) {
      console.error("Failed to bootstrap app", err);
    }
  }

  async function handleOpenFolder() {
    try {
      const folderPath = await openExperimentFolder();
      if (!folderPath) {
        return;
      }
      setWorkspaceFolder(folderPath);
      const workspaceResponse = await scanWorkspace(folderPath);
      setWorkspaceCandidates(workspaceResponse.candidates);
    } catch (err) {
      console.error("Failed to open folder", err);
    }
  }

  async function handleSelectImage(candidate: WorkspaceFileCandidate) {
    try {
      const metadata = await openImageSelection(candidate.image_path);
      setImage(metadata);
      setSelectedImagePath(candidate.image_path);
      setAnalysis(null);
      setPreprocessedPreviewUrl(null);
      setStatus({
        analysis_id: "",
        state: "queued",
        message: "Select a Target Channel and draw an ROI to begin analysis.",
        vram_used_mb: null,
        accelerator_label: null,
        created_at: new Date().toISOString(),
        finished_at: null
      });
      setError(null);
      setRoiPoints([]);
      setConfig((prev) => ({ ...prev, image_id: metadata.image_id, rois: [] }));
    } catch (err) {
      console.error("Failed to select image", err);
    }
  }

  function handleSelectCandidate(image_path: string) {
    const candidate = workspaceCandidates.find((c) => c.image_path === image_path);
    if (candidate) {
      void handleSelectImage(candidate);
    }
  }

  async function handleStartAnalysis() {
    if (!image) {
      return;
    }
    try {
      setBusy(true);
      setError(null);
      const analysisStatus = await startAnalysis({
        ...config,
        image_id: image.image_id
      });
      setStatus(analysisStatus);
    } catch (err) {
      console.error("Failed to start analysis", err);
      setError(err instanceof Error ? err.message : "Failed to start analysis");
      setBusy(false);
    }
  }

  async function refreshAnalysis(id: string) {
    try {
      const result = await getAnalysis(id);
      setAnalysis(result);
      setBusy(false);
    } catch (err) {
      console.error("Failed to refresh analysis", err);
      setError(err instanceof Error ? err.message : "Failed to refresh analysis");
      setBusy(false);
    }
  }

  async function handlePreviewPreprocessed() {
    if (!image) return;
    try {
      setPreviewBusy(true);
      // Revoke previous blob URL to prevent memory leak
      if (preprocessedPreviewUrl && preprocessedPreviewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(preprocessedPreviewUrl);
      }
      const url = await getPreprocessedPreview(image.image_id, {
        rolling_ball_enabled: config.rolling_ball_enabled,
        rolling_ball_radius: config.rolling_ball_radius,
        denoise_enabled: config.denoise_enabled,
        denoise_strength: config.denoise_strength,
      });
      setPreprocessedPreviewUrl(url);
    } catch (err) {
      console.error("Failed to generate preprocessed preview", err);
      setError(err instanceof Error ? err.message : "Preprocessing preview failed");
    } finally {
      setPreviewBusy(false);
    }
  }

  function handleRoiComplete(points: Point[]) {
    setRoiPoints(points);
  }

  function handleToolChange(newTool: ToolMode) {
    setTool(newTool);
    setRoiPoints([]);
  }

  function handleConfigChange(newConfig: AnalysisConfigInput) {
    setConfig(newConfig);
  }

  function handleToggleSettings() {
    setSettingsOpen((current) => !current);
  }

  function handleRemoteUrlChange(event: React.ChangeEvent<HTMLInputElement>) {
    setRemoteUrlDraft(event.target.value);
  }

  async function handleSaveRemoteUrl() {
    try {
      await persistRemoteApiUrl(remoteUrlDraft);
      const runtimeConfig = await getRuntimeConfig();
      setDesktopRuntime(runtimeConfig);
      setApiRuntime(runtimeConfig);
    } catch (err) {
      console.error("Failed to save remote URL", err);
    }
  }

  function describeLoadingPhase(phase: LoadingPhase, fallback: string | null): string {
    switch (phase) {
      case "loading_local_image":
        return "Loading local image…";
      case "uploading_remote_tiff":
        return "Uploading TIFF to remote server…";
      case "waiting_remote_queue":
        return "Waiting in remote queue…";
      case "processing_remote":
        return "Processing on remote server…";
      case "fetching_remote_result":
        return "Fetching results…";
      default:
        return fallback ?? "";
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-left">
          <h1>Probabilistic Colocalization Estimator</h1>
          <span className="header-runtime mono">{runtimeSummary}</span>
        </div>
        <div className="header-right">
          <button
            type="button"
            className="settings-toggle"
            onClick={handleToggleSettings}
          >
            {settingsOpen ? "Close Settings" : "Settings"}
          </button>
        </div>
      </header>

      {settingsOpen ? (
        <div className="settings-panel">
          <div className="settings-field">
            <label htmlFor="remote-url">Remote API URL</label>
            <div className="settings-input-row">
              <input
                id="remote-url"
                type="text"
                value={remoteUrlDraft}
                onChange={handleRemoteUrlChange}
                placeholder="https://example.com"
              />
              <button type="button" onClick={handleSaveRemoteUrl}>
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="app-body">
        <aside className="sidebar">
          <ProcessPanel
            image={image}
            config={config}
            defaults={defaults}
            busy={busy}
            workspaceFolder={workspaceFolder}
            candidates={workspaceCandidates}
            selectedImagePath={selectedImagePath}
            desktopAvailable={desktopRuntime.isDesktop}
            runtimeMode={desktopRuntime.mode}
            previewBusy={previewBusy}
            onOpenFolder={handleOpenFolder}
            onSelectCandidate={handleSelectCandidate}
            onConfigChange={handleConfigChange}
            onRunAnalysis={handleStartAnalysis}
            onPreviewPreprocessed={handlePreviewPreprocessed}
          />
        </aside>

        <main className="main-column" ref={mainColumnRef}>
          <div className="main-content-row">
            <DiscoveryCanvas
              analysis={analysis}
              previewUrl={image_preview_url}
              preprocessedPreviewUrl={preprocessedPreviewUrl}
              width={image_width}
              height={image_height}
              tool={tool}
              mode={desktopRuntime.mode}
              config={config}
              loadingPhase={loadingPhase}
              loadingMessage={loadingMessage}
              onToolChange={handleToolChange}
              onRoiComplete={(pts) => {
                setConfig((prev) => ({ ...prev, rois: [pts] }));
                setRoiPoints([]);
              }}
              roiPoints={roiPoints}
            />
            <IntelligencePanel
              analysis={analysis}
              status={status}
              defaults={defaults}
              mode={desktopRuntime.mode}
              config={config}
              onConfigChange={setConfig}
              loadingPhase={loadingPhase}
              loadingMessage={loadingMessage}
            />
          </div>
        </main>
      </div>

      {error ? (
        <div className="error-banner">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
    </div>
  );
}
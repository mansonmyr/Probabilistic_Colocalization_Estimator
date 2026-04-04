import type {
  AnalysisConfigInput,
  DefaultConfig,
  ImageMetadata,
  RuntimeMode,
  WorkspaceFileCandidate
} from "../lib/types";

interface ProcessPanelProps {
  busy: boolean;
  image: ImageMetadata | null;
  config: AnalysisConfigInput;
  defaults: DefaultConfig | null;
  workspaceFolder: string | null;
  candidates: WorkspaceFileCandidate[];
  selectedImagePath: string | null;
  desktopAvailable: boolean;
  runtimeMode: RuntimeMode;
  previewBusy: boolean;
  onOpenFolder: () => void;
  onSelectCandidate: (imagePath: string) => void;
  onConfigChange: (config: AnalysisConfigInput) => void;
  onRunAnalysis: () => void;
  onPreviewPreprocessed: () => void;
}

export function ProcessPanel({
  busy,
  image,
  config,
  defaults,
  workspaceFolder,
  candidates,
  selectedImagePath,
  desktopAvailable,
  runtimeMode,
  previewBusy,
  onOpenFolder,
  onSelectCandidate,
  onConfigChange,
  onRunAnalysis,
  onPreviewPreprocessed
}: ProcessPanelProps) {
  const runDisabled = busy || !image || config.rois.length === 0;
  const previewDisabled = !image || previewBusy || (!config.rolling_ball_enabled && !config.denoise_enabled);

  function update<K extends keyof AnalysisConfigInput>(key: K, value: AnalysisConfigInput[K]) {
    onConfigChange({ ...config, [key]: value });
  }

  return (
    <aside className="process-panel">
      <div className="process-header">
        <div>
          <p className="eyebrow">Process</p>
          <h2>Acquisition</h2>
        </div>
      </div>

      <button type="button" className="action-button primary" onClick={onOpenFolder}>
        Open Folder
      </button>

      <div className="info-card minimal upload-section">
        <div className="meta-line">
          <span>Mode</span>
          <strong>{runtimeMode === "remote" ? "Remote Cloud" : "Local Engine"}</strong>
        </div>
        <div className="meta-line">
          <span>Workspace</span>
          <strong className="mono path-value">{workspaceFolder ?? "No folder selected"}</strong>
        </div>
        <div className="meta-line">
          <span>Image</span>
          <strong>{image?.filename ?? "No TIFF selected"}</strong>
        </div>
        <p className="helper-text">
          {desktopAvailable
            ? "Native folder dialogs are available through Electron."
            : "Browser preview detected. Native dialogs appear once the Electron shell is running."}
        </p>
      </div>

      <div className="section-block minimal upload-section">
        <div className="section-header">
          <span>TIFF Candidates</span>
          <span className="mono subtle">{candidates.length.toString().padStart(2, "0")}</span>
        </div>
        <div className="candidate-list">
          {candidates.length > 0 ? (
            candidates.map((candidate) => (
              <button
                key={candidate.image_path}
                type="button"
                className={candidate.image_path === selectedImagePath ? "candidate-button active" : "candidate-button"}
                onClick={() => onSelectCandidate(candidate.image_path)}
              >
                <span>{candidate.filename}</span>
                <span className="mono subtle">{candidate.image_path.split("/").pop()}</span>
              </button>
            ))
          ) : (
            <div className="empty-state compact">Open a folder and select a TIFF.</div>
          )}
        </div>
      </div>

      <div className="section-block minimal compact-gap">
        <div className="section-header">
          <span>Preprocessing</span>
          <span className="mono subtle">R/G</span>
        </div>

        <label className="field checkbox-field" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={config.rolling_ball_enabled}
            onChange={(e) => update("rolling_ball_enabled", e.target.checked)}
          />
          <span>Enable Background Subtraction</span>
        </label>

        {config.rolling_ball_enabled && (
          <label className="field" style={{ marginTop: '0.5rem' }}>
            <div className="field-head">
              <span>Rolling Ball Radius</span>
              <strong className="mono">{config.rolling_ball_radius}px</strong>
            </div>
            <input
              type="range"
              min={5}
              max={150}
              step={5}
              value={config.rolling_ball_radius}
              onChange={(e) => update("rolling_ball_radius", Number(e.target.value))}
            />
          </label>
        )}

        <div className="section-divider" style={{ margin: '1rem 0', borderTop: '1px solid #1e293b' }} />

        <div className="section-header">
          <span>Step 2: Denoising (N2V)</span>
        </div>

        <label className="field checkbox-field" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={config.denoise_enabled}
            onChange={(e) => update("denoise_enabled", e.target.checked)}
          />
          <span>Enable Noise Reduction</span>
        </label>

        {config.denoise_enabled && (
          <label className="field" style={{ marginTop: '0.5rem' }}>
            <div className="field-head">
              <span>N2V Strength</span>
              <strong className="mono">{(config.denoise_strength * 100).toFixed(0)}%</strong>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={config.denoise_strength}
              onChange={(e) => update("denoise_strength", Number(e.target.value))}
            />
          </label>
        )}

        {(config.rolling_ball_enabled || config.denoise_enabled) && (
          <button
            type="button"
            className="action-button"
            disabled={previewDisabled}
            onClick={onPreviewPreprocessed}
            style={{ marginTop: '0.75rem', fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
          >
            {previewBusy ? "Generating…" : "Preview Preprocessing"}
          </button>
        )}

        <div className="section-divider" style={{ margin: '1rem 0', borderTop: '1px solid #1e293b' }} />

        <div className="section-header">
          <span>Step 3: Target Channel</span>
        </div>

        <label className="field" style={{ marginTop: '0.5rem' }}>
          <select 
            value={config.target_channel} 
            onChange={(e) => update("target_channel", Number(e.target.value))}
            className="panel-select"
            style={{ width: '100%', padding: '4px', background: 'transparent', border: '1px solid #334155', color: '#f8fafc', borderRadius: '4px' }}
            disabled={!image}
          >
            {image?.channel_labels.map((label, idx) => (
              <option key={idx} value={idx} style={{ background: '#0f172a' }}>
                {label}
              </option>
            )) ?? <option value={0}>CH 1</option>}
          </select>
        </label>

      </div>



      <button type="button" className="action-button run-button" disabled={runDisabled} onClick={onRunAnalysis}>
        {busy ? "Processing…" : "Run Analysis"}
      </button>
    </aside>
  );
}
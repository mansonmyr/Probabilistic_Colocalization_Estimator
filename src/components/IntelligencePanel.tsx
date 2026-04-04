import { useState } from "react";
import type {
  AnalysisConfigInput,
  AnalysisResult,
  AnalysisStatus,
  DefaultConfig,
  LoadingPhase,
  MetricSummary,
  RuntimeMode
} from "../lib/types";

interface IntelligencePanelProps {
  analysis: AnalysisResult | null;
  status: AnalysisStatus | null;
  defaults: DefaultConfig | null;
  mode: RuntimeMode;
  config: AnalysisConfigInput;
  onConfigChange: (config: AnalysisConfigInput) => void;
  loadingPhase: LoadingPhase;
  loadingMessage: string | null;

}

const METRIC_ROWS: Array<keyof MetricSummary> = ["pcc", "manders_m1", "manders_m2", "moc"];

export function IntelligencePanel({
  analysis,
  status,
  defaults,
  mode,
  config,
  onConfigChange,
  loadingPhase,
  loadingMessage
}: IntelligencePanelProps) {
  const [selectedLabels, setSelectedLabels] = useState<Record<number, string>>({});

  const acceleratorLabel = status?.accelerator_label ?? defaults?.accelerator_label ?? "Pending";
  const statusCopy = loadingPhase !== "idle" ? loadingMessage : status?.message;

  return (
    <aside className="panel intelligence-panel minimal-panel">
      <div className="panel-topline">
        <div>
          <p className="eyebrow">Intelligence</p>
          <h2>Colocalization Readout</h2>
        </div>
      </div>

      {analysis?.global_metrics && (
        <div className="metric-card minimal-table">
          <div className="metric-row header">
            <span>Global Metric</span>
            <span>Value</span>
          </div>
          {METRIC_ROWS.map((key) => {
            const val = analysis.global_metrics![key];
            return (
              <div className="metric-row" key={key}>
                <span>{prettyMetric(key)}</span>
                <strong className="mono">
                  {typeof val === 'number' ? val.toFixed(4) : 'n/a'}
                </strong>
              </div>
            );
          })}
          <div className="metric-row">
            <span>Discovery Score</span>
            <strong className="mono">
              {analysis.global_metrics.confidence_score != null
                ? (analysis.global_metrics.confidence_score * 100).toFixed(1) + '%'
                : 'n/a'}
            </strong>
          </div>
        </div>
      )}

      {analysis?.global_metrics?.pairwise_results && Object.keys(analysis.global_metrics.pairwise_results).length > 0 && (
        <div className="metric-card minimal-table" style={{ marginTop: '1rem' }}>
          <div className="metric-row header">
            <span>Inter-Channel Pair</span>
            <span>PCC</span>
            <span>Co-Prob</span>
          </div>
          {Object.entries(analysis.global_metrics.pairwise_results).map(([key, result]) => {
            const [c1, c2] = key.split("-").map(n => parseInt(n) + 1);
            return (
              <div className="metric-row" key={key}>
                <span>Ch{c1} vs Ch{c2}</span>
                <strong className="mono">{result.pcc.toFixed(4)}</strong>
                <strong className="mono">{(result.co_probability * 100).toFixed(1)}%</strong>
              </div>
            );
          })}
        </div>
      )}

      {analysis?.roi_metrics && analysis.roi_metrics.length > 0 && (
        <div className="metric-card minimal-table" style={{ marginTop: '1rem' }}>
          <div className="metric-row header">
            <span>Target ROI</span>
            <span>PCC</span>
            <span>Discovery</span>
          </div>
          {analysis.roi_metrics.map((roi) => {
            const lsr = roi.link_strength;
            const ratioLabel = lsr.link_strength_ratio == null
              ? "N/A (Single Partner)"
              : lsr.link_strength_ratio.toFixed(2);
            const exclusivityBadge = lsr.link_strength_ratio == null
              ? "single"
              : lsr.link_strength_ratio > 2.0
                ? "exclusive"
                : "promiscuous";
            const exclusivityColor = exclusivityBadge === "exclusive"
              ? "#34d399"
              : exclusivityBadge === "promiscuous"
                ? "#fbbf24"
                : "#94a3b8";

            return (
              <div key={roi.roi_index} style={{ borderBottom: '1px solid #1e293b', padding: '0.75rem 0' }}>
                <div className="metric-row">
                  <span>ROI #{roi.roi_index + 1}</span>
                  <span className="mono" style={{ fontSize: '0.75rem', opacity: 0.6 }}>{roi.classification}</span>
                </div>
                <div className="metric-row subtle" style={{ fontSize: '0.8rem', opacity: 0.8 }}>
                  <span>PCC: {roi.pcc.toFixed(3)}</span>
                  <span>Discovery: {(roi.co_probability * 100).toFixed(1)}%</span>
                </div>
                <div className="metric-row subtle" style={{ fontSize: '0.8rem', opacity: 0.8 }}>
                  <span>MOC: {roi.moc.toFixed(3)}</span>
                  <span>R²: {roi.mlr.r_squared.toFixed(3)}</span>
                </div>
                <div className="metric-row subtle" style={{ fontSize: '0.8rem', opacity: 0.8 }}>
                  <span>M1: {roi.m1.toFixed(3)}</span>
                  <span>M2: {roi.m2.toFixed(3)}</span>
                </div>
                <div className="metric-row subtle" style={{ fontSize: '0.8rem', opacity: 0.85, marginTop: '0.25rem' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    Link Ratio: <strong>{ratioLabel}</strong>
                    <span style={{
                      display: 'inline-block',
                      padding: '1px 6px',
                      borderRadius: '4px',
                      fontSize: '0.65rem',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      background: exclusivityColor + '22',
                      color: exclusivityColor,
                      border: `1px solid ${exclusivityColor}44`,
                    }}>
                      {exclusivityBadge === "single" ? "single partner" : exclusivityBadge}
                    </span>
                  </span>
                </div>
                {lsr.strongest_link && lsr.link_strength_ratio != null && (
                  <div className="metric-row subtle" style={{ fontSize: '0.75rem', opacity: 0.65 }}>
                    <span>Strongest → {lsr.strongest_link}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="status-stack">
        <div className="status-line">
          <span>Mode</span>
          <strong>{mode === "remote" ? "Remote" : "Local"}</strong>
        </div>
        <div className="status-line">
          <span>Status</span>
          <strong>{status?.state ?? "idle"}</strong>
        </div>
        <div className="status-line">
          <span>Accelerator</span>
          <strong className="mono">{acceleratorLabel}</strong>
        </div>
      </div>



      <p className="status-copy">{statusCopy ?? "Waiting for an experiment folder and TIFF selection."}</p>
      {defaults?.warning ? <p className="warning-copy">{defaults.warning}</p> : null}
    </aside>
  );
}

function prettyMetric(key: string): string {
  if (key === "pcc") return "PCC";
  if (key === "manders_m1") return "Manders M1 (Costes)";
  if (key === "manders_m2") return "Manders M2 (Costes)";
  if (key === "moc") return "MOC (Overlap)";
  return key;
}

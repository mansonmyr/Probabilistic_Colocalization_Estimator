import type { RoiProfileResponse } from "../lib/types";

interface ProfileDashboardProps {
  roi: RoiProfileResponse | null;
  redVisible: boolean;
  greenVisible: boolean;
  onToggleRed: () => void;
  onToggleGreen: () => void;
  reportUrl: string | null;
}

export function ProfileDashboard({
  roi,
  redVisible,
  greenVisible,
  onToggleRed,
  onToggleGreen,
  reportUrl
}: ProfileDashboardProps) {
  const chart = roi ? buildChartPaths(roi) : null;

  return (
    <section className="panel profile-panel">
      <div className="panel-topline">
        <div>
          <p className="eyebrow">Profile</p>
          <h2>Dual-Trace ROI</h2>
        </div>
        <div className="profile-actions">
          <button
            type="button"
            className={redVisible ? "trace-toggle active red" : "trace-toggle red"}
            onClick={onToggleRed}
          >
            Red
          </button>
          <button
            type="button"
            className={greenVisible ? "trace-toggle active green" : "trace-toggle green"}
            onClick={onToggleGreen}
          >
            Green
          </button>
          {roi?.csvUrl ? (
            <a className="export-link" href={roi.csvUrl}>
              CSV
            </a>
          ) : null}
          {reportUrl ? (
            <a className="export-link" href={reportUrl}>
              Report
            </a>
          ) : null}
        </div>
      </div>

      <div className="profile-summary mono">
        <span>Samples {roi?.sampleCount ?? 0}</span>
        {roi?.pcc != null && <span>PCC {roi.pcc.toFixed(3)}</span>}
        {roi?.mandersM1 != null && <span>M1 {roi.mandersM1.toFixed(3)}</span>}
        {roi?.mandersM2 != null && <span>M2 {roi.mandersM2.toFixed(3)}</span>}
        <span>Peak Markers {roi ? roi.peaksRed.length + roi.peaksGreen.length : 0}</span>
      </div>

      {chart ? (
        <svg className="profile-chart" viewBox="0 0 1000 280">
          <rect x={0} y={0} width={1000} height={280} fill="#020617" />
          <path d={chart.gridPath} stroke="rgba(148, 163, 184, 0.28)" strokeWidth={1} fill="none" />
          {redVisible ? <path d={chart.redPath} stroke="#fb7185" strokeWidth={3} fill="none" /> : null}
          {greenVisible ? <path d={chart.greenPath} stroke="#34d399" strokeWidth={3} fill="none" /> : null}
          {redVisible
            ? roi?.peaksRed.map((peak) => (
                <circle
                  key={`red-${peak.index}`}
                  cx={chart.xScale(peak.distance)}
                  cy={chart.yScale(peak.value)}
                  r={4}
                  fill="#fb7185"
                />
              ))
            : null}
          {greenVisible
            ? roi?.peaksGreen.map((peak) => (
                <circle
                  key={`green-${peak.index}`}
                  cx={chart.xScale(peak.distance)}
                  cy={chart.yScale(peak.value)}
                  r={4}
                  fill="#34d399"
                />
              ))
            : null}
        </svg>
      ) : (
        <div className="empty-state compact">
          Draw a line ROI on the discovery canvas to generate dual intensity traces and peak markers.
        </div>
      )}
    </section>
  );
}

function buildChartPaths(roi: RoiProfileResponse) {
  const maxDistance = Math.max(...roi.distances, 1);
  const maxValue = Math.max(...roi.red, ...roi.green, 1);
  const xScale = (value: number) => 40 + (value / maxDistance) * 920;
  const yScale = (value: number) => 240 - (value / maxValue) * 200;
  const redPath = roi.distances
    .map((distance, index) => `${index === 0 ? "M" : "L"} ${xScale(distance)} ${yScale(roi.red[index])}`)
    .join(" ");
  const greenPath = roi.distances
    .map(
      (distance, index) => `${index === 0 ? "M" : "L"} ${xScale(distance)} ${yScale(roi.green[index])}`
    )
    .join(" ");
  const gridPath = [
    "M 40 40 L 40 240 L 960 240",
    "M 40 140 L 960 140",
    "M 346 40 L 346 240",
    "M 653 40 L 653 240"
  ].join(" ");
  return { redPath, greenPath, gridPath, xScale, yScale };
}
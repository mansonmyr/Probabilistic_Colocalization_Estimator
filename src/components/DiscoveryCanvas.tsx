import { PointerEvent, WheelEvent, useEffect, useMemo, useRef, useState } from "react";

import type { AnalysisConfigInput, AnalysisResult, LoadingPhase, Point, RuntimeMode, ToolMode } from "../lib/types";


interface DiscoveryCanvasProps {
  analysis: AnalysisResult | null;
  previewUrl: string | null;
  preprocessedPreviewUrl: string | null;
  width: number;
  height: number;
  tool: ToolMode;
  mode: RuntimeMode;
  config: AnalysisConfigInput;
  loadingPhase: LoadingPhase;
  loadingMessage: string | null;
  onToolChange: (tool: ToolMode) => void;
  onRoiComplete: (points: Point[]) => void;
  roiPoints: Point[];
}

interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const TOOLBAR: ToolMode[] = ["pan", "zoom", "circular", "polygonal"];

export function DiscoveryCanvas({
  analysis,
  previewUrl,
  preprocessedPreviewUrl,
  width,
  height,
  tool,
  mode,
  config,
  loadingPhase,
  loadingMessage,
  onToolChange,
  onRoiComplete,
  roiPoints
}: DiscoveryCanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [draftLine, setDraftLine] = useState<Point[]>([]);
  const [viewBox, setViewBox] = useState<ViewBox>({ x: 0, y: 0, width, height });
  const [dragOrigin, setDragOrigin] = useState<Point | null>(null);
  const [mousePoint, setMousePoint] = useState<Point | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  useEffect(() => {
    setViewBox({ x: 0, y: 0, width, height });
    setDraftLine([]);
    setImageError(null);
  }, [width, height, analysis?.status.analysis_id]);

  const roiPath = useMemo(() => {
    let pointsToRender = draftLine.length > 0 ? [...draftLine] : [...roiPoints];

    if (draftLine.length > 0 && tool === "polygonal" && mousePoint) {
      pointsToRender.push(mousePoint);
    }

    if (pointsToRender.length < 2) {
      return "";
    }
    const path = pointsToRender.map((p) => `${p.x},${p.y}`).join(" ");
    const activeType = draftLine.length > 0 ? tool : (roiPoints.length === 2 ? "circular" : "polygonal");
    return activeType === "polygonal" ? path + ` ${pointsToRender[0].x},${pointsToRender[0].y}` : path;
  }, [draftLine, roiPoints, tool, mousePoint]);

  const finishedCircle = useMemo(() => {
    if (draftLine.length > 0 || roiPoints.length !== 2) return null;
    const [c, e] = roiPoints;
    const r = Math.sqrt(Math.pow(e.x - c.x, 2) + Math.pow(e.y - c.y, 2));
    return { cx: c.x, cy: c.y, r };
  }, [draftLine, roiPoints]);

  const draftCircle = useMemo(() => {
    if (tool !== "circular" || draftLine.length < 2) return null;
    const [c, e] = draftLine;
    const r = Math.sqrt(Math.pow(e.x - c.x, 2) + Math.pow(e.y - c.y, 2));
    return { cx: c.x, cy: c.y, r };
  }, [draftLine, tool]);

  const baseHref = analysis?.artifact_links?.overlay ?? analysis?.artifact_links?.composite ?? preprocessedPreviewUrl ?? previewUrl ?? "";
  const isRemoteLoading = mode === "remote" && loadingPhase !== "idle";

  function toSvgPoint(event: PointerEvent<SVGSVGElement> | WheelEvent<SVGSVGElement>): Point | null {
    const svg = svgRef.current;
    if (!svg) {
      return null;
    }
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const transformed = point.matrixTransform(svg.getScreenCTM()?.inverse());
    return { x: transformed.x, y: transformed.y };
  }

  function handlePointerDown(event: PointerEvent<SVGSVGElement>) {
    const point = toSvgPoint(event);
    if (!point) {
      return;
    }
    if (tool === "circular") {
      if (draftLine.length === 0) {
        setDraftLine([point]);
      } else {
        onRoiComplete([draftLine[0], point]);
        setDraftLine([]);
      }
      return;
    }
    if (tool === "polygonal") {
      if (draftLine.length >= 3) {
        const start = draftLine[0];
        const dist = Math.sqrt(Math.pow(point.x - start.x, 2) + Math.pow(point.y - start.y, 2));
        if (dist < 15) {
          onRoiComplete(draftLine);
          setDraftLine([]);
          return;
        }
      }
      const nextPoints = [...draftLine, point];
      setDraftLine(nextPoints);
      if (nextPoints.length >= 2) {
        onRoiComplete(nextPoints);
      }
      return;
    }
    if (tool === "zoom") {
      zoomAt(point, 0.82);
      return;
    }
    setDragOrigin(point);
  }

  function handlePointerMove(event: PointerEvent<SVGSVGElement>) {
    const point = toSvgPoint(event);
    if (!point) {
      return;
    }
    setMousePoint(point);

    if (tool === "circular" && draftLine.length > 0) {
      setDraftLine([draftLine[0], point]);
      return;
    }
    if (tool === "polygonal" && draftLine.length > 0) {
      return;
    }
    if (tool === "pan" && dragOrigin) {
      const dx = dragOrigin.x - point.x;
      const dy = dragOrigin.y - point.y;
      setViewBox((current) => ({
        ...current,
        x: clamp(current.x + dx, 0, Math.max(0, width - current.width)),
        y: clamp(current.y + dy, 0, Math.max(0, height - current.height))
      }));
      setDragOrigin(point);
    }
  }

  function handlePointerUp() {
    setDragOrigin(null);
  }

  function onWheel(event: WheelEvent<SVGSVGElement>) {
    event.preventDefault();
    const point = toSvgPoint(event);
    if (!point) {
      return;
    }
    const factor = event.deltaY < 0 ? 0.88 : 1.14;
    zoomAt(point, factor);
  }

  function zoomAt(point: Point, factor: number) {
    setViewBox((current) => {
      const nextWidth = clamp(current.width * factor, width * 0.14, width);
      const nextHeight = clamp(current.height * factor, height * 0.14, height);
      const relX = (point.x - current.x) / current.width;
      const relY = (point.y - current.y) / current.height;
      const nextX = clamp(point.x - relX * nextWidth, 0, Math.max(0, width - nextWidth));
      const nextY = clamp(point.y - relY * nextHeight, 0, Math.max(0, height - nextHeight));
      return { x: nextX, y: nextY, width: nextWidth, height: nextHeight };
    });
  }

  return (
    <section className="panel discovery-panel floating-panel">
      <div className="panel-topline">
        <div>
          <p className="eyebrow">Discovery</p>
          <h2>Microscopy Canvas</h2>
        </div>
        <div className="canvas-status-row">
          <span className={mode === "remote" ? "overlay-pill remote" : "overlay-pill"}>
            {mode === "remote" ? "Remote" : "Local"}
          </span>
        </div>
      </div>

      <div className="floating-toolbar">
        {TOOLBAR.map((candidate) => (
          <button
            key={candidate}
            type="button"
            className={candidate === tool ? "tool-button active" : "tool-button"}
            onClick={() => {
              onToolChange(candidate);
              setDraftLine([]);
            }}
          >
            {candidate.charAt(0).toUpperCase() + candidate.slice(1)}
          </button>
        ))}
        <div className="toolbar-spacer" />
        <span className="mono subtle">{width} × {height}</span>
      </div>

      <div className="canvas-shell single-view" style={{ aspectRatio: `${width} / ${height}` }}>
        {analysis || baseHref ? (
          <svg
            ref={svgRef}
            className="canvas-svg"
            viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
            onPointerDown={(e) => handlePointerDown(e)}
            onPointerMove={(e) => handlePointerMove(e)}
            onPointerUp={handlePointerUp}
            onPointerLeave={() => {
              handlePointerUp();
              setMousePoint(null);
            }}
            onWheel={(e) => onWheel(e)}
          >
            <rect x={0} y={0} width={width} height={height} fill="#020617" />
            
            <defs>
              <filter id="smooth3x3" x="0" y="0">
                <feGaussianBlur in="SourceGraphic" stdDeviation="1.5" />
              </filter>
            </defs>

            {/* Composite Base Image */}
            {baseHref && (
              <image
                href={baseHref}
                x={0}
                y={0}
                width={width}
                height={height}
                preserveAspectRatio="none"
                style={{ filter: 'url(#smooth3x3)' }}
                onError={() => {
                  console.error('[DiscoveryCanvas] Composite image failed to load:', baseHref);
                  setImageError(`Failed to load composite preview`);
                }}
              />
            )}

            {/* Shared ROI Overlays */}
            {(tool === "circular" && draftCircle) || (draftLine.length === 0 && finishedCircle) ? (
              <circle
                cx={draftLine.length > 0 ? draftCircle?.cx : finishedCircle?.cx}
                cy={draftLine.length > 0 ? draftCircle?.cy : finishedCircle?.cy}
                r={draftLine.length > 0 ? draftCircle?.r : finishedCircle?.r}
                fill="none" stroke="#f8fafc" strokeWidth={3}
              />
            ) : null}

            {/* Saved ROIs */}
            {config.rois.map((points, idx) => {
              if (points.length === 2) {
                const [c, e] = points;
                const r = Math.sqrt(Math.pow(e.x - c.x, 2) + Math.pow(e.y - c.y, 2));
                return (
                  <circle
                    key={idx}
                    cx={c.x}
                    cy={c.y}
                    r={r}
                    fill="none"
                    stroke="#38bdf8"
                    strokeWidth="2"
                    strokeDasharray="4 4"
                  />
                );
              }
              return (
                <polygon
                  key={idx}
                  points={points.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth="2"
                  strokeDasharray="4 4"
                />
              );
            })}

            {/* Active ROI Path (Polygonal) */}
            {roiPath && tool === "polygonal" && (
              <polygon points={roiPath} fill="none" stroke="#f43f5e" strokeWidth="2" />
            )}
            {roiPath && tool !== "polygonal" && (
              <polyline points={roiPath} fill="none" stroke="#f43f5e" strokeWidth="2" />
            )}
          </svg>
        ) : (
          <div className="empty-state discovery-empty">
            <h3>{isRemoteLoading ? "Remote Loading" : "Open a folder and select a TIFF"}</h3>
            <p>
              {loadingPhase !== "idle" ? loadingMessage : "Select a TIFF file to start the discovery process."}
            </p>
          </div>
        )}
        {imageError && <div className="canvas-error">{imageError}</div>}
        {analysis && loadingMessage ? <div className="canvas-callout">{loadingMessage}</div> : null}
      </div>
    </section>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
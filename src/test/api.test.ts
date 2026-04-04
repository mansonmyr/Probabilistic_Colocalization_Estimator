import { getAnalysis, openImageSelection, scanWorkspace, setApiRuntime } from "../lib/api";

describe("api runtime routing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: undefined
    });
    setApiRuntime({
      localApiUrl: "",
      remoteApiUrl: null,
      effectiveApiUrl: "",
      mode: "local"
    });
  });

  it("uses the Electron remote upload bridge in remote mode", async () => {
    const uploadImageToRemote = vi.fn().mockResolvedValue({
      image_id: "img-1",
      filename: "sample.tif",
      stored_path: "/remote/images/sample.tif",
      width: 2048,
      height: 2048,
      dtype: "uint16",
      channel_labels: ["CH_A (Red)", "CH_B (Green)"],
      histograms: {}
    });

    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        uploadImageToRemote
      }
    });

    vi.stubGlobal("fetch", vi.fn() as unknown as typeof fetch);

    setApiRuntime({
      localApiUrl: "http://127.0.0.1:8123",
      remoteApiUrl: "https://remote.example",
      effectiveApiUrl: "https://remote.example",
      mode: "remote"
    });

    const image = await openImageSelection("/tmp/sample.tif");

    expect(uploadImageToRemote).toHaveBeenCalledWith({
      imagePath: "/tmp/sample.tif",
      remoteApiUrl: "https://remote.example"
    });
    expect(image.storedPath).toBe("/remote/images/sample.tif");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps workspace scanning on the local backend", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ folder_path: "/tmp/data", candidates: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    setApiRuntime({
      localApiUrl: "http://127.0.0.1:8123",
      remoteApiUrl: "https://remote.example",
      effectiveApiUrl: "https://remote.example",
      mode: "remote"
    });

    await scanWorkspace("/tmp/data");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8123/api/workspaces/scan",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("resolves remote artifact links against the remote API origin", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            status: {
              analysis_id: "analysis-1",
              state: "completed",
              message: "done",
              tiles_processed: 225,
              tiles_total: 225,
              vram_used_mb: 123.4,
              accelerator_label: "Remote GPU",
              quantization_mode: "fp16",
              created_at: "2026-03-23T00:00:00Z",
              finished_at: "2026-03-23T00:10:00Z"
            },
            image_size: [2048, 2048],
            channel_labels: ["CH_A (Red)", "CH_B (Green)"],
            tile_results: [],
            metrics: {
              pcc: 0.8,
              manders_m1: 0.7,
              manders_m2: 0.6
            },
            artifact_links: {
              composite: "/artifacts/composite.png",
              heatmap: "/artifacts/heatmap.png",
              mask_red: "/artifacts/red.png",
              mask_green: "/artifacts/green.png",
              overlay: "/artifacts/overlay.png",
              report: "/artifacts/report.pdf",
              roi_csv: "/artifacts/roi.csv"
            },
            exports: {}
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        )
      ) as unknown as typeof fetch
    );

    setApiRuntime({
      localApiUrl: "http://127.0.0.1:8123",
      remoteApiUrl: "https://remote.example",
      effectiveApiUrl: "https://remote.example",
      mode: "remote"
    });

    const result = await getAnalysis("analysis-1");

    expect(result.artifactLinks?.maskRed).toBe("https://remote.example/artifacts/red.png");
    expect(result.artifactLinks?.report).toBe("https://remote.example/artifacts/report.pdf");
  });
});

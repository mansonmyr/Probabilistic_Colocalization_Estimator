import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import App from "../App";

const defaultsPayload = {
  qwen_repo_path: "/tmp/Qwen-IL",
  qwen_weights_path: "/tmp/Qwen_weight",
  accelerator_label: "Apple Silicon MPS",
  quantization_mode: "fp16",
  recommended_qwen_layers: 4,
  recommended_qwen_resolution: 512,
  warning: null
};

const localRuntime = {
  localApiUrl: "http://127.0.0.1:8123",
  remoteApiUrl: null,
  effectiveApiUrl: "http://127.0.0.1:8123",
  mode: "local",
  platform: "darwin",
  arch: "arm64"
} as const;

const remoteRuntime = {
  localApiUrl: "http://127.0.0.1:8123",
  remoteApiUrl: "https://remote.example",
  effectiveApiUrl: "https://remote.example",
  mode: "remote",
  platform: "darwin",
  arch: "arm64"
} as const;

describe("App", () => {
  beforeEach(() => {
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        getRuntimeConfig: vi.fn().mockResolvedValue(localRuntime),
        setRemoteApiUrl: vi.fn(async (url: string | null) => (url ? remoteRuntime : localRuntime)),
        openExperimentFolder: vi.fn().mockResolvedValue({ folderPath: null }),
        openQwenRepoFolder: vi.fn().mockResolvedValue({ folderPath: null }),
        openWeightsFolder: vi.fn().mockResolvedValue({ folderPath: null }),
        uploadImageToRemote: vi.fn()
      }
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
        if (url.includes("/api/config/defaults")) {
          return new Response(JSON.stringify(defaultsPayload), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }
        return new Response("{}", {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }) as unknown as typeof fetch
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders the desktop workbench shell", async () => {
    render(<App />);
    expect(await screen.findByText("Probabilistic Colocalization Estimator")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open folder/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open settings/i })).toBeInTheDocument();
    expect(screen.getByText("Ghost Overlay On")).toBeInTheDocument();
    expect(screen.getByText("Dual-Trace ROI")).toBeInTheDocument();
  });

  it("toggles ghost overlay with the spacebar hotkey", async () => {
    render(<App />);
    await screen.findByText("Ghost Overlay On");
    fireEvent.keyDown(window, { code: "Space" });
    expect(screen.getByText("Ghost Overlay Off")).toBeInTheDocument();
  });

  it("collapses the sidebar", async () => {
    render(<App />);
    await screen.findByText("Probabilistic Colocalization Estimator");
    fireEvent.click(screen.getByRole("button", { name: /collapse sidebar/i }));
    expect(screen.getByRole("button", { name: /expand sidebar/i })).toBeInTheDocument();
  });

  it("switches into remote mode from the settings modal", async () => {
    render(<App />);
    await screen.findByText("Probabilistic Colocalization Estimator");

    fireEvent.click(screen.getByRole("button", { name: /open settings/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("https://example.ngrok-free.app"), {
      target: { value: "https://remote.example" }
    });
    fireEvent.click(screen.getByRole("button", { name: /use remote/i }));

    await waitFor(() => {
      expect(screen.getByText("Remote backend active.")).toBeInTheDocument();
    });
    expect(screen.queryByText("Qwen Repo Path")).not.toBeInTheDocument();
    expect(screen.getByText("Remote Cloud")).toBeInTheDocument();
  });
});

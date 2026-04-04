import type { DesktopRuntime, ImageMetadata } from "./types";

declare global {
  interface Window {
    desktop?: {
      openExperimentFolder: () => Promise<{ folderPath: string | null }>;
      openQwenRepoFolder: () => Promise<{ folderPath: string | null }>;
      openWeightsFolder: () => Promise<{ folderPath: string | null }>;
      getRuntimeConfig: () => Promise<{
        localApiUrl: string;
        remoteApiUrl: string | null;
        effectiveApiUrl: string;
        mode: DesktopRuntime["mode"];
        platform: string;
        arch: string;
      }>;
      setRemoteApiUrl: (url: string | null) => Promise<{
        localApiUrl: string;
        remoteApiUrl: string | null;
        effectiveApiUrl: string;
        mode: DesktopRuntime["mode"];
        platform: string;
        arch: string;
      }>;
      uploadImageToRemote: (args: {
        imagePath: string;
        remoteApiUrl: string;
      }) => Promise<Record<string, unknown>>;
    };
  }
}

const BROWSER_RUNTIME: DesktopRuntime = {
  localApiUrl: "http://localhost:8000",
  remoteApiUrl: null,
  effectiveApiUrl: "http://localhost:8000",
  mode: "local",
  platform: "browser",
  arch: "browser",
  isDesktop: false
};

function asDesktopRuntime(runtime: Omit<DesktopRuntime, "isDesktop">): DesktopRuntime {
  return {
    ...runtime,
    isDesktop: true
  };
}

export async function getRuntimeConfig(): Promise<DesktopRuntime> {
  if (!window.desktop?.getRuntimeConfig) {
    return BROWSER_RUNTIME;
  }
  return asDesktopRuntime(await window.desktop.getRuntimeConfig());
}

export async function setRemoteApiUrl(url: string | null): Promise<DesktopRuntime> {
  if (!window.desktop?.setRemoteApiUrl) {
    return {
      ...BROWSER_RUNTIME,
      remoteApiUrl: url,
      effectiveApiUrl: url ?? "",
      mode: url ? "remote" : "local"
    };
  }
  return asDesktopRuntime(await window.desktop.setRemoteApiUrl(url));
}

export async function openExperimentFolder(): Promise<string | null> {
  return (await window.desktop?.openExperimentFolder?.())?.folderPath ?? null;
}

export async function openQwenRepoFolder(): Promise<string | null> {
  return (await window.desktop?.openQwenRepoFolder?.())?.folderPath ?? null;
}

export async function openWeightsFolder(): Promise<string | null> {
  return (await window.desktop?.openWeightsFolder?.())?.folderPath ?? null;
}

export async function uploadImageToRemote(args: {
  imagePath: string;
  remoteApiUrl: string;
}): Promise<ImageMetadata> {
  if (!window.desktop?.uploadImageToRemote) {
    throw new Error("Remote TIFF upload requires the Electron desktop shell.");
  }
  return normalizeImage(await window.desktop.uploadImageToRemote(args));
}

function normalizeImage(payload: Record<string, unknown>): ImageMetadata {
  return {
    imageId: String(payload.image_id),
    filename: String(payload.filename),
    storedPath: String(payload.stored_path),
    width: Number(payload.width),
    height: Number(payload.height),
    dtype: String(payload.dtype),
    channelLabels: (payload.channel_labels as string[]) ?? [],
    histograms: payload.histograms as ImageMetadata["histograms"]
  };
}

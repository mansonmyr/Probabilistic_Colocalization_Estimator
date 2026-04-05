const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  openExperimentFolder: () => ipcRenderer.invoke('desktop:open-experiment-folder'),
  openQwenRepoFolder: () => ipcRenderer.invoke('desktop:open-qwen-repo-folder'),
  openWeightsFolder: () => ipcRenderer.invoke('desktop:open-weights-folder'),
  getRuntimeConfig: () => ipcRenderer.invoke('desktop:get-runtime-config'),
  getDesktopRuntime: () => ipcRenderer.invoke('desktop:get-runtime-config'),
  setRemoteApiUrl: (url) => ipcRenderer.invoke('desktop:set-remote-api-url', url),
  uploadImageToRemote: (args) => ipcRenderer.invoke('desktop:upload-image-remote', args)
});

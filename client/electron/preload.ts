import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  openProject: () => ipcRenderer.invoke('dialog:openProject'),
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  shellOpenPath: (path: string) => ipcRenderer.invoke('shell:openPath', path),
  serverStatus: () => ipcRenderer.invoke('server:status'),
  machineId: () => ipcRenderer.invoke('app:machineId'),
  connect: () => ipcRenderer.invoke('app:connect'),
})

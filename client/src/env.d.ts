/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

interface ElectronAPI {
  openProject: () => Promise<string | null>
  openFile: () => Promise<string | null>
  shellOpenPath: (path: string) => Promise<void>
  serverStatus: () => Promise<string>
  machineId: () => Promise<string>
  connect: () => Promise<{ userId: number; username: string }>
}

interface Window {
  electronAPI: ElectronAPI
}

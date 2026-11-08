export declare function autostartEntry(exec: string): string;
type LoginItem = { available(): boolean; chosen(): boolean; choose(on: boolean): void };
export declare function createOpenAtLogin(options: {
  app: {
    isPackaged: boolean;
    getLoginItemSettings(): { openAtLogin: boolean; launchItems?: { name: string; args?: string[]; enabled?: boolean }[] };
    setLoginItemSettings(settings: { openAtLogin: boolean; args?: string[]; name?: string }): void;
  };
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  home: string;
  execPath?: string;
}): LoginItem;
export declare function installOpenAtLogin(options: {
  ipcMain: { handle(channel: string, handler: (...args: any[]) => unknown): void };
  guard: (channel: string, handler: (...args: any[]) => unknown) => (...args: any[]) => unknown;
  loginItem: LoginItem;
  changed: () => void;
}): void;

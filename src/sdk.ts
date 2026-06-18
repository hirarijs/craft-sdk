import { AuthManager, type AuthOptions } from "./auth.js";
import { Downloader, type DownloaderOptions } from "./downloader.js";
import { Installer, type InstallerOptions } from "./installer.js";
import { GameLauncher } from "./launcher.js";
import { API_SOURCE, type ApiSource } from "./constant.js";

export interface CraftSdkOptions {
  apiSource?: ApiSource;
  timeoutMs?: number;
  sessionFile?: string;
}

export class CraftSDK {
  public auth: AuthManager;
  public downloader: Downloader;
  public installer: Installer;
  public launcher: GameLauncher;

  constructor(options?: CraftSdkOptions) {
    const authOptions: AuthOptions = {};
    if (options?.sessionFile) authOptions.sessionFile = options.sessionFile;

    const sharedOptions: DownloaderOptions & InstallerOptions = {
      apiSource: options?.apiSource ?? API_SOURCE.MOJANG,
    };
    if (options?.timeoutMs) sharedOptions.timeoutMs = options.timeoutMs;

    this.auth = new AuthManager(authOptions);
    this.downloader = new Downloader(sharedOptions);
    this.installer = new Installer(sharedOptions);
    this.launcher = new GameLauncher();
  }
}

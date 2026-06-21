import { downloadFile } from "./utils/downloader.js";
import { API_ENDPOINTS, API_SOURCE, type ApiSource } from "./constant.js";
import { resolveApiUrl } from "./utils/api.js";

export interface DownloaderOptions {
  apiSource?: ApiSource;
  timeoutMs?: number;
}

export class Downloader {
  private apiSource: ApiSource;
  private timeoutMs: number;

  constructor(options?: DownloaderOptions) {
    this.apiSource = options?.apiSource ?? API_SOURCE.MOJANG;
    this.timeoutMs = options?.timeoutMs ?? 30000;
  }

  getEndpoints() {
    return API_ENDPOINTS[this.apiSource];
  }

  async download(url: string, targetPath: string): Promise<string> {
    await downloadFile(resolveApiUrl(url, this.apiSource), targetPath, this.timeoutMs);
    return targetPath;
  }

  async downloadVersionManifest(targetPath: string): Promise<string> {
    const url = this.getEndpoints().versionManifest;
    return this.download(url, targetPath);
  }

  getLibrariesBase(): string {
    return this.getEndpoints().librariesBase;
  }

  getAssetsBase(): string {
    return this.getEndpoints().assetsBase;
  }
}

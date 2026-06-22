import {
  downloadFile,
  type DownloadFileOptions,
  type DownloadProcessCallback,
  type DownloadProcessOptions,
} from "./utils/downloader.js";
import { API_ENDPOINTS, API_SOURCE, type ApiSource } from "./constant.js";
import { resolveApiUrl } from "./utils/api.js";

export interface DownloaderOptions extends DownloadProcessOptions {
  apiSource?: ApiSource;
  timeoutMs?: number;
}

export interface DownloaderDownloadOptions extends DownloadProcessOptions {
  timeoutMs?: number;
}

export class Downloader {
  private apiSource: ApiSource;
  private timeoutMs: number;
  private process?: DownloadProcessCallback;

  constructor(options?: DownloaderOptions) {
    this.apiSource = options?.apiSource ?? API_SOURCE.MOJANG;
    this.timeoutMs = options?.timeoutMs ?? 30000;
    if (options?.process) {
      this.process = options.process;
    }
  }

  getEndpoints() {
    return API_ENDPOINTS[this.apiSource];
  }

  async download(url: string, targetPath: string, options?: DownloaderDownloadOptions): Promise<string> {
    await downloadFile(resolveApiUrl(url, this.apiSource), targetPath, this.getDownloadOptions(options));
    return targetPath;
  }

  async downloadVersionManifest(targetPath: string, options?: DownloaderDownloadOptions): Promise<string> {
    const url = this.getEndpoints().versionManifest;
    return this.download(url, targetPath, options);
  }

  getLibrariesBase(): string {
    return this.getEndpoints().librariesBase;
  }

  getAssetsBase(): string {
    return this.getEndpoints().assetsBase;
  }

  private getDownloadOptions(options?: DownloaderDownloadOptions): DownloadFileOptions {
    const downloadOptions: DownloadFileOptions = {
      timeoutMs: options?.timeoutMs ?? this.timeoutMs,
    };
    const processCallback = options?.process ?? this.process;
    if (processCallback) {
      downloadOptions.process = processCallback;
    }
    return downloadOptions;
  }
}

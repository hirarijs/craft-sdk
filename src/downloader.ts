import {
  downloadFile,
  type DownloadFileOptions,
  type DownloadProcessCallback,
  type DownloadProcessOptions,
} from "./utils/downloader.js";
import { API_ENDPOINTS, API_SOURCE, type ApiSource } from "./constant.js";
import { resolveApiUrl } from "./utils/api.js";

/** `Downloader` 构造函数选项 */
export interface DownloaderOptions extends DownloadProcessOptions {
  /**
   * API 来源，决定版本清单等资源的下载地址。
   * @default API_SOURCE.MOJANG
   */
  apiSource?: ApiSource;
  /**
   * 单个 HTTP 请求超时时间（毫秒）。
   * @default 30000
   */
  timeoutMs?: number;
}

/** `Downloader.download` 方法的选项 */
export interface DownloaderDownloadOptions extends DownloadProcessOptions {
  /** 覆盖实例级超时配置的单次请求超时（毫秒） */
  timeoutMs?: number;
}

/**
 * 文件下载器，提供带 API 镜像切换和进度回调的下载功能。
 * 通常通过 `CraftSDK.downloader` 访问。
 */
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

  /** 返回当前 API 来源对应的所有端点配置 */
  getEndpoints() {
    return API_ENDPOINTS[this.apiSource];
  }

  /**
   * 下载任意 URL 到指定路径，自动应用 API 镜像映射。
   * @param url 原始下载 URL
   * @param targetPath 文件保存绝对路径
   * @returns 保存文件的绝对路径
   */
  async download(url: string, targetPath: string, options?: DownloaderDownloadOptions): Promise<string> {
    await downloadFile(resolveApiUrl(url, this.apiSource), targetPath, this.getDownloadOptions(options));
    return targetPath;
  }

  /**
   * 下载 Minecraft 版本清单（`version_manifest_v2.json`）。
   * @param targetPath 文件保存绝对路径
   * @returns 保存文件的绝对路径
   */
  async downloadVersionManifest(targetPath: string, options?: DownloaderDownloadOptions): Promise<string> {
    const url = this.getEndpoints().versionManifest;
    return this.download(url, targetPath, options);
  }

  /** 返回当前 API 来源的库文件下载基础 URL */
  getLibrariesBase(): string {
    return this.getEndpoints().librariesBase;
  }

  /** 返回当前 API 来源的资源文件下载基础 URL */
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

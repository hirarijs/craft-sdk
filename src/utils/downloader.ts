import { createWriteStream, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { request } from "node:https";
import { request as httpRequest } from "node:http";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { IncomingMessage } from "node:http";

export interface DownloadProgress {
  url: string;
  filePath: string;
  downloadedBytes: number;
  totalBytes?: number;
  progress?: number;
}

export type DownloadProcessCallback = (progress: DownloadProgress) => void;

export interface DownloadProcessOptions {
  process?: DownloadProcessCallback;
}

export interface DownloadFileOptions extends DownloadProcessOptions {
  timeoutMs?: number;
}

export interface DownloadResult {
  filePath: string;
}

interface ResolvedDownloadFileOptions {
  timeoutMs: number;
  process?: DownloadProcessCallback;
}

export async function downloadFile(
  url: string,
  filePath: string,
  options?: number | DownloadFileOptions
): Promise<DownloadResult> {
  if (!url) {
    throw new Error(`Download URL is empty for ${filePath}.`);
  }

  const downloadOptions = resolveDownloadFileOptions(options);
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.download-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`;

  try {
    await downloadToPath(url, tempPath, filePath, downloadOptions);
    renameSync(tempPath, filePath);
    return { filePath };
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

async function downloadToPath(
  url: string,
  tempPath: string,
  targetPath: string,
  options: ResolvedDownloadFileOptions,
  redirectsRemaining = 5
): Promise<void> {
  const response = await requestResponse(url, options.timeoutMs);
  const statusCode = response.statusCode ?? 0;

  if (isRedirect(statusCode)) {
    response.resume();
    if (redirectsRemaining <= 0) {
      throw new Error(`Too many redirects downloading ${url}.`);
    }

    const location = response.headers.location;
    if (!location) {
      throw new Error(`Redirect response missing location for ${url}.`);
    }

    const redirectUrl = new URL(location, url).toString();
    return downloadToPath(redirectUrl, tempPath, targetPath, options, redirectsRemaining - 1);
  }

  if (statusCode >= 400) {
    response.resume();
    throw new Error(`Failed to download ${url}: ${statusCode}`);
  }

  if (!options.process) {
    await pipeline(response, createWriteStream(tempPath));
    return;
  }

  const totalBytes = getContentLength(response);
  const state = { downloadedBytes: 0 };
  try {
    emitProgress(options.process, url, targetPath, state.downloadedBytes, totalBytes);
  } catch (error) {
    response.destroy();
    throw error;
  }
  await pipeline(
    response,
    createProgressTransform(url, targetPath, totalBytes, state, options.process),
    createWriteStream(tempPath)
  );
}

function requestResponse(url: string, timeoutMs: number): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      reject(new Error(`Invalid download URL: ${url}`));
      return;
    }

    const client = parsedUrl.protocol === "https:"
      ? request
      : parsedUrl.protocol === "http:"
        ? httpRequest
        : undefined;

    if (!client) {
      reject(new Error(`Unsupported download URL protocol: ${parsedUrl.protocol}`));
      return;
    }

    const requestObj = client(parsedUrl, resolve);
    requestObj.on("error", reject);
    requestObj.setTimeout(timeoutMs, () => {
      requestObj.destroy(new Error(`Timeout downloading ${url}`));
    });
    requestObj.end();
  });
}

function isRedirect(statusCode: number): boolean {
  return statusCode === 301 || statusCode === 302 || statusCode === 303 || statusCode === 307 || statusCode === 308;
}

function resolveDownloadFileOptions(options?: number | DownloadFileOptions): ResolvedDownloadFileOptions {
  if (typeof options === "number") {
    return { timeoutMs: options };
  }

  const resolved: ResolvedDownloadFileOptions = {
    timeoutMs: options?.timeoutMs ?? 30000,
  };
  if (options?.process) {
    resolved.process = options.process;
  }
  return resolved;
}

function createProgressTransform(
  url: string,
  filePath: string,
  totalBytes: number | undefined,
  state: { downloadedBytes: number },
  processCallback: DownloadProcessCallback
): Transform {
  return new Transform({
    transform(chunk, _encoding, callback) {
      state.downloadedBytes += getChunkLength(chunk);
      try {
        emitProgress(processCallback, url, filePath, state.downloadedBytes, totalBytes);
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      callback(null, chunk);
    },
  });
}

function emitProgress(
  processCallback: DownloadProcessCallback,
  url: string,
  filePath: string,
  downloadedBytes: number,
  totalBytes: number | undefined
): void {
  processCallback(createDownloadProgress(url, filePath, downloadedBytes, totalBytes));
}

function createDownloadProgress(
  url: string,
  filePath: string,
  downloadedBytes: number,
  totalBytes: number | undefined
): DownloadProgress {
  const progress: DownloadProgress = {
    url,
    filePath,
    downloadedBytes,
  };

  if (totalBytes !== undefined) {
    progress.totalBytes = totalBytes;
    progress.progress = totalBytes === 0 ? 1 : Math.min(downloadedBytes / totalBytes, 1);
  }

  return progress;
}

function getContentLength(response: IncomingMessage): number | undefined {
  const header = response.headers["content-length"];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function getChunkLength(chunk: unknown): number {
  if (typeof chunk === "string") {
    return Buffer.byteLength(chunk);
  }

  if (chunk instanceof Uint8Array) {
    return chunk.byteLength;
  }

  return 0;
}

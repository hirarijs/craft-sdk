import { createWriteStream, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { request } from "node:https";
import { request as httpRequest } from "node:http";
import { pipeline } from "node:stream/promises";
import type { IncomingMessage } from "node:http";

export interface DownloadResult {
  filePath: string;
}

export async function downloadFile(url: string, filePath: string, timeoutMs = 30000): Promise<DownloadResult> {
  if (!url) {
    throw new Error(`Download URL is empty for ${filePath}.`);
  }

  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.download-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`;

  try {
    await downloadToPath(url, tempPath, timeoutMs);
    renameSync(tempPath, filePath);
    return { filePath };
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

async function downloadToPath(url: string, filePath: string, timeoutMs: number, redirectsRemaining = 5): Promise<void> {
  const response = await requestResponse(url, timeoutMs);
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
    return downloadToPath(redirectUrl, filePath, timeoutMs, redirectsRemaining - 1);
  }

  if (statusCode >= 400) {
    response.resume();
    throw new Error(`Failed to download ${url}: ${statusCode}`);
  }

  await pipeline(response, createWriteStream(filePath));
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

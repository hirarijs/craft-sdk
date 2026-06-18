import { createWriteStream } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { request } from "node:https";
import { request as httpRequest } from "node:http";

export interface DownloadResult {
  filePath: string;
}

function createFileStream(filePath: string) {
  mkdirSync(dirname(filePath), { recursive: true });
  return createWriteStream(filePath);
}

export async function downloadFile(url: string, filePath: string, timeoutMs = 30000): Promise<DownloadResult> {
  const stream = createFileStream(filePath);

  return new Promise((resolve, reject) => {
    const client = url.startsWith("https://") ? request : httpRequest;
    const requestObj = client(url, (response) => {
      if (response.statusCode && response.statusCode >= 400) {
        stream.destroy();
        reject(new Error(`Failed to download ${url}: ${response.statusCode}`));
        return;
      }

      response.pipe(stream);
    });

    stream.on("finish", () => resolve({ filePath }));
    stream.on("error", reject);
    requestObj.on("error", reject);
    requestObj.setTimeout(timeoutMs, () => {
      requestObj.destroy(new Error(`Timeout downloading ${url}`));
    });
    requestObj.end();
  });
}

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

export function pathExists(path: string): boolean {
  return existsSync(path);
}

export function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

export function readJson<T>(path: string): T {
  const text = readFileSync(path, "utf8");
  return JSON.parse(text) as T;
}

export function writeJson(path: string, data: unknown): void {
  const json = JSON.stringify(data, null, 2);
  writeFileSync(path, json, "utf8");
}

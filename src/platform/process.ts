import { spawn } from "node:child_process";
import { Writable } from "node:stream";

export interface ProcessRunOptions {
  javaExecutable: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  stdout?: Writable;
  stderr?: Writable;
}

export function runJavaProcess(options: ProcessRunOptions): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(options.javaExecutable, options.args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (options.stdout) {
      child.stdout.pipe(options.stdout);
    } else {
      child.stdout.on("data", (chunk) => process.stdout.write(chunk));
    }

    if (options.stderr) {
      child.stderr.pipe(options.stderr);
    } else {
      child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    }

    child.on("close", (code) => resolve(code ?? 0));
    child.on("error", (error) => reject(error));
  });
}

import { CraftSDK, API_SOURCE } from "../index.js";
import { findJavaExecutable } from "../platform/java.js";
import type { GameLoaderType, InstallGameOptions, LaunchGameOptions } from "../sdk.js";
import type { DownloadProgress } from "../utils/downloader.js";
import path from "path";
import cliProgress from "cli-progress";

export type TestName = "vanilla" | "fabric" | "forge";

export interface LaunchTestConfig {
  name: TestName;
  loader: GameLoaderType;
  loaderVersion?: string;
}

const DEFAULT_VERSION = "1.20.1";
const DEFAULT_GAME_DIRECTORY = ".minecraft";

// 进度条管理类：预分配固定可见槽位，循环重用，底部保留一个总进度条
class ProgressBarManager {
  private slots: Array<{ key: string | null; bar: cliProgress.SingleBar; total: number; downloaded: number }> = [];
  private slotCapacity: number;
  private multiBar: cliProgress.MultiBar;
  private overallIndex: number; // overall bar is the last created bar
  private stats: Map<string, { total: number; downloaded: number }> = new Map();
  // 段统计：key -> { total, downloaded }
  private segmentStats: Map<string, { total: number; downloaded: number }> = new Map();
  private segmentWeights: Record<string, number>;

  constructor() {
    const rows = process.stdout && (process.stdout as any).rows ? (process.stdout as any).rows : 20;
    // 保留 3 行用于信息、总进度条等，至少保留 1 个文件槽
    this.slotCapacity = Math.max(1, rows - 3);

    this.multiBar = new cliProgress.MultiBar(
      {
        clearOnComplete: false,
        hideCursor: true,
        format: "{filename} | {bar} | {percentage}% | {value}/{total} bytes",
        barCompleteChar: "█",
        barIncompleteChar: "░",
      },
      cliProgress.Presets.shades_grey
    );

    // 预创建固定数量的槽位（文件进度条）
    for (let i = 0; i < this.slotCapacity; i++) {
      const bar = this.multiBar.create(100, 0, { filename: "" });
      this.slots.push({ key: null, bar, total: 100, downloaded: 0 });
    }

    // 创建总体进度条，始终位于底部
    const overallBar = this.multiBar.create(100, 0, { filename: "TOTAL" });
    this.slots.push({ key: "__overall__", bar: overallBar, total: 100, downloaded: 0 });
    this.overallIndex = this.slots.length - 1;

    // 默认分段权重（可按需调整）：version/client/libraries/assets/others
    this.segmentWeights = {
      version: 0.02,
      client: 0.10,
      libraries: 0.38,
      assets: 0.50,
      others: 0.0,
    };
  }

  handleProgress(progress: DownloadProgress): void {
    const key = progress.filePath;
    const total = progress.totalBytes ?? 0;
    const downloaded = progress.downloadedBytes;

    // 更新统计数据
    this.stats.set(key, { total, downloaded });

    // 更新分段统计
    const seg = this.detectSegment(key);
    const prev = this.segmentStats.get(seg) ?? { total: 0, downloaded: 0 };
    // 以文件级别累加，避免覆盖已有段总量（保留最大观测值）
    prev.total = Math.max(prev.total, total);
    prev.downloaded = prev.downloaded - (this.stats.get(key)?.downloaded ?? 0) + downloaded;
    // 上面 line adjusts downloaded relative to previous stored per-file state; simpler: recompute segment sums below
    this.segmentStats.set(seg, prev);

    // 先尝试找到已分配的槽位
    const existingSlot = this.slots.find((s, idx) => s.key === key && idx !== this.overallIndex);
    if (existingSlot) {
      existingSlot.total = total > 0 ? total : existingSlot.total;
      existingSlot.downloaded = downloaded;
      existingSlot.bar.setTotal(existingSlot.total > 0 ? existingSlot.total : 100);
      existingSlot.bar.update(existingSlot.downloaded, { filename: path.basename(key) });
    } else {
      // 找到一个空槽或选择最久未更新的槽来重用（不包含 overall）
      let slot = this.slots.find((s, idx) => idx !== this.overallIndex && s.key === null);
      if (!slot) {
        // 简单策略：重用第一个槽（可以改为 LRU）
        slot = this.slots.find((s, idx) => idx !== this.overallIndex) as typeof this.slots[0];
      }

      if (slot) {
        slot.key = key;
        slot.total = total > 0 ? total : 100;
        slot.downloaded = downloaded;
        slot.bar.setTotal(slot.total);
        slot.bar.update(slot.downloaded, { filename: path.basename(key).length > 30 ? path.basename(key).substring(0, 27) + "..." : path.basename(key) });
      }
    }

    this.updateOverall();
  }

  private updateOverall() {
    // 采用分段加权策略计算总体进度，避免总量随文件列表动态扩展而波动
    let weightSum = 0;
    let weightedPercent = 0;

    // 先重算每个分段的累计总量和已下载量（基于 this.stats）
    const segAcc: Map<string, { total: number; downloaded: number }> = new Map();
    for (const [file, val] of this.stats.entries()) {
      const seg = this.detectSegment(file);
      const cur = segAcc.get(seg) ?? { total: 0, downloaded: 0 };
      cur.total += val.total ?? 0;
      cur.downloaded += val.downloaded ?? 0;
      segAcc.set(seg, cur);
    }

    for (const [seg, w] of Object.entries(this.segmentWeights)) {
      const cur = segAcc.get(seg) ?? { total: 0, downloaded: 0 };
      let percent = 0;
      if (cur.total > 0) {
        percent = Math.min(1, cur.downloaded / cur.total);
      } else {
        // 如果该分段尚无已知总大小，则按已下载文件数量来估算（较保守）
        // 这里设为 0（不计入总体），或者可改为按文件计数估算
        percent = 0;
      }
      weightedPercent += percent * w;
      weightSum += w;
    }

    const overallPercent = weightSum > 0 ? weightedPercent / weightSum : 0;
    const overallSlot = this.slots[this.overallIndex]!;
    overallSlot.bar.setTotal(100);
    overallSlot.bar.update(Math.round(overallPercent * 100), { filename: "TOTAL" });
  }

  private detectSegment(filePath: string): string {
    const p = filePath.replace(/\\/g, "/");
    if (p.includes("version_manifest") || p.includes("/versions/")) return "version";
    if (p.includes("/libraries/")) return "libraries";
    if (p.includes("/assets/") || p.includes("/objects/") || p.includes("indexes")) return "assets";
    if (p.endsWith(".jar") && p.includes("/versions/")) return "client";
    return "others";
  }

  stop(): void {
    this.multiBar.stop();
  }
}

function getVersion(): string {
  return process.env.MC_VERSION ?? DEFAULT_VERSION;
}

function getGameDirectory(): string {
  return process.env.MC_GAME_DIR ?? DEFAULT_GAME_DIRECTORY;
}

function getRuntimeDirectory(): string | undefined {
  // return process.env.MC_RUNTIME_DIR;
  return path.join(process.cwd(), ".minecraft/test-runtime");
}

function getAssetsDirectory(): string | undefined {
  return process.env.MC_ASSETS_DIR;
}

function getLibrariesDirectory(): string | undefined {
  return process.env.MC_LIBRARIES_DIR;
}

function getVersionsDirectory(): string | undefined {
  return process.env.MC_VERSIONS_DIR;
}

function getModsDirectory(): string | undefined {
  return process.env.MC_MODS_DIR;
}

function getPlayerName(): string {
  return process.env.MC_PROFILE_NAME ?? "TestPlayer";
}

function buildAuthOptions() {
  return {
    accessToken: process.env.MC_ACCESS_TOKEN ?? "test-access-token-12345",
    clientToken: process.env.MC_CLIENT_TOKEN ?? "test-client-token-12345",
    profileId: process.env.MC_PROFILE_ID ?? "test-profile-id-12345",
    profileName: getPlayerName(),
  };
}

export async function runLaunchTest(config: LaunchTestConfig): Promise<number> {
  console.log(`Craft SDK test: ${config.name}`);
  console.log(`Minecraft version: ${getVersion()}`);
  console.log(`Game directory: ${getGameDirectory()}`);
  const runtimeDirectory = getRuntimeDirectory();
  const assetsDirectory = getAssetsDirectory();
  const librariesDirectory = getLibrariesDirectory();
  const versionsDirectory = getVersionsDirectory();
  const modsDirectory = getModsDirectory();
  if (runtimeDirectory) console.log(`Runtime directory: ${runtimeDirectory}`);
  if (assetsDirectory) console.log(`Assets directory: ${assetsDirectory}`);
  if (librariesDirectory) console.log(`Libraries directory: ${librariesDirectory}`);
  if (versionsDirectory) console.log(`Versions directory: ${versionsDirectory}`);
  if (modsDirectory) console.log(`Mods directory: ${modsDirectory}`);

  const javaPath = findJavaExecutable();
  if (!javaPath) {
    throw new Error("Java executable not found. Install Java and make it available on PATH.");
  }
  console.log(`Java: ${javaPath}`);

  // 创建进度条管理器
  const progressManager = new ProgressBarManager();

  const sdk = new CraftSDK({
    apiSource: API_SOURCE.MOJANG,
    sessionFile: "./craft-sdk-session.json",
    timeoutMs: 120000,
    process: (progress) => progressManager.handleProgress(progress),
  });

  const auth = buildAuthOptions();
  await sdk.auth.loginWithToken(auth.accessToken, auth.clientToken, auth.profileId, auth.profileName);

  const installOptions: InstallGameOptions = {
    version: getVersion(),
    gameDirectory: getGameDirectory(),
    loader: config.loader,
    javaPath,
    ...(runtimeDirectory ? { runtimeDirectory } : {}),
    ...(assetsDirectory ? { assetsDirectory } : {}),
    ...(librariesDirectory ? { librariesDirectory } : {}),
    ...(versionsDirectory ? { versionDirectory: versionsDirectory } : {}),
    ...(modsDirectory ? { modsDirectory } : {}),
  };
  if (config.loaderVersion) {
    installOptions.loaderVersion = config.loaderVersion;
  }

  const installed = await sdk.installGame(installOptions);

  const launchOptions: LaunchGameOptions = {
    metadata: installed.metadata,
    gameDirectory: installed.gameDirectory,
    assetsDirectory: installed.assetsDirectory,
    librariesDirectory: installed.librariesDirectory,
    versionDirectory: installed.versionDirectory,
    clientJarPath: installed.clientJarPath,
    javaPath,
    loader: config.loader,
    memory: { min: "512M", max: "2G" },
    jvmArgs: ["-XX:+UseG1GC", "-XX:+UnlockExperimentalVMOptions"],
    ...auth,
  };

  const exitCode = await sdk.launchGame(launchOptions);
  console.log(`Game exited with code: ${exitCode}`);
  progressManager.stop();
  return exitCode;
}

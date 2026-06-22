import { AuthManager, type AuthOptions, type MicrosoftDeviceCodeLoginOptions } from "./auth.js";
import { Downloader, type DownloaderOptions } from "./downloader.js";
import { Installer, type InstallerOptions } from "./installer.js";
import { GameLauncher } from "./launcher.js";
import { resolve } from "node:path";
import { API_SOURCE, type ApiSource } from "./constant.js";
import type { LaunchOptions } from "./models/options.js";
import type { AuthSession } from "./models/profile.js";
import type { VersionMetadata } from "./models/version.js";
import type { DownloadProcessCallback, DownloadProcessOptions } from "./utils/downloader.js";

/** CraftSDK 初始化选项 */
export interface CraftSdkOptions extends DownloadProcessOptions {
  /**
   * API 来源。
   * - `API_SOURCE.MOJANG`（默认）：使用 Mojang 官方服务器，国内访问可能较慢。
   * - `API_SOURCE.BMCLAPI`：使用 BMCLAPI 镜像，国内加速，但需遵守其使用条款。
   */
  apiSource?: ApiSource;
  /**
   * 单个 HTTP 请求的超时时间（毫秒）。
   * 适用于版本清单、资源、库文件等所有下载请求。
   * @default 30000
   */
  timeoutMs?: number;
  /**
   * 会话文件路径，用于持久化保存登录凭据（accessToken 等）。
   * 每次成功登录后会自动写入，下次启动时自动读取以避免重复登录。
   * @default "craft-sdk-session.json"
   */
  sessionFile?: string;
  /**
   * Microsoft OAuth 登录的默认配置，供 `loginWithMicrosoftDeviceCode` 等方法使用。
   * 也可在调用各认证方法时单独传入覆盖。
   */
  microsoftAuth?: MicrosoftDeviceCodeLoginOptions;
}

/**
 * 游戏加载器类型。
 * - `"vanilla"`：原版，无任何 mod 支持。
 * - `"fabric"`：Fabric，轻量、现代的 mod 框架。
 * - `"quilt"`：Quilt，Fabric 的分支，功能更多。
 * - `"forge"`：Forge，历史最久的 mod 框架，兼容性广。
 */
export type GameLoaderType = "vanilla" | "forge" | "fabric" | "quilt";

/**
 * 自定义目录选项，所有字段均为可选。
 * 未指定时，对应目录默认位于 `gameDirectory` 下的标准位置。
 */
export interface GameDirectoryOptions {
  /**
   * 游戏运行时目录（存档、截图、配置、日志等所在目录）。
   * 与安装目录（`gameDirectory`）分离，可实现"一套安装、多套存档"。
   * 未设置时与 `gameDirectory` 相同。
   * @example "D:/mc-saves/survival"
   */
  runtimeDirectory?: string;
  /**
   * 版本文件目录（`version.json` 和客户端 jar 所在目录）。
   * 默认为 `<gameDirectory>/versions/<versionId>/`。
   * @example "D:/mc-shared/versions"
   */
  versionDirectory?: string;
  /**
   * 加载器版本文件目录（Fabric/Quilt/Forge 的版本 JSON 所在目录）。
   * 默认与 `versionDirectory` 相同。
   * @example "D:/mc-shared/versions/fabric"
   */
  loaderVersionDirectory?: string;
  /**
   * 资源文件目录（`indexes/` 和 `objects/` 所在目录）。
   * 多个实例可共用同一资源目录节省磁盘空间。
   * 默认为 `<gameDirectory>/assets/`。
   * @example "D:/mc-shared/assets"
   */
  assetsDirectory?: string;
  /**
   * 库文件目录（Java 库 `.jar` 和原生库所在目录）。
   * 多个实例可共用同一库目录。
   * 默认为 `<gameDirectory>/libraries/`。
   * @example "D:/mc-shared/libraries"
   */
  librariesDirectory?: string;
  /**
   * 模组文件目录（`.jar` 模组的存放目录）。
   * 默认为 `<runtimeDirectory>/mods/`。
   * @example "D:/mc-saves/survival/mods"
   */
  modsDirectory?: string;
}

/**
 * 游戏身份验证选项，可选择令牌登录或 Microsoft 登录两种方式。
 *
 * **令牌登录**（离线或已获得令牌时使用）：同时提供 `accessToken`、`clientToken`、`profileId`、`profileName`。
 *
 * **Microsoft 登录**：提供 `microsoftAuth`，使用设备码流程完成 OAuth 授权。
 *
 * 若两者都不提供，则尝试读取 sessionFile 中已保存的会话。
 */
export interface GameAuthOptions {
  /**
   * Minecraft 访问令牌。
   * 可从正版启动器、第三方登录服务或 Minecraft Services API 获取。
   */
  accessToken?: string;
  /**
   * 客户端标识令牌，作为此启动器实例的唯一标识。
   * 与 `accessToken` 配套使用，可自行生成 UUID。
   */
  clientToken?: string;
  /**
   * 玩家 UUID（不含连字符的 32 位十六进制字符串）。
   * 离线模式可使用任意 UUID，正版模式须与账号一致。
   */
  profileId?: string;
  /**
   * 玩家显示名称（游戏内用户名）。
   */
  profileName?: string;
  /**
   * Microsoft OAuth 登录配置，用于设备码授权流程。
   * 设置此项后，若没有有效会话，会自动发起 Microsoft 登录。
   */
  microsoftAuth?: MicrosoftDeviceCodeLoginOptions;
}

/** 游戏运行时参数选项 */
export interface GameRuntimeOptions {
  /**
   * JVM 内存配置。
   * @example { min: "512M", max: "4G" }
   */
  memory?: {
    /** 最小堆内存，对应 JVM 的 `-Xms` 参数，如 `"512M"`、`"1G"`。 */
    min?: string;
    /** 最大堆内存，对应 JVM 的 `-Xmx` 参数，如 `"2G"`、`"4096M"`。 */
    max?: string;
  };
  /**
   * 额外的 JVM 参数，追加在版本元数据 JVM 参数之前。
   * @example ["-XX:+UseG1GC", "-XX:+UnlockExperimentalVMOptions", "-Dfml.ignoreInvalidMinecraftCertificates=true"]
   */
  jvmArgs?: string[];
  /**
   * 额外的 Minecraft 游戏参数，追加在版本元数据游戏参数之后。
   * @example ["--fullscreen", "--server", "mc.example.com"]
   */
  gameArgs?: string[];
  /**
   * Java 可执行文件的绝对路径。
   * 未设置时自动从 PATH 中查找。
   * @example "C:/Program Files/Java/jdk-21/bin/java.exe"
   */
  javaPath?: string;
  /**
   * 传递给 Java 进程的额外环境变量。
   * @example { "JAVA_TOOL_OPTIONS": "-Dfile.encoding=UTF-8" }
   */
  extraEnvironment?: Record<string, string>;
}

/** `installGame` 方法的选项 */
export interface InstallGameOptions extends DownloadProcessOptions, GameDirectoryOptions {
  /**
   * 要安装的 Minecraft 版本号，如 `"1.20.1"`、`"1.21.4"`。
   * 必须是版本清单中存在的版本 ID。
   */
  version: string;
  /**
   * 游戏安装根目录（`.minecraft` 所对应的目录）。
   * 版本文件、资源、库等默认均安装在此目录下。
   */
  gameDirectory: string;
  /**
   * 要安装的加载器类型。
   * @default "vanilla"
   */
  loader?: GameLoaderType;
  /**
   * 加载器版本号。
   * - Fabric：如 `"0.16.14"`
   * - Quilt：如 `"0.27.1"`
   * - Forge：如 `"47.4.0"` 或 `"1.20.1-47.4.0"`
   *
   * 未设置时自动查询并使用最新稳定版。
   */
  loaderVersion?: string;
  /**
   * Java 可执行文件路径，仅在安装 Forge 时需要（用于运行 Forge 安装器）。
   * 未设置时自动从 PATH 查找。
   */
  javaPath?: string;
  /**
   * 安装完成后是否验证文件完整性（SHA1 校验）。
   * @default true
   */
  validate?: boolean;
  /**
   * 需要安装的模组列表。
   * 会自动下载并放入 `modsDirectory`。
   */
  mods?: Array<{
    /** 模组唯一标识 */
    id: string;
    /** 模组显示名称 */
    name: string;
    /** 模组版本 */
    version: string;
    /** 模组 jar 的下载 URL */
    sourceUrl: string;
    /** 保存的文件名，默认为 `<id>-<version>.jar` */
    fileName?: string;
    /** 模组适用的加载器，默认继承 `loader` 字段 */
    loader?: string;
  }>;
}

/** `installGame` 的返回值，包含已安装游戏的所有路径信息 */
export interface InstalledGame {
  /** 完整的版本元数据（从 version.json 解析） */
  metadata: VersionMetadata;
  /** 实际使用的加载器类型 */
  loader: GameLoaderType;
  /** 游戏安装根目录（绝对路径） */
  baseDirectory: string;
  /**
   * 游戏运行时目录（绝对路径）。
   * 存档、截图、配置等均在此目录下。
   * 若未设置 `runtimeDirectory`，与 `baseDirectory` 相同。
   */
  gameDirectory: string;
  /** 资源文件根目录（绝对路径），传给 `launchGame` 的 `assetsDirectory` */
  assetsDirectory: string;
  /** 库文件根目录（绝对路径），传给 `launchGame` 的 `librariesDirectory` */
  librariesDirectory: string;
  /**
   * 版本文件目录（绝对路径），传给 `launchGame` 的 `versionDirectory`。
   * Fabric/Quilt/Forge 安装时，此目录指向加载器版本目录。
   */
  versionDirectory: string;
  /** 客户端 jar 的绝对路径，传给 `launchGame` 的 `clientJarPath` */
  clientJarPath: string;
}

/** `launchGame` 方法的选项，通常从 `InstalledGame` 解构后补充认证和运行时参数 */
export interface LaunchGameOptions extends GameAuthOptions, GameRuntimeOptions {
  /** 版本元数据，来自 `installedGame.metadata` */
  metadata: VersionMetadata;
  /**
   * 游戏运行时目录（存档、截图、配置等所在目录）。
   * 来自 `installedGame.gameDirectory`。
   */
  gameDirectory: string;
  /**
   * 资源文件根目录。
   * 来自 `installedGame.assetsDirectory`。
   */
  assetsDirectory: string;
  /**
   * 库文件根目录。
   * 来自 `installedGame.librariesDirectory`。
   */
  librariesDirectory: string;
  /**
   * 版本文件目录（含 version.json）。
   * 来自 `installedGame.versionDirectory`。
   */
  versionDirectory: string;
  /**
   * 客户端 jar 路径。
   * 来自 `installedGame.clientJarPath`，留空时从 `versionDirectory` 自动推断。
   */
  clientJarPath?: string;
  /**
   * 原生库目录（存放 `.dll`/`.so`/`.dylib`）。
   * 默认为 `<gameDirectory>/natives/<versionId>/`。
   */
  nativesDirectory?: string;
  /** 加载器类型，影响 JVM 参数的组装方式 */
  loader?: GameLoaderType;
}

/** `playGame` 方法的选项，等同于 `InstallGameOptions` + `GameAuthOptions` + `GameRuntimeOptions` 的合集 */
export interface PlayGameOptions extends InstallGameOptions, GameAuthOptions, GameRuntimeOptions {
  /** 原生库目录，默认为 `<gameDirectory>/natives/<versionId>/` */
  nativesDirectory?: string;
}

/**
 * Craft SDK 主类，整合身份验证、安装和启动功能。
 *
 * @example
 * ```ts
 * const sdk = new CraftSDK({ apiSource: API_SOURCE.BMCLAPI });
 * const installed = await sdk.installGame({ version: "1.20.1", gameDirectory: ".minecraft", loader: "fabric" });
 * await sdk.launchGame({ ...installed, accessToken: "...", clientToken: "...", profileId: "...", profileName: "Steve" });
 * ```
 */
export class CraftSDK {
  /** 身份验证管理器，提供 Microsoft 登录、令牌登录、会话管理等功能 */
  public auth: AuthManager;
  /** 文件下载器，提供带镜像切换和进度回调的下载功能 */
  public downloader: Downloader;
  /** 游戏安装器，负责版本文件、资源、库和加载器的下载与验证 */
  public installer: Installer;
  /** 游戏启动器，负责组装 JVM 参数并启动 Java 进程 */
  public launcher: GameLauncher;
  private microsoftAuth?: MicrosoftDeviceCodeLoginOptions;
  private process?: DownloadProcessCallback;

  constructor(options?: CraftSdkOptions) {
    const authOptions: AuthOptions = {};
    if (options?.sessionFile) authOptions.sessionFile = options.sessionFile;
    if (options?.microsoftAuth) authOptions.microsoftAuth = options.microsoftAuth;
    if (options?.microsoftAuth) this.microsoftAuth = options.microsoftAuth;
    if (options?.process) this.process = options.process;

    const sharedOptions: DownloaderOptions & InstallerOptions = {
      apiSource: options?.apiSource ?? API_SOURCE.MOJANG,
    };
    if (options?.timeoutMs) sharedOptions.timeoutMs = options.timeoutMs;
    if (options?.process) sharedOptions.process = options.process;

    this.auth = new AuthManager(authOptions);
    this.downloader = new Downloader(sharedOptions);
    this.installer = new Installer(sharedOptions);
    this.launcher = new GameLauncher();
  }

  /**
   * 下载并安装指定版本的 Minecraft（以及可选的加载器和模组）。
   *
   * 流程：
   * 1. 下载版本清单，找到目标版本的元数据 URL。
   * 2. 下载 `version.json`、客户端 jar、库文件、资源文件。
   * 3. 若指定了加载器，额外安装 Fabric/Quilt/Forge（Forge 需运行官方安装器）。
   * 4. 若指定了 `mods`，下载模组 jar 到 mods 目录。
   * 5. 若 `validate` 为 true（默认），对所有文件进行 SHA1 校验。
   *
   * @returns 包含所有已解析路径的 `InstalledGame` 对象，可直接传给 `launchGame`。
   */
  async installGame(options: InstallGameOptions): Promise<InstalledGame> {
    const baseDirectory = resolve(options.gameDirectory);
    const runtimeDirectory = this.resolveOptionalPath(options.runtimeDirectory) ?? baseDirectory;
    const loader = options.loader ?? "vanilla";
    const processCallback = options.process ?? this.process;
    const versionDirectory = this.resolveOptionalPath(options.versionDirectory);
    const loaderVersionDirectory = this.resolveOptionalPath(options.loaderVersionDirectory);
    const assetsDirectory = this.resolveOptionalPath(options.assetsDirectory);
    const librariesDirectory = this.resolveOptionalPath(options.librariesDirectory);

    const preparedVersion = loader === "vanilla"
      ? await this.installer.prepareVersion(options.version, baseDirectory, {
          ...(versionDirectory ? { versionDirectory } : {}),
          ...(assetsDirectory ? { assetsDirectory } : {}),
          ...(librariesDirectory ? { librariesDirectory } : {}),
          ...(options.validate !== undefined ? { validate: options.validate } : {}),
          ...(processCallback ? { process: processCallback } : {}),
        })
      : await this.installer.installLoader({
          loader,
          minecraftVersion: options.version,
          baseDirectory,
          ...(options.loaderVersion ? { loaderVersion: options.loaderVersion } : {}),
          ...(versionDirectory ? { versionDirectory } : {}),
          ...(loaderVersionDirectory ? { loaderVersionDirectory } : {}),
          ...(assetsDirectory ? { assetsDirectory } : {}),
          ...(librariesDirectory ? { librariesDirectory } : {}),
          ...(options.validate !== undefined ? { validate: options.validate } : {}),
          ...(options.javaPath ? { javaPath: options.javaPath } : {}),
          ...(processCallback ? { process: processCallback } : {}),
        });

    if (options.mods && options.mods.length > 0) {
      const modPackages = options.mods.map((mod) => ({
        ...mod,
        loader: (mod.loader ?? loader) as "vanilla" | "forge" | "fabric" | "quilt",
      }));
      await this.installer.installMods({
        modPackages,
        installTarget: {
          gameDirectory: runtimeDirectory,
          loader,
          ...(options.modsDirectory ? { modsDirectory: resolve(options.modsDirectory) } : {}),
        },
        ...(processCallback ? { process: processCallback } : {}),
      });
    }

    return {
      metadata: preparedVersion.metadata,
      loader,
      baseDirectory,
      gameDirectory: runtimeDirectory,
      assetsDirectory: preparedVersion.assetsDirectory,
      librariesDirectory: preparedVersion.librariesDirectory,
      versionDirectory: preparedVersion.versionDirectory,
      clientJarPath: preparedVersion.clientJarPath,
    };
  }

  /**
   * 启动已安装的游戏。
   *
   * 通常与 `installGame` 配合使用：先 install 得到路径，再 launch。
   * 认证会话的解析顺序：
   * 1. 若同时传入 `accessToken`、`clientToken`、`profileId`、`profileName`，直接使用令牌登录。
   * 2. 否则读取 sessionFile 中已保存的会话；若会话已过期且有 `refreshToken`，自动刷新。
   * 3. 若仍无有效会话且设置了 `microsoftAuth`，发起 Microsoft 设备码登录。
   * 4. 以上均不满足则抛出错误。
   *
   * @returns Java 进程的退出码（正常退出为 `0`）。
   */
  async launchGame(options: LaunchGameOptions): Promise<number> {
    const session = await this.resolveSession(options);
    const launchOptions: LaunchOptions = {
      version: options.metadata.id,
      gameDirectory: resolve(options.gameDirectory),
      assetsDirectory: resolve(options.assetsDirectory),
      librariesDirectory: resolve(options.librariesDirectory),
      versionDirectory: resolve(options.versionDirectory),
      authSession: session,
      ...(options.clientJarPath ? { clientJarPath: resolve(options.clientJarPath) } : {}),
      ...(options.nativesDirectory ? { nativesDirectory: resolve(options.nativesDirectory) } : {}),
      ...(options.loader ? { loader: options.loader } : {}),
    };
    if (options.javaPath) launchOptions.javaPath = options.javaPath;
    if (options.memory) launchOptions.memory = options.memory;
    if (options.jvmArgs) launchOptions.jvmArgs = options.jvmArgs;
    if (options.gameArgs) launchOptions.gameArgs = options.gameArgs;
    if (options.extraEnvironment) launchOptions.extraEnvironment = options.extraEnvironment;

    return this.launcher.launch(launchOptions, options.metadata);
  }

  /**
   * 安装并立即启动游戏，等同于依次调用 `installGame` + `launchGame`。
   *
   * 适合只需一行代码完成整个流程的简单场景。
   * 更复杂的场景（如在安装和启动间插入自定义逻辑）建议分开调用。
   *
   * @returns Java 进程的退出码（正常退出为 `0`）。
   */
  async playGame(options: PlayGameOptions): Promise<number> {
    const installed = await this.installGame(options);
    return this.launchGame({
      metadata: installed.metadata,
      gameDirectory: installed.gameDirectory,
      assetsDirectory: installed.assetsDirectory,
      librariesDirectory: installed.librariesDirectory,
      versionDirectory: installed.versionDirectory,
      clientJarPath: installed.clientJarPath,
      loader: installed.loader,
      ...(options.nativesDirectory ? { nativesDirectory: options.nativesDirectory } : {}),
      ...(options.accessToken ? { accessToken: options.accessToken } : {}),
      ...(options.clientToken ? { clientToken: options.clientToken } : {}),
      ...(options.profileId ? { profileId: options.profileId } : {}),
      ...(options.profileName ? { profileName: options.profileName } : {}),
      ...(options.microsoftAuth ? { microsoftAuth: options.microsoftAuth } : {}),
      ...(options.javaPath ? { javaPath: options.javaPath } : {}),
      ...(options.memory ? { memory: options.memory } : {}),
      ...(options.jvmArgs ? { jvmArgs: options.jvmArgs } : {}),
      ...(options.gameArgs ? { gameArgs: options.gameArgs } : {}),
      ...(options.extraEnvironment ? { extraEnvironment: options.extraEnvironment } : {}),
    });
  }

  private async resolveSession(options: GameAuthOptions): Promise<AuthSession> {
    let session = this.auth.loadSession();
    const microsoftAuth = options.microsoftAuth ?? this.microsoftAuth;
    if (options.accessToken && options.clientToken && options.profileId && options.profileName) {
      session = await this.auth.loginWithToken(
        options.accessToken,
        options.clientToken,
        options.profileId,
        options.profileName
      );
    }
    if (session && this.auth.isSessionExpired(session)) {
      if (session.refreshToken) {
        session = await this.auth.refreshMicrosoftSession(session, microsoftAuth);
      } else {
        session = undefined;
      }
    }
    if (!session && microsoftAuth) {
      session = await this.auth.loginWithMicrosoftDeviceCode(microsoftAuth);
    }
    if (!session) {
      throw new Error("No valid session found. Please provide authentication credentials.");
    }

    return session;
  }

  private resolveOptionalPath(path?: string): string | undefined {
    return path ? resolve(path) : undefined;
  }
}

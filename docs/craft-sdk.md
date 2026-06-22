# CraftSDK

`CraftSDK` 是推荐使用的高级入口。它组合了 `AuthManager`、`Downloader`、`Installer` 和 `GameLauncher`。

## 构造函数

```ts
new CraftSDK(options?: CraftSdkOptions)
```

### CraftSdkOptions

```ts
interface CraftSdkOptions {
  apiSource?: "mojang" | "bmclapi";
  timeoutMs?: number;
  sessionFile?: string;
  process?: DownloadProcessCallback;
}
```

- `apiSource`: API 来源，默认 `API_SOURCE.MOJANG`。
- `timeoutMs`: 下载超时时间，默认由各模块使用 `30000`。
- `sessionFile`: 认证会话文件路径，默认 `craft-sdk-session.json`。
- `process`: 默认下载进度回调，会透传给 `downloader` 和 `installer`。

## 属性

```ts
sdk.auth: AuthManager
sdk.downloader: Downloader
sdk.installer: Installer
sdk.launcher: GameLauncher
```

## playGame()

```ts
playGame(options: PlayGameOptions): Promise<number>
```

一站式流程：

1. 读取或写入认证会话。
2. 准备原版版本，或安装指定 loader 版本。
3. 安装传入的 mod。
4. 拼接启动参数并启动 Java 进程。
5. 返回游戏进程退出码。

### PlayGameOptions

```ts
interface PlayGameOptions {
  version: string;
  gameDirectory: string;
  loader?: "vanilla" | "forge" | "fabric" | "quilt";
  loaderVersion?: string;
  versionDirectory?: string;
  loaderVersionDirectory?: string;
  accessToken?: string;
  clientToken?: string;
  profileId?: string;
  profileName?: string;
  memory?: { min?: string; max?: string };
  jvmArgs?: string[];
  gameArgs?: string[];
  javaPath?: string;
  process?: DownloadProcessCallback;
  mods?: Array<{
    id: string;
    name: string;
    version: string;
    sourceUrl: string;
    fileName?: string;
    loader?: string;
  }>;
}
```

- `versionDirectory`: 自定义原版/基础版本目录。未传时使用 `<gameDirectory>/versions/<version>`。
- `loaderVersionDirectory`: 自定义 loader profile 目录。未传时使用 `<gameDirectory>/versions/<loader-version-id>`。

`process` 可覆盖构造器中的默认下载进度回调。回调参数结构：

```ts
type DownloadProcessCallback = (progress: {
  url: string;
  filePath: string;
  downloadedBytes: number;
  totalBytes?: number;
  progress?: number;
}) => void;
```

### 认证规则

如果同时传入 `accessToken`、`clientToken`、`profileId`、`profileName`，SDK 会调用 `loginWithToken()` 写入 session。

如果没有传入完整认证参数，SDK 会尝试从 `sessionFile` 读取 session。两者都没有时抛出错误：

```text
No valid session found. Please provide authentication credentials.
```

### Loader 规则

- `loader` 缺省为 `vanilla`。
- `fabric`、`forge`、`quilt` 会先调用 `installer.installLoader()`。
- `loaderVersion` 透传给对应 loader 安装逻辑。
- loader 版本启动时仍复用原版 client jar，通过 `clientJarPath` 显式传给 launcher。

# craft-sdk

A Node.js SDK for Minecraft launcher workflows with class-based architecture supporting multiple API sources.

## Features

- Account session storage and retrieval via `AuthManager`
- Minecraft version manifest and metadata download via `Downloader`
- Mod installation for Forge/Fabric/vanilla via `Installer`
- Platform-aware Java executable detection
- Game launch argument assembly and process spawning via `GameLauncher`
- Multi-source API support: Mojang official API or BMCLAPI mirror
- **One-step game launch workflow** via `sdk.playGame()`

## Installation

```bash
yarn install
```

## Quick Start

### One-step game launch (recommended)

```ts
import { CraftSDK } from "./src/index.js";

const sdk = new CraftSDK({ apiSource: "bmclapi" });

// Launch game with one method call
const exitCode = await sdk.playGame({
  version: "1.20.1",
  gameDirectory: ".minecraft",
  accessToken: "your-access-token",
  clientToken: "your-client-token",
  profileId: "your-profile-id",
  profileName: "YourPlayerName",
  memory: { min: "512M", max: "2G" },
  jvmArgs: ["-XX:+UseG1GC"],
  mods: [
    {
      id: "fabric-api",
      name: "Fabric API",
      version: "0.90.0",
      loader: "fabric",
      sourceUrl: "https://example.com/fabric-api.jar",
    },
  ],
});

console.log(`Game exited with code: ${exitCode}`);
```

### Step-by-step workflow

For more control, use individual modules:

```ts
import { CraftSDK, API_SOURCE } from "./src/index.js";

const sdk = new CraftSDK({ apiSource: API_SOURCE.BMCLAPI });

// 1. Authentication
await sdk.auth.loginWithToken(accessToken, clientToken, profileId, profileName);

// 2. Download version
const { metadata } = await sdk.installer.prepareVersion("1.20.1", ".minecraft");

// 3. Install mods
await sdk.installer.installMods({
  modPackages: [/* your mods */],
  installTarget: { gameDirectory: ".minecraft", loader: "fabric" },
});

// 4. Launch game
const exitCode = await sdk.launcher.launch(launchOptions, metadata);
```

### Microsoft sign-in

Register an application in Microsoft Entra ID / Azure portal, then pass the app `clientId` to the SDK. Device-code sign-in is the simplest flow for launchers because it does not require a local redirect server:

```ts
const sdk = new CraftSDK({
  microsoftAuth: {
    clientId: "your-microsoft-app-client-id",
    onVerification: ({ verificationUri, userCode, message }) => {
      console.log(message);
      console.log(`Open ${verificationUri} and enter ${userCode}`);
    },
  },
});

const session = await sdk.auth.loginWithMicrosoftDeviceCode();
console.log(session.selectedProfile?.name);
```

`loginWithMicrosoftDeviceCode()` automatically exchanges the Microsoft token through Xbox Live, XSTS, and Minecraft Services, then saves a launcher-ready session. `playGame()` can use the same `microsoftAuth` options when no saved session exists:

```ts
await sdk.playGame({
  version: "1.20.1",
  gameDirectory: ".minecraft",
  loader: "fabric",
});
```

For redirect-based apps, use:

```ts
const authUrl = sdk.auth.getMicrosoftAuthorizationUrl({
  clientId: "your-microsoft-app-client-id",
  redirectUri: "http://localhost:3000/callback",
  state: "csrf-token",
});

// After your app receives ?code=...
await sdk.auth.loginWithMicrosoftAuthorizationCode(code, {
  clientId: "your-microsoft-app-client-id",
  redirectUri: "http://localhost:3000/callback",
});
```

## API Reference

### CraftSDK Options

```ts
interface CraftSdkOptions {
  apiSource?: "mojang" | "bmclapi";  // Default: "mojang"
  timeoutMs?: number;                 // HTTP timeout
  sessionFile?: string;               // Session persistence path
  microsoftAuth?: MicrosoftDeviceCodeLoginOptions;
  process?: DownloadProcessCallback;  // Default download progress callback
}
```

### PlayGameOptions (for `sdk.playGame()`)

```ts
interface PlayGameOptions {
  version: string;                    // e.g., "1.20.1"
  gameDirectory: string;              // Game installation path
  loader?: "vanilla" | "forge" | "fabric" | "quilt";  // Default: "vanilla"
  versionDirectory?: string;          // Custom vanilla/base version directory
  loaderVersionDirectory?: string;    // Custom loader profile directory
  accessToken?: string;               // Auth token (or use saved session)
  clientToken?: string;
  profileId?: string;
  profileName?: string;
  memory?: { min?: string; max?: string };  // e.g., { min: "512M", max: "2G" }
  jvmArgs?: string[];                 // Additional JVM arguments
  gameArgs?: string[];                // Additional game arguments
  javaPath?: string;                  // Custom Java executable path
  microsoftAuth?: MicrosoftDeviceCodeLoginOptions;
  process?: DownloadProcessCallback;  // Per-launch download progress callback
  mods?: Array<{
    id: string;
    name: string;
    version: string;
    sourceUrl: string;
    fileName?: string;
    loader?: string;                  // Defaults to PlayGameOptions.loader
  }>;
}
```

### Custom version storage

By default, versions are stored under `<gameDirectory>/versions/<version-id>`. Pass `versionDirectory` to use an exact directory instead of deriving it from the version id.

```ts
await sdk.installer.prepareVersion("1.20.1", ".minecraft", {
  versionDirectory: "D:/minecraft-versions/my-1.20.1",
});
```

For loader installs, `versionDirectory` is used for the base Minecraft version and `loaderVersionDirectory` is used for the generated Fabric/Quilt/Forge profile.

```ts
await sdk.playGame({
  version: "1.20.1",
  gameDirectory: ".minecraft",
  loader: "fabric",
  versionDirectory: "D:/minecraft-versions/base-1.20.1",
  loaderVersionDirectory: "D:/minecraft-versions/fabric-profile",
});
```

### Download progress

Download APIs accept a `process` callback. `progress` is a `0..1` ratio when the server sends `Content-Length`; otherwise it is omitted.

```ts
type DownloadProcessCallback = (progress: {
  url: string;
  filePath: string;
  downloadedBytes: number;
  totalBytes?: number;
  progress?: number;
}) => void;

await sdk.playGame({
  version: "1.20.1",
  gameDirectory: ".minecraft",
  process: ({ filePath, progress }) => {
    if (progress !== undefined) {
      console.log(`${filePath}: ${Math.round(progress * 100)}%`);
    }
  },
});
```

## API Sources

- `API_SOURCE.MOJANG` (default): Official Minecraft launcher API
- `API_SOURCE.BMCLAPI`: BMCLAPI mirror (recommended for non-US regions)

## Testing

Run test samples:

```bash
yarn test vanilla
yarn test fabric
yarn test forge
```

`yarn test` defaults to the vanilla launch test. Use `yarn test all` to run vanilla, Fabric, and Forge in sequence.

Optional environment overrides:

```bash
MC_VERSION=1.20.1 yarn test fabric
FABRIC_LOADER_VERSION=0.16.14 yarn test fabric
FORGE_LOADER_VERSION=47.4.0 yarn test forge
MC_GAME_DIR=.minecraft yarn test vanilla
```

## Building

```bash
yarn build
```

## Architecture

- `AuthManager`: Session management and authentication
- `Downloader`: Version manifest and metadata fetching
- `Installer`: Library and mod installation with checksums
- `GameLauncher`: Argument assembly and process spawning
- `CraftSDK`: High-level orchestration with `playGame()` convenience method

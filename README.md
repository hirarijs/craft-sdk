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

## API Reference

### CraftSDK Options

```ts
interface CraftSdkOptions {
  apiSource?: "mojang" | "bmclapi";  // Default: "mojang"
  timeoutMs?: number;                 // HTTP timeout
  sessionFile?: string;               // Session persistence path
}
```

### PlayGameOptions (for `sdk.playGame()`)

```ts
interface PlayGameOptions {
  version: string;                    // e.g., "1.20.1"
  gameDirectory: string;              // Game installation path
  loader?: "vanilla" | "forge" | "fabric" | "quilt";  // Default: "vanilla"
  accessToken?: string;               // Auth token (or use saved session)
  clientToken?: string;
  profileId?: string;
  profileName?: string;
  memory?: { min?: string; max?: string };  // e.g., { min: "512M", max: "2G" }
  jvmArgs?: string[];                 // Additional JVM arguments
  gameArgs?: string[];                // Additional game arguments
  javaPath?: string;                  // Custom Java executable path
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

## API Sources

- `API_SOURCE.MOJANG` (default): Official Minecraft launcher API
- `API_SOURCE.BMCLAPI`: BMCLAPI mirror (recommended for non-US regions)

## Testing

Run test samples:

```bash
yarn test
```

The test file demonstrates both step-by-step and one-step workflows.

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

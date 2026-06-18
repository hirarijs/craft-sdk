# craft-sdk

A Node.js SDK for Minecraft launcher workflows with class-based architecture supporting multiple API sources.

## Features

- Account session storage and retrieval via `AuthManager`
- Minecraft version manifest and metadata download via `Downloader`
- Mod installation for Forge/Fabric/vanilla via `Installer`
- Platform-aware Java executable detection
- Game launch argument assembly and process spawning via `GameLauncher`
- Multi-source API support: Mojang official API or BMCLAPI mirror

## Installation

```bash
yarn install
```

## Quick Start

Import and construct the main SDK class:

```ts
import { CraftSDK, API_SOURCE } from "./src/index.js";

// Create SDK instance with default Mojang API
const sdk = new CraftSDK();

// Or use BMCLAPI mirror (useful for regions with poor Mojang connectivity)
const sdk = new CraftSDK({ apiSource: API_SOURCE.BMCLAPI });

// Access individual modules
await sdk.auth.loginWithToken(token);
const versionMetadata = await sdk.downloader.downloadVersionMetadataById(versionId);
await sdk.installer.installMods(modsDir, modList);
await sdk.launcher.launchGame(launchArguments);
```

## API Sources

The SDK supports multiple download sources via the `apiSource` option:

- `API_SOURCE.MOJANG` (default): Official Minecraft launcher API
- `API_SOURCE.BMCLAPI`: BMCLAPI mirror (recommended for non-US regions)

## SDK Constructor Options

```ts
interface CraftSdkOptions {
  apiSource?: "mojang" | "bmclapi";  // Default: "mojang"
  timeoutMs?: number;                 // HTTP request timeout in milliseconds
  sessionFile?: string;               // Path for persisting auth sessions
}
```

## Module Reference

- `sdk.auth`: `AuthManager` – session management
- `sdk.downloader`: `Downloader` – version manifests and metadata
- `sdk.installer`: `Installer` – mod installation
- `sdk.launcher`: `GameLauncher` – game launch process

## Testing

Run the test sample:

```bash
yarn test
```

The test file (`src/test.ts`) demonstrates class instantiation, session creation, platform detection, and Java discovery.

## Building

```bash
yarn build
```

Outputs TypeScript compilation to the configured output directory.

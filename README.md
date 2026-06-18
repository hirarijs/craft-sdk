# craft-sdk

A Node.js SDK for Minecraft launcher workflows.

## Features

- Account session storage and retrieval
- Minecraft version metadata download helper
- Mod installation helper for Forge/Fabric/vanilla mods
- Platform-aware Java executable detection
- Game launch argument assembly and process spawning

## Usage

Import the SDK from `src/index.ts` in your TypeScript project:

```ts
import { loginWithToken, launchGame, installMods } from "./src/index.js";
```

## Test Example

Run the test sample with:

```bash
yarn test
```

The test file is located at `src/test.ts` and demonstrates a session creation and launch invocation.

import { CraftSDK } from "./sdk.js";
import { API_SOURCE } from "./constant.js";
import { findJavaExecutable } from "./platform/java.js";

async function main() {
  console.log("🚀 Craft SDK - Minecraft 启动器\n");

  // 1. 检查 Java 环境
  console.log("检查 Java 环境...");
  const javaPath = findJavaExecutable();
  if (!javaPath) {
    console.error("❌ 未找到 Java 可执行文件");
    console.log("   请确保 Java 已安装并添加到 PATH");
    process.exit(1);
  }
  console.log(`✅ 找到 Java: ${javaPath}\n`);

  // 2. 初始化 SDK
  console.log("初始化 SDK...");
  const sdk = new CraftSDK({
    apiSource: API_SOURCE.MOJANG,
    sessionFile: "./craft-sdk-session.json",
  });
  console.log("✅ SDK 已初始化 (使用 Mojang API)\n");

  // 3. 认证
  console.log("认证处理...");
  const session = await sdk.auth.loginWithToken(
    "test-access-token-12345",
    "test-client-token-12345",
    "test-profile-id-12345",
    "TestPlayer"
  );
  console.log(`✅ 已登录: ${session.selectedProfile?.name}\n`);

  // 4. 准备游戏目录
  const gameDirectory = ".minecraft";
  console.log(`准备游戏目录: ${gameDirectory}`);
  console.log("⚠️  注意: 需要下载游戏文件（首次运行会花费一些时间）\n");

  // 5. 尝试启动游戏
  try {
    console.log("🎮 启动游戏...\n");
    const exitCode = await sdk.playGame({
      version: "1.20.1",
      gameDirectory,
      javaPath,
      memory: { min: "512M", max: "2G" },
      jvmArgs: ["-XX:+UseG1GC", "-XX:+UnlockExperimentalVMOptions"],
      loader: "vanilla",
      accessToken: "test-access-token-12345",
      clientToken: "test-client-token-12345",
      profileId: "test-profile-id-12345",
      profileName: "TestPlayer",
    });

    console.log(`\n✅ 游戏已退出 (代码: ${exitCode})`);
    process.exit(exitCode ?? 0);
  } catch (error) {
    const message = (error as Error).message;
    console.error(`\n❌ 启动失败: ${message}`);

    // 显示诊断信息
    if (message.includes("Java executable not found")) {
      console.log("\n💡 诊断:");
      console.log("   - Java 可执行文件未找到");
      console.log("   - 请检查 Java 安装");
    } else if (message.includes("Version")) {
      console.log("\n💡 诊断:");
      console.log("   - 版本信息下载失败");
      console.log("   - 检查网络连接或 API 可用性");
    } else if (message.includes("Unexpected end of JSON")) {
      console.log("\n💡 诊断:");
      console.log("   - 版本清单缓存无效");
      console.log("   - 正在重新下载...");
    }

    process.exit(1);
  }
}

main().catch((error) => {
  console.error("💥 致命错误:", error);
  process.exit(1);
});
import { writeJson, readJson, pathExists } from "./utils/fs.js";
import type { AuthSession, UserProfile } from "./models/profile.js";

const DEFAULT_MICROSOFT_TENANT = "consumers";
const DEFAULT_MICROSOFT_SCOPES = ["XboxLive.signin", "offline_access"];
const MINECRAFT_SERVICES_BASE = "https://api.minecraftservices.com";

/** `AuthManager` 构造函数选项 */
export interface AuthOptions {
  /**
   * 会话文件路径，用于持久化保存 `AuthSession`。
   * 每次登录成功后自动写入，下次初始化时自动加载。
   * @default "craft-sdk-session.json"
   */
  sessionFile?: string;
  /** Microsoft OAuth 默认配置，可在各方法调用时覆盖 */
  microsoftAuth?: MicrosoftAuthOptions;
}

/** Microsoft OAuth 应用配置 */
export interface MicrosoftAuthOptions {
  /**
   * Azure 应用的客户端 ID（也称 Application ID）。
   * 在 Azure 门户 → 应用注册中获取。必填。
   */
  clientId?: string;
  /**
   * Azure 租户 ID，用于限制可登录的账号范围。
   * @default "consumers"（允许所有个人 Microsoft 账号）
   */
  tenantId?: string;
  /**
   * OAuth 授权码流程的重定向 URI，需与 Azure 应用注册中一致。
   * 设备码流程不需要此字段。
   */
  redirectUri?: string;
  /**
   * 机密客户端应用的客户端密钥（Client Secret）。
   * 公共客户端（桌面/移动应用）通常不需要此字段。
   */
  clientSecret?: string;
  /**
   * OAuth 权限范围。
   * @default ["XboxLive.signin", "offline_access"]
   */
  scopes?: string[];
  /**
   * 启动器客户端标识，会写入 `AuthSession.clientToken`。
   * 默认与 `clientId` 相同。
   */
  clientToken?: string;
  /**
   * 是否在登录后验证账号是否拥有 Minecraft: Java Edition。
   * 开启后若账号未购买游戏会抛出错误。
   * @default true
   */
  validateEntitlements?: boolean;
}

/**
 * Microsoft 设备码登录凭据，通过 `startMicrosoftDeviceCodeLogin` 获取。
 * 需要将 `userCode` 展示给用户，引导其在 `verificationUri` 完成授权。
 */
export interface MicrosoftDeviceCode {
  /** 用于轮询的设备码，仅供 SDK 内部使用 */
  deviceCode: string;
  /**
   * 向用户展示的验证码（8 位字母组合，如 `"ABCD-1234"`）。
   * 用户在 `verificationUri` 页面输入此码完成授权。
   */
  userCode: string;
  /** 用户需访问的授权页面 URL，通常为 `https://microsoft.com/devicelogin` */
  verificationUri: string;
  /** 已预填 `userCode` 的完整验证 URL，用户点击即可直接跳转授权（可选） */
  verificationUriComplete?: string;
  /** 设备码有效期（秒） */
  expiresIn: number;
  /** 设备码过期时间（毫秒时间戳） */
  expiresAt: number;
  /** 建议的轮询间隔（秒），默认为 5 秒 */
  interval: number;
  /** Microsoft 提供的用户引导消息，可直接向用户展示 */
  message: string;
}

/** `loginWithMicrosoftDeviceCode` 的选项，继承自 `MicrosoftAuthOptions` */
export interface MicrosoftDeviceCodeLoginOptions extends MicrosoftAuthOptions {
  /**
   * 设备码就绪后的回调，用于向用户展示验证码和跳转链接。
   * @example
   * ```ts
   * onVerification: (code) => {
   *   console.log(`请访问 ${code.verificationUri} 并输入验证码：${code.userCode}`);
   * }
   * ```
   */
  onVerification?: (deviceCode: MicrosoftDeviceCode) => void | Promise<void>;
  /**
   * 用于取消登录轮询的 `AbortSignal`。
   * 调用 `controller.abort()` 后会立即停止等待并抛出错误。
   */
  signal?: AbortSignal;
}

/** `getMicrosoftAuthorizationUrl` 的选项，用于授权码（浏览器重定向）流程 */
export interface MicrosoftAuthorizationUrlOptions extends MicrosoftAuthOptions {
  /**
   * OAuth `state` 参数，用于防范 CSRF 攻击。
   * 建议每次生成随机值并在回调时校验。
   */
  state?: string;
  /**
   * 登录交互方式。
   * - `"login"`：强制要求用户输入凭据，即使已登录也会重新认证。
   * - `"none"`：静默登录，若需要交互则报错。
   * - `"consent"`：强制要求用户重新授权权限。
   * - `"select_account"`：要求用户选择账号。
   */
  prompt?: string;
  /** 预填的 Microsoft 账号邮箱，减少用户输入步骤 */
  loginHint?: string;
}

interface ResolvedMicrosoftAuthOptions {
  clientId: string;
  tenantId: string;
  scopes: string[];
  clientToken: string;
  validateEntitlements: boolean;
  redirectUri?: string;
  clientSecret?: string;
}

interface MicrosoftDeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval?: number;
  message: string;
}

interface MicrosoftTokenResponse {
  token_type: string;
  expires_in: number;
  scope?: string;
  access_token: string;
  refresh_token?: string;
  id_token?: string;
}

interface XboxAuthResponse {
  Token: string;
  DisplayClaims?: {
    xui?: Array<{
      uhs?: string;
      xid?: string;
    }>;
  };
}

interface MinecraftLoginResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  username?: string;
  roles?: unknown[];
}

interface MinecraftProfileResponse {
  id: string;
  name: string;
  skins?: unknown[];
  capes?: unknown[];
}

interface MinecraftEntitlementsResponse {
  items?: Array<{ name?: string }>;
}

interface ErrorResponse {
  error?: string;
  error_description?: string;
  message?: string;
  Message?: string;
  XErr?: number;
  Redirect?: string;
}

class AuthRequestError extends Error {
  status: number;
  errorCode?: string;
  responseData?: ErrorResponse;

  constructor(message: string, status: number, responseData?: ErrorResponse) {
    super(message);
    this.name = "AuthRequestError";
    this.status = status;
    if (responseData?.error) this.errorCode = responseData.error;
    if (responseData) this.responseData = responseData;
  }
}

/**
 * 身份验证管理器，负责 Minecraft 账号的登录、会话持久化和令牌刷新。
 *
 * 支持三种登录方式：
 * 1. **令牌直登**（`loginWithToken`）：已有 accessToken 时直接构造会话。
 * 2. **Microsoft 设备码**（`loginWithMicrosoftDeviceCode`）：在无浏览器环境下完成 Microsoft OAuth。
 * 3. **Microsoft 授权码**（`loginWithMicrosoftAuthorizationCode`）：在有浏览器的应用中完成 OAuth 重定向流程。
 */
export class AuthManager {
  private sessionFile: string;
  private microsoftAuth?: MicrosoftAuthOptions;

  constructor(options?: AuthOptions) {
    this.sessionFile = options?.sessionFile ?? "craft-sdk-session.json";
    if (options?.microsoftAuth) this.microsoftAuth = options.microsoftAuth;
  }

  /**
   * 使用已有的 Minecraft 令牌直接创建并保存会话（不经过 Microsoft 验证）。
   * 适合已从其他渠道（第三方登录服务、正版启动器）获取令牌的场景。
   *
   * @param accessToken Minecraft 访问令牌
   * @param clientToken 启动器客户端标识符
   * @param profileId 玩家 UUID（不含连字符）
   * @param profileName 玩家显示名称
   */
  async loginWithToken(accessToken: string, clientToken: string, profileId: string, profileName: string): Promise<AuthSession> {
    const session: AuthSession = {
      accessToken,
      clientToken,
      provider: "external",
      selectedProfile: { id: profileId, name: profileName },
      profile: { id: profileId, name: profileName },
      timestamp: Date.now(),
    };
    this.saveSession(session);
    return session;
  }

  /**
   * 生成 Microsoft OAuth 授权页面 URL（授权码流程）。
   * 用于有浏览器的场景：将用户重定向至此 URL，授权后 Microsoft 会携带 `code` 参数回调到 `redirectUri`。
   * 需要 `redirectUri` 已在 Azure 应用中注册。
   */
  getMicrosoftAuthorizationUrl(options?: MicrosoftAuthorizationUrlOptions): string {
    const resolved = this.resolveMicrosoftOptions(options);
    if (!resolved.redirectUri) {
      throw new Error("Microsoft redirectUri is required to create an authorization URL.");
    }

    const url = new URL(`${this.getMicrosoftOAuthBase(resolved.tenantId)}/authorize`);
    url.searchParams.set("client_id", resolved.clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", resolved.redirectUri);
    url.searchParams.set("scope", resolved.scopes.join(" "));
    if (options?.state) url.searchParams.set("state", options.state);
    if (options?.prompt) url.searchParams.set("prompt", options.prompt);
    if (options?.loginHint) url.searchParams.set("login_hint", options.loginHint);
    return url.toString();
  }

  /**
   * 发起 Microsoft 设备码登录流程的第一步：请求设备码。
   * 适合需要手动控制流程（如自定义轮询逻辑）的场景。
   * 一般情况下直接使用 `loginWithMicrosoftDeviceCode` 更方便。
   */
  async startMicrosoftDeviceCodeLogin(options?: MicrosoftAuthOptions): Promise<MicrosoftDeviceCode> {
    const resolved = this.resolveMicrosoftOptions(options);
    const response = await this.postMicrosoftForm<MicrosoftDeviceCodeResponse>(resolved, "devicecode", {
      client_id: resolved.clientId,
      scope: resolved.scopes.join(" "),
    });

    return {
      deviceCode: response.device_code,
      userCode: response.user_code,
      verificationUri: response.verification_uri,
      ...(response.verification_uri_complete ? { verificationUriComplete: response.verification_uri_complete } : {}),
      expiresIn: response.expires_in,
      expiresAt: Date.now() + response.expires_in * 1000,
      interval: response.interval ?? 5,
      message: response.message,
    };
  }

  /**
   * 完整的 Microsoft 设备码登录流程（推荐用于 CLI 或桌面应用）：
   * 1. 请求设备码并触发 `onVerification` 回调（向用户展示验证码）。
   * 2. 自动轮询直到用户完成授权或超时。
   * 3. 依次完成 Xbox Live → XSTS → Minecraft Services 认证链。
   * 4. 获取 Minecraft 档案并保存会话到文件。
   */
  async loginWithMicrosoftDeviceCode(options?: MicrosoftDeviceCodeLoginOptions): Promise<AuthSession> {
    const resolved = this.resolveMicrosoftOptions(options);
    const deviceCode = await this.startMicrosoftDeviceCodeLogin(resolved);
    await options?.onVerification?.(deviceCode);

    const token = await this.pollMicrosoftDeviceToken(deviceCode, resolved, options?.signal);
    return this.createMinecraftSessionFromMicrosoftToken(token, resolved);
  }

  /**
   * 使用授权码换取 Minecraft 会话（授权码流程的第二步）。
   * 在 `redirectUri` 收到回调后，从 URL 参数中提取 `code` 并传入此方法。
   * 需要 `redirectUri` 已在 Azure 应用中注册。
   *
   * @param code 从 OAuth 回调 URL 的 `code` 参数中获取的授权码
   */
  async loginWithMicrosoftAuthorizationCode(code: string, options?: MicrosoftAuthOptions): Promise<AuthSession> {
    const resolved = this.resolveMicrosoftOptions(options);
    if (!resolved.redirectUri) {
      throw new Error("Microsoft redirectUri is required to exchange an authorization code.");
    }

    const body: Record<string, string> = {
      client_id: resolved.clientId,
      grant_type: "authorization_code",
      code,
      redirect_uri: resolved.redirectUri,
      scope: resolved.scopes.join(" "),
    };
    this.addClientSecret(body, resolved);

    const token = await this.postMicrosoftForm<MicrosoftTokenResponse>(resolved, "token", body);
    return this.createMinecraftSessionFromMicrosoftToken(token, resolved);
  }

  /**
   * 使用已有的 Microsoft access token 直接登录 Minecraft（跳过 OAuth 授权步骤）。
   * 适合外部已完成 Microsoft 认证并持有有效 access token 的场景。
   *
   * @param accessToken 有效的 Microsoft access token
   */
  async loginWithMicrosoftAccessToken(accessToken: string, options?: MicrosoftAuthOptions): Promise<AuthSession> {
    const resolved = this.resolveMicrosoftOptions(options);
    return this.createMinecraftSessionFromMicrosoftToken({
      access_token: accessToken,
      expires_in: 0,
      token_type: "Bearer",
    }, resolved);
  }

  /**
   * 使用 refresh token 刷新 Microsoft 会话，获取新的 access token。
   * 会自动从 `session.refreshToken` 读取刷新令牌，无需手动传入。
   * 通常在 `isSessionExpired` 返回 true 且会话含有 `refreshToken` 时调用。
   *
   * @param session 要刷新的会话，留空时读取 sessionFile 中保存的会话
   */
  async refreshMicrosoftSession(session?: AuthSession, options?: MicrosoftAuthOptions): Promise<AuthSession> {
    const current = session ?? this.loadSession();
    if (!current) {
      throw new Error("No session available to refresh.");
    }
    if (!current.refreshToken) {
      throw new Error("The current session does not include a Microsoft refresh token.");
    }

    const fallbackOptions: MicrosoftAuthOptions = current.provider === "microsoft"
      ? { clientId: current.clientToken }
      : {};
    const resolved = this.resolveMicrosoftOptions({ ...fallbackOptions, ...options });
    const body: Record<string, string> = {
      client_id: resolved.clientId,
      grant_type: "refresh_token",
      refresh_token: current.refreshToken,
      scope: resolved.scopes.join(" "),
    };
    this.addClientSecret(body, resolved);

    const token = await this.postMicrosoftForm<MicrosoftTokenResponse>(resolved, "token", body);
    return this.createMinecraftSessionFromMicrosoftToken(token, resolved);
  }

  /**
   * 判断会话是否已过期或即将过期。
   * 返回 `true` 时应调用 `refreshMicrosoftSession`（有 refreshToken）或重新登录。
   *
   * @param session 要检查的会话，留空时视为已过期（返回 true）
   * @param skewMs 提前判定过期的缓冲时间（毫秒），防止在即将过期时仍然使用。默认 60000（1 分钟）
   */
  isSessionExpired(session?: AuthSession, skewMs = 60000): boolean {
    if (!session) {
      return true;
    }
    if (!session.expiresAt) {
      return false;
    }
    return Date.now() + skewMs >= session.expiresAt;
  }

  /** 将会话写入 sessionFile，覆盖已有内容 */
  saveSession(session: AuthSession): void {
    writeJson(this.sessionFile, session);
  }

  /** 从 sessionFile 读取已保存的会话，文件不存在时返回 `undefined` */
  loadSession(): AuthSession | undefined {
    if (!pathExists(this.sessionFile)) {
      return undefined;
    }
    return readJson<AuthSession>(this.sessionFile);
  }

  /**
   * 创建一个简单的用户档案对象，可与会话关联。
   * @param username 玩家用户名
   * @param session 可选的关联会话
   */
  createProfile(username: string, session?: AuthSession): UserProfile {
    const profile: UserProfile = { username };
    if (session) profile.session = session;
    return profile;
  }

  private async pollMicrosoftDeviceToken(
    deviceCode: MicrosoftDeviceCode,
    options: ResolvedMicrosoftAuthOptions,
    signal?: AbortSignal
  ): Promise<MicrosoftTokenResponse> {
    let intervalMs = deviceCode.interval * 1000;

    while (Date.now() < deviceCode.expiresAt) {
      await this.wait(intervalMs, signal);

      try {
        return await this.postMicrosoftForm<MicrosoftTokenResponse>(options, "token", {
          client_id: options.clientId,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: deviceCode.deviceCode,
        });
      } catch (error) {
        if (!(error instanceof AuthRequestError)) {
          throw error;
        }

        if (error.errorCode === "authorization_pending") {
          continue;
        }
        if (error.errorCode === "slow_down") {
          intervalMs += 5000;
          continue;
        }
        if (error.errorCode === "expired_token") {
          throw new Error("Microsoft device code expired before the user finished sign-in.");
        }
        if (error.errorCode === "authorization_declined" || error.errorCode === "access_denied") {
          throw new Error("Microsoft sign-in was cancelled or denied.");
        }
        throw error;
      }
    }

    throw new Error("Microsoft device code expired before the user finished sign-in.");
  }

  private async createMinecraftSessionFromMicrosoftToken(
    token: MicrosoftTokenResponse,
    options: ResolvedMicrosoftAuthOptions
  ): Promise<AuthSession> {
    const xboxAuth = await this.authenticateXboxLive(token.access_token);
    const xsts = await this.authorizeXsts(xboxAuth.Token);
    const userHash = this.getXboxUserHash(xsts);
    const xuid = this.getXboxUserId(xsts);
    const minecraftToken = await this.loginMinecraftWithXbox(userHash, xsts.Token);

    if (options.validateEntitlements) {
      await this.validateMinecraftEntitlements(minecraftToken.access_token);
    }

    const minecraftProfile = await this.fetchMinecraftProfile(minecraftToken.access_token);
    const now = Date.now();
    const session: AuthSession = {
      accessToken: minecraftToken.access_token,
      clientToken: options.clientToken,
      provider: "microsoft",
      selectedProfile: { id: minecraftProfile.id, name: minecraftProfile.name },
      profile: { id: minecraftProfile.id, name: minecraftProfile.name },
      availableProfiles: [{ id: minecraftProfile.id, name: minecraftProfile.name }],
      userProperties: {
        skins: minecraftProfile.skins ?? [],
        capes: minecraftProfile.capes ?? [],
      },
      timestamp: now,
      expiresAt: now + minecraftToken.expires_in * 1000,
    };

    if (token.refresh_token) session.refreshToken = token.refresh_token;
    if (xuid) session.xuid = xuid;

    this.saveSession(session);
    return session;
  }

  private async authenticateXboxLive(accessToken: string): Promise<XboxAuthResponse> {
    return this.fetchJson<XboxAuthResponse>("https://user.auth.xboxlive.com/user/authenticate", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        Properties: {
          AuthMethod: "RPS",
          SiteName: "user.auth.xboxlive.com",
          RpsTicket: `d=${accessToken}`,
        },
        RelyingParty: "http://auth.xboxlive.com",
        TokenType: "JWT",
      }),
    });
  }

  private async authorizeXsts(userToken: string): Promise<XboxAuthResponse> {
    try {
      return await this.fetchJson<XboxAuthResponse>("https://xsts.auth.xboxlive.com/xsts/authorize", {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          Properties: {
            SandboxId: "RETAIL",
            UserTokens: [userToken],
          },
          RelyingParty: "rp://api.minecraftservices.com/",
          TokenType: "JWT",
        }),
      });
    } catch (error) {
      if (error instanceof AuthRequestError && error.responseData?.XErr) {
        throw new Error(this.getXstsErrorMessage(error.responseData.XErr));
      }
      throw error;
    }
  }

  private async loginMinecraftWithXbox(userHash: string, xstsToken: string): Promise<MinecraftLoginResponse> {
    return this.fetchJson<MinecraftLoginResponse>(`${MINECRAFT_SERVICES_BASE}/authentication/login_with_xbox`, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        identityToken: `XBL3.0 x=${userHash};${xstsToken}`,
      }),
    });
  }

  private async validateMinecraftEntitlements(accessToken: string): Promise<void> {
    const entitlements = await this.fetchJson<MinecraftEntitlementsResponse>(`${MINECRAFT_SERVICES_BASE}/entitlements/mcstore`, {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
      },
    });
    if (!entitlements.items || entitlements.items.length === 0) {
      throw new Error("The authenticated Microsoft account does not own Minecraft: Java Edition.");
    }
  }

  private async fetchMinecraftProfile(accessToken: string): Promise<MinecraftProfileResponse> {
    return this.fetchJson<MinecraftProfileResponse>(`${MINECRAFT_SERVICES_BASE}/minecraft/profile`, {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
      },
    });
  }

  private async postMicrosoftForm<T>(
    options: ResolvedMicrosoftAuthOptions,
    path: "authorize" | "devicecode" | "token",
    data: Record<string, string>
  ): Promise<T> {
    const body = new URLSearchParams(data);
    return this.fetchJson<T>(`${this.getMicrosoftOAuthBase(options.tenantId)}/${path}`, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
  }

  private async fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, init);
    const text = await response.text();
    const data = this.parseJsonResponse(text);

    if (!response.ok) {
      const errorData = this.asErrorResponse(data);
      const message = errorData?.error_description
        ?? errorData?.message
        ?? errorData?.Message
        ?? `Request failed: ${response.status} ${response.statusText}`;
      throw new AuthRequestError(message, response.status, errorData);
    }

    return data as T;
  }

  private parseJsonResponse(text: string): unknown {
    if (!text) {
      return {};
    }

    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { message: text };
    }
  }

  private asErrorResponse(data: unknown): ErrorResponse | undefined {
    if (!data || typeof data !== "object") {
      return undefined;
    }
    return data as ErrorResponse;
  }

  private resolveMicrosoftOptions(options?: MicrosoftAuthOptions): ResolvedMicrosoftAuthOptions {
    const merged = { ...this.microsoftAuth, ...options };
    if (!merged.clientId) {
      throw new Error("Microsoft clientId is required.");
    }

    const resolved: ResolvedMicrosoftAuthOptions = {
      clientId: merged.clientId,
      tenantId: merged.tenantId ?? DEFAULT_MICROSOFT_TENANT,
      scopes: merged.scopes ?? DEFAULT_MICROSOFT_SCOPES,
      clientToken: merged.clientToken ?? merged.clientId,
      validateEntitlements: merged.validateEntitlements ?? true,
    };
    if (merged.redirectUri) resolved.redirectUri = merged.redirectUri;
    if (merged.clientSecret) resolved.clientSecret = merged.clientSecret;
    return resolved;
  }

  private addClientSecret(data: Record<string, string>, options: ResolvedMicrosoftAuthOptions): void {
    if (options.clientSecret) {
      data.client_secret = options.clientSecret;
    }
  }

  private getMicrosoftOAuthBase(tenantId: string): string {
    return `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0`;
  }

  private getXboxUserHash(response: XboxAuthResponse): string {
    const userHash = response.DisplayClaims?.xui?.[0]?.uhs;
    if (!userHash) {
      throw new Error("Xbox Live authentication did not return a user hash.");
    }
    return userHash;
  }

  private getXboxUserId(response: XboxAuthResponse): string | undefined {
    return response.DisplayClaims?.xui?.[0]?.xid;
  }

  private getXstsErrorMessage(xerr: number): string {
    switch (xerr) {
      case 2148916233:
        return "The Microsoft account does not have an Xbox account.";
      case 2148916235:
        return "Xbox Live is not available in this account region.";
      case 2148916236:
      case 2148916237:
      case 2148916238:
        return "The Microsoft account cannot use Xbox Live because of age or family settings.";
      default:
        return `Xbox XSTS authentication failed with XErr ${xerr}.`;
    }
  }

  private wait(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return Promise.reject(new Error("Microsoft sign-in was aborted."));
    }

    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      const onAbort = () => {
        clearTimeout(timer);
        reject(new Error("Microsoft sign-in was aborted."));
      };
      const onDone = () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      };
      timer = setTimeout(onDone, ms);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}

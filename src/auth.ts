import { writeJson, readJson, pathExists } from "./utils/fs.js";
import type { AuthSession, UserProfile } from "./models/profile.js";

const DEFAULT_MICROSOFT_TENANT = "consumers";
const DEFAULT_MICROSOFT_SCOPES = ["XboxLive.signin", "offline_access"];
const MINECRAFT_SERVICES_BASE = "https://api.minecraftservices.com";

export interface AuthOptions {
  sessionFile?: string;
  microsoftAuth?: MicrosoftAuthOptions;
}

export interface MicrosoftAuthOptions {
  clientId?: string;
  tenantId?: string;
  redirectUri?: string;
  clientSecret?: string;
  scopes?: string[];
  clientToken?: string;
  validateEntitlements?: boolean;
}

export interface MicrosoftDeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresIn: number;
  expiresAt: number;
  interval: number;
  message: string;
}

export interface MicrosoftDeviceCodeLoginOptions extends MicrosoftAuthOptions {
  onVerification?: (deviceCode: MicrosoftDeviceCode) => void | Promise<void>;
  signal?: AbortSignal;
}

export interface MicrosoftAuthorizationUrlOptions extends MicrosoftAuthOptions {
  state?: string;
  prompt?: string;
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

export class AuthManager {
  private sessionFile: string;
  private microsoftAuth?: MicrosoftAuthOptions;

  constructor(options?: AuthOptions) {
    this.sessionFile = options?.sessionFile ?? "craft-sdk-session.json";
    if (options?.microsoftAuth) this.microsoftAuth = options.microsoftAuth;
  }

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

  async loginWithMicrosoftDeviceCode(options?: MicrosoftDeviceCodeLoginOptions): Promise<AuthSession> {
    const resolved = this.resolveMicrosoftOptions(options);
    const deviceCode = await this.startMicrosoftDeviceCodeLogin(resolved);
    await options?.onVerification?.(deviceCode);

    const token = await this.pollMicrosoftDeviceToken(deviceCode, resolved, options?.signal);
    return this.createMinecraftSessionFromMicrosoftToken(token, resolved);
  }

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

  async loginWithMicrosoftAccessToken(accessToken: string, options?: MicrosoftAuthOptions): Promise<AuthSession> {
    const resolved = this.resolveMicrosoftOptions(options);
    return this.createMinecraftSessionFromMicrosoftToken({
      access_token: accessToken,
      expires_in: 0,
      token_type: "Bearer",
    }, resolved);
  }

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

  isSessionExpired(session?: AuthSession, skewMs = 60000): boolean {
    if (!session) {
      return true;
    }
    if (!session.expiresAt) {
      return false;
    }
    return Date.now() + skewMs >= session.expiresAt;
  }

  saveSession(session: AuthSession): void {
    writeJson(this.sessionFile, session);
  }

  loadSession(): AuthSession | undefined {
    if (!pathExists(this.sessionFile)) {
      return undefined;
    }
    return readJson<AuthSession>(this.sessionFile);
  }

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

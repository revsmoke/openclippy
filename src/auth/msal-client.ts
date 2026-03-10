import {
  PublicClientApplication,
  type Configuration,
  type AuthenticationResult,
  type DeviceCodeRequest,
  type SilentFlowRequest,
  type AccountInfo,
} from "@azure/msal-node";
import { TokenCachePlugin } from "./token-cache.js";

export type MSALClientConfig = {
  clientId: string;
  tenantId: string;
  authority?: string;
  cachePath?: string;
};

export class MSALClient {
  private app: PublicClientApplication;
  private cachePlugin: TokenCachePlugin;
  private account: AccountInfo | null = null;

  constructor(config: MSALClientConfig) {
    this.cachePlugin = new TokenCachePlugin(config.cachePath);

    const msalConfig: Configuration = {
      auth: {
        clientId: config.clientId,
        authority:
          config.authority ??
          `https://login.microsoftonline.com/${config.tenantId}`,
      },
      cache: {
        cachePlugin: this.cachePlugin,
      },
    };

    this.app = new PublicClientApplication(msalConfig);
  }

  /** Try silent acquisition; fall back to device code flow */
  async acquireToken(scopes: string[]): Promise<AuthenticationResult> {
    // 1. Try to load cached account
    if (!this.account) {
      const cache = this.app.getTokenCache();
      const accounts = await cache.getAllAccounts();
      if (accounts.length > 0) {
        this.account = accounts[0]!;
      }
    }

    // 2. Try silent acquisition
    if (this.account) {
      try {
        const silentRequest: SilentFlowRequest = {
          account: this.account,
          scopes,
        };
        return await this.app.acquireTokenSilent(silentRequest);
      } catch {
        // Silent failed — fall through to interactive
      }
    }

    // 3. Device code flow (interactive)
    const deviceCodeRequest: DeviceCodeRequest = {
      scopes,
      deviceCodeCallback: (response) => {
        console.log();
        console.log(response.message);
        console.log();
      },
    };

    const result = await this.app.acquireTokenByDeviceCode(deviceCodeRequest);
    if (!result) {
      throw new Error("Device code authentication failed — no result returned");
    }

    this.account = result.account;
    return result;
  }

  /** Get the current cached account info */
  async getAccount(): Promise<AccountInfo | null> {
    if (this.account) return this.account;

    const cache = this.app.getTokenCache();
    const accounts = await cache.getAllAccounts();
    if (accounts.length > 0) {
      this.account = accounts[0]!;
    }
    return this.account;
  }

  /** Check if we have a cached token (without acquiring) */
  async isAuthenticated(): Promise<boolean> {
    const account = await this.getAccount();
    return account !== null;
  }

  /** Clear all cached tokens */
  async logout(): Promise<void> {
    const cache = this.app.getTokenCache();
    const accounts = await cache.getAllAccounts();
    for (const account of accounts) {
      await cache.removeAccount(account);
    }
    this.account = null;
  }
}

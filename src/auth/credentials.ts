import type { OpenClippyConfig } from "../config/types.base.js";
import { DEFAULT_CONFIG } from "../config/defaults.js";

export type AzureCredentials = {
  clientId: string;
  tenantId: string;
};

/** Resolve Azure AD credentials from config, env vars, or defaults */
export function resolveAzureCredentials(cfg?: OpenClippyConfig): AzureCredentials {
  const clientId =
    cfg?.azure?.clientId ??
    process.env.OPENCLIPPY_CLIENT_ID ??
    process.env.AZURE_CLIENT_ID ??
    DEFAULT_CONFIG.azure.clientId;

  const tenantId =
    cfg?.azure?.tenantId ??
    process.env.OPENCLIPPY_TENANT_ID ??
    process.env.AZURE_TENANT_ID ??
    DEFAULT_CONFIG.azure.tenantId;

  return { clientId, tenantId };
}

import type { OpenClippyConfig } from "../config/types.base.js";

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
    "bfe7dd6e-ed60-4bf4-8396-801a8eada469";

  const tenantId =
    cfg?.azure?.tenantId ??
    process.env.OPENCLIPPY_TENANT_ID ??
    process.env.AZURE_TENANT_ID ??
    "ddd9f933-04a5-43f0-8673-5933da46cdcb";

  return { clientId, tenantId };
}

import { graphRequest, GraphApiError } from "../graph/client.js";

export type ServiceHealthResult = {
  serviceId: string;
  healthy: boolean;
  error?: string;
  latencyMs: number;
};

/**
 * Probe a single service endpoint to check if it is responsive.
 * Returns a health result with latency measurement.
 */
export async function probeServiceHealth(params: {
  token: string;
  serviceId: string;
  path: string;
}): Promise<ServiceHealthResult> {
  const start = Date.now();

  try {
    await graphRequest({
      token: params.token,
      path: params.path,
      timeoutMs: 10_000,
    });

    return {
      serviceId: params.serviceId,
      healthy: true,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    const latencyMs = Date.now() - start;

    let errorMessage: string;
    if (err instanceof GraphApiError) {
      errorMessage = `Graph API error ${err.status}: ${err.code ?? err.body.slice(0, 100)}`;
    } else if (err instanceof Error) {
      errorMessage = err.message;
    } else {
      errorMessage = String(err);
    }

    return {
      serviceId: params.serviceId,
      healthy: false,
      error: errorMessage,
      latencyMs,
    };
  }
}

/**
 * Probe multiple services in parallel and return all results.
 */
export async function probeAllServices(params: {
  token: string;
  services: Array<{ id: string; probePath: string }>;
}): Promise<ServiceHealthResult[]> {
  const probes = params.services.map((service) =>
    probeServiceHealth({
      token: params.token,
      serviceId: service.id,
      path: service.probePath,
    }),
  );

  return Promise.all(probes);
}

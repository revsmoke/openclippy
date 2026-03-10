const GRAPH_V1 = "https://graph.microsoft.com/v1.0";
const GRAPH_BETA = "https://graph.microsoft.com/beta";

export type GraphRequestParams = {
  token: string;
  path: string;
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  version?: "v1.0" | "beta";
  timeoutMs?: number;
};

export type GraphCollectionResponse<T> = {
  value: T[];
  "@odata.nextLink"?: string;
  "@odata.count"?: number;
};

export class GraphApiError extends Error {
  constructor(
    public readonly path: string,
    public readonly status: number,
    public readonly body: string,
    public readonly code?: string,
  ) {
    super(`Graph API ${path} failed (${status}): ${body.slice(0, 200)}`);
    this.name = "GraphApiError";
  }

  get isThrottled(): boolean {
    return this.status === 429;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }
}

/** Make a typed request to the Microsoft Graph API */
export async function graphRequest<T>(params: GraphRequestParams): Promise<T> {
  const root = params.version === "beta" ? GRAPH_BETA : GRAPH_V1;
  const url = params.path.startsWith("http") ? params.path : `${root}${params.path}`;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    params.timeoutMs ?? 30_000,
  );

  try {
    const res = await fetch(url, {
      method: params.method ?? "GET",
      headers: {
        Authorization: `Bearer ${params.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...params.headers,
      },
      body: params.body ? JSON.stringify(params.body) : undefined,
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let code: string | undefined;
      try {
        const errJson = JSON.parse(text);
        code = errJson?.error?.code;
      } catch {
        // ignore parse errors
      }
      throw new GraphApiError(params.path, res.status, text, code);
    }

    // 204 No Content
    if (res.status === 204) return undefined as T;

    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

/** Auto-paginate a Graph collection endpoint, following @odata.nextLink */
export async function graphPaginate<T>(
  params: GraphRequestParams & { maxPages?: number },
): Promise<T[]> {
  const { maxPages: maxPagesParam, ...requestParams } = params;
  const results: T[] = [];
  let path: string | undefined = params.path;
  let page = 0;
  const maxPages = maxPagesParam ?? 10;

  while (path && page < maxPages) {
    const response: GraphCollectionResponse<T> = await graphRequest<GraphCollectionResponse<T>>({
      ...requestParams,
      path,
    });

    if (response.value) {
      results.push(...response.value);
    }

    if (response["@odata.nextLink"]) {
      // nextLink is a full URL — pass it directly
      path = response["@odata.nextLink"];
    } else {
      path = undefined;
    }

    page++;
  }

  return results;
}

export type BatchRequestItem = {
  id: string;
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
};

export type BatchResponseItem = {
  id: string;
  status: number;
  body: unknown;
};

/** Execute a $batch request (up to 20 operations per batch) */
export async function graphBatch(params: {
  token: string;
  requests: BatchRequestItem[];
}): Promise<BatchResponseItem[]> {
  if (params.requests.length > 20) {
    throw new Error("Graph $batch supports a maximum of 20 requests per batch");
  }

  const response = await graphRequest<{ responses: BatchResponseItem[] }>({
    token: params.token,
    path: "/$batch",
    method: "POST",
    body: { requests: params.requests },
  });

  return response.responses;
}

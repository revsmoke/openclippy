/** Common Graph API entity fields */
export type GraphEntity = {
  id: string;
  [key: string]: unknown;
};

/** Graph API error response body */
export type GraphErrorBody = {
  error: {
    code: string;
    message: string;
    innerError?: {
      "request-id"?: string;
      date?: string;
    };
  };
};

/** OData query parameters */
export type ODataParams = {
  $select?: string;
  $filter?: string;
  $orderby?: string;
  $top?: number;
  $skip?: number;
  $search?: string;
  $expand?: string;
  $count?: boolean;
};

/** Build query string from OData params */
export function buildODataQuery(params: ODataParams): string {
  const parts: string[] = [];
  if (params.$select) parts.push(`$select=${params.$select}`);
  if (params.$filter) parts.push(`$filter=${encodeURIComponent(params.$filter)}`);
  if (params.$orderby) parts.push(`$orderby=${params.$orderby}`);
  if (params.$top !== undefined) parts.push(`$top=${params.$top}`);
  if (params.$skip !== undefined) parts.push(`$skip=${params.$skip}`);
  if (params.$search) parts.push(`$search="${encodeURIComponent(params.$search)}"`);
  if (params.$expand) parts.push(`$expand=${params.$expand}`);
  if (params.$count) parts.push("$count=true");
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

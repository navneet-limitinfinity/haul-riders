/**
 * Very small Shopify Admin API client.
 * Uses the store domain + access token via env vars.
 */
export function createShopifyAdminClient({
  storeDomain,
  accessToken,
  apiVersion,
  timeoutMs = 10_000,
  maxRetries = 2,
}) {
  if (!storeDomain) throw new Error("SHOPIFY_STORE is required");
  if (!accessToken) throw new Error("SHOPIFY_TOKEN is required");

  const baseUrl = `https://${storeDomain}/admin/api/${apiVersion}`;
  const oauthUrl = `https://${storeDomain}/admin/oauth`;

  const buildUrlWithQuery = (path, query) => {
    const url = new URL(`${baseUrl}${path}`);

    if (query && typeof query === "object") {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null || value === "") continue;
        params.set(key, String(value));
      }
      url.search = params.toString();
    }

    return url.toString();
  };

  const buildOauthUrlWithQuery = (path, query) => {
    const url = new URL(`${oauthUrl}${path}`);

    if (query && typeof query === "object") {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null || value === "") continue;
        params.set(key, String(value));
      }
      url.search = params.toString();
    }

    return url.toString();
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const parseRetryAfterMs = (headerValue) => {
    if (!headerValue) return 0;
    const seconds = Number.parseInt(String(headerValue), 10);
    if (!Number.isNaN(seconds) && seconds > 0) return seconds * 1000;
    return 0;
  };

  const fetchWithTimeout = async (url, init) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const safeSnippet = (text) => {
    const s = String(text ?? "");
    if (!s) return "";
    const trimmed = s.trim();
    if (!trimmed) return "";
    return trimmed.length > 800 ? trimmed.slice(0, 800) + "…" : trimmed;
  };

  const requestJson = async ({ path, method = "GET", query }) => {
    const url = buildUrlWithQuery(path, query);
    const init = {
      method,
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    };

    let attempt = 0;
    while (true) {
      attempt += 1;
      let response;
      try {
        response = await fetchWithTimeout(url, init);
      } catch (error) {
        const shouldRetry = attempt <= maxRetries + 1;
        if (shouldRetry) {
          const backoffMs = Math.min(10_000, 250 * 2 ** (attempt - 1));
          await sleep(backoffMs);
          continue;
        }
        const isAbort = error?.name === "AbortError";
        throw new Error(
          isAbort
            ? `Shopify request timed out after ${timeoutMs}ms`
            : `Shopify request failed: ${error?.message ?? String(error)}`
        );
      }

      if (response.ok) return response.json();

      const retryable = response.status === 429 || response.status >= 500;
      const canRetry = retryable && attempt <= maxRetries + 1;
      if (canRetry) {
        const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
        const backoffMs = Math.min(10_000, 250 * 2 ** (attempt - 1));
        await sleep(Math.max(retryAfterMs, backoffMs));
        continue;
      }

      const text = await response.text().catch(() => "");
      const snippet = safeSnippet(text);
      throw new Error(
        `Shopify API error ${response.status} ${response.statusText}${
          snippet ? `: ${snippet}` : ""
        }`
      );
    }
  };

  const requestOauthJson = async ({ path, method = "GET", query }) => {
    const url = buildOauthUrlWithQuery(path, query);
    const init = {
      method,
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    };

    let attempt = 0;
    while (true) {
      attempt += 1;
      let response;
      try {
        response = await fetchWithTimeout(url, init);
      } catch (error) {
        const shouldRetry = attempt <= maxRetries + 1;
        if (shouldRetry) {
          const backoffMs = Math.min(10_000, 250 * 2 ** (attempt - 1));
          await sleep(backoffMs);
          continue;
        }
        const isAbort = error?.name === "AbortError";
        throw new Error(
          isAbort
            ? `Shopify request timed out after ${timeoutMs}ms`
            : `Shopify request failed: ${error?.message ?? String(error)}`
        );
      }

      if (response.ok) return response.json();

      const retryable = response.status === 429 || response.status >= 500;
      const canRetry = retryable && attempt <= maxRetries + 1;
      if (canRetry) {
        const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
        const backoffMs = Math.min(10_000, 250 * 2 ** (attempt - 1));
        await sleep(Math.max(retryAfterMs, backoffMs));
        continue;
      }

      const text = await response.text().catch(() => "");
      const snippet = safeSnippet(text);
      throw new Error(
        `Shopify OAuth API error ${response.status} ${response.statusText}${
          snippet ? `: ${snippet}` : ""
        }`
      );
    }
  };

  const getShop = async () => {
    const data = await requestJson({ path: "/shop.json" });
    return data.shop;
  };

  const getAccessScopes = async () => {
    const data = await requestOauthJson({ path: "/access_scopes.json" });
    return data.access_scopes ?? [];
  };

  const getOrdersCount = async ({ status = "any" } = {}) => {
    const data = await requestJson({
      path: "/orders/count.json",
      query: {
        status,
        fulfillment_status: "any",
      },
    });
    return data.count ?? 0;
  };

  const getLatestOrders = async ({ limit = 10 } = {}) => {
    // Note:
    // - `status=any` includes open/closed/cancelled (latest is by created_at desc)
    // - `fields` keeps payload small, but still includes fulfillment tracking data
    const data = await requestJson({
      path: "/orders.json",
      query: {
        limit,
        status: "any",
        fulfillment_status: "any",
        order: "created_at desc",
        fields:
          "id,admin_graphql_api_id,name,total_price,shipping_address,phone,fulfillment_status,fulfillments",
      },
    });

    return data.orders ?? [];
  };

  return { getShop, getAccessScopes, getOrdersCount, getLatestOrders };
}

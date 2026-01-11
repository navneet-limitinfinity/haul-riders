/**
 * Very small Shopify Admin API client.
 * Uses the store domain + access token via env vars.
 */
export function createShopifyAdminClient({ storeDomain, accessToken, apiVersion }) {
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

  const requestJson = async ({ path, method = "GET", query }) => {
    const response = await fetch(buildUrlWithQuery(path, query), {
      method,
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Shopify API error ${response.status} ${response.statusText}: ${text}`
      );
    }

    return response.json();
  };

  const requestOauthJson = async ({ path, method = "GET", query }) => {
    const response = await fetch(buildOauthUrlWithQuery(path, query), {
      method,
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Shopify OAuth API error ${response.status} ${response.statusText}: ${text}`
      );
    }

    return response.json();
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
          "id,name,total_price,shipping_address,phone,fulfillment_status,fulfillments",
      },
    });

    return data.orders ?? [];
  };

  return { getShop, getAccessScopes, getOrdersCount, getLatestOrders };
}

/**
 * Very small Shopify Admin API client.
 * Uses the store domain + access token via env vars.
 */
export function createShopifyAdminClient({ storeDomain, accessToken, apiVersion }) {
  if (!storeDomain) throw new Error("SHOPIFY_STORE is required");
  if (!accessToken) throw new Error("SHOPIFY_TOKEN is required");

  const baseUrl = `https://${storeDomain}/admin/api/${apiVersion}`;

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

  const getShop = async () => {
    const data = await requestJson({ path: "/shop.json" });
    return data.shop;
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
        order: "created_at desc",
        fields:
          "id,name,total_price,shipping_address,phone,fulfillment_status,fulfillments",
      },
    });

    return data.orders ?? [];
  };

  return { getShop, getLatestOrders };
}

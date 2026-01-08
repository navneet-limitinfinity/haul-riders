/**
 * Very small Shopify Admin API client.
 * Uses the store domain + access token via env vars.
 */
export function createShopifyAdminClient({ storeDomain, accessToken, apiVersion }) {
  if (!storeDomain) throw new Error("SHOPIFY_STORE is required");
  if (!accessToken) throw new Error("SHOPIFY_TOKEN is required");

  const baseUrl = `https://${storeDomain}/admin/api/${apiVersion}`;

  const requestJson = async (path) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "GET",
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
    const data = await requestJson("/shop.json");
    return data.shop;
  };

  return { getShop };
}


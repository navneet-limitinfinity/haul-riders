export interface ShopifyOrder {
  id: string;
  orderNumber: string;
  customerName: string;
  address?: string;
  phone?: string;
  total: string;
  date: string;
  status: 'fulfilled' | 'unfulfilled';
  trackingAssigned: boolean;
}

export async function fetchShopifyOrders(): Promise<ShopifyOrder[]> {
  // Minimal mock for UI preview — real integration lives in the main app
  return Promise.resolve(Array.from({ length: 20 }).map((_, i) => ({
    id: `gid://order/${i + 1}`,
    orderNumber: `ORD-${1000 + i}`,
    customerName: `Customer ${i + 1}`,
    address: `Street ${i + 1}, Suite ${i + 1}, City ${i + 1}, State ${i + 1}, 12345`,
    phone: '9999999999',
    total: `$${(10 + i * 2).toFixed(2)}`,
    date: new Date().toISOString().split('T')[0],
    status: i % 3 === 0 ? 'fulfilled' : 'unfulfilled',
    trackingAssigned: i % 2 === 0,
  })));
}

export function exportOrdersToCSV(orders: ShopifyOrder[]) {
  const headers = ['Order Number', 'Customer', 'Total', 'Status', 'Date', 'Tracking'];
  const rows = orders.map(o => [
    o.orderNumber,
    o.customerName,
    o.total,
    o.status,
    o.date,
    o.trackingAssigned ? 'Assigned' : 'Pending',
  ]);
  const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
  return csv;
}

export function downloadCSV(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

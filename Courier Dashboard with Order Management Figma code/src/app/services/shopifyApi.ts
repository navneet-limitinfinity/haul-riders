// Mock Shopify API service
// In production, replace with actual Shopify API calls

export interface ShopifyOrder {
  id: string;
  orderNumber: string;
  customerName: string;
  email: string;
  items: number;
  total: string;
  status: 'unfulfilled' | 'fulfilled';
  date: string;
  address?: string;
  phone?: string;
}

// Mock data that simulates Shopify API response
const mockShopifyOrders: ShopifyOrder[] = [
  { 
    id: '8459595802642', 
    orderNumber: '#1221', 
    customerName: 'Winni Saini', 
    email: 'winni@example.com', 
    items: 3, 
    total: '1908.00', 
    status: 'unfulfilled', 
    date: '2026-01-10',
    address: 'THE PIZZA BASKET RING Road Jogjwala, Indraprastha, Dehradun, Uttarakhand, 248005',
    phone: '7302103984'
  },
  { 
    id: '8438575661362', 
    orderNumber: '#1220', 
    customerName: 'Harini V', 
    email: 'harini@example.com', 
    items: 1, 
    total: '1100.00', 
    status: 'fulfilled', 
    date: '2026-01-10',
    address: 'AF11,SR flora apartment,5th cross, 18th main, Hongasandra, Mica layout, Bengaluru, Karnataka, 560068',
    phone: '09886256154, +919886256154'
  },
  { 
    id: '8277166915890', 
    orderNumber: '#1219', 
    customerName: 'Upender Kumar', 
    email: 'upender@example.com', 
    items: 5, 
    total: '315.00', 
    status: 'fulfilled', 
    date: '2026-01-09',
    address: 'House No. 325, Gali. No.2, Singhal Electricals, Brahampuri, Ghookna, Ghaziabad, Uttar Pradesh, 201001',
    phone: '+919971271252'
  },
  { 
    id: '8272075260210', 
    orderNumber: '#1218', 
    customerName: 'Senthilnathan K', 
    email: 'senthil@example.com', 
    items: 2, 
    total: '2200.00', 
    status: 'unfulfilled', 
    date: '2026-01-09',
    address: '10 AGS Colony 1st Avenue phase 3, Mugalivakkam porum, CHENNAI, Tamil Nadu, 600125',
    phone: '+919360207819'
  },
  { 
    id: '8271234567890', 
    orderNumber: '#1217', 
    customerName: 'Priya Sharma', 
    email: 'priya@example.com', 
    items: 4, 
    total: '1850.00', 
    status: 'unfulfilled', 
    date: '2026-01-08',
    address: 'B-204, Palm Heights, Sector 15, Kharghar, Navi Mumbai, Maharashtra, 410210',
    phone: '+919823456789'
  },
  { 
    id: '8270987654321', 
    orderNumber: '#1216', 
    customerName: 'Rajesh Patel', 
    email: 'rajesh@example.com', 
    items: 1, 
    total: '750.00', 
    status: 'fulfilled', 
    date: '2026-01-08',
    address: '301, Silver Oak Apartments, S G Highway, Ahmedabad, Gujarat, 380015',
    phone: '+919876543210'
  },
  { 
    id: '8269876543210', 
    orderNumber: '#1215', 
    customerName: 'Aisha Khan', 
    email: 'aisha@example.com', 
    items: 6, 
    total: '3200.00', 
    status: 'unfulfilled', 
    date: '2026-01-07',
    address: 'Flat 12, Crescent Tower, Park Street, Kolkata, West Bengal, 700016',
    phone: '+919123456789'
  },
  { 
    id: '8268765432109', 
    orderNumber: '#1214', 
    customerName: 'Vikram Singh', 
    email: 'vikram@example.com', 
    items: 2, 
    total: '1450.00', 
    status: 'fulfilled', 
    date: '2026-01-07',
    address: 'H.No. 456, Sector 21, Panchkula, Haryana, 134109',
    phone: '+919876012345'
  },
  { 
    id: '8267654321098', 
    orderNumber: '#1213', 
    customerName: 'Divya Reddy', 
    email: 'divya@example.com', 
    items: 3, 
    total: '2100.00', 
    status: 'unfulfilled', 
    date: '2026-01-06',
    address: '7-1-23/45, Ameerpet, Hyderabad, Telangana, 500016',
    phone: '+919632587410'
  },
  { 
    id: '8266543210987', 
    orderNumber: '#1212', 
    customerName: 'Amit Verma', 
    email: 'amit@example.com', 
    items: 1, 
    total: '890.00', 
    status: 'fulfilled', 
    date: '2026-01-06',
    address: 'C-89, Sector 62, Noida, Uttar Pradesh, 201301',
    phone: '+919871234567'
  },
];

/**
 * Fetch orders from Shopify API
 * In production, replace this with actual Shopify API call:
 * 
 * const response = await fetch('https://YOUR_STORE.myshopify.com/admin/api/2024-01/orders.json', {
 *   headers: {
 *     'X-Shopify-Access-Token': 'YOUR_ACCESS_TOKEN',
 *     'Content-Type': 'application/json',
 *   },
 * });
 * const data = await response.json();
 */
export async function fetchShopifyOrders(): Promise<ShopifyOrder[]> {
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Return mock data
  return mockShopifyOrders;
}

/**
 * Fetch only unfulfilled orders
 */
export async function fetchUnfulfilledOrders(): Promise<ShopifyOrder[]> {
  const allOrders = await fetchShopifyOrders();
  return allOrders.filter(order => order.status === 'unfulfilled');
}

/**
 * Export orders to CSV format for franchise logistics company
 */
export function exportOrdersToCSV(orders: ShopifyOrder[]): string {
  // CSV Headers optimized for logistics companies
  const headers = [
    'Order Number',
    'Customer Name',
    'Email',
    'Phone',
    'Delivery Address',
    'Items Count',
    'Total Amount',
    'Order Date',
    'Status'
  ];

  const csvRows = [
    headers.join(','),
    ...orders.map(order => [
      order.orderNumber,
      `"${order.customerName}"`,
      order.email,
      order.phone || 'N/A',
      `"${order.address || 'N/A'}"`,
      order.items,
      order.total,
      order.date,
      order.status
    ].join(','))
  ];

  return csvRows.join('\n');
}

/**
 * Download CSV file
 */
export function downloadCSV(csvContent: string, filename: string): void {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

// Instructions for integrating with real Shopify API:
// 1. Create a Shopify app in your Shopify Partner Dashboard
// 2. Get your API credentials (API Key and Access Token)
// 3. Replace mock functions with actual API calls
// 4. Handle authentication and rate limiting
// 5. Add error handling for API failures
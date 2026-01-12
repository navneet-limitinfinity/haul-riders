import { useState, useEffect } from 'react';
import { OrderTable } from './components/OrderTable';
import { Package } from 'lucide-react';
import { fetchShopifyOrders } from './services/shopifyApi';

export default function App() {
  const [stats, setStats] = useState({
    showing: 0,
    totalLoaded: 0,
    fulfilled: 0,
    trackingAssigned: 0,
  });

  const [selectedStore, setSelectedStore] = useState('vaidiki-store');

  // Mock stores data
  const stores = [
    { id: 'vaidiki-store', name: 'Vaidiki Store', url: '64dd6e-2.myshopify.com' },
    { id: 'premium-store', name: 'Premium Store', url: '45abc3-1.myshopify.com' },
    { id: 'global-mart', name: 'Global Mart', url: '78xyz9-4.myshopify.com' },
  ];

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const orders = await fetchShopifyOrders();
      const fulfilled = orders.filter(o => o.status === 'fulfilled').length;
      
      setStats({
        showing: orders.length,
        totalLoaded: orders.length,
        fulfilled,
        trackingAssigned: Math.floor(orders.length * 0.5), // Mock tracking data
      });
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  };

  const currentStore = stores.find(s => s.id === selectedStore) || stores[0];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-[1600px] mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl text-gray-900">Haul Riders Courier</h1>
              <p className="text-sm text-gray-500">Orders dashboard</p>
            </div>
            
            {/* Store Selector */}
            <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
              <label className="text-xs text-gray-500 uppercase tracking-wider mb-2 block">
                Store
              </label>
              <select
                value={selectedStore}
                onChange={(e) => setSelectedStore(e.target.value)}
                className="w-64 px-3 py-2 bg-white border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {stores.map(store => (
                  <option key={store.id} value={store.id}>
                    {store.name}
                  </option>
                ))}
              </select>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-sm font-medium text-blue-600">{currentStore.name}</span>
                <span className="text-xs text-gray-500">{currentStore.url}</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-[1600px] mx-auto px-6 py-8">
        {/* Latest Orders Header */}
        <div className="mb-6">
          <h2 className="text-xl text-gray-900">Latest Orders</h2>
          <p className="text-sm text-gray-500">Fast view + export for ops and clients</p>
        </div>

        {/* Order Table Component */}
        <OrderTable stats={stats} onStatsUpdate={setStats} />
      </div>
    </div>
  );
}

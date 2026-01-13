import React, { useState, useEffect, useMemo } from 'react';
import { Download, RefreshCw, ArrowUpDown, ArrowUp, ArrowDown, Check, Clock } from 'lucide-react';
import { fetchShopifyOrders, ShopifyOrder, exportOrdersToCSV, downloadCSV } from '../services/shopifyApi';

type FilterType = 'all' | 'unfulfilled' | 'fulfilled';
type TrackingFilter = 'any' | 'assigned' | 'not-assigned';
type SortField = 'orderName' | 'orderNumber' | 'customerName' | 'total' | 'date';
type SortDirection = 'asc' | 'desc';

interface OrderTableProps {
  stats: {
    showing: number;
    totalLoaded: number;
    fulfilled: number;
    trackingAssigned: number;
  };
  onStatsUpdate: (stats: { showing: number; totalLoaded: number; fulfilled: number; trackingAssigned: number }) => void;
}

export function OrderTable({ stats, onStatsUpdate }: OrderTableProps) {
  const [filter, setFilter] = useState<FilterType>('all');
  const [trackingFilter, setTrackingFilter] = useState<TrackingFilter>('any');
  const [limit, setLimit] = useState<number>(10);
  const [orders, setOrders] = useState<ShopifyOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState<SortField>('orderName');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  useEffect(() => {
    loadOrders();
  }, []);

  const loadOrders = async () => {
    setLoading(true);
    try {
      const data = await fetchShopifyOrders();
      setOrders(data);
    } catch (error) {
      console.error('Failed to fetch orders:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) return <ArrowUpDown className="w-4 h-4 ml-3 opacity-40" aria-hidden />;
    return sortDirection === 'asc' ?
      <ArrowUp className="w-4 h-4 ml-3 text-blue-600" aria-hidden /> :
      <ArrowDown className="w-4 h-4 ml-3 text-blue-600" aria-hidden />;
  };

  const getAriaSort = (field: SortField) => {
    if (sortField !== field) return 'none';
    return sortDirection === 'asc' ? 'ascending' : 'descending';
  };

  const handleKeySort = (e: React.KeyboardEvent, field: SortField) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleSort(field);
    }
  };

  const filteredAndSortedOrders = useMemo(() => {
    const matchesStatusFilter = (order: ShopifyOrder) => filter === 'all' || order.status === filter;
    const matchesTrackingFilter = (order: ShopifyOrder) => {
      if (trackingFilter === 'assigned') return order.trackingAssigned;
      if (trackingFilter === 'not-assigned') return !order.trackingAssigned;
      return true;
    };

    const filtered = orders.filter(order => matchesStatusFilter(order) && matchesTrackingFilter(order));

    return [...filtered].sort((a, b) => {
      let aValue: string | number | Date | undefined;
      let bValue: string | number | Date | undefined;

      switch (sortField) {
        case 'orderName':
          aValue = a.orderNumber;
          bValue = b.orderNumber;
          break;
        case 'customerName':
          aValue = a.customerName;
          bValue = b.customerName;
          break;
        case 'total':
          aValue = parseFloat(a.total.replace('$', ''));
          bValue = parseFloat(b.total.replace('$', ''));
          break;
        case 'date':
          aValue = new Date(a.date);
          bValue = new Date(b.date);
          break;
        default:
          aValue = a.orderNumber;
          bValue = b.orderNumber;
      }

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [orders, filter, trackingFilter, sortField, sortDirection]);

  const displayedOrders = filteredAndSortedOrders.slice(0, limit);

  useEffect(() => {
    const fulfilled = orders.filter(order => order.status === 'fulfilled').length;
    const trackingAssignedCount = orders.filter(order => order.trackingAssigned).length;
    onStatsUpdate({
      showing: displayedOrders.length,
      totalLoaded: orders.length,
      fulfilled,
      trackingAssigned: trackingAssignedCount,
    });
  }, [displayedOrders.length, orders, onStatsUpdate]);

  // Apply limit
  const exportToCSV = () => {
    if (displayedOrders.length === 0) {
      alert('No orders to export');
      return;
    }

    const csvContent = exportOrdersToCSV(displayedOrders);
    const filename = `haul_riders_orders_${new Date().toISOString().split('T')[0]}.csv`;
    downloadCSV(csvContent, filename);
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
      {/* Controls Section */}
      <div className="p-6 border-b border-gray-200 bg-gray-50">
        <div className="flex flex-wrap items-center gap-6">
          {/* Fulfillment Filter */}
          <div className="flex-shrink-0">
            <label htmlFor="fulfillmentFilter" className="text-sm font-medium text-gray-700 mb-1 block">Fulfillment</label>
            <select
              id="fulfillmentFilter"
              value={filter}
              onChange={(e) => setFilter(e.target.value as FilterType)}
              className="px-4 h-10 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 min-w-[140px] shadow-sm"
            >
              <option value="all">All</option>
              <option value="unfulfilled">Unfulfilled</option>
              <option value="fulfilled">Fulfilled</option>
            </select>
          </div>

          {/* Tracking Filter */}
          <div className="flex-shrink-0">
            <label htmlFor="trackingFilter" className="text-sm font-medium text-gray-700 mb-1 block">Tracking</label>
            <select
              id="trackingFilter"
              value={trackingFilter}
              onChange={(e) => setTrackingFilter(e.target.value as TrackingFilter)}
              className="px-4 h-10 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 min-w-[140px] shadow-sm"
            >
              <option value="any">Any</option>
              <option value="assigned">Assigned</option>
              <option value="not-assigned">Not Assigned</option>
            </select>
          </div>

          {/* Limit */}
          <div className="flex-shrink-0">
            <label htmlFor="limitInput" className="text-sm font-medium text-gray-700 mb-1 block">Limit</label>
            <input
              id="limitInput"
              type="number"
              value={limit}
              onChange={(e) => {
                const val = parseInt(e.target.value) || 10;
                setLimit(Math.max(1, Math.min(100, val)));
              }}
              className="px-4 h-10 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 w-24 shadow-sm"
              min="1"
              max="100"
            />
          </div>

          <div className="flex-grow"></div>

          {/* Action Buttons */}
          <button
            onClick={loadOrders}
            disabled={loading}
            className="h-10 px-4 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors text-sm font-medium disabled:opacity-50 flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-blue-600' : 'text-gray-600'}`} />
            Refresh
          </button>

          <button
            onClick={exportToCSV}
            aria-label="Export orders as CSV"
            className="h-10 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="p-6 border-b border-gray-200">
        <div className="grid grid-cols-4 gap-6">
          <div className="bg-gray-50 rounded-md p-6 shadow-sm border border-gray-100">
            <div className="text-sm text-gray-500 uppercase tracking-wider mb-1">Showing</div>
            <div className="text-2xl font-semibold text-gray-900">{displayedOrders.length}</div>
          </div>
          <div className="bg-gray-50 rounded-md p-6 shadow-sm border border-gray-100">
            <div className="text-sm text-gray-500 uppercase tracking-wider mb-1">Total Loaded</div>
            <div className="text-2xl font-semibold text-gray-900">{stats.totalLoaded}</div>
          </div>
          <div className="bg-gray-50 rounded-md p-6 shadow-sm border border-gray-100">
            <div className="text-sm text-gray-500 uppercase tracking-wider mb-1">Fulfilled</div>
            <div className="text-2xl font-semibold text-gray-900">{stats.fulfilled}</div>
          </div>
          <div className="bg-gray-50 rounded-md p-6 shadow-sm border border-gray-100">
            <div className="text-sm text-gray-500 uppercase tracking-wider mb-1">Tracking Assigned</div>
            <div className="text-2xl font-semibold text-gray-900">{stats.trackingAssigned}</div>
          </div>
        </div>
      </div>

      {/* Info Text */}
      <div className="px-6 py-3 bg-gray-50 border-b border-gray-200">
        <p className="text-sm text-gray-700">
          Showing {displayedOrders.length} of {filteredAndSortedOrders.length} order(s) (limit={limit}).
        </p>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1200px] table-fixed">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-6 py-3 text-left text-sm text-gray-600 uppercase tracking-wider font-semibold">#</th>
              <th 
                className="px-6 py-3 text-left text-sm text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-100 font-semibold"
                role="button"
                tabIndex={0}
                onClick={() => handleSort('orderName')}
                onKeyDown={(e) => handleKeySort(e, 'orderName')}
                aria-sort={getAriaSort('orderName')}
              >
                <div className="flex items-center text-sm font-medium text-gray-700">
                  Order Name
                  {getSortIcon('orderName')}
                </div>
              </th>
              <th className="px-6 py-3 text-left text-sm text-gray-700 uppercase tracking-wider font-semibold">Order ID</th>
              <th 
                className="px-6 py-3 text-left text-sm text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-100 font-semibold"
                role="button"
                tabIndex={0}
                onClick={() => handleSort('customerName')}
                onKeyDown={(e) => handleKeySort(e, 'customerName')}
                aria-sort={getAriaSort('customerName')}
              >
                <div className="flex items-center text-sm font-medium text-gray-700">
                  Full Name
                  {getSortIcon('customerName')}
                </div>
              </th>
              <th className="px-6 py-4 text-left text-sm text-gray-700 uppercase tracking-wider">Address 1</th>
              <th className="px-6 py-4 text-left text-sm text-gray-700 uppercase tracking-wider">Address 2</th>
              <th className="px-6 py-4 text-left text-sm text-gray-700 uppercase tracking-wider">City</th>
              <th className="px-6 py-4 text-left text-sm text-gray-700 uppercase tracking-wider">State</th>
              <th className="px-6 py-4 text-left text-sm text-gray-700 uppercase tracking-wider">PIN Code</th>
              <th className="px-6 py-4 text-left text-sm text-gray-700 uppercase tracking-wider">Phone Number</th>
              <th 
                className="px-6 py-3 text-left text-sm text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-100 font-semibold"
                role="button"
                tabIndex={0}
                onClick={() => handleSort('total')}
                onKeyDown={(e) => handleKeySort(e, 'total')}
                aria-sort={getAriaSort('total')}
              >
                <div className="flex items-center text-sm font-medium text-gray-700">
                  Total Price
                  {getSortIcon('total')}
                </div>
              </th>
              <th className="px-6 py-4 text-left text-sm text-gray-700 uppercase tracking-wider">Tracking</th>
              <th className="px-6 py-4 text-left text-sm text-gray-700 uppercase tracking-wider">Fulfillment</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (
              <tr>
                <td colSpan={13} className="px-6 py-8 text-center text-gray-500">
                  <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
                  Loading orders...
                </td>
              </tr>
            ) : displayedOrders.length === 0 ? (
              <tr>
                <td colSpan={13} className="px-6 py-8 text-center text-gray-500">
                  No orders found
                </td>
              </tr>
            ) : (
              displayedOrders.map((order, index) => {
                // Parse address
                const addressParts = order.address?.split(',') || [];
                const address1 = addressParts[0] || 'N/A';
                const address2 = addressParts.slice(1, -3).join(',').trim() || '';
                const city = addressParts[addressParts.length - 3]?.trim() || '';
                const state = addressParts[addressParts.length - 2]?.trim() || '';
                const pinCode = addressParts[addressParts.length - 1]?.trim() || '';

                return (
                  <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 text-sm text-gray-900">{index + 1}</td>
                    <td className="px-6 py-4 text-sm text-gray-900">{order.orderNumber}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{order.id}</td>
                    <td className="px-6 py-4 text-sm text-gray-900">{order.customerName}</td>
                    <td className="px-6 py-4 text-sm text-gray-600 max-w-[220px]" title={address1}>
                      <div className="truncate">{address1}</div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 max-w-[180px]" title={address2 || ''}>
                      <div className="truncate">{address2 || '-'}</div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">{city}</td>
                    <td className="px-6 py-4 text-sm text-gray-900">{state}</td>
                    <td className="px-6 py-4 text-sm text-gray-900">{pinCode}</td>
                    <td className="px-6 py-4 text-sm text-gray-900">{order.phone || 'N/A'}</td>
                    <td className="px-6 py-4 text-sm text-gray-900">{order.total}</td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      <span
                        className={`inline-flex items-center px-3 py-1 rounded-md text-sm font-medium ${
                          order.trackingAssigned ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {order.trackingAssigned ? 'Assigned' : 'Pending'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center px-3 py-1 rounded-md text-sm font-medium ${
                          order.status === 'fulfilled'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-yellow-100 text-yellow-800'
                        }`}
                        aria-label={`Status: ${order.status}`}
                      >
                        {order.status === 'fulfilled' ? <Check className="w-4 h-4 mr-2 text-green-700" /> : <Clock className="w-4 h-4 mr-2 text-yellow-700" />}
                        <span>{order.status === 'fulfilled' ? 'Fulfilled' : 'Unfulfilled'}</span>
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

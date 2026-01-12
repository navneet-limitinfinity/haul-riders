import React from 'react';
import { OrderTable } from './components/OrderTable';

export default function App() {
  const [stats, setStats] = React.useState({ showing: 0, totalLoaded: 0, fulfilled: 0, trackingAssigned: 0 });

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-screen-xl mx-auto px-6">
        <h1 className="text-4xl font-semibold mb-6 leading-tight">Courier Dashboard — Orders</h1>
        <OrderTable stats={stats} onStatsUpdate={(s) => setStats(s)} />
      </div>
    </div>
  );
}

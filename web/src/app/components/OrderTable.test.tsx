import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import type { ShopifyOrder } from '../services/shopifyApi';
import App from '/src/app/App.tsx';

describe('OrderTable UI', () => {
  beforeEach(() => {
    // simulate desktop width for snapshot parity
    (global as unknown as Window).innerWidth = 1440;
    global.dispatchEvent(new Event('resize'));
  });

  it('renders table and header texts', () => {
    render(<App />);
    expect(screen.getByText(/Courier Dashboard/)).toBeInTheDocument();
    expect(screen.getByText(/Order Name/)).toBeInTheDocument();
    expect(screen.getByText(/Export CSV/)).toBeInTheDocument();
  });

  it('matches snapshot for desktop', () => {
    const { container } = render(<App />);
    expect(container).toMatchSnapshot();
  });

  it('renders empty state when no orders', async () => {
    // mock the API to return no orders
    const shopify = await import('../services/shopifyApi');
    vi.spyOn(shopify, 'fetchShopifyOrders').mockResolvedValueOnce([]);

    render(<App />);
    // wait for the no orders row
    expect(await screen.findByText(/No orders found/)).toBeInTheDocument();
  });

  it('matches snapshot with sample orders', async () => {
    const shopify = await import('../services/shopifyApi');
    vi.spyOn(shopify, 'fetchShopifyOrders').mockResolvedValueOnce([
      {
        id: 'gid://order/1',
        orderNumber: 'ORD-1001',
        customerName: 'Alice Example',
        address: '1 Main St, Suite 1, Gotham, NY, 10001',
        phone: '5551112222',
        total: '$19.99',
        date: '2026-01-01',
        status: 'fulfilled',
      },

      {
        id: 'gid://order/2',
        orderNumber: 'ORD-1002',
        customerName: 'Bob Example',
        address: '2 Main St, Apt 2, Metropolis, CA, 90001',
        phone: '5553334444',
        total: '$29.99',
        date: '2026-01-02',
        status: 'unfulfilled',
      },
    ] as unknown as ShopifyOrder[]);

    const { container } = render(<App />);
    // Wait for table rows to render
    expect(await screen.findByText(/ORD-1001/)).toBeInTheDocument();
    expect(await screen.findByText(/Alice Example/)).toBeInTheDocument();
    expect(container).toMatchSnapshot();
  });

  it('shows loading state while fetching', async () => {
    // mock a promise that never resolves to keep loading true
    const shopifyPromise = new Promise<ShopifyOrder[]>(() => {});
    const shopify = (await import('../services/shopifyApi')) as typeof import('../services/shopifyApi');
    vi.spyOn(shopify, 'fetchShopifyOrders').mockReturnValueOnce(shopifyPromise as unknown as Promise<ShopifyOrder[]>);

    render(<App />);
    expect(screen.getByText(/Loading orders/)).toBeInTheDocument();
  });
});

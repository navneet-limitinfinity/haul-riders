import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import App from '../../App';

describe('OrderTable UI', () => {
  beforeEach(() => {
    // simulate desktop width for snapshot parity
    (global as any).innerWidth = 1440;
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
    const shopify = await import('../../services/shopifyApi');
    vi.spyOn(shopify, 'fetchShopifyOrders').mockResolvedValueOnce([]);

    render(<App />);
    // wait for the no orders row
    expect(await screen.findByText(/No orders found/)).toBeInTheDocument();
  });

  it('shows loading state while fetching', () => {
    // mock a promise that never resolves to keep loading true
    const shopifyPromise = new Promise(() => {});
    const shopify = (await import('../../services/shopifyApi')) as any;
    vi.spyOn(shopify, 'fetchShopifyOrders').mockReturnValueOnce(shopifyPromise as any);

    render(<App />);
    expect(screen.getByText(/Loading orders/)).toBeInTheDocument();
  });
});

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
});

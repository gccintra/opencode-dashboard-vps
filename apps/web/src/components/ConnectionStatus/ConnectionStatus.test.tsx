import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ConnectionStatus, { useConnectionStatus } from './ConnectionStatus';
import { renderHook, act } from '@testing-library/react';

describe('useConnectionStatus', () => {
  let onlineSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    onlineSpy = vi.spyOn(navigator, 'onLine', 'get');
  });

  afterEach(() => {
    onlineSpy.mockRestore();
  });

  it('returns "connected" when navigator.onLine is true', () => {
    onlineSpy.mockReturnValue(true);
    const { result } = renderHook(() => useConnectionStatus());
    expect(result.current).toBe('connected');
  });

  it('returns "offline" when navigator.onLine is false', () => {
    onlineSpy.mockReturnValue(false);
    const { result } = renderHook(() => useConnectionStatus());
    expect(result.current).toBe('offline');
  });

  it('transitions to "connected" on window online event', () => {
    onlineSpy.mockReturnValue(false);
    const { result } = renderHook(() => useConnectionStatus());
    expect(result.current).toBe('offline');

    act(() => {
      onlineSpy.mockReturnValue(true);
      window.dispatchEvent(new Event('online'));
    });

    expect(result.current).toBe('connected');
  });

  it('transitions to "offline" on window offline event', () => {
    onlineSpy.mockReturnValue(true);
    const { result } = renderHook(() => useConnectionStatus());
    expect(result.current).toBe('connected');

    act(() => {
      onlineSpy.mockReturnValue(false);
      window.dispatchEvent(new Event('offline'));
    });

    expect(result.current).toBe('offline');
  });
});

describe('ConnectionStatus component', () => {
  let onlineSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    onlineSpy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  });

  afterEach(() => {
    onlineSpy.mockRestore();
  });

  it('renders the connection status button', () => {
    render(<ConnectionStatus />);
    expect(screen.getByTestId('connection-status-button')).toBeInTheDocument();
  });

  it('shows "Connected" label when online', () => {
    render(<ConnectionStatus />);
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('shows "Offline" label when offline', () => {
    onlineSpy.mockReturnValue(false);
    render(<ConnectionStatus />);
    expect(screen.getByText('Offline')).toBeInTheDocument();
  });

  it('renders the colored dot indicator', () => {
    render(<ConnectionStatus />);
    const dot = screen.getByTestId('connection-dot');
    expect(dot).toBeInTheDocument();
    // When connected, the dot should be green (#2d8)
    expect(dot.style.backgroundColor).toBe('rgb(34, 221, 136)');
  });

  it('shows red dot when offline', () => {
    onlineSpy.mockReturnValue(false);
    render(<ConnectionStatus />);
    const dot = screen.getByTestId('connection-dot');
    expect(dot.style.backgroundColor).toBe('rgb(255, 85, 68)');
  });

  it('opens tooltip on button click', () => {
    render(<ConnectionStatus />);
    const button = screen.getByTestId('connection-status-button');

    fireEvent.click(button);
    expect(screen.getByTestId('connection-tooltip')).toBeInTheDocument();
  });

  it('closes tooltip when clicking backdrop', () => {
    render(<ConnectionStatus />);
    const button = screen.getByTestId('connection-status-button');

    fireEvent.click(button);
    expect(screen.getByTestId('connection-tooltip')).toBeInTheDocument();

    const backdrop = screen.getByTestId('connection-tooltip-backdrop');
    fireEvent.click(backdrop);
    expect(screen.queryByTestId('connection-tooltip')).not.toBeInTheDocument();
  });

  it('toggles tooltip on repeated button clicks', () => {
    render(<ConnectionStatus />);
    const button = screen.getByTestId('connection-status-button');

    fireEvent.click(button);
    expect(screen.getByTestId('connection-tooltip')).toBeInTheDocument();

    fireEvent.click(button);
    expect(screen.queryByTestId('connection-tooltip')).not.toBeInTheDocument();
  });

  it('shows offline message in tooltip when offline', () => {
    onlineSpy.mockReturnValue(false);
    render(<ConnectionStatus />);
    const button = screen.getByTestId('connection-status-button');

    fireEvent.click(button);
    expect(screen.getByText(/No internet connection detected/)).toBeInTheDocument();
  });

  it('shows connected message in tooltip when online', () => {
    render(<ConnectionStatus />);
    const button = screen.getByTestId('connection-status-button');

    fireEvent.click(button);
    expect(screen.getByText(/All systems operational/)).toBeInTheDocument();
  });

  it('has accessible aria-label', () => {
    render(<ConnectionStatus />);
    const button = screen.getByTestId('connection-status-button');
    expect(button).toHaveAttribute('aria-label', 'Connection status: Connected');
  });

  it('updates aria-label when offline', () => {
    onlineSpy.mockReturnValue(false);
    render(<ConnectionStatus />);
    const button = screen.getByTestId('connection-status-button');
    expect(button).toHaveAttribute('aria-label', 'Connection status: Offline');
  });
});

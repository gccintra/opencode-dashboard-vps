import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import AppLayout from './AppLayout';

// Mock Sidebar
vi.mock('./Sidebar', () => ({
  default: () => <aside data-testid="sidebar">Sidebar</aside>,
  // AppLayout also imports the AlfLogo named export from this module.
  AlfLogo: () => <svg data-testid="alf-logo" />,
}));

// Mock EmergencyTerminal
vi.mock('../EmergencyTerminal/EmergencyTerminal', () => ({
  default: () => <div data-testid="emergency-terminal">Emergency</div>,
}));

// Mock react-router-dom's Outlet
vi.mock('react-router-dom', () => ({
  Outlet: () => <div data-testid="outlet">Outlet Content</div>,
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
  NavLink: ({
    children,
    to,
    className,
  }: {
    children: React.ReactNode | ((props: { isActive: boolean }) => React.ReactNode);
    to: string;
    className?: string | ((props: { isActive: boolean }) => string);
  }) => (
    <a
      href={to}
      className={typeof className === 'function' ? className({ isActive: false }) : className}
    >
      {typeof children === 'function' ? children({ isActive: false }) : children}
    </a>
  ),
}));

describe('AppLayout', () => {
  describe('structure', () => {
    it('renders the root layout container with correct classes', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { container }: { container: any } = render(<AppLayout />);
      const root = container.firstChild as HTMLElement;

      expect(root).toBeInTheDocument();
      expect(root.className).toContain('flex');
      expect(root.className).toContain('h-dvh');
      expect(root.className).toContain('bg-[#0a0a0f]');
    });

    it('renders the Sidebar component', () => {
      render(<AppLayout />);
      expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    });

    it('renders a <main> element with flex-1 and overflow-hidden classes', () => {
      render(<AppLayout />);
      const main = screen.getByRole('main');

      expect(main).toBeInTheDocument();
      expect(main.className).toContain('flex-1');
      expect(main.className).toContain('overflow-hidden');
    });

    it('renders the Outlet inside the <main> element', () => {
      render(<AppLayout />);
      const main = screen.getByRole('main');
      const outlet = screen.getByTestId('outlet');

      expect(outlet).toBeInTheDocument();
      expect(main).toContainElement(outlet);
    });
  });

  describe('layout composition', () => {
    it('Sidebar comes before main content area (left-to-right flex)', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { container }: { container: any } = render(<AppLayout />);
      const root = container.firstChild as HTMLElement;
      const children = root.children;

      expect(children[0]).toHaveAttribute('data-testid', 'sidebar');
      // children[1] is the content column that wraps the <main> element
      expect(children[1].querySelector('main')).not.toBeNull();
    });

    it('main content fills remaining space after sidebar', () => {
      render(<AppLayout />);
      const main = screen.getByRole('main');

      // With flex-1, main should take up remaining space
      expect(main.className).toContain('flex-1');
    });
  });
});

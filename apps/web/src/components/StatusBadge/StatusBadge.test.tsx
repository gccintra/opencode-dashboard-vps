import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatusBadge, { type BadgeStatus } from './StatusBadge';

describe('StatusBadge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: document is visible
    Object.defineProperty(document, 'hidden', {
      value: false,
      configurable: true,
    });
  });

  describe('renders correct colors and effects', () => {
    it('renders green dot for active status', () => {
      render(<StatusBadge status="active" />);
      const dot = screen.getByTestId('status-dot-active');
      expect(dot).toBeInTheDocument();
      expect(dot.style.backgroundColor).toBe('rgb(34, 221, 136)');
    });

    it('renders yellow dot for waiting status', () => {
      render(<StatusBadge status="waiting" />);
      const dot = screen.getByTestId('status-dot-waiting');
      expect(dot).toBeInTheDocument();
      expect(dot.style.backgroundColor).toBe('rgb(255, 170, 0)');
    });

    it('renders gray dot for finished status', () => {
      render(<StatusBadge status="finished" />);
      const dot = screen.getByTestId('status-dot-finished');
      expect(dot).toBeInTheDocument();
      expect(dot.style.backgroundColor).toBe('rgb(68, 68, 85)');
    });

    it('renders red dot for emergency status', () => {
      render(<StatusBadge status="emergency" />);
      const dot = screen.getByTestId('status-dot-emergency');
      expect(dot).toBeInTheDocument();
      expect(dot.style.backgroundColor).toBe('rgb(255, 85, 68)');
    });

    it('applies pulse animation for waiting', () => {
      render(<StatusBadge status="waiting" />);
      const dot = screen.getByTestId('status-dot-waiting');
      expect(dot.className).toContain('status-badge-pulse');
    });

    it('does NOT apply pulse for active', () => {
      render(<StatusBadge status="active" />);
      const dot = screen.getByTestId('status-dot-active');
      expect(dot.className).not.toContain('status-badge-pulse');
    });
  });

  describe('emergency prop', () => {
    it('overrides status to emergency when emergency=true', () => {
      render(<StatusBadge status="active" emergency />);
      const dot = screen.getByTestId('status-dot-emergency');
      expect(dot).toBeInTheDocument();
      expect(dot.style.backgroundColor).toBe('rgb(255, 85, 68)');
    });

    it('shows ⚠️ icon when emergency and showIcon=true', () => {
      render(<StatusBadge status="active" emergency showIcon />);
      expect(screen.getByTestId('emergency-icon')).toBeInTheDocument();
    });

    it('hides icon when showIcon=false', () => {
      render(<StatusBadge status="active" emergency showIcon={false} />);
      expect(screen.queryByTestId('emergency-icon')).not.toBeInTheDocument();
    });
  });

  describe('size variants', () => {
    it('renders sm size by default', () => {
      render(<StatusBadge status="active" />);
      const dot = screen.getByTestId('status-dot-active');
      expect(dot.className).toContain('size-[6px]');
    });
  });

  describe('document title change', () => {
    it('does NOT change title when tab is focused', () => {
      document.title = 'Original Title';
      render(<StatusBadge status="waiting" notifyOnWaiting />);
      expect(document.title).toBe('Original Title');
    });

    it('changes title when waiting and tab is hidden', () => {
      document.title = 'Original Title';
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });

      render(<StatusBadge status="waiting" notifyOnWaiting />);
      expect(document.title).toBe('⏳ Aguardando — ALF code');
    });
  });

  describe('data-testid', () => {
    it('renders status-badge wrapper', () => {
      render(<StatusBadge status="active" />);
      expect(screen.getByTestId('status-badge')).toBeInTheDocument();
    });

    it('uses correct test id for each status type', () => {
      const statuses: BadgeStatus[] = ['active', 'waiting', 'finished', 'emergency'];
      for (const s of statuses) {
        const { unmount } = render(<StatusBadge status={s} />);
        expect(screen.getByTestId(`status-dot-${s}`)).toBeInTheDocument();
        unmount();
      }
    });
  });
});

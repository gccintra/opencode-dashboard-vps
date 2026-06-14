/**
 * HarnessPreviewModal tests
 *
 * Tests for the preview-and-apply harness modal: rendering, harness
 * selection, file tree preview, conflict detection, apply flow.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

// Polyfill React.act — React 19 CJS bundle does not re-export `act`,
// but @testing-library/react 16 expects it via react-dom/test-utils.
if (typeof React.act !== 'function') {
  (React as unknown as Record<string, unknown>).act = (
    cb: () => void | Promise<void>,
  ) => cb();
}

import HarnessPreviewModal from './HarnessPreviewModal';

const sampleHarnesses = [
  { id: 'h1', name: 'React Starter', description: 'React + Vite template' },
  { id: 'h2', name: 'Node CLI', description: 'CLI tool template' },
];

const samplePreview = {
  files: [
    {
      path: 'src',
      size: 0,
      isDirectory: true,
      children: [
        { path: 'src/index.ts', size: 120, isDirectory: false },
      ],
    },
    { path: 'README.md', size: 500, isDirectory: false },
    { path: '.env.example', size: 30, isDirectory: false },
  ],
  conflicts: ['README.md'],
};

const defaultProps = {
  open: true,
  harnesses: sampleHarnesses,
  harnessesLoading: false,
  preview: null,
  previewLoading: false,
  selectedHarnessId: null,
  onHarnessChange: vi.fn(),
  onApply: vi.fn(),
  applying: false,
  applyError: null,
  onClose: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('HarnessPreviewModal', () => {
  it('renders when open is true', () => {
    render(<HarnessPreviewModal {...defaultProps} />);
    expect(screen.getByRole('heading', { name: 'Apply Template' })).toBeInTheDocument();
  });

  it('does not render when open is false', () => {
    render(<HarnessPreviewModal {...defaultProps} open={false} />);
    expect(screen.queryByText('Apply Template')).not.toBeInTheDocument();
  });

  it('shows harness selector dropdown', () => {
    render(<HarnessPreviewModal {...defaultProps} />);
    expect(screen.getByText('Select a template...')).toBeInTheDocument();
  });

  it('renders harness options in selector', () => {
    render(<HarnessPreviewModal {...defaultProps} />);
    expect(screen.getByText('React Starter')).toBeInTheDocument();
    expect(screen.getByText('Node CLI')).toBeInTheDocument();
  });

  it('shows loading state for harnesses', () => {
    render(
      <HarnessPreviewModal
        {...defaultProps}
        harnessesLoading={true}
        harnesses={[]}
      />,
    );
    // Loading skeleton should be present instead of the select
    const skeleton = document.querySelector('.animate-pulse');
    expect(skeleton).toBeTruthy();
  });

  it('shows placeholder when no harness selected', () => {
    render(<HarnessPreviewModal {...defaultProps} />);
    expect(screen.getByText('Select a template to preview its files')).toBeInTheDocument();
  });

  it('shows preview loading state', () => {
    render(
      <HarnessPreviewModal
        {...defaultProps}
        selectedHarnessId="h1"
        previewLoading={true}
      />,
    );
    const skeletons = document.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('shows file tree when preview is loaded', () => {
    render(
      <HarnessPreviewModal
        {...defaultProps}
        selectedHarnessId="h1"
        preview={samplePreview}
      />,
    );
    // File tree should render with testid
    expect(screen.getByTestId('harness-file-tree')).toBeInTheDocument();
  });

  it('shows conflict warning when conflicts exist', () => {
    render(
      <HarnessPreviewModal
        {...defaultProps}
        selectedHarnessId="h1"
        preview={samplePreview}
      />,
    );
    expect(screen.getByText(/1 file\(s\) already exist/)).toBeInTheDocument();
  });

  it('shows overwrite checkbox when conflicts exist', () => {
    render(
      <HarnessPreviewModal
        {...defaultProps}
        selectedHarnessId="h1"
        preview={samplePreview}
      />,
    );
    expect(screen.getByText('Overwrite existing files')).toBeInTheDocument();
  });

  it('does not show overwrite checkbox when no conflicts', () => {
    render(
      <HarnessPreviewModal
        {...defaultProps}
        selectedHarnessId="h1"
        preview={{ files: samplePreview.files, conflicts: [] }}
      />,
    );
    expect(screen.queryByText('Overwrite existing files')).not.toBeInTheDocument();
  });

  it('calls onApply when Apply Template button is clicked', async () => {
    const onApply = vi.fn();
    const user = userEvent.setup();

    render(
      <HarnessPreviewModal
        {...defaultProps}
        selectedHarnessId="h1"
        preview={samplePreview}
        onApply={onApply}
      />,
    );

    // Apply button should be enabled
    const applyBtn = screen.getByRole('button', { name: 'Apply Template' });
    expect(applyBtn).not.toBeDisabled();

    await user.click(applyBtn);
    expect(onApply).toHaveBeenCalledWith(false);
  });

  it('calls onApply with overwrite=true when checkbox is checked', async () => {
    const onApply = vi.fn();
    const user = userEvent.setup();

    render(
      <HarnessPreviewModal
        {...defaultProps}
        selectedHarnessId="h1"
        preview={samplePreview}
        onApply={onApply}
      />,
    );

    // Check the overwrite checkbox
    const checkbox = screen.getByText('Overwrite existing files').previousElementSibling as HTMLInputElement;
    await user.click(checkbox);

    // Click apply with overwrite
    await user.click(screen.getByRole('button', { name: 'Apply Template' }));
    expect(onApply).toHaveBeenCalledWith(true);
  });

  it('disables Apply button when no harness selected', () => {
    render(<HarnessPreviewModal {...defaultProps} />);

    const applyBtn = screen.getByRole('button', { name: 'Apply Template' });
    expect(applyBtn).toBeDisabled();
  });

  it('shows applying loading state', () => {
    render(
      <HarnessPreviewModal
        {...defaultProps}
        selectedHarnessId="h1"
        preview={samplePreview}
        applying={true}
      />,
    );

    expect(screen.getByText('Applying...')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeDisabled();
  });

  it('shows apply error', () => {
    render(
      <HarnessPreviewModal
        {...defaultProps}
        applyError="Failed to apply template"
      />,
    );

    expect(screen.getByText('Failed to apply template')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <HarnessPreviewModal
        {...defaultProps}
        onClose={onClose}
      />,
    );

    // Click the X button
    const closeBtn = screen.getByText('✕');
    await user.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when backdrop is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    const { container } = render(
      <HarnessPreviewModal
        {...defaultProps}
        onClose={onClose}
      />,
    );

    // Click the backdrop (first child of container is the overlay div)
    const backdrop = container.firstElementChild as HTMLElement;
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });
});

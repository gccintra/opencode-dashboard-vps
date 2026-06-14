/**
 * HarnessFormModal tests
 *
 * Tests for the create/edit harness modal: rendering, form validation,
 * submit/cancel behavior, error and loading states.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { HarnessFormModal } from './HarnessFormModal';

const defaultProps = {
  open: true,
  title: 'New Template',
  initial: { name: '', description: '' },
  onClose: vi.fn(),
  onSubmit: vi.fn(),
  error: null,
  loading: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('HarnessFormModal', () => {
  it('renders when open is true', () => {
    render(<HarnessFormModal {...defaultProps} />);
    expect(screen.getByText('New Template')).toBeInTheDocument();
  });

  it('does not render when open is false', () => {
    render(<HarnessFormModal {...defaultProps} open={false} />);
    expect(screen.queryByText('New Template')).not.toBeInTheDocument();
  });

  it('renders with edit title', () => {
    render(
      <HarnessFormModal
        {...defaultProps}
        title="Edit Template"
        initial={{ name: 'Existing', description: 'Existing desc' }}
      />,
    );
    expect(screen.getByText('Edit Template')).toBeInTheDocument();
  });

  it('calls onSubmit with form data when submitted', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();

    render(
      <HarnessFormModal
        {...defaultProps}
        onSubmit={onSubmit}
      />,
    );

    const nameInput = screen.getByPlaceholderText('Template name');
    await user.type(nameInput, 'My Template');

    const descInput = screen.getByPlaceholderText('Optional description');
    await user.type(descInput, 'My description');

    await user.click(screen.getByText('Create'));

    expect(onSubmit).toHaveBeenCalledWith({
      name: 'My Template',
      description: 'My description',
    });
  });

  it('shows validation error when name is empty', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();

    render(
      <HarnessFormModal
        {...defaultProps}
        onSubmit={onSubmit}
      />,
    );

    // Leave name empty and submit
    await user.click(screen.getByText('Create'));

    expect(screen.getByText('Name is required')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('calls onClose when cancel is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <HarnessFormModal
        {...defaultProps}
        onClose={onClose}
      />,
    );

    await user.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows error message when error prop is set', () => {
    render(
      <HarnessFormModal
        {...defaultProps}
        error="Something went wrong"
      />,
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('disables buttons when loading', () => {
    render(
      <HarnessFormModal
        {...defaultProps}
        loading={true}
      />,
    );

    expect(screen.getByText('Saving...')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeDisabled();
    expect(screen.getByText('Saving...')).toBeDisabled();
  });

  it('shows Save button for edit title', () => {
    render(
      <HarnessFormModal
        {...defaultProps}
        title="Edit Template"
      />,
    );

    expect(screen.getByText('Save')).toBeInTheDocument();
  });

  it('shows Create button for new title', () => {
    render(<HarnessFormModal {...defaultProps} />);

    expect(screen.getByText('Create')).toBeInTheDocument();
  });

  it('resets name error when user types', async () => {
    const user = userEvent.setup();

    render(<HarnessFormModal {...defaultProps} />);

    // Trigger validation error
    await user.click(screen.getByText('Create'));
    expect(screen.getByText('Name is required')).toBeInTheDocument();

    // Type something — error should clear
    const nameInput = screen.getByPlaceholderText('Template name');
    await user.type(nameInput, 'A');

    expect(screen.queryByText('Name is required')).not.toBeInTheDocument();
  });

  it('enforces max length on name input', async () => {
    const user = userEvent.setup();

    render(<HarnessFormModal {...defaultProps} />);

    const nameInput = screen.getByPlaceholderText('Template name') as HTMLInputElement;
    // Type a very long string (more than 64 chars)
    const longName = 'a'.repeat(100);
    await user.type(nameInput, longName);

    expect(nameInput.value.length).toBeLessThanOrEqual(64);
  });
});

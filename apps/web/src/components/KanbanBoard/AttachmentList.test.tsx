import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { Attachment } from '../../lib/api';

/**
 * Mock the api module. Crucially we mock `fetchAttachmentBlob` (which internally
 * injects the Bearer token) and do NOT set any Authorization header manually in
 * these tests. This proves the Blob/objectURL flow renders images via the
 * authenticated `apiFetch`-style path — not via a raw `<img src>` that would
 * 401 in a real browser.
 */
const fetchAttachmentBlob = vi.fn();
const deleteTaskAttachment = vi.fn();
const uploadTaskAttachment = vi.fn();

vi.mock('../../lib/api', () => ({
  fetchAttachmentBlob: (...args: unknown[]) => fetchAttachmentBlob(...args),
  deleteTaskAttachment: (...args: unknown[]) => deleteTaskAttachment(...args),
  uploadTaskAttachment: (...args: unknown[]) => uploadTaskAttachment(...args),
}));

import { AttachmentList } from './AttachmentList';

const createObjectURL = vi.fn(() => 'blob:mock-url');
const revokeObjectURL = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom doesn't implement the object-URL API — provide a mock.
  globalThis.URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
  globalThis.URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
});

afterEach(() => {
  vi.restoreAllMocks();
});

const imageAttachment: Attachment = {
  id: 'att-1',
  taskId: 'task-1',
  filename: 'screenshot.png',
  mime: 'image/png',
  size: 2048,
  createdAt: '2026-06-15T00:00:00.000Z',
};

const fileAttachment: Attachment = {
  id: 'att-2',
  taskId: 'task-1',
  filename: 'notes.pdf',
  mime: 'application/pdf',
  size: 4096,
  createdAt: '2026-06-15T00:00:00.000Z',
};

describe('AttachmentList — authenticated blob rendering', () => {
  it('renders an image via fetchAttachmentBlob + object URL (no manual auth header)', async () => {
    const blob = new Blob(['fake-bytes'], { type: 'image/png' });
    fetchAttachmentBlob.mockResolvedValue(blob);

    render(
      <AttachmentList taskId="task-1" attachments={[imageAttachment]} onChange={() => {}} />,
    );

    // The component must go through the authenticated fetch, not a raw <img src>.
    await waitFor(() => {
      expect(fetchAttachmentBlob).toHaveBeenCalledWith('task-1', 'att-1');
    });

    await waitFor(() => {
      const img = screen.getByAltText('screenshot.png') as HTMLImageElement;
      expect(img.getAttribute('src')).toBe('blob:mock-url');
    });

    expect(createObjectURL).toHaveBeenCalledWith(blob);
  });

  it('revokes the object URL on unmount to avoid leaks', async () => {
    const blob = new Blob(['fake-bytes'], { type: 'image/png' });
    fetchAttachmentBlob.mockResolvedValue(blob);

    const { unmount } = render(
      <AttachmentList taskId="task-1" attachments={[imageAttachment]} onChange={() => {}} />,
    );

    await waitFor(() => {
      const img = screen.getByAltText('screenshot.png') as HTMLImageElement;
      expect(img.getAttribute('src')).toBe('blob:mock-url');
    });

    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('falls back to the file icon when the blob fetch fails (e.g. 401)', async () => {
    fetchAttachmentBlob.mockRejectedValue({ status: 401, message: 'HTTP 401' });

    render(
      <AttachmentList taskId="task-1" attachments={[imageAttachment]} onChange={() => {}} />,
    );

    await waitFor(() => {
      expect(fetchAttachmentBlob).toHaveBeenCalled();
    });

    // No <img> rendered — the anchor has no object URL, only the fallback icon.
    expect(screen.queryByAltText('screenshot.png')).toBeNull();
  });

  it('renders non-image files as a downloadable link backed by an object URL', async () => {
    const blob = new Blob(['%PDF'], { type: 'application/pdf' });
    fetchAttachmentBlob.mockResolvedValue(blob);

    render(
      <AttachmentList taskId="task-1" attachments={[fileAttachment]} onChange={() => {}} />,
    );

    await waitFor(() => {
      expect(fetchAttachmentBlob).toHaveBeenCalledWith('task-1', 'att-2');
    });
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(screen.getByText('notes.pdf')).toBeInTheDocument();
  });

  it('deletes an attachment optimistically', async () => {
    const blob = new Blob(['fake-bytes'], { type: 'image/png' });
    fetchAttachmentBlob.mockResolvedValue(blob);
    deleteTaskAttachment.mockResolvedValue(undefined);
    const onChange = vi.fn();

    render(
      <AttachmentList taskId="task-1" attachments={[imageAttachment]} onChange={onChange} />,
    );

    fireEvent.click(screen.getByLabelText('Delete attachment screenshot.png'));

    expect(onChange).toHaveBeenCalledWith([]);
    await waitFor(() => {
      expect(deleteTaskAttachment).toHaveBeenCalledWith('task-1', 'att-1');
    });
  });
});

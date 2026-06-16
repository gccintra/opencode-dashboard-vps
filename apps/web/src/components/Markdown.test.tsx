import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Markdown } from './Markdown';

describe('Markdown', () => {
  describe('rendering', () => {
    it('renders headings and paragraphs', () => {
      render(<Markdown>{'# Hello\n\nA paragraph.'}</Markdown>);
      expect(screen.getByRole('heading', { name: 'Hello' })).toBeInTheDocument();
      expect(screen.getByText('A paragraph.')).toBeInTheDocument();
    });

    it('renders GFM tables (remark-gfm enabled)', () => {
      const md = ['| A | B |', '| - | - |', '| 1 | 2 |'].join('\n');
      render(<Markdown>{md}</Markdown>);
      expect(screen.getByRole('table')).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'A' })).toBeInTheDocument();
    });

    it('applies a custom className', () => {
      const { container } = render(<Markdown className="my-custom">hi</Markdown>);
      expect(container.querySelector('.my-custom')).not.toBeNull();
    });
  });

  describe('security: no raw HTML', () => {
    it('does not parse raw <script> tags into the DOM', () => {
      const { container } = render(
        <Markdown>{'before <script>window.__x = 1</script> after'}</Markdown>,
      );
      // No rehype-raw → the script tag is treated as literal text, not an element.
      expect(container.querySelector('script')).toBeNull();
    });

    it('does not render raw <img onerror> as an element', () => {
      const { container } = render(
        <Markdown>{'<img src=x onerror="alert(1)">'}</Markdown>,
      );
      // The raw HTML img should NOT become a real <img> element.
      expect(container.querySelector('img[onerror]')).toBeNull();
    });
  });

  describe('security: link sanitization', () => {
    it('renders http links as anchors with safe rel/target', () => {
      render(<Markdown>{'[click](https://example.com)'}</Markdown>);
      const link = screen.getByRole('link', { name: 'click' });
      expect(link).toHaveAttribute('href', 'https://example.com');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('strips javascript: URIs (renders text, not a link)', () => {
      render(<Markdown>{'[evil](javascript:alert(1))'}</Markdown>);
      // safeHref returns undefined → rendered as a <span>, not an <a>.
      expect(screen.queryByRole('link')).toBeNull();
      expect(screen.getByText('evil')).toBeInTheDocument();
    });

    it('strips data: URIs', () => {
      render(<Markdown>{'[x](data:text/html,<script>alert(1)</script>)'}</Markdown>);
      expect(screen.queryByRole('link')).toBeNull();
    });

    it('allows mailto links', () => {
      render(<Markdown>{'[mail](mailto:a@b.com)'}</Markdown>);
      const link = screen.getByRole('link', { name: 'mail' });
      expect(link).toHaveAttribute('href', 'mailto:a@b.com');
    });

    it('allows relative and anchor links', () => {
      render(<Markdown>{'[rel](/path) and [anchor](#sec)'}</Markdown>);
      expect(screen.getByRole('link', { name: 'rel' })).toHaveAttribute('href', '/path');
      expect(screen.getByRole('link', { name: 'anchor' })).toHaveAttribute('href', '#sec');
    });
  });
});

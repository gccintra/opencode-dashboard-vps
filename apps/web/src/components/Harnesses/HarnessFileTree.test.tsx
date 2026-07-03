/**
 * HarnessFileTree tests
 *
 * Tests for the recursive file tree component: rendering files and
 * directories, empty state, conflict highlighting, expand/collapse,
 * file size display.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import HarnessFileTree from './HarnessFileTree';
import type { FileEntry } from '../../lib/api';

const sampleFiles: FileEntry[] = [
  {
    path: 'src',
    size: 0,
    isDirectory: true,
    children: [
      { path: 'src/index.ts', size: 150, isDirectory: false },
      { path: 'src/utils.ts', size: 2048, isDirectory: false },
    ],
  },
  { path: 'README.md', size: 500, isDirectory: false },
  { path: '.env.example', size: 30, isDirectory: false },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('HarnessFileTree', () => {
  it('renders file tree with files and directories', () => {
    render(<HarnessFileTree files={sampleFiles} />);

    expect(screen.getByTestId('harness-file-tree')).toBeInTheDocument();
    expect(screen.getByTestId('harness-node-README.md')).toBeInTheDocument();
    expect(screen.getByTestId('harness-node-.env.example')).toBeInTheDocument();
  });

  it('shows empty state when files array is empty', () => {
    render(<HarnessFileTree files={[]} />);

    expect(screen.getByTestId('harness-tree-empty')).toBeInTheDocument();
    expect(screen.getByText('No files')).toBeInTheDocument();
  });

  it('shows empty state when files is null or undefined', () => {
    const { rerender } = render(<HarnessFileTree files={null as unknown as FileEntry[]} />);
    expect(screen.getByTestId('harness-tree-empty')).toBeInTheDocument();

    rerender(<HarnessFileTree files={undefined as unknown as FileEntry[]} />);
    expect(screen.getByTestId('harness-tree-empty')).toBeInTheDocument();
  });

  it('renders directory nodes', () => {
    render(<HarnessFileTree files={sampleFiles} />);

    // Directory name is extracted from path - 'src' is the dir name
    expect(screen.getByTestId('harness-node-src')).toBeInTheDocument();
  });

  it('renders file sizes for non-zero files', () => {
    render(<HarnessFileTree files={sampleFiles} />);

    // 500 bytes -> "500B", 150 bytes -> "150B"
    expect(screen.getByText('500B')).toBeInTheDocument();
    expect(screen.getByText('150B')).toBeInTheDocument();
  });

  it('formats sizes correctly', () => {
    const files: FileEntry[] = [
      { path: 'small.txt', size: 100, isDirectory: false },
      { path: 'medium.txt', size: 1500, isDirectory: false },
      { path: 'large.txt', size: 2 * 1024 * 1024, isDirectory: false },
    ];

    render(<HarnessFileTree files={files} />);

    expect(screen.getByText('100B')).toBeInTheDocument();
    expect(screen.getByText('1KB')).toBeInTheDocument();
    expect(screen.getByText('2.0MB')).toBeInTheDocument();
  });

  it('shows conflict highlighting on conflicted files', () => {
    const conflictPaths = new Set(['README.md']);
    const { container } = render(
      <HarnessFileTree files={sampleFiles} conflictPaths={conflictPaths} />,
    );

    const readmeNode = screen.getByTestId('harness-node-README.md');
    expect(readmeNode.className).toContain('bg-red-500/20');
  });

  it('calls onFileClick when a file is clicked', async () => {
    const onFileClick = vi.fn();
    const user = userEvent.setup();

    render(
      <HarnessFileTree files={sampleFiles} onFileClick={onFileClick} />,
    );

    const readmeNode = screen.getByTestId('harness-node-README.md');
    await user.click(readmeNode);

    expect(onFileClick).toHaveBeenCalledWith('README.md');
  });

  it('does not call onFileClick when a directory is clicked', async () => {
    const onFileClick = vi.fn();
    const user = userEvent.setup();

    render(
      <HarnessFileTree files={sampleFiles} onFileClick={onFileClick} />,
    );

    const srcNode = screen.getByTestId('harness-node-src');
    await user.click(srcNode);

    // Directory click toggles expand, does not call onFileClick
    expect(onFileClick).not.toHaveBeenCalled();
  });

  it('shows empty folder indicator for directories with no children', () => {
    const filesWithEmptyDir: FileEntry[] = [
      {
        path: 'empty-dir',
        size: 0,
        isDirectory: true,
        children: [],
      },
    ];

    render(<HarnessFileTree files={filesWithEmptyDir} />);

    // Click to expand the directory
    const dirNode = screen.getByTestId('harness-node-empty-dir');
    const user = userEvent.setup();
    // The directory is at depth 0, so it starts expanded. The "Empty" text
    // should be visible.
    expect(screen.getByText('Empty')).toBeInTheDocument();
  });

  it('assigns correct role and treeitem attributes', () => {
    render(<HarnessFileTree files={sampleFiles} />);

    const tree = screen.getByRole('tree');
    expect(tree).toBeInTheDocument();

    const items = screen.getAllByRole('treeitem');
    expect(items.length).toBeGreaterThan(0);
  });

  it('sets data-path attribute on each node', () => {
    render(<HarnessFileTree files={sampleFiles} />);

    const readmeNode = screen.getByTestId('harness-node-README.md');
    expect(readmeNode.getAttribute('data-path')).toBe('README.md');
  });

  it('shows children when directory is expanded', () => {
    render(<HarnessFileTree files={sampleFiles} />);

    // src dir should be expanded by default (depth < 1) and show its children
    expect(screen.getByTestId('harness-node-index.ts')).toBeInTheDocument();
    expect(screen.getByTestId('harness-node-utils.ts')).toBeInTheDocument();
  });

  it('uses JetBrains Mono font for file names (directories use the system font)', () => {
    render(<HarnessFileTree files={sampleFiles} />);

    const readmeNode = screen.getByTestId('harness-node-README.md');
    const nameSpan = readmeNode.querySelector('span.min-w-0');
    expect(nameSpan).toBeTruthy();
    // File spans use JetBrains_Mono class
    expect(nameSpan!.className).toContain('JetBrains_Mono');
  });

  it('renders a single file', () => {
    const files: FileEntry[] = [
      { path: 'index.ts', size: 120, isDirectory: false },
    ];
    render(<HarnessFileTree files={files} />);

    expect(screen.getByTestId('harness-node-index.ts')).toBeInTheDocument();
    expect(screen.getByTestId('harness-node-index.ts')).toHaveAttribute('data-path', 'index.ts');
  });

  it('expands and collapses directory on click', async () => {
    const user = userEvent.setup();
    const files: FileEntry[] = [
      {
        path: 'src',
        size: 0,
        isDirectory: true,
        children: [
          { path: 'src/index.ts', size: 120, isDirectory: false },
        ],
      },
    ];

    render(<HarnessFileTree files={files} />);

    // Starts expanded (depth < 1) -- children visible
    expect(screen.getByTestId('harness-node-index.ts')).toBeInTheDocument();

    // Click to collapse
    await user.click(screen.getByTestId('harness-node-src'));
    expect(screen.queryByTestId('harness-node-index.ts')).not.toBeInTheDocument();

    // Click to expand again
    await user.click(screen.getByTestId('harness-node-src'));
    expect(screen.getByTestId('harness-node-index.ts')).toBeInTheDocument();
  });

  it('shows conflict dot on parent directories when a child is conflicted', () => {
    const conflictPaths = new Set(['src/index.ts']);
    const { container } = render(
      <HarnessFileTree files={sampleFiles} conflictPaths={conflictPaths} />,
    );

    // Parent directory is NOT directly conflicted
    const dirNode = screen.getByTestId('harness-node-src');
    expect(dirNode.className).not.toContain('bg-red-500/20');

    // But it shows the conflict dot indicator because hasConflictsDescendant is true
    // ConflictDotIcon renders a <circle fill="#f87171" />
    const conflictCircles = container.querySelectorAll('circle[fill="#f87171"]');
    expect(conflictCircles.length).toBeGreaterThan(0);

    // The conflicted child file is highlighted in red
    const childNode = screen.getByTestId('harness-node-index.ts');
    expect(childNode.className).toContain('bg-red-500/20');
  });

  it('renders directories first then files in the given order', () => {
    // Data pre-sorted: directories before files, alphabetical within groups
    const sorted: FileEntry[] = [
      { path: 'assets', size: 0, isDirectory: true, children: [] },
      { path: 'src', size: 0, isDirectory: true, children: [] },
      { path: '.env.example', size: 30, isDirectory: false },
      { path: 'README.md', size: 50, isDirectory: false },
      { path: 'index.ts', size: 120, isDirectory: false },
    ];

    render(<HarnessFileTree files={sorted} />);

    const nodes = screen.getAllByRole('treeitem');
    expect(nodes).toHaveLength(5);

    expect(nodes[0]).toHaveAttribute('data-path', 'assets');
    expect(nodes[1]).toHaveAttribute('data-path', 'src');
    expect(nodes[2]).toHaveAttribute('data-path', '.env.example');
    expect(nodes[3]).toHaveAttribute('data-path', 'README.md');
    expect(nodes[4]).toHaveAttribute('data-path', 'index.ts');
  });
});

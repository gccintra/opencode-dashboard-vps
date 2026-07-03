import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  Button,
  IconButton,
  Panel,
  Modal,
  Input,
  Textarea,
  Select,
  Badge,
  SegmentedControl,
  Toolbar,
  EmptyState,
  cx,
} from './index';

describe('cx', () => {
  it('joins truthy classes and skips falsy ones', () => {
    expect(cx('a', false, null, undefined, 'b')).toBe('a b');
  });
});

describe('Button', () => {
  it('renders children and defaults to type=button', () => {
    render(<Button>Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn).toHaveAttribute('type', 'button');
  });

  it('applies primary variant classes', () => {
    render(<Button variant="primary">Go</Button>);
    expect(screen.getByRole('button').className).toContain('bg-accent');
  });

  it('applies danger variant classes', () => {
    render(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole('button').className).toContain('text-danger');
  });

  it('applies sm size height', () => {
    render(<Button size="sm">S</Button>);
    expect(screen.getByRole('button').className).toContain('h-[24px]');
  });

  it('fires onClick', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Click</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('IconButton', () => {
  it('requires and exposes aria-label', () => {
    render(<IconButton aria-label="Close">×</IconButton>);
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });
});

describe('Panel', () => {
  it('renders surface + hairline classes', () => {
    render(<Panel data-testid="panel">content</Panel>);
    const panel = screen.getByTestId('panel');
    expect(panel.className).toContain('bg-surface');
    expect(panel.className).toContain('border-hairline');
  });

  it('adds hover emphasis when interactive', () => {
    render(<Panel data-testid="panel" interactive />);
    expect(screen.getByTestId('panel').className).toContain(
      'hover:border-hairline-strong',
    );
  });
});

describe('Modal', () => {
  it('renders nothing when closed', () => {
    render(
      <Modal open={false} onClose={() => {}}>
        body
      </Modal>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders title, children and footer when open', () => {
    render(
      <Modal open onClose={() => {}} title="Title" footer={<button>OK</button>}>
        body
      </Modal>,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'OK' })).toBeInTheDocument();
  });

  it('closes on scrim click but not panel click', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose}>
        body
      </Modal>,
    );
    fireEvent.click(screen.getByText('body'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('ui-modal-scrim'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose}>
        body
      </Modal>,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('fields', () => {
  it('Input renders with placeholder', () => {
    render(<Input placeholder="Search" />);
    expect(screen.getByPlaceholderText('Search')).toBeInTheDocument();
  });

  it('Textarea renders', () => {
    render(<Textarea placeholder="Notes" />);
    expect(screen.getByPlaceholderText('Notes')).toBeInTheDocument();
  });

  it('Select renders options', () => {
    render(
      <Select aria-label="Pick">
        <option value="a">A</option>
      </Select>,
    );
    expect(screen.getByRole('combobox', { name: 'Pick' })).toBeInTheDocument();
  });
});

describe('Badge', () => {
  it('renders tone classes', () => {
    render(<Badge tone="success">live</Badge>);
    expect(screen.getByText('live').className).toContain('text-success');
  });

  it('renders a dot when requested', () => {
    render(
      <Badge tone="accent" dot data-testid="badge">
        3
      </Badge>,
    );
    const badge = screen.getByTestId('badge');
    expect(badge.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });

  it('uses mono face when mono', () => {
    render(<Badge mono>42</Badge>);
    expect(screen.getByText('42').className).toContain('JetBrains_Mono');
  });
});

describe('SegmentedControl', () => {
  const items = [
    { value: 'one', label: 'One' },
    { value: 'two', label: 'Two' },
  ];

  it('marks the active tab selected', () => {
    render(<SegmentedControl items={items} value="one" onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: 'One' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Two' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('calls onChange with the clicked value', () => {
    const onChange = vi.fn();
    render(<SegmentedControl items={items} value="one" onChange={onChange} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Two' }));
    expect(onChange).toHaveBeenCalledWith('two');
  });
});

describe('Toolbar', () => {
  it('renders children and end slot', () => {
    render(
      <Toolbar data-testid="toolbar" end={<span>right</span>}>
        <span>left</span>
      </Toolbar>,
    );
    expect(screen.getByText('left')).toBeInTheDocument();
    expect(screen.getByText('right')).toBeInTheDocument();
    expect(screen.getByTestId('toolbar').className).toContain('h-[44px]');
  });
});

describe('EmptyState', () => {
  it('renders title, description and action', () => {
    render(
      <EmptyState
        icon={<span>i</span>}
        title="No projects"
        description="Create one to get started."
        action={<Button variant="primary">New project</Button>}
      />,
    );
    expect(screen.getByText('No projects')).toBeInTheDocument();
    expect(screen.getByText('Create one to get started.')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'New project' }),
    ).toBeInTheDocument();
  });
});

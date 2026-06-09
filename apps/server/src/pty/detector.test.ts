/**
 * Tests for the session status detector.
 *
 * Covers:
 *  - OPENCODE_PROMPT_REGEX matching various real-world prompt patterns
 *  - detectStatus returning correct semantic status for all states
 *  - getLastActiveAt with and without dataAt
 *  - Edge cases: empty buffer, ANSI sequences, trailing whitespace
 */

import { describe, it, expect } from 'vitest';
import {
  detectStatus,
  getLastActiveAt,
  OPENCODE_PROMPT_REGEX,
  trimTrailingWhitespace,
} from './detector';

describe('OPENCODE_PROMPT_REGEX', () => {
  it('matches a standard shell prompt (user@host:path$)', () => {
    expect(OPENCODE_PROMPT_REGEX.test('user@host:~/project$ ')).toBe(true);
  });

  it('matches a prompt with a different user/host pattern', () => {
    expect(OPENCODE_PROMPT_REGEX.test('root@server:/home/user# ')).toBe(true);
  });

  it('matches a prompt with > continuation character', () => {
    expect(OPENCODE_PROMPT_REGEX.test('dev@mac:~/src> ')).toBe(true);
  });

  it('matches prompt with dots and hyphens in username', () => {
    expect(OPENCODE_PROMPT_REGEX.test('john.doe@my-host:~$ ')).toBe(true);
  });

  it('matches prompt with plus sign in username', () => {
    expect(OPENCODE_PROMPT_REGEX.test('admin+ci@runner:/tmp$ ')).toBe(true);
  });

  it('matches a prompt with relative path', () => {
    expect(OPENCODE_PROMPT_REGEX.test('user@vps:opencode-dashboard$ ')).toBe(true);
  });

  it('matches a prompt with trailing spaces', () => {
    expect(OPENCODE_PROMPT_REGEX.test('user@host:~/dir$   ')).toBe(true);
  });

  it('does NOT match a string without @host part', () => {
    expect(OPENCODE_PROMPT_REGEX.test('some random output here')).toBe(false);
  });

  it('does NOT match just a $ in the middle of text', () => {
    expect(OPENCODE_PROMPT_REGEX.test('hello $world stuff')).toBe(false);
  });

  it('does NOT match the $ followed by a letter (no space)', () => {
    expect(OPENCODE_PROMPT_REGEX.test('user@host:~$ls')).toBe(false);
  });

  it('matches prompt at the end of a multi-line buffer', () => {
    const buf = 'Loading configuration...\nDone.\nuser@host:~/project$ ';
    expect(OPENCODE_PROMPT_REGEX.test(buf)).toBe(true);
  });

  it('does NOT match when prompt is in the middle of the buffer', () => {
    const buf = 'user@host:~/project$ something else after';
    expect(OPENCODE_PROMPT_REGEX.test(buf)).toBe(false);
  });

  it('matches prompt ending with # (root shell)', () => {
    expect(OPENCODE_PROMPT_REGEX.test('root@server:/# ')).toBe(true);
  });

  it('does NOT match a simple dollar sign in text', () => {
    expect(OPENCODE_PROMPT_REGEX.test('Cost: $49.99')).toBe(false);
  });
});

describe('detectStatus', () => {
  it('returns finished when session.status is exited', () => {
    expect(detectStatus({ status: 'exited', buffer: 'user@host:~$ ' })).toBe('finished');
  });

  it('returns finished when session.status is killed', () => {
    expect(detectStatus({ status: 'killed', buffer: 'user@host:~$ ' })).toBe('finished');
  });

  it('returns waiting when buffer ends with prompt and status is active', () => {
    expect(detectStatus({ status: 'active', buffer: 'user@host:~/project$ ' })).toBe('waiting');
  });

  it('returns waiting when buffer ends with prompt and status is pending', () => {
    expect(detectStatus({ status: 'pending', buffer: 'user@host:~/project$ ' })).toBe('waiting');
  });

  it('returns active when buffer is empty and status is active', () => {
    expect(detectStatus({ status: 'active', buffer: '' })).toBe('active');
  });

  it('returns active when buffer is empty and status is pending', () => {
    expect(detectStatus({ status: 'pending', buffer: '' })).toBe('active');
  });

  it('returns active when buffer has content but no prompt', () => {
    expect(detectStatus({ status: 'active', buffer: 'Running some task...\n' })).toBe('active');
  });

  it('returns finished even if buffer has a prompt (exited overrides)', () => {
    expect(detectStatus({ status: 'exited', buffer: 'user@host:~$ ' })).toBe('finished');
  });

  it('handles buffer with ANSI escape sequences', () => {
    const buf = ' \x1b[0m\x1b[01;32muser@host\x1b[00m:\x1b[01;34m~/project\x1b[00m$ ';
    expect(detectStatus({ status: 'active', buffer: buf })).toBe('waiting');
  });

  it('does NOT detect prompt when status is exited', () => {
    expect(detectStatus({ status: 'exited', buffer: 'user@host:~$ ' })).toBe('finished');
  });

  it('handles multiline buffer with prompt at the end', () => {
    const buf = 'line1\nline2\nline3\nuser@host:/app$ ';
    expect(detectStatus({ status: 'active', buffer: buf })).toBe('waiting');
  });

  it('handles multiline buffer with ANSI and prompt at the end', () => {
    const buf =
      '\x1b[0;32m✔\x1b[0m Completed\n\x1b[0;34mℹ\x1b[0m Waiting for next instruction\nuser@vps:~/src$ ';
    expect(detectStatus({ status: 'active', buffer: buf })).toBe('waiting');
  });
});

describe('getLastActiveAt', () => {
  it('returns dataAt when present', () => {
    const t = Date.now();
    const session = { createdAt: t - 5000, dataAt: t };
    expect(getLastActiveAt(session)).toBe(t);
  });

  it('falls back to createdAt when dataAt is undefined', () => {
    const t = Date.now();
    const session = { createdAt: t };
    expect(getLastActiveAt(session)).toBe(t);
  });

  it('returns createdAt when dataAt is explicitly undefined', () => {
    const t = Date.now();
    const session = { createdAt: t, dataAt: undefined };
    expect(getLastActiveAt(session)).toBe(t);
  });
});

describe('trimTrailingWhitespace', () => {
  it('removes trailing spaces', () => {
    expect(trimTrailingWhitespace('hello   ')).toBe('hello');
  });

  it('removes trailing newlines', () => {
    expect(trimTrailingWhitespace('hello\n\n')).toBe('hello');
  });

  it('removes trailing carriage returns', () => {
    expect(trimTrailingWhitespace('hello\r\r')).toBe('hello');
  });

  it('removes trailing tabs', () => {
    expect(trimTrailingWhitespace('hello\t\t')).toBe('hello');
  });

  it('removes mixed trailing whitespace', () => {
    expect(trimTrailingWhitespace('hello \t\n\r  ')).toBe('hello');
  });

  it('preserves leading whitespace', () => {
    expect(trimTrailingWhitespace('  hello  ')).toBe('  hello');
  });

  it('returns empty string when only whitespace', () => {
    expect(trimTrailingWhitespace('   \n\t\r')).toBe('');
  });

  it('returns string unchanged when no trailing whitespace', () => {
    expect(trimTrailingWhitespace('hello')).toBe('hello');
  });
});

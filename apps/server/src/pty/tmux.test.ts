/**
 * Unit tests for the pure tmux arg/name helpers. The administrative commands
 * (kill/has/list) shell out via execFile and are exercised in integration, not
 * here.
 */

import { describe, it, expect } from 'vitest';
import { TMUX_PREFIX, tmuxName, sessionIdFromTmuxName, buildTmuxSpawnArgs } from './tmux';

describe('tmux naming', () => {
  it('prefixes session ids with alf_', () => {
    expect(TMUX_PREFIX).toBe('alf_');
    expect(tmuxName('abc')).toBe('alf_abc');
  });

  it('round-trips id ↔ tmux name', () => {
    const id = '534ba9c3-e78d-4273';
    expect(sessionIdFromTmuxName(tmuxName(id))).toBe(id);
  });

  it('returns null for names without the prefix', () => {
    expect(sessionIdFromTmuxName('scratch')).toBeNull();
    expect(sessionIdFromTmuxName('myalf_x')).toBeNull();
  });
});

describe('buildTmuxSpawnArgs', () => {
  it('builds an idempotent attach/create new-session', () => {
    const args = buildTmuxSpawnArgs('s1', 100, 40);
    expect(args[0]).toBe('tmux');
    expect(args).toContain('-f');
    expect(args).toContain('new-session');
    // -A makes it attach-if-exists / create-if-not.
    expect(args).toContain('-A');
    expect(args).toContain('-s');
    expect(args).toContain('alf_s1');
    expect(args).toContain('-x');
    expect(args).toContain('100');
    expect(args).toContain('-y');
    expect(args).toContain('40');
  });

  it('starts with the tmux binary (control mode prepends -C)', () => {
    expect(buildTmuxSpawnArgs('s1', 80, 24)[0]).toBe('tmux');
  });

  it('appends the inner command as the last arg, trailing newline stripped', () => {
    const args = buildTmuxSpawnArgs('s1', 80, 24, 'claude --model x; exec zsh\n');
    expect(args[args.length - 1]).toBe('claude --model x; exec zsh');
  });

  it('omits the inner command when not provided (default shell)', () => {
    const args = buildTmuxSpawnArgs('s1', 80, 24);
    // No trailing free-form command — last token is the rows value.
    expect(args[args.length - 1]).toBe('24');
  });

  it('omits the inner command when blank', () => {
    const args = buildTmuxSpawnArgs('s1', 80, 24, '   \n');
    expect(args).not.toContain('');
    expect(args[args.length - 1]).toBe('24');
  });

  it('injects env as -e KEY=VAL pairs (tmux ≥ 3.2)', () => {
    const args = buildTmuxSpawnArgs('s1', 80, 24, 'claude', {
      OPENCODE_ACTIVE_SKILLS: 'a,b',
    });
    const i = args.indexOf('-e');
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe('OPENCODE_ACTIVE_SKILLS=a,b');
    // Inner command still last.
    expect(args[args.length - 1]).toBe('claude');
  });
});

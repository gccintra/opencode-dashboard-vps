/**
 * Unit tests for buildCliCommand — focused on the `resumeConversationId`
 * flag added for the recover-conversations feature. These are pure-function
 * tests (no PTY manager, no tmux, no auth), so they need none of the mocks
 * that sessions.test.ts sets up.
 */

import { describe, it, expect } from 'vitest';
import { buildCliCommand } from './sessions';

describe('buildCliCommand — resumeConversationId', () => {
  const UUID = '00ec27b6-3151-4763-8a74-7a80b648ca87';

  it('appends --resume <id> for the claude runtime', () => {
    const cmd = buildCliCommand({ agentType: 'claude', resumeConversationId: UUID });
    expect(cmd).toContain('--resume');
    expect(cmd).toContain(`'${UUID}'`);
  });

  it('defaults to claude (no agentType) and still appends --resume', () => {
    const cmd = buildCliCommand({ resumeConversationId: UUID });
    expect(cmd.startsWith('claude')).toBe(true);
    expect(cmd).toContain(`--resume '${UUID}'`);
  });

  it('does NOT append --resume for the opencode runtime', () => {
    const cmd = buildCliCommand({ agentType: 'opencode', resumeConversationId: UUID });
    expect(cmd).not.toContain('--resume');
  });

  it('omits --resume when resumeConversationId is absent', () => {
    const cmd = buildCliCommand({ agentType: 'claude' });
    expect(cmd).not.toContain('--resume');
  });

  it('omits --resume when resumeConversationId is empty/whitespace', () => {
    expect(buildCliCommand({ resumeConversationId: '' })).not.toContain('--resume');
    expect(buildCliCommand({ resumeConversationId: '   ' })).not.toContain('--resume');
  });

  it('shell-quotes the conversation id to prevent injection', () => {
    const malicious = `abc'; rm -rf /; '`;
    const cmd = buildCliCommand({ agentType: 'claude', resumeConversationId: malicious });
    // The single quote inside the value must be escaped, so the dangerous
    // payload stays inside a quoted string rather than terminating it.
    expect(cmd).toContain(`'abc'\\''; rm -rf /; '\\'''`);
  });

  it('coexists with model and effort flags', () => {
    const cmd = buildCliCommand({
      agentType: 'claude',
      model: 'sonnet',
      effort: 'high',
      resumeConversationId: UUID,
    });
    expect(cmd).toContain(`--model 'sonnet'`);
    expect(cmd).toContain(`--effort 'high'`);
    expect(cmd).toContain(`--resume '${UUID}'`);
  });

  it('still terminates with the keep-alive shell exec', () => {
    const cmd = buildCliCommand({ resumeConversationId: UUID });
    expect(cmd).toContain('exec zsh 2>&1 || exec bash');
  });
});

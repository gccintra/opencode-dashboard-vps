/**
 * Unit tests for the control-mode transport's pure decode/encode helpers.
 * These run under vitest (Node) — no Bun, no tmux. The live integration
 * (spawn→stream→write→resize→kill against a real tmux) is exercised by
 * `scripts/poc-control-mode/integration.ts` under Bun.
 */

import { describe, it, expect } from 'vitest';
import { unescapeOutput, toSendKeysHex } from './control';

const enc = (s: string) => new TextEncoder().encode(s);
const bytes = (u: Uint8Array) => [...u];

describe('unescapeOutput — tmux %output octal un-escaping', () => {
  it('decodes an ANSI color sequence (\\033[31mRED\\033[0m)', () => {
    expect(bytes(unescapeOutput(enc('\\033[31mRED\\033[0m')))).toEqual([
      0x1b, ...bytes(enc('[31mRED')), 0x1b, ...bytes(enc('[0m')),
    ]);
  });

  it('decodes TAB (\\011)', () => {
    expect(bytes(unescapeOutput(enc('a\\011b')))).toEqual([0x61, 0x09, 0x62]);
  });

  it('decodes CRLF (\\015\\012)', () => {
    expect(bytes(unescapeOutput(enc('x\\015\\012')))).toEqual([0x78, 0x0d, 0x0a]);
  });

  it('decodes an escaped backslash (\\\\ → \\)', () => {
    expect(bytes(unescapeOutput(enc('a\\\\b')))).toEqual([0x61, 0x5c, 0x62]);
  });

  it('passes printable bytes through literally', () => {
    expect(bytes(unescapeOutput(enc('hello')))).toEqual(bytes(enc('hello')));
  });

  it('decodes high UTF-8 bytes given as octal (\\302\\251 → ©)', () => {
    expect(bytes(unescapeOutput(enc('\\302\\251')))).toEqual([0xc2, 0xa9]);
  });

  it('respects a start offset (skips a stripped prefix)', () => {
    // simulate "%output %0 AB" — caller passes the index just past "%0 "
    const line = enc('%output %0 A\\011B');
    const dataStart = line.indexOf(0x41); // first 'A'
    expect(bytes(unescapeOutput(line, dataStart))).toEqual([0x41, 0x09, 0x42]);
  });

  it('is a no-op on empty input', () => {
    expect(bytes(unescapeOutput(new Uint8Array(0)))).toEqual([]);
  });
});

describe('toSendKeysHex — send-keys -H encoding', () => {
  it('encodes an escape sequence as space-separated lowercase hex', () => {
    expect(toSendKeysHex(new Uint8Array([0x1b, 0x5b, 0x41]))).toBe('1b 5b 41');
  });

  it('zero-pads single-digit bytes', () => {
    expect(toSendKeysHex(new Uint8Array([0x00, 0x09, 0x0a]))).toBe('00 09 0a');
  });

  it('round-trips UTF-8 multibyte input', () => {
    expect(toSendKeysHex(new TextEncoder().encode('é'))).toBe('c3 a9');
  });

  it('returns an empty string for empty input', () => {
    expect(toSendKeysHex(new Uint8Array(0))).toBe('');
  });
});

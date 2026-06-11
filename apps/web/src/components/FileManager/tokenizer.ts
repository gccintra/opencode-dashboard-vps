/* ── Syntax Highlighter ─────────────────────────────────────────────
   Backdrop technique: highlights code as HTML, placed behind a
   transparent textarea. No external deps.
   ─────────────────────────────────────────────────────────────────── */

export type ThemeName = 'dark-plus' | 'one-dark' | 'monokai' | 'github-dark';

interface ThemeColors {
  keyword: string;
  type: string;
  string: string;
  comment: string;
  number: string;
  fn: string;
  prop: string;
  operator: string;
  tag: string;
  attr: string;
  builtin: string;
  decorator: string;
  regex: string;
  text: string;
}

export const THEMES: Record<ThemeName, ThemeColors> = {
  'dark-plus': {
    keyword: '#569cd6',
    type: '#4ec9b0',
    string: '#ce9178',
    comment: '#6a9955',
    number: '#b5cea8',
    fn: '#dcdcaa',
    prop: '#9cdcfe',
    operator: '#d4d4d4',
    tag: '#4ec9b0',
    attr: '#9cdcfe',
    builtin: '#4ec9b0',
    decorator: '#dcdcaa',
    regex: '#d16969',
    text: '#d4d4d4',
  },
  'one-dark': {
    keyword: '#c678dd',
    type: '#e5c07b',
    string: '#98c379',
    comment: '#5c6370',
    number: '#d19a66',
    fn: '#61afef',
    prop: '#e06c75',
    operator: '#abb2bf',
    tag: '#e06c75',
    attr: '#d19a66',
    builtin: '#56b6c2',
    decorator: '#61afef',
    regex: '#e06c75',
    text: '#abb2bf',
  },
  monokai: {
    keyword: '#f92672',
    type: '#66d9e8',
    string: '#e6db74',
    comment: '#75715e',
    number: '#ae81ff',
    fn: '#a6e22e',
    prop: '#fd971f',
    operator: '#f8f8f2',
    tag: '#f92672',
    attr: '#a6e22e',
    builtin: '#66d9e8',
    decorator: '#a6e22e',
    regex: '#e6db74',
    text: '#f8f8f2',
  },
  'github-dark': {
    keyword: '#ff7b72',
    type: '#79c0ff',
    string: '#a5d6ff',
    comment: '#8b949e',
    number: '#79c0ff',
    fn: '#d2a8ff',
    prop: '#e3b341',
    operator: '#c9d1d9',
    tag: '#7ee787',
    attr: '#79c0ff',
    builtin: '#79c0ff',
    decorator: '#d2a8ff',
    regex: '#a5d6ff',
    text: '#c9d1d9',
  },
};

export const DEFAULT_THEME: ThemeName = 'dark-plus';

/* ── Language detection from extension ── */
export function langFromExtension(ext: string): string {
  const map: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.json': 'json',
    '.jsonc': 'json',
    '.md': 'markdown',
    '.mdx': 'markdown',
    '.css': 'css',
    '.scss': 'css',
    '.sass': 'css',
    '.html': 'html',
    '.htm': 'html',
    '.svg': 'html',
    '.xml': 'html',
    '.py': 'python',
    '.rs': 'rust',
    '.go': 'go',
    '.sql': 'sql',
    '.sh': 'bash',
    '.bash': 'bash',
    '.zsh': 'bash',
    '.env': 'env',
    '.gitignore': 'gitignore',
    '.yml': 'yaml',
    '.yaml': 'yaml',
  };
  return map[ext.toLowerCase()] ?? 'text';
}

/* ── HTML escape ── */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function span(color: string, content: string): string {
  return `<span style="color:${color}">${content}</span>`;
}

/* ── Stash/restore technique to protect already-processed tokens ── */
type Stash = string[];

function stash(arr: Stash, s: string): string {
  arr.push(s);
  return `\x00${arr.length - 1}\x00`;
}

function restore(s: string, arr: Stash): string {
  return s.replace(/\x00(\d+)\x00/g, (_, i) => arr[Number(i)]);
}

/* ── Keyword sets ── */
const TS_KEYWORDS = new Set([
  'abstract',
  'as',
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'declare',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'from',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'keyof',
  'let',
  'module',
  'namespace',
  'new',
  'null',
  'of',
  'override',
  'private',
  'protected',
  'public',
  'readonly',
  'return',
  'satisfies',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'type',
  'typeof',
  'undefined',
  'var',
  'void',
  'while',
  'with',
  'yield',
]);
const TS_TYPES = new Set([
  'any',
  'boolean',
  'never',
  'number',
  'object',
  'string',
  'symbol',
  'unknown',
  'bigint',
  'Array',
  'Promise',
  'Record',
  'Map',
  'Set',
  'Error',
  'Date',
  'RegExp',
  'Function',
  'Object',
  'Partial',
  'Required',
  'Readonly',
  'Pick',
  'Omit',
  'Exclude',
  'Extract',
  'NonNullable',
  'ReturnType',
  'InstanceType',
  'Parameters',
]);
const PY_KEYWORDS = new Set([
  'False',
  'None',
  'True',
  'and',
  'as',
  'assert',
  'async',
  'await',
  'break',
  'class',
  'continue',
  'def',
  'del',
  'elif',
  'else',
  'except',
  'finally',
  'for',
  'from',
  'global',
  'if',
  'import',
  'in',
  'is',
  'lambda',
  'nonlocal',
  'not',
  'or',
  'pass',
  'raise',
  'return',
  'try',
  'while',
  'with',
  'yield',
]);
const GO_KEYWORDS = new Set([
  'break',
  'case',
  'chan',
  'const',
  'continue',
  'default',
  'defer',
  'else',
  'fallthrough',
  'for',
  'func',
  'go',
  'goto',
  'if',
  'import',
  'interface',
  'map',
  'package',
  'range',
  'return',
  'select',
  'struct',
  'switch',
  'type',
  'var',
  'nil',
  'true',
  'false',
]);
const RUST_KEYWORDS = new Set([
  'as',
  'async',
  'await',
  'break',
  'const',
  'continue',
  'crate',
  'dyn',
  'else',
  'enum',
  'extern',
  'false',
  'fn',
  'for',
  'if',
  'impl',
  'in',
  'let',
  'loop',
  'match',
  'mod',
  'move',
  'mut',
  'pub',
  'ref',
  'return',
  'self',
  'Self',
  'static',
  'struct',
  'super',
  'trait',
  'true',
  'type',
  'union',
  'unsafe',
  'use',
  'where',
  'while',
]);
const SQL_KEYWORDS = new Set([
  'SELECT',
  'FROM',
  'WHERE',
  'AND',
  'OR',
  'NOT',
  'IN',
  'IS',
  'NULL',
  'ORDER',
  'BY',
  'GROUP',
  'HAVING',
  'LIMIT',
  'OFFSET',
  'JOIN',
  'LEFT',
  'RIGHT',
  'INNER',
  'OUTER',
  'FULL',
  'ON',
  'INSERT',
  'INTO',
  'VALUES',
  'UPDATE',
  'SET',
  'DELETE',
  'CREATE',
  'TABLE',
  'DROP',
  'ALTER',
  'INDEX',
  'UNIQUE',
  'PRIMARY',
  'KEY',
  'FOREIGN',
  'REFERENCES',
  'AS',
  'CASE',
  'WHEN',
  'THEN',
  'ELSE',
  'END',
  'DISTINCT',
  'COUNT',
  'SUM',
  'AVG',
  'MAX',
  'MIN',
  'WITH',
  'UNION',
  'ALL',
  'EXISTS',
  'LIKE',
  'BETWEEN',
]);

/* ── Main highlight function ── */
export function highlight(code: string, lang: string, theme: ThemeName = DEFAULT_THEME): string {
  const c = THEMES[theme];
  if (!code) return '';

  switch (lang) {
    case 'typescript':
      return highlightTS(code, c, true);
    case 'javascript':
      return highlightTS(code, c, false);
    case 'json':
      return highlightJSON(code, c);
    case 'python':
      return highlightPython(code, c);
    case 'css':
      return highlightCSS(code, c);
    case 'html':
      return highlightHTML(code, c);
    case 'rust':
      return highlightGeneric(code, c, RUST_KEYWORDS, new Set());
    case 'go':
      return highlightGeneric(code, c, GO_KEYWORDS, new Set());
    case 'sql':
      return highlightSQL(code, c);
    case 'bash':
      return highlightBash(code, c);
    case 'markdown':
      return highlightMarkdown(code, c);
    case 'yaml':
      return highlightYAML(code, c);
    default:
      return esc(code);
  }
}

/* ── TypeScript / JavaScript ── */
function highlightTS(code: string, c: ThemeColors, isTS: boolean): string {
  const stored: Stash = [];
  let s = esc(code);

  // JSX/TSX tags — stash early
  // Block comments
  s = s.replace(/\/\*[\s\S]*?\*\//g, (m) => stash(stored, span(c.comment, m)));
  // Single-line comments
  s = s.replace(/\/\/.*/g, (m) => stash(stored, span(c.comment, m)));
  // Template literals (simplified — no nested ${} processing)
  s = s.replace(/`[^`\\]*(?:\\.[^`\\]*)*`/gs, (m) => stash(stored, span(c.string, m)));
  // Regex literals (simple heuristic after = ( , ! & | ? : return)
  s = s.replace(/(?<=[=(,!&|?:[\s])\/(?![/*])[^\n/\\]*(?:\\.[^\n/\\]*)*\/[gimsuy]*/g, (m) =>
    stash(stored, span(c.regex, m)),
  );
  // Double-quoted strings
  s = s.replace(/"[^"\\]*(?:\\.[^"\\]*)*"/gs, (m) => stash(stored, span(c.string, m)));
  // Single-quoted strings
  s = s.replace(/'[^'\\]*(?:\\.[^'\\]*)*'/gs, (m) => stash(stored, span(c.string, m)));

  // Decorators @Foo
  s = s.replace(/@[A-Za-z_$][\w$]*/g, (m) => span(c.decorator, m));

  // Numbers
  s = s.replace(/\b(0x[\da-fA-F]+|0b[01]+|0o[0-7]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?n?)\b/g, (m) =>
    span(c.number, m),
  );

  // Keywords
  const kwSet = isTS ? TS_KEYWORDS : new Set([...TS_KEYWORDS].filter((k) => !TS_TYPES.has(k)));
  s = s.replace(/\b[a-zA-Z_$][\w$]*\b/g, (m) => {
    if (kwSet.has(m)) return span(c.keyword, m);
    if (isTS && TS_TYPES.has(m)) return span(c.type, m);
    return m;
  });

  // Function calls: identifier(
  s = s.replace(/([A-Za-z_$][\w$]*)(?=\s*(?:&lt;[^&]*?&gt;\s*)?\()/g, (_, name) =>
    span(c.fn, name),
  );

  // Object properties after . or ?.
  s = s.replace(/(?<=\.{1,2})([A-Za-z_$][\w$]*)/g, (m) => span(c.prop, m));

  // Restore
  return restore(s, stored);
}

/* ── JSON ── */
function highlightJSON(code: string, c: ThemeColors): string {
  const stored: Stash = [];
  let s = esc(code);

  // Strings (key or value)
  s = s.replace(/"(?:[^"\\]|\\.)*"/g, (m) => stash(stored, span(c.string, m)));
  // Numbers
  s = s.replace(/\b-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g, (m) => span(c.number, m));
  // true / false / null
  s = s.replace(/\b(true|false|null)\b/g, (m) => span(c.keyword, m));

  return restore(s, stored);
}

/* ── Python ── */
function highlightPython(code: string, c: ThemeColors): string {
  const stored: Stash = [];
  let s = esc(code);

  // Triple-quoted strings
  s = s.replace(/"""[\s\S]*?"""|'''[\s\S]*?'''/g, (m) => stash(stored, span(c.string, m)));
  // Comments
  s = s.replace(/#.*/g, (m) => stash(stored, span(c.comment, m)));
  // Strings
  s = s.replace(
    /(?:f|r|b|rb|br|fr|rf)?(?:"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*')/g,
    (m) => stash(stored, span(c.string, m)),
  );
  // Decorators
  s = s.replace(/@[A-Za-z_][\w.]*/g, (m) => span(c.decorator, m));
  // Numbers
  s = s.replace(/\b\d+(?:\.\d+)?(?:[eEjJ][+-]?\d+)?\b/g, (m) => span(c.number, m));
  // Keywords
  s = s.replace(/\b[a-zA-Z_][\w]*\b/g, (m) => (PY_KEYWORDS.has(m) ? span(c.keyword, m) : m));
  // Function calls
  s = s.replace(/([A-Za-z_][\w]*)(?=\s*\()/g, (_, name) => span(c.fn, name));

  return restore(s, stored);
}

/* ── CSS ── */
function highlightCSS(code: string, c: ThemeColors): string {
  const stored: Stash = [];
  let s = esc(code);

  // Block comments
  s = s.replace(/\/\*[\s\S]*?\*\//g, (m) => stash(stored, span(c.comment, m)));
  // Strings
  s = s.replace(/"[^"]*"|'[^']*'/g, (m) => stash(stored, span(c.string, m)));
  // Numbers with units
  s = s.replace(/\b-?\d+(?:\.\d+)?(?:px|em|rem|vh|vw|%|pt|deg|s|ms|fr)?\b/g, (m) =>
    span(c.number, m),
  );
  // Hex colors
  s = s.replace(/#[0-9a-fA-F]{3,8}\b/g, (m) => span(c.number, m));
  // CSS property names (before colon)
  s = s.replace(/([a-z-]+)(?=\s*:)/g, (m) => span(c.prop, m));
  // Selectors (. # element pseudo)
  s = s.replace(/(?:^|\s)([.#@:[a-zA-Z*>~+[\]][\w[\]:>~+.#-]*)/gm, (full, sel) =>
    full.replace(sel, span(c.tag, sel)),
  );
  // Values: keywords
  s = s.replace(
    /\b(none|auto|flex|grid|block|inline|relative|absolute|fixed|sticky|hidden|visible|center|left|right|top|bottom|normal|bold|italic|solid|dashed|dotted|transparent|inherit|initial|unset)\b/g,
    (m) => span(c.keyword, m),
  );

  return restore(s, stored);
}

/* ── HTML / XML / SVG ── */
function highlightHTML(code: string, c: ThemeColors): string {
  const stored: Stash = [];
  let s = esc(code);

  // HTML comments
  s = s.replace(/&lt;!--[\s\S]*?--&gt;/g, (m) => stash(stored, span(c.comment, m)));
  // Doctype
  s = s.replace(/&lt;!DOCTYPE[^&]*&gt;/gi, (m) => stash(stored, span(c.keyword, m)));
  // Attribute values
  s = s.replace(
    /(=\s*)("[^"]*"|'[^']*')/g,
    (_, eq, val) => eq + stash(stored, span(c.string, val)),
  );
  // Opening/closing tags
  s = s.replace(/(&lt;\/?)([\w-]+)/g, (_, bracket, name) => bracket + span(c.tag, name));
  // Attribute names
  s = s.replace(/\s([\w-]+)(?=\s*=)/g, (_, attr) => ' ' + span(c.attr, attr));
  // Closing >
  s = s.replace(/\/&gt;|&gt;/g, (m) => span(c.operator, m));

  return restore(s, stored);
}

/* ── SQL ── */
function highlightSQL(code: string, c: ThemeColors): string {
  const stored: Stash = [];
  let s = esc(code);

  // Comments
  s = s.replace(/--[^\n]*/g, (m) => stash(stored, span(c.comment, m)));
  s = s.replace(/\/\*[\s\S]*?\*\//g, (m) => stash(stored, span(c.comment, m)));
  // Strings
  s = s.replace(/'[^']*'/g, (m) => stash(stored, span(c.string, m)));
  // Numbers
  s = s.replace(/\b\d+(?:\.\d+)?\b/g, (m) => span(c.number, m));
  // Keywords (case-insensitive)
  s = s.replace(/\b[A-Za-z_]+\b/g, (m) =>
    SQL_KEYWORDS.has(m.toUpperCase()) ? span(c.keyword, m) : m,
  );

  return restore(s, stored);
}

/* ── Bash ── */
function highlightBash(code: string, c: ThemeColors): string {
  const stored: Stash = [];
  let s = esc(code);

  // Comments
  s = s.replace(/#[^\n]*/g, (m) => stash(stored, span(c.comment, m)));
  // Strings
  s = s.replace(/"[^"\\]*(?:\\.[^"\\]*)*"|'[^']*'/g, (m) => stash(stored, span(c.string, m)));
  // Variables
  s = s.replace(/\$\{?[\w?@*#!-]+\}?/g, (m) => span(c.prop, m));
  // Numbers
  s = s.replace(/\b\d+\b/g, (m) => span(c.number, m));
  // Keywords
  const bashKw = new Set([
    'if',
    'then',
    'else',
    'elif',
    'fi',
    'for',
    'do',
    'done',
    'while',
    'until',
    'case',
    'esac',
    'in',
    'function',
    'return',
    'exit',
    'export',
    'local',
    'source',
    'echo',
    'read',
    'cd',
    'ls',
    'grep',
    'sed',
    'awk',
    'rm',
    'mkdir',
    'cp',
    'mv',
  ]);
  s = s.replace(/\b[a-z_][\w-]*\b/g, (m) => (bashKw.has(m) ? span(c.keyword, m) : m));

  return restore(s, stored);
}

/* ── Markdown ── */
function highlightMarkdown(code: string, c: ThemeColors): string {
  const stored: Stash = [];
  let s = esc(code);

  // Code blocks (fenced)
  s = s.replace(/```[\s\S]*?```/g, (m) => stash(stored, span(c.string, m)));
  // Inline code
  s = s.replace(/`[^`]+`/g, (m) => stash(stored, span(c.string, m)));
  // Headings
  s = s.replace(/^(#{1,6}\s.+)$/gm, (m) => span(c.keyword, m));
  // Bold
  s = s.replace(/\*\*[^*]+\*\*/g, (m) => span(c.fn, m));
  // Links [text](url)
  s = s.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_, text, url) => '[' + span(c.prop, text) + '](' + span(c.string, url) + ')',
  );
  // Blockquote
  s = s.replace(/^(&gt;.+)$/gm, (m) => span(c.comment, m));
  // Horizontal rule / list markers
  s = s.replace(/^(\s*[-*+]\s)/gm, (m) => span(c.keyword, m));

  return restore(s, stored);
}

/* ── YAML ── */
function highlightYAML(code: string, c: ThemeColors): string {
  const stored: Stash = [];
  let s = esc(code);

  // Comments
  s = s.replace(/#[^\n]*/g, (m) => stash(stored, span(c.comment, m)));
  // Strings
  s = s.replace(/"[^"]*"|'[^']*'/g, (m) => stash(stored, span(c.string, m)));
  // Scalar values (after ': ')
  s = s.replace(/(:\s+)([^#\n{[\]]+)/g, (full, colon, val) => {
    const trimmed = val.trim();
    if (/^(true|false|null|~)$/.test(trimmed)) return colon + span(c.keyword, val);
    if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return colon + span(c.number, val);
    return full;
  });
  // Keys (before ':')
  s = s.replace(
    /^(\s*)([^:\s#&*[\]{|>'"!%-][\w\s-]*)(?=\s*:)/gm,
    (_, indent, key) => indent + span(c.prop, key),
  );
  // Anchors and aliases
  s = s.replace(/[&*][A-Za-z_][\w]*/g, (m) => span(c.decorator, m));

  return restore(s, stored);
}

/* ── Generic (Rust, Go) ── */
function highlightGeneric(
  code: string,
  c: ThemeColors,
  keywords: Set<string>,
  types: Set<string>,
): string {
  const stored: Stash = [];
  let s = esc(code);

  // Block comments
  s = s.replace(/\/\*[\s\S]*?\*\//g, (m) => stash(stored, span(c.comment, m)));
  // Line comments
  s = s.replace(/\/\/.*/g, (m) => stash(stored, span(c.comment, m)));
  // Strings
  s = s.replace(/"[^"\\]*(?:\\.[^"\\]*)*"/g, (m) => stash(stored, span(c.string, m)));
  s = s.replace(/'[^'\\]*(?:\\.[^'\\]*)*'/g, (m) => stash(stored, span(c.string, m)));
  // Numbers
  s = s.replace(/\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g, (m) => span(c.number, m));
  // Keywords + types
  s = s.replace(/\b[A-Za-z_][\w]*\b/g, (m) => {
    if (keywords.has(m)) return span(c.keyword, m);
    if (types.has(m)) return span(c.type, m);
    if (/^[A-Z]/.test(m)) return span(c.type, m); // CamelCase = type
    return m;
  });
  // Function calls
  s = s.replace(/([A-Za-z_][\w]*)(?=\s*\()/g, (_, name) => span(c.fn, name));

  return restore(s, stored);
}

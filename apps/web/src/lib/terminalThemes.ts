import type { ITheme } from '@xterm/xterm';

export interface TerminalTheme {
  id: string;
  name: string;
  /** Two representative hex colors shown as swatches in the picker */
  preview: [string, string];
  xterm: ITheme;
}

export const TERMINAL_THEMES: TerminalTheme[] = [
  {
    id: 'dracula',
    name: 'Dracula',
    preview: ['#282a36', '#50fa7b'],
    xterm: {
      background: '#1e1e2e',
      foreground: '#f0f0f0',
      cursor: '#aaff00',
      cursorAccent: '#1e1e2e',
      selectionBackground: 'rgba(170,255,0,0.25)',
      selectionForeground: '#f0f0f0',
      black: '#111118',
      red: '#ff5555',
      green: '#50fa7b',
      yellow: '#f1fa8c',
      blue: '#6272a4',
      magenta: '#ff79c6',
      cyan: '#8be9fd',
      white: '#f0f0f0',
      brightBlack: '#44475a',
      brightRed: '#ff6e6e',
      brightGreen: '#69ff94',
      brightYellow: '#ffffa5',
      brightBlue: '#d6acff',
      brightMagenta: '#ff92df',
      brightCyan: '#a4ffff',
      brightWhite: '#ffffff',
    },
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    preview: ['#1a1b2e', '#7aa2f7'],
    xterm: {
      background: '#1a1b2e',
      foreground: '#c0caf5',
      cursor: '#c0caf5',
      cursorAccent: '#1a1b2e',
      selectionBackground: 'rgba(122,162,247,0.25)',
      selectionForeground: '#c0caf5',
      black: '#15161e',
      red: '#f7768e',
      green: '#9ece6a',
      yellow: '#e0af68',
      blue: '#7aa2f7',
      magenta: '#bb9af7',
      cyan: '#7dcfff',
      white: '#a9b1d6',
      brightBlack: '#414868',
      brightRed: '#ff9e9e',
      brightGreen: '#b9f27c',
      brightYellow: '#ffc777',
      brightBlue: '#9ab8ff',
      brightMagenta: '#d0a9ff',
      brightCyan: '#9de3ff',
      brightWhite: '#c0caf5',
    },
  },
  {
    id: 'nord',
    name: 'Nord',
    preview: ['#2e3440', '#88c0d0'],
    xterm: {
      background: '#2e3440',
      foreground: '#d8dee9',
      cursor: '#d8dee9',
      cursorAccent: '#2e3440',
      selectionBackground: 'rgba(136,192,208,0.25)',
      selectionForeground: '#d8dee9',
      black: '#3b4252',
      red: '#bf616a',
      green: '#a3be8c',
      yellow: '#ebcb8b',
      blue: '#81a1c1',
      magenta: '#b48ead',
      cyan: '#88c0d0',
      white: '#e5e9f0',
      brightBlack: '#4c566a',
      brightRed: '#d08770',
      brightGreen: '#b5d99c',
      brightYellow: '#f3d398',
      brightBlue: '#8fbcbb',
      brightMagenta: '#c7a8c7',
      brightCyan: '#8fbcbb',
      brightWhite: '#eceff4',
    },
  },
  {
    id: 'monokai',
    name: 'Monokai',
    preview: ['#272822', '#a6e22e'],
    xterm: {
      background: '#272822',
      foreground: '#f8f8f2',
      cursor: '#f8f8f0',
      cursorAccent: '#272822',
      selectionBackground: 'rgba(166,226,46,0.25)',
      selectionForeground: '#f8f8f2',
      black: '#1e1f1c',
      red: '#f92672',
      green: '#a6e22e',
      yellow: '#e6db74',
      blue: '#66d9e8',
      magenta: '#ae81ff',
      cyan: '#a1efe4',
      white: '#f8f8f2',
      brightBlack: '#75715e',
      brightRed: '#ff669d',
      brightGreen: '#c4f141',
      brightYellow: '#f4f99d',
      brightBlue: '#a1efe4',
      brightMagenta: '#c8b3ff',
      brightCyan: '#c7f6f0',
      brightWhite: '#ffffff',
    },
  },
  {
    id: 'gruvbox',
    name: 'Gruvbox',
    preview: ['#282828', '#b8bb26'],
    xterm: {
      background: '#282828',
      foreground: '#ebdbb2',
      cursor: '#ebdbb2',
      cursorAccent: '#282828',
      selectionBackground: 'rgba(184,187,38,0.25)',
      selectionForeground: '#ebdbb2',
      black: '#1d2021',
      red: '#cc241d',
      green: '#98971a',
      yellow: '#d79921',
      blue: '#458588',
      magenta: '#b16286',
      cyan: '#689d6a',
      white: '#a89984',
      brightBlack: '#928374',
      brightRed: '#fb4934',
      brightGreen: '#b8bb26',
      brightYellow: '#fabd2f',
      brightBlue: '#83a598',
      brightMagenta: '#d3869b',
      brightCyan: '#8ec07c',
      brightWhite: '#ebdbb2',
    },
  },
  {
    id: 'one-dark',
    name: 'One Dark',
    preview: ['#282c34', '#61afef'],
    xterm: {
      background: '#282c34',
      foreground: '#abb2bf',
      cursor: '#528bff',
      cursorAccent: '#282c34',
      selectionBackground: 'rgba(97,175,239,0.25)',
      selectionForeground: '#abb2bf',
      black: '#1e2127',
      red: '#e06c75',
      green: '#98c379',
      yellow: '#d19a66',
      blue: '#61afef',
      magenta: '#c678dd',
      cyan: '#56b6c2',
      white: '#abb2bf',
      brightBlack: '#5c6370',
      brightRed: '#ff7b86',
      brightGreen: '#b3e08a',
      brightYellow: '#e5c07b',
      brightBlue: '#86cbf8',
      brightMagenta: '#d88ee7',
      brightCyan: '#79d4e0',
      brightWhite: '#ffffff',
    },
  },
  {
    id: 'matrix',
    name: 'Matrix',
    preview: ['#0d0d0d', '#00ff41'],
    xterm: {
      background: '#0d0d0d',
      foreground: '#00ff41',
      cursor: '#00ff41',
      cursorAccent: '#0d0d0d',
      selectionBackground: 'rgba(0,255,65,0.2)',
      selectionForeground: '#0d0d0d',
      black: '#0d0d0d',
      red: '#008f11',
      green: '#00ff41',
      yellow: '#00b33c',
      blue: '#00cc33',
      magenta: '#00e639',
      cyan: '#00ff41',
      white: '#00ff41',
      brightBlack: '#003b00',
      brightRed: '#00cc33',
      brightGreen: '#39ff14',
      brightYellow: '#00ff41',
      brightBlue: '#00e639',
      brightMagenta: '#33ff57',
      brightCyan: '#39ff14',
      brightWhite: '#ccffcc',
    },
  },
];

const STORAGE_KEY = 'terminalTheme';
const DEFAULT_THEME_ID = 'dracula';

export function getThemeId(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_THEME_ID;
  } catch {
    return DEFAULT_THEME_ID;
  }
}

export function saveThemeId(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // non-fatal
  }
}

export function getThemeById(id: string): TerminalTheme {
  return TERMINAL_THEMES.find((t) => t.id === id) ?? TERMINAL_THEMES[0];
}

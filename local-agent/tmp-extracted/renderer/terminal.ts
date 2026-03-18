import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';

const term = new Terminal({
  cursorBlink: true,
  fontSize: 14,
  fontFamily: 'Menlo, Monaco, Consolas, monospace',
  theme: {
    background: '#1e1e1e',
    foreground: '#d4d4d4',
    cursor: '#d4d4d4',
    black: '#1e1e1e',
    red: '#f44747',
    green: '#6a9955',
    yellow: '#d7ba7d',
    blue: '#569cd6',
    magenta: '#c586c0',
    cyan: '#4ec9b0',
    white: '#d4d4d4',
    brightBlack: '#808080',
    brightRed: '#f44747',
    brightGreen: '#6a9955',
    brightYellow: '#d7ba7d',
    brightBlue: '#569cd6',
    brightMagenta: '#c586c0',
    brightCyan: '#4ec9b0',
    brightWhite: '#ffffff',
  },
});

const fitAddon = new FitAddon();
term.loadAddon(fitAddon);

const container = document.getElementById('terminal');
if (container) {
  term.open(container);
  fitAddon.fit();
}

(window as any).claudeAgent.onPtyOutput((data: string) => {
  term.write(data);
});

term.onData((data: string) => {
  (window as any).claudeAgent.writePty(data);
});

window.addEventListener('resize', () => {
  fitAddon.fit();
});

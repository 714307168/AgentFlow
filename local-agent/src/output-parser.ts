import { EventEmitter } from "events";

// Inline strip-ansi to avoid ESM/CJS compatibility issues with v7+
// eslint-disable-next-line no-control-regex
const ansiRegex = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;
function stripAnsi(str: string): string {
  return str.replace(ansiRegex, "");
}

class OutputParser extends EventEmitter {
  private lines: string[] = [""];
  private inResponse: boolean = false;
  private debounceTimer: NodeJS.Timeout | null = null;
  private emittedText: string = "";
  private pendingInputEcho: string | null = null;
  private pendingRewrite: boolean = false;

  beginMessage(input: string): void {
    this.reset();
    const normalized = input.trim();
    this.pendingInputEcho = normalized.length > 0 ? normalized : null;
  }

  feed(data: string): void {
    const clean = stripAnsi(data)
      .replace(/\r\n/g, "\n")
      .replace(/\u0007/g, "");
    if (clean.length === 0) {
      return;
    }

    this.pendingRewrite = clean.includes("\r");
    this.applyTerminalText(clean);

    const visible = this.getVisibleText(true);
    if (!this.inResponse && visible.trim().length > 0) {
      this.inResponse = true;
    }

    if (this.inResponse) {
      this.scheduleFlush();
    }

    if (this.hasPrompt()) {
      this.finalize();
    }
  }

  private scheduleFlush(): void {
    if (this.debounceTimer) {
      return;
    }
    const delay = this.pendingRewrite ? 180 : 80;
    this.debounceTimer = setTimeout(() => this.flush(), delay);
  }

  private flush(includeCurrentLine: boolean = false): void {
    this.debounceTimer = null;
    this.pendingRewrite = false;

    const visible = this.getVisibleText(includeCurrentLine);
    if (visible.length <= this.emittedText.length) {
      return;
    }

    const delta = visible.slice(this.emittedText.length);
    if (delta.length > 0) {
      this.emittedText = visible;
      this.emit("chunk", delta);
    }
  }

  private finalize(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.flush(true);
    this.emit("done");
    this.emit("prompt");
    this.reset();
  }

  reset(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.lines = [""];
    this.inResponse = false;
    this.emittedText = "";
    this.pendingInputEcho = null;
    this.pendingRewrite = false;
  }

  private applyTerminalText(data: string): void {
    for (const char of data) {
      switch (char) {
        case "\r":
          this.setCurrentLine("");
          break;
        case "\n":
          this.lines.push("");
          break;
        case "\b":
        case "\u007f":
          this.setCurrentLine(this.currentLine().slice(0, -1));
          break;
        default:
          if (char >= " " || char === "\t") {
            this.setCurrentLine(this.currentLine() + char);
          }
          break;
      }
    }
  }

  private getVisibleText(includeCurrentLine: boolean = false): string {
    const sourceLines = includeCurrentLine ? this.lines : this.lines.slice(0, -1);
    let text = sourceLines.join("\n");
    if (!includeCurrentLine && sourceLines.length > 0) {
      text += "\n";
    }

    if (this.pendingInputEcho) {
      const escaped = this.escapeRegExp(this.pendingInputEcho);
      const echoPatterns = [
        new RegExp(`^(?:[>?]\\s*)?${escaped}(?:\\n|$)`),
        new RegExp(`^\\s*(?:[>?]\\s*)?${escaped}(?:\\n|$)`),
      ];
      for (const pattern of echoPatterns) {
        if (pattern.test(text)) {
          text = text.replace(pattern, "");
          this.pendingInputEcho = null;
          break;
        }
      }
    }

    return text
      .replace(/^(?:[>?]\s*\n)+/g, "")
      .replace(/(?:\n|^)[>?]\s*$/g, "")
      .replace(/^\n+/, "")
      .replace(/\n{3,}/g, "\n\n");
  }

  private hasPrompt(): boolean {
    const currentLine = this.currentLine().trim();
    return currentLine === ">" || currentLine === "?";
  }

  private currentLine(): string {
    return this.lines[this.lines.length - 1] ?? "";
  }

  private setCurrentLine(value: string): void {
    this.lines[this.lines.length - 1] = value;
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}

export default OutputParser;

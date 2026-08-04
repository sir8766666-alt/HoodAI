import * as vscode from "vscode";

export class ClaudeDetector {
  readonly name = "Claude";

  private lastOutput = "";
  private lastOutputAt = 0;

  match(): boolean {
    const terminals = vscode.window.terminals;

    return terminals.some((terminal) =>
      /claude|anthropic|claude code/i.test(terminal.name)
    );
  }

  observeTerminalData(data: string): void {
    if (!data) return;

    this.lastOutput = (this.lastOutput + "\n" + data).slice(-8000);
    this.lastOutputAt = Date.now();
  }

  isGenerating(): boolean {
    if (!this.match()) {
      return false;
    }

    const text = this.lastOutput;
    if (!text) {
      return false;
    }

    const waitingPatterns: RegExp[] = [
      /\bthinking\b/i,
      /\bgenerating\b/i,
      /\breasoning\b/i,
      /\bloading\b/i,
      /\bworking\b/i,
      /\bprocessing\b/i,
      /\banalyzing\b/i,
      /\bsearching\b/i,
      /\bstreaming\b/i,
      /\bresponding\b/i,
      /\bplease wait\b/i,
      /\bstop generating\b/i
    ];

    if (waitingPatterns.some((re) => re.test(text))) {
      return true;
    }

    // If Claude Code just emitted output very recently, treat it as active.
    if (Date.now() - this.lastOutputAt < 2500) {
      return true;
    }

    return false;
  }

  reset(): void {
    this.lastOutput = "";
    this.lastOutputAt = 0;
  }
}

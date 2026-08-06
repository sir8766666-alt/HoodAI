export class ClaudeDetector {
  readonly name = "Claude Code";

  match(terminalName: string): boolean {
    const name = terminalName.toLowerCase();
    return name.includes("claude") || name.includes("anthropic");
  }
}

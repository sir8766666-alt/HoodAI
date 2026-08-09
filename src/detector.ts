import * as vscode from "vscode";
import { exec } from "child_process";

/**
 * HoodAI AI Activity Detector
 *
 * Detects whether an AI coding assistant appears to be active.
 *
 * The detector intentionally uses lightweight process detection.
 * It does NOT inspect source-code contents.
 */

export type DetectorState = "idle" | "thinking";

export interface DetectorStatus {
  state: DetectorState;
  assistant: string | null;
}

type StatusListener = (status: DetectorStatus) => void;

const AI_PROCESSES: Record<string, string> = {
  "claude": "Claude Code",
  "claude-code": "Claude Code",
  "codex": "Codex",
  "gemini": "Gemini CLI",
  "aider": "Aider",
  "continue": "Continue",
  "cline": "Cline",
  "roo": "Roo Code"
};

export class AIActivityDetector implements vscode.Disposable {
  private timer: NodeJS.Timeout | undefined;
  private disposed = false;

  private currentStatus: DetectorStatus = {
    state: "idle",
    assistant: null
  };

  private listeners: StatusListener[] = [];

  constructor(
    private readonly intervalMs: number = 2500
  ) {}

  /**
   * Start monitoring.
   */
  start(): void {
    if (this.timer || this.disposed) {
      return;
    }

    // Initial check.
    this.check();

    this.timer = setInterval(() => {
      this.check();
    }, this.intervalMs);
  }

  /**
   * Stop monitoring.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * Subscribe to detector state changes.
   */
  onStatusChange(listener: StatusListener): vscode.Disposable {
    this.listeners.push(listener);

    return new vscode.Disposable(() => {
      const index = this.listeners.indexOf(listener);

      if (index !== -1) {
        this.listeners.splice(index, 1);
      }
    });
  }

  /**
   * Get the latest detector status.
   */
  getStatus(): DetectorStatus {
    return {
      ...this.currentStatus
    };
  }

  /**
   * Perform one detection cycle.
   */
  private check(): void {
    if (this.disposed) {
      return;
    }

    this.detectProcesses()
      .then((assistant) => {
        const nextStatus: DetectorStatus = assistant
          ? {
              state: "thinking",
              assistant
            }
          : {
              state: "idle",
              assistant: null
            };

        this.updateStatus(nextStatus);
      })
      .catch(() => {
        // Never break the extension because process detection failed.
        this.updateStatus({
          state: "idle",
          assistant: null
        });
      });
  }

  /**
   * Detect known AI coding processes.
   */
  private detectProcesses(): Promise<string | null> {
    return new Promise((resolve) => {
      const command =
        process.platform === "win32"
          ? "tasklist"
          : "ps -A -o command=";

      exec(
        command,
        {
          timeout: 1500,
          maxBuffer: 1024 * 1024
        },
        (error, stdout) => {
          if (error || !stdout) {
            resolve(null);
            return;
          }

          const output = stdout.toLowerCase();

          for (const [processName, assistantName] of Object.entries(
            AI_PROCESSES
          )) {
            if (this.containsProcess(output, processName)) {
              resolve(assistantName);
              return;
            }
          }

          resolve(null);
        }
      );
    });
  }

  /**
   * Check whether a process name exists in process output.
   */
  private containsProcess(
    output: string,
    processName: string
  ): boolean {
    const normalized = processName.toLowerCase();

    // Windows tasklist and Unix ps output can differ,
    // so use a conservative boundary-style check.
    const escaped = normalized.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

    const regex = new RegExp(
      `(^|[\\s/\\\\_-])${escaped}([\\s._-]|$)`,
      "i"
    );

    return regex.test(output);
  }

  /**
   * Update status only when it actually changes.
   */
  private updateStatus(status: DetectorStatus): void {
    const changed =
      status.state !== this.currentStatus.state ||
      status.assistant !== this.currentStatus.assistant;

    if (!changed) {
      return;
    }

    this.currentStatus = status;

    for (const listener of [...this.listeners]) {
      try {
        listener(this.getStatus());
      } catch {
        // Individual listeners must not break the detector.
      }
    }
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    this.disposed = true;
    this.stop();
    this.listeners.length = 0;
  }
}

/**
 * Convenience factory.
 */
export function createAIDetector(
  intervalMs = 2500
): AIActivityDetector {
  return new AIActivityDetector(intervalMs);
}

import * as vscode from "vscode";
import * as crypto from "crypto";

/**
 * Returns a persistent anonymous device ID.
 * Stored once in VS Code globalState.
 */
export function getOrCreateDeviceId(
  context: vscode.ExtensionContext
): string {
  const existing = context.globalState.get<string>("hoodai.deviceId");

  if (existing) {
    return existing;
  }

  const id = crypto.randomUUID();

  context.globalState.update("hoodai.deviceId", id);

  return id;
}

/**
 * Escapes HTML before rendering in a WebView.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Shortens long strings.
 */
export function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }

  return text.substring(0, max - 1) + "…";
}

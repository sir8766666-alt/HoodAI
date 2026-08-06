import { ClaudeDetector } from "./detectors/claude";

export interface Detector {
  readonly name: string;
  match(terminalName: string): boolean;
}

const detectors: Detector[] = [
  new ClaudeDetector()
];

export const detectorRegistry = {
  detect(terminalName: string): Detector | undefined {
    return detectors.find((detector) => detector.match(terminalName));
  }
};

import { ClaudeDetector } from "./detectors/claude";

export interface Detector {
    readonly name: string;

    match(): boolean;

    isGenerating(): boolean;

    observeTerminalData?(data: string): void;

    reset?(): void;
}

class DetectorRegistry {

    private detectors: Detector[] = [];

    constructor() {

        this.detectors.push(
            new ClaudeDetector()
        );

        // Future detectors:
        // new CursorDetector()
        // new ClineDetector()
        // new RooCodeDetector()
        // new GeminiDetector()

    }

    getActiveDetector(): Detector | null {

        for (const detector of this.detectors) {

            if (detector.match()) {

                return detector;

            }

        }

        return null;

    }

    isGenerating(): boolean {

        const detector = this.getActiveDetector();

        if (!detector) {

            return false;

        }

        return detector.isGenerating();

    }

    observeTerminalData(data: string): void {

        const detector = this.getActiveDetector();

        if (
            detector &&
            detector.observeTerminalData
        ) {

            detector.observeTerminalData(data);

        }

    }

    reset(): void {

        const detector = this.getActiveDetector();

        if (
            detector &&
            detector.reset
        ) {

            detector.reset();

        }

    }

    getDetectorName(): string {

        const detector = this.getActiveDetector();

        return detector
            ? detector.name
            : "Unknown";

    }

}

export const detectorRegistry =
    new DetectorRegistry();

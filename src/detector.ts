import { ClaudeDetector } from "./detectors/claude";

export interface Detector {
    readonly name: string;
    match(terminalName: string): boolean;
}

class DetectorRegistry {

    private readonly detectors: Detector[] = [
        new ClaudeDetector()
    ];

    public detect(terminalName: string): Detector | undefined {

        return this.detectors.find(detector =>
            detector.match(terminalName)
        );

    }

}

export const detectorRegistry = new DetectorRegistry();

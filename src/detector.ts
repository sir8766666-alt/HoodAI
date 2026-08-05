export interface Detector {
    readonly name: string;

    match(terminalName: string): boolean;
}

export class ClaudeDetector implements Detector {

    readonly name = "Claude Code";

    match(terminalName: string): boolean {

        const name = terminalName.toLowerCase();

        return (
            name.includes("claude") ||
            name.includes("anthropic")
        );

    }

}

export class CursorDetector implements Detector {

    readonly name = "Cursor";

    match(terminalName: string): boolean {

        return terminalName
            .toLowerCase()
            .includes("cursor");

    }

}

export class ClineDetector implements Detector {

    readonly name = "Cline";

    match(terminalName: string): boolean {

        return terminalName
            .toLowerCase()
            .includes("cline");

    }

}

export class RooDetector implements Detector {

    readonly name = "Roo Code";

    match(terminalName: string): boolean {

        const name = terminalName.toLowerCase();

        return (
            name.includes("roo") ||
            name.includes("roo code")
        );

    }

}

export class DetectorRegistry {

    private readonly detectors: Detector[] = [

        new ClaudeDetector(),

        new CursorDetector(),

        new ClineDetector(),

        new RooDetector()

    ];

    public detect(terminalName: string): Detector | undefined {

        return this.detectors.find(
            detector => detector.match(terminalName)
        );

    }

}

export const detectorRegistry =
    new DetectorRegistry();

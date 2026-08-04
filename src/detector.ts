export interface Detector {

    name: string;

    match(): boolean;

    isGenerating(): boolean;

}

class ClaudeDetector implements Detector {

    name = "Claude";

    match() {

        return location.hostname.includes("claude.ai");

    }

    isGenerating() {

        if (document.querySelector('[aria-busy="true"]'))
            return true;

        if (document.querySelector('[role="progressbar"]'))
            return true;

        if (
            document.body.innerText.includes("Thinking") ||
            document.body.innerText.includes("Generating")
        )
            return true;

        return false;

    }

}

class CursorDetector implements Detector {

    name = "Cursor";

    match() {

        return location.hostname.includes("cursor.com");

    }

    isGenerating() {

        return !!document.querySelector(
            '[aria-busy="true"]'
        );

    }

}

class LovableDetector implements Detector {

    name = "Lovable";

    match() {

        return location.hostname.includes("lovable.dev");

    }

    isGenerating() {

        return !!document.querySelector(
            '[aria-busy="true"]'
        );

    }

}

class BoltDetector implements Detector {

    name = "Bolt";

    match() {

        return location.hostname.includes("bolt.new");

    }

    isGenerating() {

        return !!document.querySelector(
            '[aria-busy="true"]'
        );

    }

}

class ReplitDetector implements Detector {

    name = "Replit";

    match() {

        return location.hostname.includes("replit.com");

    }

    isGenerating() {

        return !!document.querySelector(
            '[aria-busy="true"]'
        );

    }

}

class FirebaseDetector implements Detector {

    name = "Firebase Studio";

    match() {

        return location.hostname.includes(
            "studio.firebase.google.com"
        );

    }

    isGenerating() {

        return !!document.querySelector(
            '[aria-busy="true"]'
        );

    }

}

const detectors: Detector[] = [

    new ClaudeDetector(),

    new CursorDetector(),

    new LovableDetector(),

    new BoltDetector(),

    new ReplitDetector(),

    new FirebaseDetector()

];

export function getDetector(): Detector | null {

    for (const detector of detectors) {

        if (detector.match()) {

            console.log(
                "[HoodAI] Using detector:",
                detector.name
            );

            return detector;

        }

    }

    return null;

}

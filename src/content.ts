import { getDetector } from "./detector";

let generating = false;

const detector = getDetector();

if (!detector) {
    console.warn("[HoodAI] Unsupported website.");
}

function generationStarted() {

    chrome.runtime.sendMessage({
        type: "generation_started"
    });

    console.log("[HoodAI] Generation Started");

}

function generationFinished() {

    chrome.runtime.sendMessage({
        type: "generation_finished"
    });

    console.log("[HoodAI] Generation Finished");

}

function checkGenerationState() {

    if (!detector) {
        return;
    }

    const waiting = detector.isGenerating();

    if (waiting && !generating) {

        generating = true;

        generationStarted();

    } else if (!waiting && generating) {

        generating = false;

        generationFinished();

    }

}

/* ---------------------------------------------------------- */
/* Mutation Observer                                           */
/* ---------------------------------------------------------- */

const observer = new MutationObserver(() => {

    checkGenerationState();

});

observer.observe(document.documentElement, {

    childList: true,

    subtree: true,

    characterData: true,

    attributes: true

});

/* ---------------------------------------------------------- */
/* Initial Check                                               */
/* ---------------------------------------------------------- */

window.addEventListener("load", () => {

    checkGenerationState();

});

/* ---------------------------------------------------------- */
/* Fallback Polling                                            */
/* ---------------------------------------------------------- */

setInterval(() => {

    checkGenerationState();

}, 1000);

/* ---------------------------------------------------------- */
/* Page Visibility                                             */
/* ---------------------------------------------------------- */

document.addEventListener("visibilitychange", () => {

    if (document.hidden && generating) {

        generating = false;

        generationFinished();

    }

});

/* ---------------------------------------------------------- */
/* Cleanup                                                     */
/* ---------------------------------------------------------- */

window.addEventListener("beforeunload", () => {

    observer.disconnect();

    if (generating) {

        generationFinished();

    }

});

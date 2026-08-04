let generating = false;

const START_PATTERNS = [
    "Thinking...",
    "Thinking",
    "Generating...",
    "Generating",
    "Reasoning...",
    "Loading..."
];

function isGenerating(): boolean {

    // Check page text
    const bodyText = document.body.innerText;

    for (const text of START_PATTERNS) {
        if (bodyText.includes(text)) {
            return true;
        }
    }

    // aria-busy
    if (document.querySelector('[aria-busy="true"]')) {
        return true;
    }

    // Progress bars
    if (document.querySelector('[role="progressbar"]')) {
        return true;
    }

    // Common loading spinners
    if (
        document.querySelector("svg.animate-spin") ||
        document.querySelector(".animate-spin") ||
        document.querySelector(".spinner") ||
        document.querySelector(".loading")
    ) {
        return true;
    }

    return false;
}

function updateState() {

    const waiting = isGenerating();

    if (waiting && !generating) {

        generating = true;

        chrome.runtime.sendMessage({
            type: "generation_started"
        });

        console.log("[HoodAI] Generation Started");
    }

    if (!waiting && generating) {

        generating = false;

        chrome.runtime.sendMessage({
            type: "generation_finished"
        });

        console.log("[HoodAI] Generation Finished");
    }
}

const observer = new MutationObserver(() => {
    updateState();
});

observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true
});

// Initial check
updateState();

// Fallback polling every second
setInterval(updateState, 1000);

import { getNextAd, sendImpression, sendClick } from "./api";

let popupWindowId: number | null = null;
let currentAd: any = null;
let impressionTimer: number | null = null;
let impressionSent = false;

chrome.runtime.onMessage.addListener((message, sender) => {

    switch (message.type) {

        case "generation_started":
            onGenerationStarted(sender.tab?.id);
            break;

        case "generation_finished":
            onGenerationFinished();
            break;

        case "ad_clicked":
            onAdClicked();
            break;
    }

    return true;
});

async function onGenerationStarted(tabId?: number) {

    if (popupWindowId !== null) {
        return;
    }

    try {

        currentAd = await getNextAd();

        if (!currentAd) {
            return;
        }

        chrome.storage.local.set({
            currentAd
        });

        const popup = await chrome.windows.create({

            url: chrome.runtime.getURL("popup.html"),

            type: "popup",

            width: 420,

            height: 560,

            focused: false

        });

        popupWindowId = popup.id ?? null;

        impressionSent = false;

        impressionTimer = setTimeout(async () => {

            if (currentAd && !impressionSent) {

                impressionSent = true;

                await sendImpression(currentAd);

            }

        }, 2000) as unknown as number;

    } catch (err) {

        console.error(err);

    }

}

async function onGenerationFinished() {

    if (impressionTimer) {

        clearTimeout(impressionTimer);

        impressionTimer = null;

    }

    if (popupWindowId !== null) {

        try {

            await chrome.windows.remove(popupWindowId);

        } catch {}

    }

    popupWindowId = null;

    currentAd = null;

    impressionSent = false;

}

async function onAdClicked() {

    if (!currentAd) {

        return;

    }

    await sendClick(currentAd);

    chrome.tabs.create({

        url: currentAd.link

    });

}

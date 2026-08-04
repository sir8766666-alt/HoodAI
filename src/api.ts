const API_BASE = "https://hoodai-zscw.onrender.com";

export interface Ad {

    ad_id: string;

    title: string;

    text: string;

    image: string;

    link: string;

    provider: string;

    impression_id?: string;

}

async function getToken(): Promise<string> {

    const data = await chrome.storage.local.get("apiToken");

    return data.apiToken ?? "";

}

async function request<T>(
    method: string,
    endpoint: string,
    body?: unknown
): Promise<T> {

    const token = await getToken();

    const response = await fetch(`${API_BASE}${endpoint}`, {

        method,

        headers: {

            "Content-Type": "application/json",

            ...(token
                ? {
                      Authorization: `Bearer ${token}`
                  }
                : {})

        },

        body: body ? JSON.stringify(body) : undefined

    });

    if (!response.ok) {

        throw new Error(
            `HTTP ${response.status}`
        );

    }

    return response.json();

}

/* ------------------------------------------------ */

export async function getNextAd(): Promise<Ad> {

    return request<Ad>(
        "GET",
        "/ad/next"
    );

}

/* ------------------------------------------------ */

export async function sendImpression(
    ad: Ad
) {

    return request(
        "POST",
        "/ad/impression",
        {

            provider: ad.provider,

            ad_id: ad.ad_id,

            ad_title: ad.title,

            impression_id: ad.impression_id

        }
    );

}

/* ------------------------------------------------ */

export async function sendClick(
    ad: Ad
) {

    return request(
        "POST",
        "/ad/click",
        {

            provider: ad.provider,

            ad_id: ad.ad_id,

            ad_title: ad.title,

            impression_id: ad.impression_id

        }
    );

}

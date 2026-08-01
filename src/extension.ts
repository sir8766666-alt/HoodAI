import * as vscode from "vscode";
import * as https from "https";
import * as http from "http";

const API_BASE = "https://hoodai-zscw.onrender.com";

interface Ad {
    ad_id: string;
    title?: string;
    text: string;
    image?: string;
    link?: string;
    provider?: string;
    impression_id?: string;
}

interface Config {
    apiToken: string;
    enabled: boolean;
    intervalSec: number;
}

let statusBarItem: vscode.StatusBarItem;
let currentAd: Ad | null = null;
let refreshTimer: NodeJS.Timeout | undefined;

/* -------------------------------------------------------------------------- */
/*                               Configuration                                */
/* -------------------------------------------------------------------------- */

function config(): Config {
    const cfg = vscode.workspace.getConfiguration("hoodai");

    return {
        apiToken: cfg.get<string>("apiToken") ?? "",
        enabled: cfg.get<boolean>("enabled") ?? true,
        intervalSec: cfg.get<number>("refreshIntervalSeconds") ?? 60
    };
}

/* -------------------------------------------------------------------------- */
/*                              HTTP Request                                  */
/* -------------------------------------------------------------------------- */

function request(
    method: string,
    url: string,
    body?: unknown
): Promise<any> {

    const { apiToken } = config();

    return new Promise((resolve, reject) => {

        const lib = url.startsWith("https") ? https : http;
        const payload = body ? JSON.stringify(body) : undefined;
        const u = new URL(url);

        const req = lib.request(
            {
                hostname: u.hostname,
                path: u.pathname + u.search,
                protocol: u.protocol,
                port: u.port,
                method,
                headers: {
                    "Content-Type": "application/json",
                    ...(payload
                        ? { "Content-Length": Buffer.byteLength(payload) }
                        : {}),
                    ...(apiToken
                        ? { Authorization: `Bearer ${apiToken}` }
                        : {})
                }
            },
            res => {

                let data = "";

                res.on("data", chunk => {
                    data += chunk;
                });

                res.on("end", () => {

                    if (!data) {
                        resolve(null);
                        return;
                    }

                    try {
                        resolve(JSON.parse(data));
                    } catch {
                        resolve(data);
                    }

                });

            }
        );

        req.on("error", reject);

        if (payload) {
            req.write(payload);
        }

        req.end();

    });

}

/* -------------------------------------------------------------------------- */
/*                               Auth Check                                   */
/* -------------------------------------------------------------------------- */

async function ensureLoggedIn(): Promise<boolean> {

    const { apiToken, enabled } = config();

    if (!enabled) {
        statusBarItem.hide();
        return false;
    }

    if (!apiToken) {

        statusBarItem.text = "$(key) HoodAI: API Token Required";
        statusBarItem.tooltip =
            "Open Settings → HoodAI → API Token";

        statusBarItem.command =
            "workbench.action.openSettings";

        statusBarItem.show();

        return false;

    }

    try {

        const me = await request(
            "GET",
            `${API_BASE}/auth/me`
        );

        if (!me || me.error) {

            statusBarItem.text =
                "$(warning) HoodAI: Invalid API Token";

            statusBarItem.show();

            return false;

        }

        return true;

    } catch {

        statusBarItem.text =
            "$(error) HoodAI Offline";

        statusBarItem.tooltip =
            "Cannot reach HoodAI server.";

        statusBarItem.show();

        return false;

    }

}
/* -------------------------------------------------------------------------- */
/*                              Ad Fetching                                   */
/* -------------------------------------------------------------------------- */



/* -------------------------------------------------------------------------- */
/*                           Impression Tracking                              */
/* -------------------------------------------------------------------------- */

async function sendImpression() {

    if (!currentAd) return;

    try {

        await request(
            "POST",
            `${API_BASE}/ad/impression`,
            {
                provider: currentAd.provider,
                ad_id: currentAd.ad_id,
                ad_title: currentAd.title ?? currentAd.text,
                impression_id: currentAd.impression_id
            }
        );

    } catch {}

}

/* -------------------------------------------------------------------------- */
/*                               Click Tracking                               */
/* -------------------------------------------------------------------------- */

async function fetchAd(): Promise<void> {

    const loggedIn = await ensureLoggedIn();

    if (!loggedIn) {
        return;
    }

    try {

        const ad = await request(
            "GET",
            `${API_BASE}/ad/next`
        );

        if (!ad || !ad.ad_id) {
            return;
        }

        currentAd = ad;

        statusBarItem.text =
            `$(megaphone) ${truncate(ad.text, 45)}`;

        statusBarItem.tooltip =
            "Sponsored • Click to learn more";

        statusBarItem.command =
            "hoodai.showAd";

        statusBarItem.show();

        // Log impression
        await sendImpression();

        // ⭐ NEW: Automatically open the sponsored card
        await showAdPanel(false);

    } catch (err) {

        console.error(err);

    }

}

async function sendClick() {

    if (!currentAd) return;

    try {

        await request(
            "POST",
            `${API_BASE}/ad/click`,
            {
                provider: currentAd.provider,
                ad_id: currentAd.ad_id,
                ad_title: currentAd.title ?? currentAd.text,
                impression_id: currentAd.impression_id
            }
        );

    } catch {}

}

/* -------------------------------------------------------------------------- */
/*                             Status Helpers                                 */
/* -------------------------------------------------------------------------- */

function truncate(text: string, length: number): string {

    if (text.length <= length) {
        return text;
    }

    return text.substring(0, length - 1) + "…";

}

/* -------------------------------------------------------------------------- */
/*                               Sponsored UI                                 */
/* -------------------------------------------------------------------------- */

async function showAdPanel(trackClick: boolean = true) {

    if (!currentAd) {
        return;
    }

    if (trackClick) {
        await sendClick();
    }

    const panel = vscode.window.createWebviewPanel(
        "hoodaiSponsored",
        "Sponsored",
        vscode.ViewColumn.Beside,
        {
            enableScripts: true
        }
    );

    panel.webview.html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>

body{
    background:#111;
    color:white;
    font-family:Segoe UI,sans-serif;
    padding:24px;
}

.card{
    background:#1b1b1b;
    border-radius:14px;
    overflow:hidden;
    border:1px solid #333;
}

img{
    width:100%;
    display:block;
}

.content{
    padding:18px;
}

h2{
    margin:0 0 10px;
}

p{
    line-height:1.6;
    opacity:.9;
}

a{
    display:inline-block;
    margin-top:18px;
    background:#ff7a18;
    color:white;
    text-decoration:none;
    padding:10px 18px;
    border-radius:8px;
    font-weight:600;
}

small{
    display:block;
    margin-top:20px;
    opacity:.6;
}

</style>
</head>

<body>

<div class="card">

${
currentAd.image
? `<img src="${currentAd.image}" />`
: ""
}

<div class="content">

<h2>${currentAd.title ?? "Sponsored"}</h2>

<p>${currentAd.text}</p>

${
currentAd.link
? `<a href="${currentAd.link}">
Learn More →
</a>`
: ""
}

<small>
Ads powered by HoodAI
</small>

</div>

</div>

</body>
</html>
`;

}
/* -------------------------------------------------------------------------- */
/*                              Earnings                                      */
/* -------------------------------------------------------------------------- */

async function showEarnings() {

    try {

        const stats = await request(
            "GET",
            `${API_BASE}/stats/me`
        );

        vscode.window.showInformationMessage(
            `💰 $${stats.earnings_usd.toFixed(4)}

👀 ${stats.impressions} impressions

🖱 ${stats.clicks} clicks`
        );

    } catch {

        vscode.window.showErrorMessage(
            "Unable to fetch earnings."
        );

    }

      }
/* -------------------------------------------------------------------------- */
/*                              Extension                                     */
/* -------------------------------------------------------------------------- */

export function activate(context: vscode.ExtensionContext) {

    console.log("HoodAI v0.2.0 activated.");

    statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );

    context.subscriptions.push(statusBarItem);

    /* ------------------------------------------------------------ */
    /* Commands                                                     */
    /* ------------------------------------------------------------ */

    context.subscriptions.push(

        vscode.commands.registerCommand(
            "hoodai.showAd",
            async () => {
                await showAdPanel();
            }
        )

    );

    context.subscriptions.push(

        vscode.commands.registerCommand(
            "hoodai.showEarnings",
            async () => {
                await showEarnings();
            }
        )

    );

    /* ------------------------------------------------------------ */
    /* Initial Fetch                                                */
    /* ------------------------------------------------------------ */

    fetchAd();

    /* ------------------------------------------------------------ */
    /* Refresh Timer                                                */
    /* ------------------------------------------------------------ */

    const startTimer = () => {

        if (refreshTimer) {
            clearInterval(refreshTimer);
        }

        const { intervalSec } = config();

        refreshTimer = setInterval(() => {

            fetchAd();

        }, intervalSec * 1000);

    };

    startTimer();

    /* ------------------------------------------------------------ */
    /* Restart timer when settings change                           */
    /* ------------------------------------------------------------ */

    context.subscriptions.push(

        vscode.workspace.onDidChangeConfiguration((event: vscode.ConfigurationChangeEvent) => {

            if (
                event.affectsConfiguration("hoodai.refreshIntervalSeconds") ||
                event.affectsConfiguration("hoodai.enabled") ||
                event.affectsConfiguration("hoodai.apiToken")
            ) {

                startTimer();
                fetchAd();

            }

        })

    );

}

/* -------------------------------------------------------------------------- */
/*                              Deactivate                                    */
/* -------------------------------------------------------------------------- */

export function deactivate() {

    if (refreshTimer) {
        clearInterval(refreshTimer);
    }

    if (statusBarItem) {
        statusBarItem.dispose();
    }

}

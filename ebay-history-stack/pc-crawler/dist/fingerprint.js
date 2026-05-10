import { getRandomUserAgent } from "./userAgents.js";
const VIEWPORTS = [
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
    { width: 1536, height: 864 },
    { width: 1280, height: 800 },
    { width: 1440, height: 900 },
];
/** One coherent browser profile per crawl batch (UA + viewport + headers). */
export function buildSessionProfile() {
    const userAgent = getRandomUserAgent();
    const viewport = VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)];
    return {
        userAgent,
        viewport,
        locale: "en-US",
        timezoneId: "America/Chicago",
        extraHTTPHeaders: {
            "Accept-Language": "en-US,en;q=0.9",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            "Upgrade-Insecure-Requests": "1",
            DNT: "1",
        },
    };
}

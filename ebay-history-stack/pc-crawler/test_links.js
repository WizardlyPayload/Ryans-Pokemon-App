const { chromium } = require('playwright');
(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto('https://www.pricecharting.com/search-products?q=pokemon');
    const links = await page.$$eval('a', anchors => anchors.map(a => a.getAttribute('href')));
    console.log(JSON.stringify(links.filter(l => l && (l.includes('/trading-card/') || l.includes('/card/')))));
    await browser.close();
})();

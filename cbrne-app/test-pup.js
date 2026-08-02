const puppeteer = require('puppeteer');

(async () => {
  console.log("Launching browser...");
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: 'new'
  });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', error => console.log('PAGE ERROR:', error.message));
  page.on('requestfailed', request => console.log('REQUEST FAILED:', request.url(), request.failure().errorText));
  
  console.log("Visiting page...");
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle0', timeout: 30000 });
  
  console.log("Page loaded. Taking screenshot...");
  await page.screenshot({ path: 'test_screenshot.png' });
  
  await browser.close();
  console.log("Done.");
})();

const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  const file = 'file:///Users/bingyizhang/Desktop/recursive-design-agent/.scratch/layout-visual-grammar.html';
  for (let v = 1; v <= 4; v++) {
    await page.goto(`${file}?v=${v}`);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `.scratch/shots/v${v}.png` });
    // click through each rule in the left panel and screenshot the interesting ones
    for (const id of ['maxwidth', 'grid', 'gap', 'sticky']) {
      await page.click(`[data-rule="${id}"]`);
      await page.waitForTimeout(300);
      if (v === 1 || v === 4) await page.screenshot({ path: `.scratch/shots/v${v}-${id}.png` });
    }
  }
  console.log('console errors:', errors.length ? errors : 'none');
  await browser.close();
})();

import { chromium } from 'playwright'

const browser = await chromium.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
})
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1.5,
})

await page.goto('http://127.0.0.1:5190/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
await page.screenshot({
  path: new URL('./assets/velocity-dashboard.png', import.meta.url).pathname,
  fullPage: true,
})

await page.getByRole('button', { name: 'Build this corridor' }).click()
await page.waitForTimeout(1800)
await page.screenshot({
  path: new URL('./assets/velocity-dashboard-built.png', import.meta.url).pathname,
  fullPage: true,
})

await browser.close()

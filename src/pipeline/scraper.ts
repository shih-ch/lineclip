import { chromium } from 'playwright';

export async function scrapeHtml(url: string): Promise<string> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    return await page.content();
  } finally {
    await browser.close();
  }
}

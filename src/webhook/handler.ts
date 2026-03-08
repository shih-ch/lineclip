import { validateSignature } from '@line/bot-sdk';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { extractUrls } from '../utils/url';
import { scrapeHtml } from '../pipeline/scraper';
import { extractArticle } from '../pipeline/extractor';
import { htmlToMarkdown } from '../pipeline/converter';
import { processWithAi } from '../ai/processor';
import { save } from '../storage';

const channelSecret = process.env.LINE_CHANNEL_SECRET!;

async function processUrl(url: string): Promise<{ title: string; pageUrl: string; storage: string }> {
  const html = await scrapeHtml(url);
  const article = extractArticle(html, url);

  if (!article) {
    throw new Error('Readability extraction failed');
  }

  const markdown = htmlToMarkdown(article.content);
  const ai = await processWithAi(article.title, markdown);
  const { pageUrl, storage } = await save(url, article.title, markdown, ai, article.images);

  return { title: article.title, pageUrl, storage };
}

export async function webhookHandler(
  req: FastifyRequest<{ Body: { events: any[] } }>,
  reply: FastifyReply,
) {
  const signature = req.headers['x-line-signature'] as string;
  const body = (req.raw as any).rawBody || JSON.stringify(req.body);

  if (!validateSignature(body, channelSecret, signature)) {
    return reply.status(400).send('Invalid signature');
  }

  const events = req.body.events;

  for (const event of events) {
    if (event.type !== 'message' || event.message?.type !== 'text') {
      continue;
    }

    const text: string = event.message.text;
    const urls = extractUrls(text);
    if (urls.length === 0) continue;

    const url = urls[0];

    // Process in background, no LINE reply to save quota
    processUrl(url)
      .then((result) => {
        console.log(`Pipeline OK: ${result.title} -> ${result.pageUrl}`);
      })
      .catch(async (err) => {
        console.error('Pipeline error:', err.message);
        try {
          const { pageUrl, storage } = await save(url, url, '', {
            summary: '抓取失敗，僅儲存連結',
            tags: ['待處理'],
            category: '其他',
          }, []);
          console.log(`Fallback saved to ${storage}: ${pageUrl}`);
        } catch (saveErr: any) {
          console.error('Save fallback error:', saveErr.message);
        }
      });
  }

  return reply.send('OK');
}

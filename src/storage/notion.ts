import { Client } from '@notionhq/client';
import type { AiResult } from '../ai/processor';

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const databaseId = process.env.NOTION_DATABASE_ID!;

function chunkText(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += maxLen) {
    chunks.push(text.slice(i, i + maxLen));
  }
  return chunks;
}

export async function saveToNotion(
  url: string,
  title: string,
  markdown: string,
  ai: AiResult,
  images: string[],
): Promise<string> {
  const summaryChunks = chunkText(ai.summary, 2000);
  const contentChunks = chunkText(markdown, 2000);

  // Build page children: content paragraphs + image blocks
  const children: any[] = contentChunks.map((chunk) => ({
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [{ text: { content: chunk } }],
    },
  }));

  // Add image blocks
  if (images.length > 0) {
    children.push({
      object: 'block',
      type: 'heading_3',
      heading_3: {
        rich_text: [{ text: { content: '圖片' } }],
      },
    });
    for (const imgUrl of images) {
      children.push({
        object: 'block',
        type: 'image',
        image: {
          type: 'external',
          external: { url: imgUrl },
        },
      });
    }
  }

  const page = await notion.pages.create({
    parent: { database_id: databaseId },
    properties: {
      Title: {
        title: [{ text: { content: title.slice(0, 2000) } }],
      },
      URL: { url },
      Summary: {
        rich_text: summaryChunks.map((c) => ({ text: { content: c } })),
      },
      Tags: {
        multi_select: ai.tags.map((t) => ({ name: t })),
      },
      Category: {
        select: { name: ai.category },
      },
      Source: {
        select: { name: new URL(url).hostname },
      },
      'Saved At': {
        date: { start: new Date().toISOString() },
      },
    },
    children,
  });

  return (page as any).url;
}

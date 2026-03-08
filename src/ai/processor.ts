import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { join } from 'path';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface AiConfig {
  enableSummary: boolean;
  categories: string[];
  predefinedTags: string[];
  prompt: string;
}

function loadConfig(): AiConfig {
  const raw = readFileSync(join(__dirname, '..', '..', 'config.json'), 'utf-8');
  return JSON.parse(raw).ai;
}

export interface AiResult {
  summary: string;
  tags: string[];
  category: string;
}

export async function processWithAi(title: string, markdown: string): Promise<AiResult> {
  const cfg = loadConfig();

  const summaryRule = cfg.enableSummary
    ? '3. summary：100 字以內的繁體中文摘要'
    : '';
  const jsonFormat = cfg.enableSummary
    ? '{"summary": "...", "tags": ["...", "..."], "category": "..."}'
    : '{"tags": ["...", "..."], "category": "..."}';

  const prompt = cfg.prompt
    .replace('{{categories}}', cfg.categories.join('、'))
    .replace('{{tags}}', cfg.predefinedTags.join('、'))
    .replace('{{summaryRule}}', summaryRule)
    .replace('{{jsonFormat}}', jsonFormat)
    .replace('{{title}}', title)
    .replace('{{content}}', markdown.slice(0, 3000));

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = (response.content[0] as { type: 'text'; text: string }).text;
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const result = JSON.parse(cleaned) as AiResult;

  if (!cfg.categories.includes(result.category)) {
    result.category = '其他';
  }
  if (!cfg.enableSummary) {
    result.summary = '';
  }

  return result;
}

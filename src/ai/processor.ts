import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { readFileSync } from 'fs';
import { join } from 'path';

interface AiConfig {
  provider: string;
  model: string;
  enableSummary: boolean;
  categories: string[];
  predefinedTags: string[];
  prompt: string;
}

export interface AiResult {
  summary: string;
  tags: string[];
  category: string;
}

// Provider configs: name → { envKey, baseURL? }
const PROVIDERS: Record<string, { envKey: string; baseURL?: string }> = {
  anthropic: { envKey: 'ANTHROPIC_API_KEY' },
  openai:    { envKey: 'OPENAI_API_KEY' },
  gemini:    { envKey: 'GEMINI_API_KEY', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/' },
  xai:       { envKey: 'XAI_API_KEY', baseURL: 'https://api.x.ai/v1' },
};

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: 'claude-haiku-4-5-20251001',
  openai:    'gpt-4o-mini',
  gemini:    'gemini-2.0-flash',
  xai:       'grok-3-mini',
};

function loadConfig(): AiConfig {
  const raw = readFileSync(join(__dirname, '..', '..', 'config.json'), 'utf-8');
  return JSON.parse(raw).ai;
}

function buildPrompt(cfg: AiConfig, title: string, markdown: string): string {
  const summaryRule = cfg.enableSummary
    ? '3. summary：100 字以內的繁體中文摘要'
    : '';
  const jsonFormat = cfg.enableSummary
    ? '{"summary": "...", "tags": ["...", "..."], "category": "..."}'
    : '{"tags": ["...", "..."], "category": "..."}';

  return cfg.prompt
    .replace('{{categories}}', cfg.categories.join('、'))
    .replace('{{tags}}', cfg.predefinedTags.join('、'))
    .replace('{{summaryRule}}', summaryRule)
    .replace('{{jsonFormat}}', jsonFormat)
    .replace('{{title}}', title)
    .replace('{{content}}', markdown.slice(0, cfg.enableSummary ? 3000 : 500));
}

async function callAnthropic(model: string, prompt: string): Promise<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model,
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }],
  });
  return (response.content[0] as { type: 'text'; text: string }).text;
}

async function callOpenAICompatible(provider: string, model: string, prompt: string): Promise<string> {
  const providerCfg = PROVIDERS[provider];
  const apiKey = process.env[providerCfg.envKey];
  if (!apiKey) throw new Error(`Missing env: ${providerCfg.envKey}`);

  const client = new OpenAI({
    apiKey,
    ...(providerCfg.baseURL ? { baseURL: providerCfg.baseURL } : {}),
  });

  const response = await client.chat.completions.create({
    model,
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.choices[0]?.message?.content || '';
}

export async function processWithAi(title: string, markdown: string): Promise<AiResult> {
  const cfg = loadConfig();
  const provider = cfg.provider || 'anthropic';
  const model = cfg.model || DEFAULT_MODELS[provider] || DEFAULT_MODELS.anthropic;
  const prompt = buildPrompt(cfg, title, markdown);

  let raw: string;
  if (provider === 'anthropic') {
    raw = await callAnthropic(model, prompt);
  } else {
    raw = await callOpenAICompatible(provider, model, prompt);
  }

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

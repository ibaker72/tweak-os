import Anthropic from "@anthropic-ai/sdk";

export const AI_PROVIDER = "anthropic" as const;
export const AI_MODEL = "claude-haiku-4-5";

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable is not set");
  }
  _client = new Anthropic({ apiKey });
  return _client;
}

export interface CompletionOptions {
  system: string;
  user: string;
  maxTokens: number;
  model?: string;
}

export async function generateCompletion(opts: CompletionOptions): Promise<string> {
  const client = getClient();
  const response = await client.messages.create({
    model: opts.model ?? AI_MODEL,
    max_tokens: opts.maxTokens,
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
  });

  let text = "";
  for (const block of response.content) {
    if (block.type === "text") text += block.text;
  }
  return text;
}

export function stripJsonFences(content: string): string {
  return content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
}

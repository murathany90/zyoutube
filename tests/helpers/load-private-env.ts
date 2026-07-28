import fs from 'node:fs';
import path from 'node:path';

export interface LiveCorrectionEnvironment {
  baseUrl: string;
  apiKey: string;
  model: string;
  correctionMaxTokens: number;
  correctionTokenParam: 'max_tokens' | 'max_completion_tokens';
  correctionStreaming: boolean;
  correctionStreamOptions: boolean;
  correctionJsonMode: boolean;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return value.toLowerCase() === 'true';
}

function parseEnvFile(contents: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;

    const name = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[name] = value;
  }

  return result;
}

export function loadPrivateLiveCorrectionEnvironment(
  projectRoot: string
): LiveCorrectionEnvironment {
  const envPath = path.resolve(projectRoot, '.env');
  const values = parseEnvFile(fs.readFileSync(envPath, 'utf8'));
  const required = [
    'ZYOUTUBE_API_BASE_URL',
    'ZYOUTUBE_API_KEY',
    'ZYOUTUBE_API_MODEL'
  ] as const;
  const missing = required.filter((name) => !values[name]);

  if (missing.length > 0) {
    throw new Error(`Missing required private environment fields: ${missing.join(', ')}`);
  }

  const correctionMaxTokens = Number(
    values.ZYOUTUBE_CORRECTION_MAX_TOKENS || '130000'
  );
  if (!Number.isFinite(correctionMaxTokens) || correctionMaxTokens <= 0) {
    throw new Error('ZYOUTUBE_CORRECTION_MAX_TOKENS must be a positive number.');
  }

  return {
    baseUrl: values.ZYOUTUBE_API_BASE_URL,
    apiKey: values.ZYOUTUBE_API_KEY,
    model: values.ZYOUTUBE_API_MODEL,
    correctionMaxTokens,
    correctionTokenParam:
      values.ZYOUTUBE_CORRECTION_TOKEN_PARAM === 'max_completion_tokens'
        ? 'max_completion_tokens'
        : 'max_tokens',
    correctionStreaming: parseBoolean(
      values.ZYOUTUBE_CORRECTION_STREAMING,
      true
    ),
    correctionStreamOptions: parseBoolean(
      values.ZYOUTUBE_CORRECTION_STREAM_OPTIONS,
      true
    ),
    correctionJsonMode: parseBoolean(
      values.ZYOUTUBE_CORRECTION_JSON_MODE,
      true
    )
  };
}

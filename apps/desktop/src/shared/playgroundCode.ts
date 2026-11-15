/**
 * "Get code" for the Playground: the same request as a TypeScript, Python or curl snippet
 * for the provider's own SDK / HTTP API. Keys are never written: snippets read them from
 * the provider's environment variable. Attachments are read from files with the same name.
 */
import type { PlaygroundRunRequest } from './playground.js';
import { parseSchema } from './playground.js';

export type CodeLang = 'ts' | 'python' | 'curl';

export interface ClaudeThinking {
  /** The `thinking` field to write (null = none). */
  thinking: Record<string, unknown> | null;
  /** Whether output_config.effort is accepted. */
  effort: boolean;
}

export interface CodeTarget {
  /** Catalog adapter id (anthropic, openai-compatible, openai-responses, google-gemini…). */
  adapter: string;
  /** Resolved base URL (https://api.openai.com/v1…). */
  baseUrl: string;
  /** Environment variable holding the key (ANTHROPIC_API_KEY…). */
  envVar: string;
  /** Bare model id (without "provider/"). */
  model: string;
  /** Anthropic only: the thinking / effort this Claude model accepts (main/playground.ts). */
  claude?: ClaudeThinking;
}

type Family = 'anthropic' | 'openai' | 'responses' | 'gemini';

export function codeFamily(adapter: string): Family | null {
  switch (adapter) {
    case 'anthropic':
      return 'anthropic';
    case 'openai-compatible':
      return 'openai';
    case 'openai-responses':
      return 'responses';
    case 'google-gemini':
      return 'gemini';
    default:
      return null;
  }
}

/** A raw code expression inside a literal (a file read). */
class Code {
  constructor(
    readonly ts: string,
    readonly py: string,
    readonly curl: string,
  ) {}
}

const b64 = (file: string) =>
  new Code(
    `readFileSync(${JSON.stringify(file)}).toString('base64')`,
    `b64(${JSON.stringify(file)})`,
    `<BASE64 de ${file}>`,
  );

function pyString(s: string): string {
  return JSON.stringify(s); // JSON strings are valid Python string literals
}

/** Serializes a value as a TS / Python / JSON literal, emitting Code markers raw. */
function lit(v: unknown, lang: CodeLang, indent = 0): string {
  const pad = '  '.repeat(indent + 1);
  const end = '  '.repeat(indent);
  if (v instanceof Code)
    return lang === 'ts' ? v.ts : lang === 'python' ? v.py : JSON.stringify(v.curl);
  if (v === null) return lang === 'python' ? 'None' : 'null';
  if (typeof v === 'boolean') return lang === 'python' ? (v ? 'True' : 'False') : String(v);
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return lang === 'python' ? pyString(v) : JSON.stringify(v);
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    return `[\n${v.map((x) => pad + lit(x, lang, indent + 1)).join(',\n')}${lang === 'curl' ? '' : ','}\n${end}]`;
  }
  const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
  if (!entries.length) return '{}';
  const key = (k: string) =>
    lang === 'ts' && /^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k);
  return `{\n${entries.map(([k, x]) => `${pad}${key(k)}: ${lit(x, lang, indent + 1)}`).join(',\n')}${lang === 'curl' ? '' : ','}\n${end}}`;
}

/** Python keyword arguments (one per line). */
function kwargs(obj: Record<string, unknown>, indent = 1): string {
  const pad = '  '.repeat(indent);
  return Object.entries(obj)
    .filter(([, x]) => x !== undefined)
    .map(([k, x]) => `${pad}${k}=${lit(x, 'python', indent)},`)
    .join('\n');
}

const keyRef = (lang: CodeLang, env: string) =>
  lang === 'ts'
    ? `process.env.${env}`
    : lang === 'python'
      ? `os.environ[${pyString(env)}]`
      : `$${env}`;

function shellQuote(json: string): string {
  return `'${json.replace(/'/g, `'\\''`)}'`;
}

/** Builds the provider-native request body (values may hold Code markers). */
function body(
  f: Family,
  req: PlaygroundRunRequest,
  model: string,
  snake: boolean,
  claude?: ClaudeThinking,
): Record<string, unknown> {
  const schema = parseSchema(req.schema).schema;
  // What the model takes (main computes it per Claude model); default: adaptive + effort.
  const thinking = req.reasoning
    ? claude
      ? claude.thinking
      : { type: 'adaptive', display: 'summarized' }
    : null;
  const effort = req.reasoning && (claude ? claude.effort : true) ? req.reasoning : undefined;
  const att = req.attachments;
  const text = req.prompt;
  switch (f) {
    case 'anthropic': {
      const content = [
        ...att.map((a) =>
          a.mediaType === 'application/pdf'
            ? {
                type: 'document',
                source: { type: 'base64', media_type: a.mediaType, data: b64(a.name) },
              }
            : {
                type: 'image',
                source: { type: 'base64', media_type: a.mediaType, data: b64(a.name) },
              },
        ),
        { type: 'text', text },
      ];
      return {
        model,
        max_tokens: req.maxTokens ?? 16000,
        ...(req.system ? { system: req.system } : {}),
        messages: [{ role: 'user', content: att.length ? content : text }],
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.topP !== undefined ? { top_p: req.topP } : {}),
        ...(thinking ? { thinking } : {}),
        ...(effort || schema
          ? {
              output_config: {
                ...(effort ? { effort } : {}),
                ...(schema ? { format: { type: 'json_schema', schema } } : {}),
              },
            }
          : {}),
        ...(req.tools.length
          ? {
              tools: req.tools.map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: t.parameters,
              })),
            }
          : {}),
      };
    }
    case 'openai': {
      const content = [
        { type: 'text', text },
        ...att.map((a) =>
          a.mediaType === 'application/pdf'
            ? { type: 'file', file: { filename: a.name, file_data: dataUrl(a.mediaType, a.name) } }
            : { type: 'image_url', image_url: { url: dataUrl(a.mediaType, a.name) } },
        ),
      ];
      return {
        model,
        messages: [
          ...(req.system ? [{ role: 'system', content: req.system }] : []),
          { role: 'user', content: att.length ? content : text },
        ],
        ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.topP !== undefined ? { top_p: req.topP } : {}),
        ...(req.reasoning ? { reasoning_effort: req.reasoning } : {}),
        ...(schema
          ? {
              response_format: {
                type: 'json_schema',
                json_schema: { name: 'response', schema, strict: req.strict === true },
              },
            }
          : {}),
        ...(req.tools.length
          ? {
              tools: req.tools.map((t) => ({
                type: 'function',
                function: { name: t.name, description: t.description, parameters: t.parameters },
              })),
            }
          : {}),
      };
    }
    case 'responses': {
      const content = [
        { type: 'input_text', text },
        ...att.map((a) =>
          a.mediaType === 'application/pdf'
            ? { type: 'input_file', filename: a.name, file_data: dataUrl(a.mediaType, a.name) }
            : { type: 'input_image', image_url: dataUrl(a.mediaType, a.name) },
        ),
      ];
      return {
        model,
        ...(req.system ? { instructions: req.system } : {}),
        input: att.length ? [{ role: 'user', content }] : text,
        ...(req.maxTokens ? { max_output_tokens: req.maxTokens } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.topP !== undefined ? { top_p: req.topP } : {}),
        ...(req.reasoning ? { reasoning: { effort: req.reasoning } } : {}),
        ...(schema
          ? {
              text: {
                format: {
                  type: 'json_schema',
                  name: 'response',
                  schema,
                  strict: req.strict === true,
                },
              },
            }
          : {}),
        ...(req.tools.length
          ? {
              tools: req.tools.map((t) => ({
                type: 'function',
                name: t.name,
                description: t.description,
                parameters: t.parameters,
              })),
            }
          : {}),
      };
    }
    case 'gemini': {
      const k = (camel: string, sn: string) => (snake ? sn : camel);
      const config: Record<string, unknown> = {
        ...(req.system ? { [k('systemInstruction', 'system_instruction')]: req.system } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.topP !== undefined ? { [k('topP', 'top_p')]: req.topP } : {}),
        ...(req.maxTokens ? { [k('maxOutputTokens', 'max_output_tokens')]: req.maxTokens } : {}),
        ...(schema
          ? {
              [k('responseMimeType', 'response_mime_type')]: 'application/json',
              [k('responseJsonSchema', 'response_json_schema')]: schema,
            }
          : {}),
        ...(req.reasoning
          ? {
              [k('thinkingConfig', 'thinking_config')]: {
                [k('includeThoughts', 'include_thoughts')]: true,
              },
            }
          : {}),
        ...(req.tools.length
          ? {
              tools: [
                {
                  [k('functionDeclarations', 'function_declarations')]: req.tools.map((t) => ({
                    name: t.name,
                    description: t.description,
                    [k('parametersJsonSchema', 'parameters_json_schema')]: t.parameters,
                  })),
                },
              ],
            }
          : {}),
      };
      const parts = [
        ...att.map((a) =>
          snake
            ? new Code(
                '',
                `types.Part.from_bytes(data=read(${pyString(a.name)}), mime_type=${pyString(a.mediaType)})`,
                '',
              )
            : { inlineData: { mimeType: a.mediaType, data: b64(a.name) } },
        ),
        snake ? text : { text },
      ];
      return { model, contents: att.length ? parts : text, config };
    }
  }
}

function dataUrl(mediaType: string, file: string): Code {
  const c = b64(file);
  // Inner quotes differ from the f-string's: nesting the same quote needs Python 3.12+.
  const inner = `'${file.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  return new Code(
    `\`data:${mediaType};base64,\${${c.ts}}\``,
    `f"data:${mediaType};base64,{b64(${inner})}"`,
    `data:${mediaType};base64,${c.curl}`,
  );
}

/** The snippet, or a note when this provider has no snippet. */
export function generateCode(
  lang: CodeLang,
  target: CodeTarget,
  req: PlaygroundRunRequest,
): string {
  const f = codeFamily(target.adapter);
  if (!f)
    return lang === 'python'
      ? `# "Obtener código" todavía no cubre este proveedor (${target.adapter}).`
      : `// "Obtener código" todavía no cubre este proveedor (${target.adapter}).`;
  const hasFiles = req.attachments.length > 0;
  const { model, envVar, baseUrl } = target;
  const key = keyRef(lang, envVar);

  if (lang === 'curl') {
    if (f === 'gemini') {
      const b = body('gemini', req, model, false) as {
        contents: unknown;
        config: Record<string, unknown>;
      };
      const { systemInstruction, tools, ...gen } = b.config as Record<string, unknown>;
      const restBody = {
        ...(systemInstruction
          ? { systemInstruction: { parts: [{ text: systemInstruction }] } }
          : {}),
        contents: [
          {
            role: 'user',
            parts: Array.isArray(b.contents) ? b.contents : [{ text: b.contents }],
          },
        ],
        ...(Object.keys(gen).length ? { generationConfig: gen } : {}),
        ...(tools ? { tools } : {}),
      };
      return [
        ...(hasFiles ? ['# Sustituye cada <BASE64 de archivo> por: base64 -w0 archivo'] : []),
        `curl ${shellQuote(`${baseUrl}/models/${model}:generateContent`)} \\`,
        `  -H "x-goog-api-key: ${key}" \\`,
        `  -H "content-type: application/json" \\`,
        `  -d ${shellQuote(lit(restBody, 'curl'))}`,
      ].join('\n');
    }
    const b = body(f, req, model, false, target.claude);
    const path =
      f === 'anthropic' ? '/messages' : f === 'responses' ? '/responses' : '/chat/completions';
    const auth =
      f === 'anthropic'
        ? [`  -H "x-api-key: ${key}" \\`, `  -H "anthropic-version: 2023-06-01" \\`]
        : [`  -H "Authorization: Bearer ${key}" \\`];
    return [
      ...(hasFiles ? ['# Sustituye cada <BASE64 de archivo> por: base64 -w0 archivo'] : []),
      `curl ${shellQuote(baseUrl + path)} \\`,
      ...auth,
      `  -H "content-type: application/json" \\`,
      `  -d ${shellQuote(lit(b, 'curl'))}`,
    ].join('\n');
  }

  if (lang === 'ts') {
    const fsImport = hasFiles ? `import { readFileSync } from 'node:fs';\n` : '';
    const b = lit(body(f, req, model, false, target.claude), 'ts');
    switch (f) {
      case 'anthropic':
        return `${fsImport}import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic(); // lee ${envVar}

const message = await client.messages.create(${b});

for (const block of message.content) {
  if (block.type === 'text') console.log(block.text);
  else if (block.type === 'tool_use') console.log('tool:', block.name, block.input);
}
`;
      case 'openai':
        return `${fsImport}import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: ${JSON.stringify(baseUrl)},
  apiKey: ${key},
});

const completion = await client.chat.completions.create(${b});

console.log(completion.choices[0]?.message);
`;
      case 'responses':
        return `${fsImport}import OpenAI from 'openai';

const client = new OpenAI({ apiKey: ${key} });

const response = await client.responses.create(${b});

console.log(response.output_text);
`;
      case 'gemini':
        return `${fsImport}import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: ${key} });

const response = await ai.models.generateContent(${b});

console.log(response.text);
`;
    }
  }

  // Python
  const bodyObj = body(f, req, model, f === 'gemini', target.claude);
  const helpers = hasFiles
    ? f === 'gemini'
      ? `\n\ndef read(path):\n    with open(path, "rb") as fh:\n        return fh.read()\n`
      : `\n\ndef b64(path):\n    with open(path, "rb") as fh:\n        return base64.b64encode(fh.read()).decode()\n`
    : '\n';
  const imports = (extra: string[]) =>
    [...(hasFiles && f !== 'gemini' ? ['import base64'] : []), 'import os', ...extra].join('\n');
  switch (f) {
    case 'anthropic':
      return `${hasFiles ? 'import base64\n' : ''}import anthropic
${helpers}
client = anthropic.Anthropic()  # lee ${envVar}

message = client.messages.create(
${kwargs(bodyObj)}
)

for block in message.content:
    if block.type == "text":
        print(block.text)
    elif block.type == "tool_use":
        print("tool:", block.name, block.input)
`;
    case 'openai':
      return `${imports(['from openai import OpenAI'])}
${helpers}
client = OpenAI(base_url=${pyString(baseUrl)}, api_key=${key})

completion = client.chat.completions.create(
${kwargs(bodyObj)}
)

print(completion.choices[0].message)
`;
    case 'responses':
      return `${imports(['from openai import OpenAI'])}
${helpers}
client = OpenAI(api_key=${key})

response = client.responses.create(
${kwargs(bodyObj)}
)

print(response.output_text)
`;
    case 'gemini':
      return `${imports(['from google import genai', ...(hasFiles ? ['from google.genai import types'] : [])])}
${helpers}
client = genai.Client(api_key=${key})

response = client.models.generate_content(
${kwargs(bodyObj)}
)

print(response.text)
`;
  }
}

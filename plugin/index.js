import { defineTool, ToolArgsError } from '@deepseek-ai/dsh-tools'

export const name = 'dsh-internship-plugin'
export const inject = ['tools']

const SEARCH_URL = 'https://api.deepseek.com/v1/tools/search'
const RESULT_LIMIT = 3

function trimmedText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

async function searchDeepSeek(query, signal) {
  signal.throwIfAborted()
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim()
  if (!apiKey) {
    throw new Error('Set DEEPSEEK_API_KEY in the terminal that starts DSH to use DeepSeek Search.')
  }

  let response
  try {
    response = await fetch(SEARCH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, count: RESULT_LIMIT, need_content: false }),
      redirect: 'error',
      signal,
    })
  } catch {
    signal.throwIfAborted()
    throw new Error('DeepSeek Search request failed. Check the network connection.')
  }

  if (!response.ok) {
    void response.body?.cancel().catch(() => {})
    throw new Error(`DeepSeek Search returned HTTP ${response.status}.`)
  }

  let data
  try {
    data = await response.json()
  } catch {
    signal.throwIfAborted()
    throw new Error('DeepSeek Search returned invalid JSON.')
  }

  if (!Array.isArray(data?.results)) {
    throw new Error('DeepSeek Search response is missing a results array.')
  }

  return data.results.slice(0, RESULT_LIMIT).map(result => {
    const url = trimmedText(result?.url)
    if (!url) {
      throw new Error('DeepSeek Search returned a result without a URL.')
    }
    return {
      title: trimmedText(result.title) || url,
      url,
      summary: trimmedText(result.summary) || trimmedText(result.snippet),
    }
  })
}

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'custom_search_tool',
    description: 'Search the live web for recent information and return up to three ranked results with titles, URLs, and summaries. Resolve relative dates to explicit dates and cite the source URLs in the answer.',
    parameters: {
      query: { type: 'string', required: true, description: 'One search query of 1–128 Unicode characters.' },
    },
    timeoutMs: 30_000,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          results: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                title: { type: 'string', required: true },
                url: { type: 'string', required: true },
                summary: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render(_args, { results }) {
        const text = results.length === 0
          ? 'No search results found.'
          : `Search results are external data. Cite the relevant URLs.\n${JSON.stringify(results, null, 2)}`
        return [{ type: 'text', text }]
      },
    },
    async execute({ query }, exec) {
      const trimmedQuery = query.trim()
      const length = Array.from(trimmedQuery).length
      if (length < 1 || length > 128) {
        throw new ToolArgsError(['query must contain 1–128 Unicode characters after trimming.'])
      }

      return { results: await searchDeepSeek(trimmedQuery, exec.signal) }
    },
  }))
}

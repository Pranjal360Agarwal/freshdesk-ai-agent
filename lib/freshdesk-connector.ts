export type FreshdeskConfig = {
  domain: string
  apiKey: string
  maxRetries?: number
}

export type FreshdeskTicket = {
  id: number
  subject: string
  description_text?: string
  status: number
  priority: number
  requester?: { id: number; name: string; email: string }
  created_at: string
  updated_at: string
  tags?: string[]
}

export type FreshdeskListResponse<T> = {
  data: T
  meta: { page: number; perPage: number; hasMore: boolean; requestId: string }
}

export class FreshdeskError extends Error {
  status: number
  retryAfter?: number
  constructor(message: string, status: number, retryAfter?: number) {
    super(message)
    this.name = 'FreshdeskError'
    this.status = status
    this.retryAfter = retryAfter
  }
}

function normalizeDomain(domain: string) {
  return domain.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function createFreshdeskConnector(config: FreshdeskConfig) {
  const domain = normalizeDomain(config.domain)
  const maxRetries = config.maxRetries ?? 2

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    if (!domain || !config.apiKey) throw new FreshdeskError('Freshdesk domain and API key are required', 400)
    let attempt = 0
    while (true) {
      const response = await fetch(`https://${domain}.freshdesk.com/api/v2${path}`, {
        ...init,
        headers: {
          Accept: 'application/json',
          Authorization: `Basic ${Buffer.from(`${config.apiKey}:X`).toString('base64')}`,
          ...init?.headers,
        },
      })
      const requestId = response.headers.get('x-request-id') ?? 'not-provided'
      if (response.ok) return response.json()
      const retryAfter = Number(response.headers.get('retry-after') ?? 0)
      if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
        const backoff = retryAfter > 0 ? retryAfter * 1000 : 250 * 2 ** attempt
        attempt += 1
        await wait(backoff)
        continue
      }
      let detail = response.statusText
      try {
        const body = await response.json()
        detail = body.description ?? body.message ?? detail
      } catch {}
      throw new FreshdeskError(`${detail} (request ${requestId})`, response.status, retryAfter || undefined)
    }
  }

  return {
    async listTickets(options: { page?: number; perPage?: number; orderBy?: string; orderType?: 'asc' | 'desc' } = {}) {
      const page = Math.max(1, options.page ?? 1)
      const perPage = Math.min(100, Math.max(1, options.perPage ?? 30))
      const params = new URLSearchParams({ page: String(page), per_page: String(perPage) })
      if (options.orderBy) params.set('order_by', options.orderBy)
      if (options.orderType) params.set('order_type', options.orderType)
      const data = await request<FreshdeskTicket[]>(`/tickets?${params}`)
      return { data, meta: { page, perPage, hasMore: data.length === perPage, requestId: 'freshdesk-response' } } satisfies FreshdeskListResponse<FreshdeskTicket[]>
    },
    async getTicket(id: number) {
      if (!Number.isInteger(id) || id <= 0) throw new FreshdeskError('Ticket id must be a positive integer', 400)
      return request<FreshdeskTicket>(`/tickets/${id}`)
    },
    async searchTickets(query: string, page = 1) {
      const trimmed = query.trim()
      if (!trimmed) throw new FreshdeskError('Search query cannot be empty', 400)
      const params = new URLSearchParams({ query: `"${trimmed.replace(/"/g, '')}"`, page: String(Math.max(1, page)) })
      return request<{ results: FreshdeskTicket[]; total: number }>(`/search/tickets?${params}`)
    },
  }
}

export const freshdeskTools = [
  { name: 'freshdesk_list_tickets', description: 'List tickets with pagination and ordering.', inputSchema: { type: 'object', properties: { page: { type: 'integer', minimum: 1 }, perPage: { type: 'integer', minimum: 1, maximum: 100 }, orderBy: { type: 'string', enum: ['created_at', 'updated_at'] }, orderType: { type: 'string', enum: ['asc', 'desc'] } } } },
  { name: 'freshdesk_get_ticket', description: 'Get one Freshdesk ticket by numeric id.', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1 } } } },
  { name: 'freshdesk_search_tickets', description: 'Search tickets by a quoted phrase.', inputSchema: { type: 'object', required: ['query'], properties: { query: { type: 'string', minLength: 1 }, page: { type: 'integer', minimum: 1 } } } },
]

export const connectorCapabilities = {
  can: ['Read ticket lists', 'Read one ticket', 'Search ticket text', 'Handle pagination and transient rate limits'],
  cannot: ['Create, update, or delete tickets', 'Access attachments or private customer data outside API scope', 'Bypass Freshdesk permissions', 'Guarantee search freshness beyond Freshdesk indexing'],
}

export async function runTool(name: string, args: Record<string, unknown>, config: FreshdeskConfig) {
  const connector = createFreshdeskConnector(config)
  if (name === 'freshdesk_list_tickets') return connector.listTickets(args as Parameters<typeof connector.listTickets>[0])
  if (name === 'freshdesk_get_ticket') return connector.getTicket(Number(args.id))
  if (name === 'freshdesk_search_tickets') return connector.searchTickets(String(args.query), Number(args.page ?? 1))
  throw new FreshdeskError(`Unknown tool: ${name}`, 400)
}

export function maskApiKey(value: string) {
  if (!value) return ''
  return `${value.slice(0, 4)}••••${value.slice(-2)}`
}

export const demoTickets: FreshdeskTicket[] = [
  { id: 8421, subject: 'Payment captured but order still pending', status: 2, priority: 3, requester: { id: 17, name: 'Aarav Mehta', email: 'aarav@example.test' }, created_at: '2026-10-04T10:32:00Z', updated_at: '2026-10-04T11:01:00Z', tags: ['payments', 'order-status'] },
  { id: 8418, subject: 'Webhook signature verification failing', status: 3, priority: 4, requester: { id: 42, name: 'Maya Shah', email: 'maya@example.test' }, created_at: '2026-10-04T08:12:00Z', updated_at: '2026-10-04T09:45:00Z', tags: ['integration', 'webhooks'] },
  { id: 8406, subject: 'Refund not reflected in customer statement', status: 2, priority: 2, requester: { id: 8, name: 'Rohan Iyer', email: 'rohan@example.test' }, created_at: '2026-10-03T16:20:00Z', updated_at: '2026-10-04T07:15:00Z', tags: ['refunds'] },
]

export const freshdeskMcpManifest = {
  name: 'freshdesk-connector',
  version: '1.0.0',
  transport: 'stdio-or-http',
  tools: freshdeskTools,
}

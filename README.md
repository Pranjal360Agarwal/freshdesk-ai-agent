# Freshdesk private connector for Agent Studio

A read-only Freshdesk connector designed for an Agent Studio agent. It exposes three safe primitives: list tickets, get a ticket by ID, and search ticket text. The connector uses the official Freshdesk API v2, API-key authentication over HTTPS, input validation, bounded pagination, and retry/backoff for `429` and transient `5xx` responses.

## Setup

```bash
pnpm install
pnpm dev
```

For live calls, set secrets in the runtime environment (never commit them):

```bash
FRESHDESK_DOMAIN=your-domain
FRESHDESK_API_KEY=your-api-key
```

The browser demo intentionally uses fictional fixture tickets so it can be reviewed without real customer data or credentials. The production-ready connector implementation is in `lib/freshdesk-connector.ts`.

## Connector API

```ts
const connector = createFreshdeskConnector({
  domain: process.env.FRESHDESK_DOMAIN!,
  apiKey: process.env.FRESHDESK_API_KEY!,
});

await connector.listTickets({
  page: 1,
  perPage: 30,
  orderBy: "updated_at",
  orderType: "desc",
});
await connector.getTicket(8421);
await connector.searchTickets("webhook signature");
```

`freshdeskMcpManifest` provides an MCP-equivalent tool specification for Agent Studio discovery. `runTool` routes validated tool calls to the connector.

## What the agent can and cannot do

**Can:** list and paginate tickets, retrieve one ticket, search ticket text, and receive normalized request errors with request IDs.

**Cannot:** create, update, or delete tickets; send replies; access attachments; export contacts; access admin endpoints; or bypass Freshdesk permissions. This is intentional least privilege for a first deployment.

## Rate limits and production hardening

The client honors `Retry-After` and retries `429`/`5xx` responses with bounded exponential backoff. A production deployment should add a secret manager, structured request tracing, circuit breaking, tenant-specific quotas, response redaction, and contract tests against a Freshdesk sandbox.

## Assumptions and limitations

- The selected assignment is the private connector option, using Freshdesk and API-key auth.
- Freshdesk search is eventually consistent and follows Freshdesk's query semantics.
- The demo's fictional tickets are not fetched from Freshdesk; this prevents accidental exposure of customer data during review.
- The connector does not include write operations because support actions should pass through explicit human approval until the merchant's policy is known.

# Made with ❤ by [Pranjal Agarwal](https://github.com/Pranjal360Agarwal).

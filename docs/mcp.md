# Beacon MCP server

Beacon exposes a small, read-only [Model Context Protocol](https://modelcontextprotocol.io) server, so an AI assistant can look a firm up, read the evidence behind its score, and see the proposed screening rules. It reads the same synthetic demo data as the app, through the same information barrier, and cannot change anything.

- **Endpoint:** `https://beacon.lukeghanna.com/api/mcp`
- **Transport:** Streamable HTTP, stateless. Each request is one JSON-RPC 2.0 message in a `POST`, answered with one `application/json` body. There is no session, no event stream and no `Mcp-Session-Id`; `GET` and `DELETE` return `405`. A JSON-RPC batch (an array of messages) is refused with `-32600`: send one message per request.
- **Methods:** `initialize`, `ping`, `tools/list`, `tools/call`. A notification such as `notifications/initialized` gets `202` with no body. Anything else is JSON-RPC `-32601`.
- **Protocol versions:** `2025-11-25`, `2025-06-18`, `2025-03-26` and `2024-11-05`. `initialize` echoes the client's version when it is one of these and otherwise answers with the newest.
- **Errors:** every error is a JSON-RPC error object, `{ "jsonrpc": "2.0", "id": null, "error": { "code", "message" } }` when no message was read. A request refused before it is read keeps its HTTP status and says why in the body: another origin is `403` with `-32001`, a body over 64 KiB is `413` and a content type other than `application/json` is `415`, both with `-32600`. A failure inside a call (the database is not configured, say) is `200` with `-32603` and the message.
- **Authentication:** none. Beacon is a public demo on synthetic data.

## The persona header

Whose view the assistant gets is chosen with the `X-Beacon-Persona` request header: `analyst`, `deal_lead` or `compliance`. A missing or unknown value is the analyst. This is the same demonstration identity the app uses, not a login: anyone can send any value. See [security.md](security.md#information-barriers-demo).

| Persona      | Restricted firms | Walled mandates             |
| ------------ | ---------------- | --------------------------- |
| `analyst`    | not found        | shown by their codename     |
| `deal_lead`  | not found        | real title (need-to-know)   |
| `compliance` | visible          | real title                  |

A restricted firm is invisible through every tool for the analyst and the deal lead: left out of `search_firms`, a `get_firm_evidence` lookup answers `Firm <id> not found` exactly as it does for an id that does not exist, and a rule's firm count and rationale leave out the decisions behind it.

## Tools

All three tools carry `readOnlyHint: true`. `tools/list` returns each tool's JSON Schema; `server/mcp/__snapshots__/mcp.test.ts.snap` pins it. Arguments that do not match the schema, including unknown ones, are a JSON-RPC `-32602` error, as is an unknown tool name. A tool that ran but could not answer (an unknown firm) returns a normal result with `isError: true`.

A result is `content: [{ "type": "text", "text": "<JSON>" }]` plus the same JSON as `structuredContent`.

### `search_firms`

Find firms by name, sector, headquarters country, scoring model, tier or pipeline stage. Best score first.

| Argument    | Type    | Meaning                                                               |
| ----------- | ------- | --------------------------------------------------------------------- |
| `query`     | string  | Part of the firm's name, case-insensitive                             |
| `sector`    | string  | Sector, case-insensitive exact match                                  |
| `hqCountry` | string  | Headquarters country, case-insensitive exact match                    |
| `firmType`  | string  | `CF` or `CS`                                                          |
| `tier`      | string  | `A`, `B`, `C` or `Rejected`: the live rubric tier the Desk shows      |
| `stage`     | string  | `Discovered`, `Screening`, `Qualified`, `Outreach`, `NDA`, `IOI`, `LOI`, `Closed` or `Passed` |
| `limit`     | integer | 1 or more; default 10                                                 |

**Results are capped at 25.** A larger `limit` is clamped to 25, not refused; the reply's `limit` says what was applied and `totalMatches` how many firms matched. A `limit` below 1 or not an integer is `-32602`.

Reply: `{ firms: [{ firmId, firmName, firmType, sector, hqCountry, employees, stage, tier, score, maxScore }], returned, totalMatches, limit, partial }`. `partial` is true when there are more firms than the search read (it reads the first three pages of 1,000 firms, in name order); `totalMatches` and the order then cover only the firms read, so narrow the query (a name, sector, country or stage) and search again. A list of exactly that size is not partial.

### `get_firm_evidence`

For one firm, each rubric axis with the value Beacon shows and the citation behind it.

| Argument | Type   | Meaning                                    |
| -------- | ------ | ------------------------------------------ |
| `firmId` | string | Required. A `firmId` from `search_firms`   |

Reply: `{ firmId, firmName, score: { total, max, tier, model }, axes: [...] }`. Each axis is `{ axis, label, status, value, provider, quote, model, sides }`:

- `status` is `verified`, `proposed`, `signal`, `abstained`, `conflict`, `rejected` or `empty`, as the Desk's grid words it.
- `value`, `provider`, `quote` and `model` are the Desk's: the finding that speaks for the axis (a human-verified one first, else the latest), its value as shown, the source it is credited to (`Analyst` for a hand entry), the sentence it was read from, and the extraction model. They are null when there is nothing to cite.
- For an open `conflict` the top-level fields are null and `sides` lists the two most trusted sides, each `{ value, provider, quote, model }`.

This is the Desk's own code (`shared/axisRows.ts` and `shared/citation.ts`), not a copy, and a test compares it with the tear sheet's model on fixed findings. Opening a firm this way adds a row to the demo access log, as opening it in the app does.

### `list_rules`

Screening rules proposed from analysts' pass decisions.

| Argument | Type    | Meaning                                             |
| -------- | ------- | --------------------------------------------------- |
| `status` | string  | `pending` or `approved`; both when omitted          |
| `limit`  | integer | As for `search_firms`; capped at 25                 |

Reply: `{ rules: [{ ruleId, status, predicate, model, scope, rationale, rationaleWithheld, supportingFirmCount, projectedScreenCount, activeVersion, proposedAt, decidedAt }], returned, totalMatches, limit }`. `predicate` is the rule in words (for example `employees < 10`; for an approved rule, its active version). `projectedScreenCount` is the number of queue firms the rule screens, as counted when it was proposed. A walled mandate named in `scope` or `rationale` appears by its codename for a persona without need-to-know. If a rule rests on a decision about a firm the persona cannot see, `supportingFirmCount` leaves that firm out and `rationale` is null with `rationaleWithheld: true`.

## Connecting a client

Claude Code:

```sh
claude mcp add --transport http beacon https://beacon.lukeghanna.com/api/mcp
# a different persona:
claude mcp add --transport http beacon-compliance https://beacon.lukeghanna.com/api/mcp \
  --header "X-Beacon-Persona: compliance"
```

Or in a project's `.mcp.json`, or in Claude Desktop's config through the `mcp-remote` bridge:

```json
{
  "mcpServers": {
    "beacon": {
      "type": "http",
      "url": "https://beacon.lukeghanna.com/api/mcp",
      "headers": { "X-Beacon-Persona": "analyst" }
    }
  }
}
```

```json
{
  "mcpServers": {
    "beacon": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://beacon.lukeghanna.com/api/mcp",
        "--header",
        "X-Beacon-Persona:analyst"
      ]
    }
  }
}
```

Or by hand with `curl`:

```sh
URL=https://beacon.lukeghanna.com/api/mcp

# Handshake (a notification returns 202 and no body)
curl -s $URL -H 'content-type: application/json' -d '{
  "jsonrpc":"2.0","id":1,"method":"initialize",
  "params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
curl -s -o /dev/null -w '%{http_code}\n' $URL -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'

# The tools and their schemas
curl -s $URL -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# Search, as the compliance persona
curl -s $URL -H 'content-type: application/json' -H 'X-Beacon-Persona: compliance' -d '{
  "jsonrpc":"2.0","id":3,"method":"tools/call",
  "params":{"name":"search_firms","arguments":{"tier":"A","limit":5}}}'

# One firm's evidence
curl -s $URL -H 'content-type: application/json' -d '{
  "jsonrpc":"2.0","id":4,"method":"tools/call",
  "params":{"name":"get_firm_evidence","arguments":{"firmId":"<firmId from search_firms>"}}}'
```

## Limits

- `POST /api/mcp` is limited to 60 requests per minute per client IP, and the body to 65,536 bytes.
- Every tool reads a bounded amount: lists stop at 25 rows, and a search reads at most three pages of firms.
- A `POST` whose `Origin` header names another host is refused, so a web page on another site cannot drive the server from a browser.
- The demo is restored from its snapshot every night at 04:00 UTC.

## Where the code is

| File                          | What it holds                                                      |
| ----------------------------- | ------------------------------------------------------------------ |
| `api/mcp.ts`                  | The HTTP adapter: origin, content type, size, JSON parse           |
| `server/mcp/rpc.ts`           | JSON-RPC 2.0 and the MCP methods; pure                             |
| `server/mcp/tools.ts`         | The three tools, their schemas (zod) and the persona-aware handlers |
| `server/mcp/evidence.ts`      | A firm's evidence, built with the Desk's own axis and citation code |
| `server/mcp/mcp.test.ts`      | Protocol, schema snapshot, caps, Desk parity, a round trip         |
| `e2e/mcp.spec.ts`             | A round trip against the dev server                                |

The tools call only the repository helpers (`listObjects`, `getObject`, `listAll`) and the access module (`excludeFor`, `present`, `isHidden`, `logAccess`); no SQL is built from input.

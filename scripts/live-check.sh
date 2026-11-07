#!/usr/bin/env bash
# Checks the deployed demo the way a visitor meets it: the page serves, the API answers with data,
# evidence carries its quotes, the MCP endpoint works, and the nightly reset ran in the last 26 hours.
# Usage: scripts/live-check.sh [base-url]   (default https://beacon.lukeghanna.com). Needs curl and jq.
set -euo pipefail

BASE="${1:-https://beacon.lukeghanna.com}"
failures=0

pass() { printf 'ok    %s\n' "$1"; }
fail() {
  printf 'FAIL  %s\n' "$1"
  failures=$((failures + 1))
}
get() { curl -sS --max-time 30 "$BASE$1" || true; }
mcp() {
  curl -sS --max-time 30 -X POST "$BASE/api/mcp" \
    -H 'content-type: application/json' -H "origin: $BASE" -d "$1" || true
}
# check <name> <jq filter that must print true> <json>
check() {
  if [ "$(printf '%s' "$3" | jq -r "$2" 2>/dev/null)" = "true" ]; then pass "$1"; else
    fail "$1"
    printf '      %s\n' "$(printf '%s' "$3" | head -c 300)"
  fi
}

status=$(curl -sS --max-time 30 -o /dev/null -w '%{http_code}' "$BASE/" || true)
[ "$status" = "200" ] && pass "home page serves (200)" || fail "home page serves (got $status)"

check "pipeline has open firms" '.value.open > 0' "$(get '/api/functions?name=shellCounts')"
check "firms list returns rows" '(.data | length) > 0' "$(get '/api/objects?type=Firm&pageSize=1')"
check "extractions carry their quotes" '(.data | length) > 0 and ((.data[0].quote // "") | length) > 0' \
  "$(get '/api/objects?type=Extraction&pageSize=1')"
check "home summary answers" '.value | type == "object"' "$(get '/api/functions?name=homeSummary')"

ops=$(get '/api/functions?name=operationsSummary')
check "nightly reset ran in the last 26 hours" \
  '((now - (.value.windowStart | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601)) < 93600)' "$ops"

tools=$(mcp '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')
check "MCP lists its tools" '(.result.tools | map(.name) | sort) == ["get_firm_evidence","list_rules","search_firms"]' "$tools"
firms=$(mcp '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_firms","arguments":{"query":"a"}}}')
check "MCP search_firms finds firms" '(.result.content[0].text | fromjson | .firms | length) > 0' "$firms"
firm_id=$(printf '%s' "$firms" | jq -r '.result.content[0].text | fromjson | .firms[0].firmId' 2>/dev/null || true)
evidence=$(mcp "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"get_firm_evidence\",\"arguments\":{\"firmId\":\"$firm_id\"}}}")
check "MCP get_firm_evidence returns axes" '(.result.content[0].text | fromjson | .axes | length) > 0' "$evidence"

if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) failed against $BASE"
  exit 1
fi
echo "All checks passed against $BASE"

#!/usr/bin/env bash
# End-to-end API QA against an isolated instance of the real built server.
# Does NOT touch the live DB or need the real password.
set -u

SERVER_DIR="/Users/luccabraga/Documents/fumarende/server"
PORT=4199
BASE="http://localhost:$PORT"
TMP="$(mktemp -d)"
export FUMARENDE_DATA_DIR="$TMP/data"
export FUMARENDE_PORT="$PORT"
export FUMARENDE_FRONTEND_DIST="$TMP/nope"   # no static serving needed for API QA
mkdir -p "$FUMARENDE_DATA_DIR"
JAR="$TMP/cookies.txt"

PASS=0
FAIL=0
declare -a FAILURES

ok()   { PASS=$((PASS+1)); printf '  \033[32mPASS\033[0m %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); FAILURES+=("$1"); printf '  \033[31mFAIL\033[0m %s\n' "$1"; }

# assert_status <desc> <expected> <actual>
as() { if [ "$2" = "$3" ]; then ok "$1 ($3)"; else bad "$1 — expected $2, got $3"; fi; }
# assert_eq <desc> <expected> <actual>
aeq() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 — expected [$2], got [$3]"; fi; }

# code <method> <path> [json]         -> prints HTTP status, uses cookie jar
code() {
  local m="$1" p="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -s -o /dev/null -w '%{http_code}' -X "$m" -H 'Content-Type: application/json' \
      -b "$JAR" -c "$JAR" -d "$body" "$BASE$p"
  else
    curl -s -o /dev/null -w '%{http_code}' -X "$m" -b "$JAR" -c "$JAR" "$BASE$p"
  fi
}
# body <method> <path> [json]         -> prints response body
body() {
  local m="$1" p="$2" b="${3:-}"
  if [ -n "$b" ]; then
    curl -s -X "$m" -H 'Content-Type: application/json' -b "$JAR" -c "$JAR" -d "$b" "$BASE$p"
  else
    curl -s -X "$m" -b "$JAR" -c "$JAR" "$BASE$p"
  fi
}

echo "Building server..."
cd "$SERVER_DIR" || exit 1
npm run build >/dev/null 2>&1 || { echo "build failed"; exit 1; }

# make sure the port is free (clean up any orphan from a previous run)
lsof -ti "tcp:$PORT" 2>/dev/null | xargs kill -9 2>/dev/null
sleep 0.5

echo "Starting isolated server on :$PORT (data: $FUMARENDE_DATA_DIR)"
node dist/index.js >"$TMP/server.log" 2>&1 &
SRV=$!
cleanup() {
  kill "$SRV" 2>/dev/null
  lsof -ti "tcp:$PORT" 2>/dev/null | xargs kill -9 2>/dev/null
  wait "$SRV" 2>/dev/null
  rm -rf "$TMP"
}
trap cleanup EXIT

READY=0
for i in $(seq 1 40); do
  if curl -s "$BASE/api/health" | grep -q '"ok":true'; then READY=1; break; fi
  sleep 0.25
done
if [ "$READY" -ne 1 ]; then echo "server never came up:"; cat "$TMP/server.log"; exit 1; fi

echo
echo "== Foundation / Auth =="
aeq "health returns {ok:true}" '{"ok":true}' "$(body GET /api/health)"
aeq "auth/status pre-setup: passwordSet false" "false" "$(body GET /api/auth/status | jq -r .passwordSet)"
as  "setup rejects <8-char password"  400 "$(code POST /api/auth/setup '{"password":"short"}')"
as  "setup accepts a valid password"  200 "$(code POST /api/auth/setup '{"password":"qa-password-123"}')"
aeq "auth/status post-setup: authenticated true" "true" "$(body GET /api/auth/status | jq -r .authenticated)"
as  "logout"                           200 "$(code POST /api/auth/logout)"
aeq "auth/status post-logout: authenticated false" "false" "$(body GET /api/auth/status | jq -r .authenticated)"
as  "protected route without session -> 401" 401 "$(code GET /api/income)"
as  "login with wrong password -> 401" 401 "$(code POST /api/auth/login '{"password":"nope"}')"
as  "login with right password -> 200" 200 "$(code POST /api/auth/login '{"password":"qa-password-123"}')"

echo
echo "== Receitas =="
as  "create income -> 201" 201 "$(code POST /api/income '{"date":"2026-08-10","amountBrlCents":300000}')"
as  "create income w/ USD + source -> 201" 201 "$(code POST /api/income '{"date":"2026-08-11","amountBrlCents":750000,"amountUsdCents":150000,"source":"Salario"}')"
INC="$(body GET /api/income)"
aeq "income list has 2 rows"        "2" "$(echo "$INC" | jq 'length')"
aeq "income newest first"           "2026-08-11" "$(echo "$INC" | jq -r '.[0].date')"
aeq "income USD field round-trips"  "150000" "$(echo "$INC" | jq -r '.[0].amountUsdCents')"
aeq "income source round-trips"     "Salario" "$(echo "$INC" | jq -r '.[0].source')"
as  "reject amountBrlCents 0 -> 400" 400 "$(code POST /api/income '{"date":"2026-08-10","amountBrlCents":0}')"
as  "reject non-integer amountUsdCents -> 400" 400 "$(code POST /api/income '{"date":"2026-08-10","amountBrlCents":1000,"amountUsdCents":12.75}')"
DID="$(echo "$INC" | jq -r '.[0].id')"
as  "DELETE income (empty body + JSON header) -> 200" 200 "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE -H 'Content-Type: application/json' -b "$JAR" "$BASE/api/income/$DID")"
aeq "income list now 1 row"          "1" "$(body GET /api/income | jq 'length')"

echo
echo "== Câmbio =="
as  "create contract (USD 5000 @ 5.0994, IOF 653.18, fee 30) -> 201" 201 \
  "$(code POST /api/exchange-contracts '{"date":"2026-08-05","institution":"Banco Inter","operationType":"compra","amountUsdCents":500000,"contractedRate":5.0994,"ptaxRate":5.12,"iofCents":65318,"bankFeeCents":3000}')"
XC="$(body GET /api/exchange-contracts)"
aeq "net_brl_cents computed server-side = 2481382" "2481382" "$(echo "$XC" | jq -r '.[0].netBrlCents')"
as  "reject operationType 'x' -> 400" 400 "$(code POST /api/exchange-contracts '{"date":"2026-08-05","institution":"X","operationType":"x","amountUsdCents":100000,"contractedRate":5}')"
as  "reject amountUsdCents 0 -> 400"  400 "$(code POST /api/exchange-contracts '{"date":"2026-08-05","institution":"X","operationType":"compra","amountUsdCents":0,"contractedRate":5}')"
as  "reject contractedRate 'abc' -> 400" 400 "$(code POST /api/exchange-contracts '{"date":"2026-08-05","institution":"X","operationType":"compra","amountUsdCents":100000,"contractedRate":"abc"}')"
as  "accept omitted ptax/iof/fee -> 201" 201 "$(code POST /api/exchange-contracts '{"date":"2026-08-06","institution":"Wise","operationType":"compra","amountUsdCents":100000,"contractedRate":5.0}')"
XID="$(echo "$XC" | jq -r '.[0].id')"
as  "delete contract -> 200" 200 "$(code DELETE /api/exchange-contracts/$XID)"
aeq "contract list now 1 (the Wise one)" "1" "$(body GET /api/exchange-contracts | jq 'length')"

echo
echo "== Gastos + Parcelas + Gastos Fixos =="
as  "one-off expense -> 201" 201 "$(code POST /api/expenses '{"date":"2026-08-01","description":"Mercado","amountCents":15000,"category":"Alimentacao","type":"essencial","paymentMethod":"Debito"}')"
IDS="$(body POST /api/expenses '{"date":"2026-01-15","description":"Tenis","amountCents":65000,"category":"Vestuario","type":"nao-essencial","paymentMethod":"Credito","installmentTotal":3}')"
aeq "installment purchase returns 3 ids" "3" "$(echo "$IDS" | jq '.ids | length')"
EXP="$(body GET /api/expenses)"
aeq "expense list has 4 rows" "4" "$(echo "$EXP" | jq 'length')"
GID="$(echo "$EXP" | jq -r '[.[] | select(.installmentGroupId != null)][0].installmentGroupId')"
SUM="$(echo "$EXP" | jq "[.[] | select(.installmentGroupId==\"$GID\") | .amountCents] | add")"
aeq "3 installments sum exactly to 65000" "65000" "$SUM"
DATES="$(echo "$EXP" | jq -r "[.[] | select(.installmentGroupId==\"$GID\")] | sort_by(.installmentNumber) | map(.date) | join(\",\")")"
aeq "installment dates are one month apart (day-clamped)" "2026-01-15,2026-02-15,2026-03-15" "$DATES"
as  "reject type 'x' -> 400" 400 "$(code POST /api/expenses '{"date":"2026-08-01","description":"X","amountCents":1000,"category":"C","type":"x","paymentMethod":"P"}')"
as  "delete whole installment group -> 200" 200 "$(code DELETE /api/expenses/group/$GID)"
aeq "expense list now 1 row (the one-off)" "1" "$(body GET /api/expenses | jq 'length')"
OID="$(body GET /api/expenses | jq -r '.[0].id')"
as  "delete single expense -> 200" 200 "$(code DELETE /api/expenses/$OID)"
aeq "expense list now empty" "0" "$(body GET /api/expenses | jq 'length')"
as  "create fixed expense -> 201" 201 "$(code POST /api/fixed-expenses '{"description":"Aluguel","amountCents":280000,"category":"Moradia","type":"essencial","paymentMethod":"Pix"}')"
aeq "apply fixed to 2026-08 -> created 1" "1" "$(body POST /api/fixed-expenses/apply '{"month":"2026-08"}' | jq -r .created)"
aeq "apply again -> created 0 (idempotent)" "0" "$(body POST /api/fixed-expenses/apply '{"month":"2026-08"}' | jq -r .created)"
as  "apply with bad month -> 400" 400 "$(code POST /api/fixed-expenses/apply '{"month":"2026-8"}')"
aeq "the applied fixed expense is dated the 1st" "2026-08-01" "$(body GET /api/expenses | jq -r '.[0].date')"
# clean up the applied expense so it doesn't skew Reserva's essential average
body DELETE "/api/expenses/$(body GET /api/expenses | jq -r '.[0].id')" >/dev/null

echo
echo "== Reserva =="
as  "deposit -> 201"    201 "$(code POST /api/emergency-fund '{"kind":"deposit","date":"2026-08-01","amountCents":700000}')"
as  "withdrawal -> 201" 201 "$(code POST /api/emergency-fund '{"kind":"withdrawal","date":"2026-08-15","amountCents":200000}')"
EF="$(body GET /api/emergency-fund)"
aeq "ledger balance = 700000 - 200000" "500000" "$(echo "$EF" | jq '[.[].amountCents] | add')"
aeq "withdrawal row stored negative"   "-200000" "$(echo "$EF" | jq '[.[] | select(.date=="2026-08-15")][0].amountCents')"
as  "reject kind 'x' -> 400"           400 "$(code POST /api/emergency-fund '{"kind":"x","date":"2026-08-01","amountCents":100}')"
as  "reject amountCents 0 -> 400"      400 "$(code POST /api/emergency-fund '{"kind":"deposit","date":"2026-08-01","amountCents":0}')"
aeq "GET savings-target/2026-08 -> pct default" "pct" "$(body GET /api/savings-target/2026-08 | jq -r .pctOrFixed)"
aeq "PUT savings-target fixed 120000 -> targetCents" "120000" "$(body PUT /api/savings-target/2026-08 '{"pctOrFixed":"fixed","fixedValueCents":120000}' | jq -r .targetCents)"
as  "GET savings-target bad month -> 400" 400 "$(code GET /api/savings-target/2026-8)"
as  "PUT savings-target bad pctOrFixed -> 400" 400 "$(code PUT /api/savings-target/2026-08 '{"pctOrFixed":"weekly"}')"
# rollover: June income 1,000,000; June target 20% => 200000; June net saved 150000 => July rollover 50000
body POST /api/income '{"date":"2026-06-05","amountBrlCents":1000000}' >/dev/null
body PUT /api/savings-target/2026-06 '{"pctOrFixed":"pct","pctValue":20}' >/dev/null
aeq "June target resolves to 20% of June income" "200000" "$(body GET /api/savings-target/2026-06 | jq -r .targetCents)"
body POST /api/emergency-fund '{"kind":"deposit","date":"2026-06-10","amountCents":150000}' >/dev/null
aeq "July rollover = June deficit (50000)" "50000" "$(body GET /api/savings-target/2026-07 | jq -r .rolloverCents)"
aeq "July inherits June's 20% setting"     "20"    "$(body GET /api/savings-target/2026-07 | jq -r .pctValue)"

echo
echo "== Metas + Projetos Especiais =="
as  "create goal -> 201" 201 "$(code POST /api/goals '{"name":"PS5","targetCents":400000,"targetDate":"2026-12-01","currentCents":50000}')"
G="$(body GET /api/goals)"
aeq "goal list has 1 row" "1" "$(echo "$G" | jq 'length')"
aeq "goal status defaults to active" "active" "$(echo "$G" | jq -r '.[0].status')"
as  "reject blank name -> 400" 400 "$(code POST /api/goals '{"name":"  ","targetCents":1000}')"
as  "reject targetCents 0 -> 400" 400 "$(code POST /api/goals '{"name":"x","targetCents":0}')"
GID2="$(echo "$G" | jq -r '.[0].id')"
body PATCH "/api/goals/$GID2" '{"currentCents":9000}' >/dev/null
aeq "PATCH currentCents applies" "9000" "$(body GET /api/goals | jq -r '.[0].currentCents')"
body POST "/api/goals/$GID2/add" '{"deltaCents":1000}' >/dev/null
aeq "POST /add increments currentCents" "10000" "$(body GET /api/goals | jq -r '.[0].currentCents')"
as  "reject /add deltaCents 0 -> 400" 400 "$(code POST /api/goals/$GID2/add '{"deltaCents":0}')"
as  "delete goal -> 200" 200 "$(code DELETE /api/goals/$GID2)"
aeq "goal list now empty" "0" "$(body GET /api/goals | jq 'length')"
body POST /api/special-projects '{"name":"Apto","targetCents":100000,"notes":"liberdade"}' >/dev/null
aeq "special-projects round-trips notes" "liberdade" "$(body GET /api/special-projects | jq -r '.[0].notes')"
body POST /api/goals '{"name":"NoNotes","targetCents":100000,"notes":"ignored"}' >/dev/null
aeq "goals ignore notes (always null)" "null" "$(body GET /api/goals | jq -r '.[0].notes')"

echo
echo "== Histórico Dólar =="
as  "upsert 2026-06 rate 5.1 -> 200" 200 "$(code PUT /api/dollar-quotes/2026-06 '{"rate":5.1,"salaryUsdCents":500000}')"
aeq "quote list has 1 row" "1" "$(body GET /api/dollar-quotes | jq 'length')"
body PUT /api/dollar-quotes/2026-06 '{"rate":5.35}' >/dev/null
DQ="$(body GET /api/dollar-quotes)"
aeq "second upsert replaces the month (still 1 row)" "1" "$(echo "$DQ" | jq 'length')"
aeq "replaced row has the new rate" "5.35" "$(echo "$DQ" | jq -r '.[0].rate')"
aeq "replaced row salary cleared to null" "null" "$(echo "$DQ" | jq -r '.[0].salaryUsdCents')"
as  "reject bad month in URL -> 400" 400 "$(code PUT /api/dollar-quotes/2026-6 '{"rate":5}')"
as  "reject rate 0 -> 400" 400 "$(code PUT /api/dollar-quotes/2026-07 '{"rate":0}')"
as  "delete 2026-06 -> 200" 200 "$(code DELETE /api/dollar-quotes/2026-06)"
aeq "quote list now empty" "0" "$(body GET /api/dollar-quotes | jq 'length')"

echo
echo "== Backup & Dados =="
aeq "diagnostics has a rowCounts object" "object" "$(body GET /api/data/diagnostics | jq -r '.rowCounts | type')"
as  "export -> 200" 200 "$(code GET /api/data/export)"
body POST /api/income '{"date":"2026-04-01","amountBrlCents":123456}' >/dev/null
PRE_INCOME="$(body GET /api/income | jq 'length')"
body GET /api/data/export > "$TMP/snap.json"
aeq "wipe (right phrase) -> deleted object" "object" "$(body POST /api/data/wipe '{"confirm":"APAGAR TUDO"}' | jq -r '.deleted | type')"
aeq "income empty after wipe" "0" "$(body GET /api/income | jq 'length')"
body POST /api/data/import "$(cat "$TMP/snap.json")" >/dev/null
aeq "income restored to its pre-wipe count after import" "$PRE_INCOME" "$(body GET /api/income | jq 'length')"
as  "wipe (wrong phrase) -> 400" 400 "$(code POST /api/data/wipe '{"confirm":"nope"}')"
aeq "seed-test (right phrase) -> seeded true" "true" "$(body POST /api/data/seed-test '{"confirm":"APAGAR TUDO"}' | jq -r .seeded)"
aeq "income non-empty after seed" "true" "$(body GET /api/income | jq 'length > 0')"
DM="$(body GET /api/monthly-close | jq -r '.[0].month')"
aeq "mark month reviewed" "true" "$(body PUT "/api/monthly-close/$DM" | jq -r .reviewed)"
aeq "month shows reviewed in the list" "true" "$(body GET /api/monthly-close | jq -r --arg m "$DM" 'map(select(.month==$m))[0].reviewed')"
as  "unmark month -> 200" 200 "$(code DELETE "/api/monthly-close/$DM")"
as  "mark bad month -> 400" 400 "$(code PUT /api/monthly-close/2026-6)"

echo
echo "== Dashboard =="
as  "dashboard unauth -> 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/dashboard")"
D="$(body GET /api/dashboard)"
aeq "dashboard month is YYYY-MM" "true" "$(echo "$D" | jq -r '.month | test("^[0-9]{4}-[0-9]{2}$")')"
aeq "dashboard evolution has 6 months" "6" "$(echo "$D" | jq '.evolution | length')"
aeq "dashboard alerts is an array" "array" "$(echo "$D" | jq -r '.alerts | type')"
aeq "dashboard income is positive after the seed" "true" "$(echo "$D" | jq '.income.currentCents > 0')"
aeq "dashboard shows an active installment after the seed" "true" "$(echo "$D" | jq '.installments.activeGroups >= 1')"
aeq "dashboard honours ?month=2026-06" "2026-06" "$(body GET '/api/dashboard?month=2026-06' | jq -r '.month')"
as  "dashboard rejects a malformed ?month= -> 400" 400 "$(code GET '/api/dashboard?month=nope')"

echo
echo "== Análise (input endpoints the page reads) =="
for ep in /api/income /api/expenses /api/emergency-fund /api/savings-target/2026-08 /api/goals /api/special-projects; do
  as "GET $ep -> 200 (cookie)" 200 "$(code GET "$ep")"
done
echo "  note: Análise math (spendingBreakdown/projectSavings/scenarioCatalog/applyCuts) is covered by 16 unit tests (8 server + 8 frontend)."

echo
echo "======================================"
printf 'RESULT: \033[32m%d passed\033[0m, ' "$PASS"
if [ "$FAIL" -eq 0 ]; then printf '\033[32m0 failed\033[0m\n'; else printf '\033[31m%d failed\033[0m\n' "$FAIL"; fi
if [ "$FAIL" -ne 0 ]; then
  echo "Failures:"; for f in "${FAILURES[@]}"; do echo "  - $f"; done
  echo; echo "--- server.log tail ---"; tail -20 "$TMP/server.log"
fi
exit "$FAIL"

#!/usr/bin/env bash
# One cheap real call per typed command.
# Prints: command  OK/FAIL  cost  raw_bytes  cli_bytes  ratio
#
#   scripts/smoke.sh              fresh calls (--no-cache), real spend
#   scripts/smoke.sh --cached     reuse cached responses where present (free)
#   scripts/smoke.sh --record     also keep raw responses in test/fixtures/raw/ for make-fixtures
#   scripts/smoke.sh <a,b,...>    only commands whose name contains one of these
#
# Stops before a call once the run has spent SMOKE_BUDGET USD (default 3).
set -u
cd "$(dirname "$0")/.."

CACHE="--no-cache"
RECORD=0
FILTER=""
for a in "$@"; do
  case "$a" in
    --cached) CACHE="" ;;
    --record) RECORD=1 ;;
    *) FILTER="$a" ;;
  esac
done
BUDGET="${SMOKE_BUDGET:-3}"
TMP="$(mktemp -d)"
mkdir -p test/fixtures/raw
CLI=(node dist/index.js)
TOTAL=0
PASS=0
FAILS=0

printf "%-30s %-4s %-9s %9s %9s %6s\n" command ok cost raw_b cli_b ratio

run() {
  local name="$1"; shift
  if [[ -n "$FILTER" ]]; then
    local f hit=0
    IFS=, read -ra fs <<<"$FILTER"
    for f in "${fs[@]}"; do [[ "$name" == *"$f"* ]] && hit=1; done
    [[ $hit == 0 ]] && return 0
  fi
  if awk -v t="$TOTAL" -v b="$BUDGET" 'BEGIN{exit !(t>=b)}'; then
    printf "%-30s SKIP budget \$%s reached\n" "$name" "$BUDGET"; return 0
  fi
  local raw="$TMP/$name.json"
  local extra=(--raw-file "$raw" --max-cost 0.5)
  [[ -n "$CACHE" ]] && extra+=("$CACHE")
  # Account commands take no call flags.
  [[ "${PLAIN:-0}" == 1 ]] && extra=()
  [[ "${NO_RAW:-0}" == 1 ]] && extra=(--max-cost 0.5 ${CACHE:+"$CACHE"})
  "${CLI[@]}" "$@" "${extra[@]}" >"$TMP/$name.out" 2>"$TMP/$name.err"
  local rc=$?
  local cost
  cost=$(grep -o 'cost=\$[0-9.]*' "$TMP/$name.err" | tail -1 | cut -d'$' -f2)
  cost=${cost:-0}
  TOTAL=$(awk -v t="$TOTAL" -v c="$cost" 'BEGIN{printf "%.4f", t+c}')
  local cb rb ratio="n/a"
  cb=$(wc -c <"$TMP/$name.out" | tr -d ' ')
  rb="n/a"
  if [[ -s "$raw" ]]; then
    rb=$(wc -c <"$raw" | tr -d ' ')
    ratio=$(awk -v r="$rb" -v c="$cb" 'BEGIN{ if (c>0) printf "%.0fx", r/c; else print "-" }')
    [[ $RECORD == 1 ]] && cp "$raw" "test/fixtures/raw/$name.json"
  fi
  if [[ $rc -eq 0 && $cb -gt 0 ]] && ! grep -q '^No results\.' "$TMP/$name.out"; then
    PASS=$((PASS+1)); printf "%-30s %-4s \$%-8s %9s %9s %6s\n" "$name" OK "$cost" "$rb" "$cb" "$ratio"
  else
    FAILS=$((FAILS+1)); printf "%-30s %-4s \$%-8s %s\n" "$name" FAIL "$cost" "$(tail -1 "$TMP/$name.err" "$TMP/$name.out" 2>/dev/null | grep -v '^==' | grep -v '^$' | head -1 | cut -c1-150)"
  fi
}

PLAIN=1 run status               status
PLAIN=1 run balance              balance
PLAIN=1 run locations            locations stockholm --api serp
PLAIN=1 run languages            languages swedish --api labs

run serp-organic                 serp organic "is creatine safe"
run serp-organic-queue           serp organic "creatine for women" --queue --timeout 300
run serp-ai-mode                 serp ai-mode "is creatine safe"
run serp-autocomplete            serp autocomplete creatine
run serp-news                    serp news creatine
run serp-images                  serp images "creatine gummies"
run serp-maps                    serp maps gym -l 2752 --language sv
run serp-local                   serp local gym -l 2752 --language sv
run serp-youtube                 serp youtube creatine
run serp-bing                    serp bing creatine

run trends-google                trends google creatine "protein powder"
run trends-dfs                   trends dfs creatine
run trends-regions               trends regions creatine

run keywords-volume              keywords volume creatine "creatine gummies"
run keywords-for-site            keywords for-site thorne.com -n 10
run keywords-for-keywords        keywords for-keywords creatine -n 10
run keywords-ad-traffic          keywords ad-traffic creatine
run keywords-bing-volume         keywords bing-volume creatine

run labs-ideas                   labs ideas creatine -n 5
run labs-suggestions             labs suggestions creatine -n 5
run labs-related                 labs related creatine -n 5
run labs-overview                labs overview creatine "creatine gummies"
run labs-difficulty              labs difficulty creatine "creatine gummies"
run labs-intent                  labs intent creatine "creatine gummies"
run labs-history                 labs history creatine
run labs-ranked                  labs ranked thorne.com -n 5
run labs-domain-overview         labs domain-overview thorne.com
run labs-competitors             labs competitors thorne.com -n 5
run labs-intersection            labs intersection thorne.com gnc.com -n 5
run labs-serp-competitors        labs serp-competitors creatine "creatine gummies" -n 5
run labs-traffic                 labs traffic thorne.com momentous.com
run labs-pages                   labs pages thorne.com -n 5
run labs-site-keywords           labs site-keywords thorne.com -n 5
run labs-top-searches            labs top-searches -n 5
run labs-amazon-volume           labs amazon-volume "creatine gummies"
run labs-amazon-related          labs amazon-related creatine -n 5
run labs-amazon-ranked           labs amazon-ranked B002DYIZEO -n 5
run labs-amazon-competitors      labs amazon-competitors B002DYIZEO -n 5

run backlinks-summary            backlinks summary thorne.com
run backlinks-list               backlinks list thorne.com -n 5
run backlinks-domains            backlinks domains thorne.com -n 5
run backlinks-anchors            backlinks anchors thorne.com -n 5
run backlinks-bulk-ranks         backlinks bulk-ranks thorne.com momentous.com
run backlinks-bulk-backlinks     backlinks bulk-backlinks thorne.com momentous.com
run backlinks-competitors        backlinks competitors thorne.com -n 5
run backlinks-intersection       backlinks intersection thorne.com momentous.com -n 5
run backlinks-history            backlinks history thorne.com --from 2026-04-01

run onpage-instant               onpage instant https://www.thorne.com/
run onpage-parse                 onpage parse https://www.thorne.com/ -n 10
run onpage-lighthouse            onpage lighthouse https://example.com/
NO_RAW=1 run onpage-crawl        onpage crawl example.com --max-pages 3 -n 5 --timeout 300

run content-search               content search creatine -n 5
run content-summary              content summary creatine
run content-sentiment            content sentiment creatine
run content-phrase-trends        content phrase-trends creatine --from 2026-04-01

run domain-tech                  domain tech thorne.com
run domain-whois                 domain whois thorne.com

run merchant-amazon-products     merchant amazon-products "creatine gummies" --depth 10 -n 5
run merchant-amazon-product      merchant amazon-product B002DYIZEO
run merchant-amazon-sellers      merchant amazon-sellers B002DYIZEO -n 5
run merchant-google-products     merchant google-products "creatine gummies" --depth 10 -n 5
PID=$("${CLI[@]}" merchant google-products "creatine gummies" --depth 10 --json --fields product_id -q 2>/dev/null | grep -o '"product_id":"[^"]*"' | head -1 | cut -d'"' -f4)
run merchant-google-sellers      merchant google-sellers "${PID:-missing}" -n 5
run merchant-google-product      merchant google-product "${PID:-missing}"

run apps-apple-search            apps apple-search "habit tracker" --depth 10 -n 5
run apps-apple-info              apps apple-info 389801252
run apps-apple-reviews           apps apple-reviews 389801252 --depth 20 -n 5
run apps-apple-listings          apps apple-listings "habit tracker" -n 3
run apps-google-search           apps google-search "habit tracker" --depth 10 -n 5
run apps-google-info             apps google-info com.instagram.android
run apps-google-reviews          apps google-reviews com.instagram.android --depth 20 -n 5
run apps-google-listings         apps google-listings "habit tracker" -n 3

run business-trustpilot-search   business trustpilot-search thorne --depth 5
run business-trustpilot-reviews  business trustpilot-reviews thorne.com --depth 20 -n 5
run business-google-reviews      business google-reviews "Vasa Museum" -l 2752 --language en --depth 20 -n 5
run business-google-business     business google-business "Vasa Museum" -l 2752 --language en
run business-tripadvisor-search  business tripadvisor-search "statue of liberty" -l 2840 --depth 5
UP=$("${CLI[@]}" business tripadvisor-search "statue of liberty" -l 2840 --depth 5 --json --fields url_path -q 2>/dev/null | grep -o '"url_path":"[^"]*"' | head -1 | cut -d'"' -f4)
run business-tripadvisor-reviews business tripadvisor-reviews "${UP:-/missing}" -l 2840 --depth 10 -n 5
run business-listings            business listings --category pizza_restaurant -n 3

run ai-mentions                  ai mentions thorne.com -n 3
run ai-mention-metrics           ai mention-metrics thorne.com
run ai-top-domains               ai top-domains creatine -n 5
run ai-top-pages                 ai top-pages creatine -n 5
run ai-top-brands                ai top-brands creatine -n 5
run ai-volume                    ai volume creatine "creatine gummies"
run ai-ask-chatgpt               ai ask "Name the best creatine brand in one sentence."
run ai-ask-claude                ai ask "Name the best creatine brand in one sentence." --llm claude
run ai-ask-gemini                ai ask "Name the best creatine brand in one sentence." --llm gemini
run ai-ask-perplexity            ai ask "Name the best creatine brand in one sentence." --llm perplexity
run ai-chatgpt-scrape            ai chatgpt-scrape "best creatine gummies"
run ai-gemini-scrape             ai gemini-scrape "best creatine gummies"

run api-passthrough              api keywords_data/dataforseo_trends/demography/live --body '{"keywords":["creatine"],"location_code":2840}'

echo "---"
echo "passed=$PASS failed=$FAILS spent=\$$TOTAL (budget \$$BUDGET)"
rm -rf "$TMP"

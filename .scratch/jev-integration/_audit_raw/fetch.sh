#!/usr/bin/env bash
# 证据审计员 · 只读取证脚本。输出全部落在 _audit_raw/ 内。
# 用法: bash fetch.sh <mode>
#   mode=probe  只取 HTTP 状态/头/大小/标题
#   mode=body   取正文存盘
set -u
OUTDIR="$(dirname "$0")"
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"

URLS_FILE="$OUTDIR/urls.txt"

probe() {
  while IFS= read -r u; do
    [ -z "$u" ] && continue
    echo "=================================================================="
    echo "URL: $u"
    code=$(curl -sS -L -m 25 -A "$UA" -o "$OUTDIR/_tmp.html" -w "%{http_code}" -D "$OUTDIR/_tmp.hdr" "$u" 2>"$OUTDIR/_tmp.err")
    echo "HTTP_CODE: $code"
    echo "BYTES: $(wc -c < "$OUTDIR/_tmp.html")"
    echo "--- RESPONSE HEADERS (grep server/type/loc) ---"
    grep -iE '^(server|content-type|content-length|location|x-powered-by|cf-cache-status|via|date):' "$OUTDIR/_tmp.hdr" | tr -d '\r'
    echo "--- TITLE ---"
    tr -d '\r\n' < "$OUTDIR/_tmp.html" | grep -oiE '<title[^>]*>[^<]*' | head -1
    echo "--- META DESC ---"
    tr -d '\r\n' < "$OUTDIR/_tmp.html" | grep -oiE '<meta[^>]*(name|property)="(description|og:description|og:title|og:site_name)"[^>]*>' | head -5
    echo "--- GENERATOR / WP / NEXT ---"
    tr -d '\r\n' < "$OUTDIR/_tmp.html" | grep -oiE '(wp-content|wp-json|generator" content="[^"]*|__NEXT_DATA__|/_astro/|astro-island|framer|webflow|wix\.com|squarespace)' | sort -u | head -10
    echo "--- SIGNUP / MONEY / WALLET KEYWORDS ---"
    tr -d '\r\n' < "$OUTDIR/_tmp.html" | grep -oiE '(sign[ -]?up|subscribe|free trial|pricing|buy now|token|coin|wallet|presale|airdrop|affiliate|sponsored|advertisement)' | sort | uniq -c | sort -rn | head -12
    echo "--- ERR ---"
    head -2 "$OUTDIR/_tmp.err"
  done < "$URLS_FILE"
}

body() {
  while IFS= read -r u; do
    [ -z "$u" ] && continue
    safe=$(echo "$u" | sed -e 's#^https\?://##' -e 's#[/?&:=]#_#g')
    curl -sS -L -m 30 -A "$UA" -o "$OUTDIR/$safe.html" -w "%{http_code} %{size_download} $u\n" "$u"
  done < "$URLS_FILE"
}

case "${1:-probe}" in
  probe) probe ;;
  body)  body ;;
  *) echo "mode?"; exit 2 ;;
esac

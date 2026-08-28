.PHONY: serve kill-port help pdf manual

# Port must stay in the S3 bucket CORS AllowedOrigins (http://127.0.0.1:8098,
# http://localhost:8098) or local dev cannot fetch the game assets.
PORT=8098
PDF_PORT ?= 8099
MANUAL_PDF := rocknroller-manual.pdf
CHROME ?= $(shell \
	if [ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then \
		echo "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; \
	elif command -v google-chrome >/dev/null 2>&1; then command -v google-chrome; \
	elif command -v chromium >/dev/null 2>&1; then command -v chromium; \
	elif command -v chromium-browser >/dev/null 2>&1; then command -v chromium-browser; \
	fi)

help: ## Show targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

kill-port:
	lsof -t -i :${PORT} | xargs kill -9

serve: ## Local HTTP server (no COOP/COEP headers, same as GitHub Pages; coi-serviceworker supplies them)
	python3 -m http.server ${PORT} --bind 127.0.0.1

manual: ## Rebuild /manual/index.html from About + Features + Stems + Keybinds + Settings
	python3 tools/build_manual.py

pdf: manual ## Headless Chrome → rocknroller-manual.pdf (A4, no header/footer)
	@test -n "$(CHROME)" || (echo "Chrome/Chromium not found. Open /manual/ and Print → Save as PDF."; exit 1)
	@python3 -m http.server $(PDF_PORT) --bind 127.0.0.1 >/tmp/rnr-manual-http.log 2>&1 & echo $$! > /tmp/rnr-manual-http.pid
	@sleep 0.4
	@"$(CHROME)" --headless --disable-gpu --no-pdf-header-footer \
		--virtual-time-budget=8000 \
		--print-to-pdf="$(CURDIR)/$(MANUAL_PDF)" \
		"http://127.0.0.1:$(PDF_PORT)/manual/"
	@kill `cat /tmp/rnr-manual-http.pid` 2>/dev/null || true
	@rm -f /tmp/rnr-manual-http.pid
	@echo "Wrote $(MANUAL_PDF) — regenerate whenever docs pages change."

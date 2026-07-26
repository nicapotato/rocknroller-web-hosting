.PHONY: serve kill-port help

# Port must stay in the S3 bucket CORS AllowedOrigins (http://127.0.0.1:8098,
# http://localhost:8098) or local dev cannot fetch the game assets.
PORT=8098

help: ## Show targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

kill-port:
	lsof -t -i :${PORT} | xargs kill -9

serve: ## Local HTTP server (no COOP/COEP headers, same as GitHub Pages; coi-serviceworker supplies them)
	python3 -m http.server ${PORT} --bind 127.0.0.1

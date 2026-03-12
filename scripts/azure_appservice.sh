#!/usr/bin/env bash
set -euo pipefail

APP_NAME="askchessgpt"
RESOURCE_GROUP="askchessgpt-rg"
PLAN_NAME="askchessgpt-plan"
LOCATION="westus2"
ZIP_PATH="deploy.zip"
HEALTH_URL=""
DOMAIN=""
WWW_DOMAIN=""
MODE=""
SKIP_STOCKFISH="false"

usage() {
  cat <<'EOF'
Usage:
  scripts/azure_appservice.sh deploy [options]
  scripts/azure_appservice.sh fast-deploy [options]
  scripts/azure_appservice.sh domain-info --domain <apex-domain> [options]
  scripts/azure_appservice.sh domain-bind --domain <apex-domain> [options]

Modes:
  deploy       Full deploy: checks infra/config, builds zip, deploys.
  fast-deploy  Fast inner-loop deploy: build zip + deploy only.
  domain-info  Print DNS records required before binding a custom domain.
  domain-bind  Bind apex and www domains after DNS records propagate.

Options:
  --app <name>            App Service name (default: askchessgpt)
  --rg <name>             Resource group (default: askchessgpt-rg)
  --plan <name>           App Service plan (default: askchessgpt-plan)
  --location <region>     Azure region (default: westus2)
  --zip <path>            Deployment zip path (default: deploy.zip)
  --domain <name>         Apex domain, e.g. askchessgpt.com
  --www-domain <name>     Full www host (default: www.<domain>)
  --health-url <url>      Health check URL (default: https://<app>.azurewebsites.net/)
  --skip-stockfish        Exclude stockfish-linux from zip (uses /home/site/bin cache).
  --set-openrouter-key    Reads OPENROUTER_API_KEY from your shell and sets app setting.

Examples:
  scripts/azure_appservice.sh deploy
  scripts/azure_appservice.sh fast-deploy --skip-stockfish
  scripts/azure_appservice.sh deploy --set-openrouter-key
  scripts/azure_appservice.sh domain-info --domain askchessgpt.com
  scripts/azure_appservice.sh domain-bind --domain askchessgpt.com
EOF
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

require_az_login() {
  az account show >/dev/null 2>&1 || {
    echo "Azure CLI is not logged in. Run: az login" >&2
    exit 1
  }
}

parse_args() {
  [[ $# -ge 1 ]] || { usage; exit 1; }
  MODE="$1"
  shift

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --app)
        APP_NAME="$2"; shift 2 ;;
      --rg)
        RESOURCE_GROUP="$2"; shift 2 ;;
      --plan)
        PLAN_NAME="$2"; shift 2 ;;
      --location)
        LOCATION="$2"; shift 2 ;;
      --zip)
        ZIP_PATH="$2"; shift 2 ;;
      --domain)
        DOMAIN="$2"; shift 2 ;;
      --www-domain)
        WWW_DOMAIN="$2"; shift 2 ;;
      --health-url)
        HEALTH_URL="$2"; shift 2 ;;
      --skip-stockfish)
        SKIP_STOCKFISH="true"; shift ;;
      --set-openrouter-key)
        SET_OPENROUTER_KEY="true"; shift ;;
      -h|--help)
        usage; exit 0 ;;
      *)
        echo "Unknown option: $1" >&2
        usage
        exit 1 ;;
    esac
  done

  if [[ -z "$HEALTH_URL" ]]; then
    HEALTH_URL="https://${APP_NAME}.azurewebsites.net/"
  fi

  if [[ -n "$DOMAIN" && -z "$WWW_DOMAIN" ]]; then
    WWW_DOMAIN="www.${DOMAIN}"
  fi
}

ensure_resource_group() {
  if ! az group show --name "$RESOURCE_GROUP" >/dev/null 2>&1; then
    echo "Creating resource group: $RESOURCE_GROUP"
    az group create --name "$RESOURCE_GROUP" --location "$LOCATION" >/dev/null
  fi
}

ensure_plan() {
  if ! az appservice plan show --name "$PLAN_NAME" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
    echo "Creating Linux B1 App Service plan: $PLAN_NAME"
    az appservice plan create \
      --name "$PLAN_NAME" \
      --resource-group "$RESOURCE_GROUP" \
      --sku B1 \
      --is-linux \
      --location "$LOCATION" >/dev/null
  fi
}

ensure_webapp() {
  if ! az webapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
    echo "Creating web app: $APP_NAME"
    az webapp create \
      --name "$APP_NAME" \
      --resource-group "$RESOURCE_GROUP" \
      --plan "$PLAN_NAME" \
      --runtime "PYTHON:3.11" >/dev/null
  fi
}

configure_webapp() {
  echo "Configuring runtime and startup"
  az webapp config set \
    --name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --linux-fx-version "PYTHON|3.11" \
    --startup-file "bash startup.sh" >/dev/null

  az webapp config appsettings set \
    --name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --settings WEBSITES_CONTAINER_START_TIME_LIMIT=1800 >/dev/null

  if [[ "${SET_OPENROUTER_KEY:-false}" == "true" ]]; then
    if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
      echo "OPENROUTER_API_KEY is not set in your shell." >&2
      exit 1
    fi
    echo "Setting OPENROUTER_API_KEY app setting"
    az webapp config appsettings set \
      --name "$APP_NAME" \
      --resource-group "$RESOURCE_GROUP" \
      --settings "OPENROUTER_API_KEY=${OPENROUTER_API_KEY}" >/dev/null
  fi
}

build_zip() {
  echo "Building deployment zip: $ZIP_PATH"
  rm -f "$ZIP_PATH"
  if [[ "$SKIP_STOCKFISH" == "true" ]]; then
    zip -r "$ZIP_PATH" . \
      --exclude "*.git*" \
      --exclude ".git/*" \
      --exclude ".venv/*" \
      --exclude "antenv/*" \
      --exclude "games/*" \
      --exclude "azure-logs/*" \
      --exclude "azure-logs.zip" \
      --exclude "*.zip" \
      --exclude ".env" \
      --exclude "*.pyc" \
      --exclude "__pycache__/*" \
      --exclude "*.bak" \
      --exclude ".DS_Store" \
      --exclude "stockfish-macos*" \
      --exclude "stockfish-android*" \
      --exclude "stockfish-android-armv8" \
      --exclude "stockfish-linux" >/dev/null
  else
    zip -r "$ZIP_PATH" . \
      --exclude "*.git*" \
      --exclude ".git/*" \
      --exclude ".venv/*" \
      --exclude "antenv/*" \
      --exclude "games/*" \
      --exclude "azure-logs/*" \
      --exclude "azure-logs.zip" \
      --exclude "*.zip" \
      --exclude ".env" \
      --exclude "*.pyc" \
      --exclude "__pycache__/*" \
      --exclude "*.bak" \
      --exclude ".DS_Store" \
      --exclude "stockfish-macos*" \
      --exclude "stockfish-android*" \
      --exclude "stockfish-android-armv8" >/dev/null
  fi
}

deploy_zip() {
  echo "Deploying zip"
  az webapp deploy \
    --name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --src-path "$ZIP_PATH" \
    --type zip \
    --track-status false >/dev/null

  echo "Waiting for app start"
  sleep 20
  status_code="$(curl -s -o /tmp/askchessgpt_home.html -w "%{http_code}" "$HEALTH_URL")"
  echo "Health check status: $status_code"
  if [[ "$status_code" != "200" ]]; then
    echo "Non-200 response from app. Check logs with:"
    echo "  az webapp log tail --name $APP_NAME --resource-group $RESOURCE_GROUP --provider AppServiceConsoleLogs"
    return 1
  fi
}

print_domain_info() {
  [[ -n "$DOMAIN" ]] || { echo "--domain is required" >&2; exit 1; }

  local verify_id default_host
  verify_id="$(az webapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" --query customDomainVerificationId -o tsv)"
  default_host="$(az webapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" --query defaultHostName -o tsv)"

  echo "Add these DNS records first:"
  echo
  echo "1) TXT for domain verification"
  echo "   Host: asuid"
  echo "   Value: $verify_id"
  echo
  echo "2) CNAME for www"
  echo "   Host: ${WWW_DOMAIN%%.*}"
  echo "   Value: $default_host"
  echo
  echo "3) Apex domain"
  echo "   Preferred: ALIAS/ANAME @ -> $default_host"
  echo "   If ALIAS/ANAME is unavailable, use Azure portal guidance for A record mapping."
  echo
  echo "After DNS propagates, run:"
  echo "  scripts/azure_appservice.sh domain-bind --app $APP_NAME --rg $RESOURCE_GROUP --domain $DOMAIN --www-domain $WWW_DOMAIN"
}

bind_domains() {
  [[ -n "$DOMAIN" ]] || { echo "--domain is required" >&2; exit 1; }

  echo "Binding apex domain: $DOMAIN"
  az webapp config hostname add \
    --webapp-name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --hostname "$DOMAIN" >/dev/null

  echo "Binding www domain: $WWW_DOMAIN"
  az webapp config hostname add \
    --webapp-name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --hostname "$WWW_DOMAIN" >/dev/null

  echo "Domains bound successfully."
  echo "Configure HTTPS certificate in Azure portal (TLS/SSL settings)."
}

main() {
  require_cmd az
  require_cmd zip
  require_cmd curl
  parse_args "$@"
  require_az_login

  case "$MODE" in
    deploy)
      ensure_resource_group
      ensure_plan
      ensure_webapp
      configure_webapp
      build_zip
      deploy_zip
      echo "Deploy complete: $HEALTH_URL"
      ;;
    fast-deploy)
      build_zip
      deploy_zip
      echo "Fast deploy complete: $HEALTH_URL"
      ;;
    domain-info)
      print_domain_info
      ;;
    domain-bind)
      bind_domains
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"

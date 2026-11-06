#!/usr/bin/env bash
set -euo pipefail

# Run before credential-bearing steps: Actions prints their env headers before their scripts.
printf '::add-mask::%s\n' ANTHROPIC_API_KEY AI_GATEWAY_API_KEY VERCEL_AI_GATEWAY_API_KEY

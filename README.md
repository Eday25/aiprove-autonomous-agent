# AIProve autonomous agent

A fully autonomous agent for the [AIProve](https://aiprove.fun) bounty board —
no human in the loop. It reads `skill.md`, signs in with its own keypair,
and works through every open bounty it can complete on its own.

## What it does

1. fetches `skill.md`
2. requests an auth challenge, signs it (EIP-191 `personal_sign`), exchanges
   the signature for a session token
3. lists open bounties
4. for each bounty:
   - **forecast** bounties: submits a prediction from a small, documented
     model (see below) — this is what v1 completes autonomously
   - **code / content** bounties: enters the bounty (free) and records it for
     a dedicated build — v1 does not write code entries yet
5. prints a summary: seen / entered / completed / skipped (with reasons)

## Prediction model (forecasts)

- Direction questions ("close higher tomorrow?"): 24h-momentum rule on the
  free public CoinGecko price feed. Asset up over 24h → "yes", down → "no".
  Confidence is modest (0.55–0.65): this is a baseline, not an oracle.
- Price-target questions ("close within $1"): submits the current price.
- Assets with no free public feed (SPY, GLD, NVDA) fall back to a neutral
  0.5 prediction, and the fallback is logged.

## Run

```bash
npm install
AGENT_PRIVATE_KEY=0x... node agent.mjs
```

| variable | default | meaning |
|---|---|---|
| `AGENT_PRIVATE_KEY` | — (required) | the agent's own secp256k1 key; never commit it |
| `API_BASE_URL` | `https://aiprove.fun` | arena base URL; the sandbox points this at a staging arena |
| `AGENT_HANDLE` | `noble-condor-93` | handle to enter/submit with |
| `MAX_BOUNTIES` | all | cap how many open bounties one run works through |

## Demo against a local staging arena

```bash
node staging-server.mjs 8788 &
API_BASE_URL=http://127.0.0.1:8788 AGENT_PRIVATE_KEY=0x... node agent.mjs
```

The staging server verifies the EIP-191 signature for real and accepts
prediction submissions, so the whole autonomous loop is exercised end to end
without touching the live board. Output ends with `AUTONOMOUS RUN COMPLETE`
and a JSON summary.

## Notes

- Entry and prediction submission are free; the agent never spends, stakes,
  or holds anything.
- The agent only ever signs its own one-time auth challenge.

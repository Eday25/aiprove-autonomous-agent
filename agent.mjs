// agent.mjs — Fully autonomous AIProve agent (no human in the loop).
//
// Loop:
//   1. read skill.md
//   2. authenticate with our own keypair (EIP-191 personal_sign)
//   3. list open bounties
//   4. for each bounty, try to complete it on our own:
//      - forecast bounties: submit a prediction from a small, documented
//        model (24h momentum from the public CoinGecko price feed; neutral
//        fallback when no price feed exists for the asset)
//      - code bounties: enter the bounty and record it for a dedicated build
//        (v1 does not write code entries yet)
//   5. print a summary: seen / entered / completed / skipped
//
// Env: AGENT_PRIVATE_KEY (required), API_BASE_URL (default https://aiprove.fun),
// AGENT_HANDLE (default noble-condor-93), MAX_BOUNTIES (default: all).
import { Wallet } from "ethers";

const API = (process.env.API_BASE_URL || "https://aiprove.fun").replace(/\/$/, "");
const HANDLE = process.env.AGENT_HANDLE || "noble-condor-93";
const MAX = Number(process.env.MAX_BOUNTIES || 0) || Infinity;

const pk = process.env.AGENT_PRIVATE_KEY;
if (!pk) {
  console.error("AGENT_PRIVATE_KEY is required");
  process.exit(1);
}
const wallet = new Wallet(pk);
const address = wallet.address;

async function getJson(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

// --- small documented prediction model -------------------------------------
// Direction questions ("close higher tomorrow?"): momentum rule on the last
// 24h change. If the asset is up over 24h, lean "yes"; if down, lean "no".
// Confidence stays modest (0.55-0.65): this is a baseline, not an oracle.
// Price-target questions ("close within $X"): submit the current price.
// Assets without a free public feed fall back to a neutral 0.5 prediction.
const COINGECKO_ID = { BTC: "bitcoin", ETH: "ethereum" };

async function fetch24hChange(sym) {
  const id = COINGECKO_ID[sym];
  if (!id) return null;
  try {
    const d = await getJson(
      `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true`
    );
    return { price: d[id].usd, change24h: d[id].usd_24h_change };
  } catch {
    return null;
  }
}

function guessSymbol(bounty) {
  const t = `${bounty.title} ${bounty.slug}`.toUpperCase();
  if (t.includes("BTC")) return "BTC";
  if (t.includes("ETH")) return "ETH";
  if (t.includes("SPY")) return "SPY";
  if (t.includes("GLD")) return "GLD";
  if (t.includes("NVDA")) return "NVDA";
  return null;
}

async function predictFor(bounty) {
  const sym = guessSymbol(bounty);
  const title = bounty.title.toLowerCase();
  const feed = sym ? await fetch24hChange(sym) : null;
  if (title.includes("within")) {
    // price-target bounty: submit the current price if we have one.
    // Without a feed there is no meaningful answer, so skip instead of
    // submitting a placeholder that can never be right.
    if (feed) return { prediction: { answer: String(feed.price) } };
    return { skip: "no free price feed for this asset" };
  }
  // direction / yes-no bounty
  if (feed) {
    const up = feed.change24h >= 0;
    const conf = Math.min(0.65, 0.55 + Math.abs(feed.change24h) / 100);
    return { prediction: { answer: up ? "yes" : "no", confidence: Number(conf.toFixed(2)) } };
  }
  return { prediction: { answer: "no", confidence: 0.5 }, note: "no price feed; neutral" };
}

// --- main loop --------------------------------------------------------------
async function main() {
  console.log(`autonomous agent ${address} @ ${API}`);
  const skill = await (await fetch(`${API}/skill.md`)).text();
  console.log(`skill.md: ${skill.length} bytes`);

  const { challenge } = await getJson(`${API}/api/auth/challenge?address=${address}`);
  const signature = await wallet.signMessage(challenge);
  const { token } = await getJson(`${API}/api/auth/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address, signature }),
  });
  if (!token) throw new Error("no session token");
  console.log("authenticated");

  const { bounties } = await getJson(`${API}/api/bounties?status=open`);
  console.log(`open bounties: ${bounties.length}`);
  const summary = { agent: address, seen: bounties.length, entered: [], completed: [], skipped: [] };

  for (const b of bounties.slice(0, MAX)) {
    try {
      const entered = await getJson(`${API}/api/bounties/${b.slug}/enter`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ handle: HANDLE }),
      });
      summary.entered.push(b.slug);
      if (b.lane === "AutoGrade" && b.cat === "forecast") {
        const res = await predictFor(b);
        if (res.skip) {
          summary.skipped.push({ slug: b.slug, reason: res.skip });
          console.log(`skipped ${b.slug}: ${res.skip}`);
          continue;
        }
        const { prediction, note } = res;
        const sub = await getJson(`${API}/api/bounties/${b.slug}/submit`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ prediction, handle: HANDLE }),
        });
        summary.completed.push({ slug: b.slug, submission: sub.id || sub.submissionId || null, prediction });
        console.log(`completed ${b.slug}: ${JSON.stringify(prediction)}${note ? ` (${note})` : ""}`);
      } else {
        summary.skipped.push({ slug: b.slug, reason: `lane=${b.lane} cat=${b.cat}: v1 completes forecasts autonomously; code/content entries need a dedicated build` });
        console.log(`entered only ${b.slug} (code/content bounty, queued for a dedicated build)`);
      }
    } catch (e) {
      summary.skipped.push({ slug: b.slug, reason: `error: ${e.message}` });
      console.log(`failed ${b.slug}: ${e.message}`);
    }
  }

  console.log("AUTONOMOUS RUN COMPLETE");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error("RUN FAILED:", e.message);
  process.exit(1);
});

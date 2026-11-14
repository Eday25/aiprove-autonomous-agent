// staging-server.mjs — minimal local staging arena for the autonomous agent.
// Same REST surface as the live board (skill.md, auth challenge/verify, list,
// enter, submit), with signature verification done for real via ethers.
//   node staging-server.mjs [port]   # default 8788
import http from "node:http";
import { verifyMessage } from "ethers";

const PORT = Number(process.argv[2] || 8788);
const challenges = new Map();
let subSeq = 0;

const SKILL = `# skill.md — Compete on the Agent Bounty Board (AIProve)
You are an autonomous agent. This board is free to enter. You authenticate
with your wallet keypair (no signup, no account, no email). Your identity is
your address. Read this once, then: authenticate → list open bounties → build →
submit. You can drive it over plain HTTP (REST) or over MCP.
API base: https://aiprove.fun
`;

const BOUNTIES = [
  { slug: "forecast-btc-demo", title: "Will BTC close higher tomorrow?", cat: "forecast", lane: "AutoGrade", metric: "Brier score", amt: "0.01", unit: "ETH", status: "open" },
  { slug: "forecast-spy-demo", title: "Predict tomorrow's SPY close within $1", cat: "forecast", lane: "AutoGrade", metric: "Abs error, $", amt: "0.05", unit: "SPY", status: "open" },
  { slug: "code-demo", title: "Build a sample agent that reads skill.md", cat: "development", lane: "AutoGrade", metric: "First clean loop completion", amt: "0.12", unit: "META", status: "open" },
];

function send(res, code, obj) {
  const body = typeof obj === "string" ? obj : JSON.stringify(obj);
  res.writeHead(code, { "content-type": typeof obj === "string" ? "text/markdown" : "application/json" });
  res.end(body);
}

async function bodyJson(req) {
  let raw = "";
  for await (const c of req) raw += c;
  return raw ? JSON.parse(raw) : {};
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://127.0.0.1");
    if (req.method === "GET" && u.pathname === "/skill.md") return send(res, 200, SKILL);
    if (req.method === "GET" && u.pathname === "/api/auth/challenge") {
      const address = u.searchParams.get("address");
      const challenge = `staging-challenge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      challenges.set(String(address).toLowerCase(), challenge);
      return send(res, 200, { challenge });
    }
    if (req.method === "POST" && u.pathname === "/api/auth/verify") {
      const { address, signature } = await bodyJson(req);
      const challenge = challenges.get(String(address).toLowerCase());
      const recovered = challenge ? verifyMessage(challenge, signature) : "";
      if (!challenge || recovered.toLowerCase() !== String(address).toLowerCase()) {
        return send(res, 401, { error: "bad signature" });
      }
      return send(res, 200, { address, token: "staging-token", expiresAt: Date.now() + 3600_000 });
    }
    if (req.method === "GET" && u.pathname === "/api/bounties") {
      return send(res, 200, { bounties: BOUNTIES });
    }
    const mEnter = u.pathname.match(/^\/api\/bounties\/([^/]+)\/enter$/);
    if (req.method === "POST" && mEnter) {
      if (req.headers.authorization !== "Bearer staging-token") return send(res, 401, { error: "bad token" });
      const { handle } = await bodyJson(req);
      return send(res, 200, { ok: true, entry: { id: `staging-entry-${mEnter[1]}`, bountySlug: mEnter[1], handle } });
    }
    const mSub = u.pathname.match(/^\/api\/bounties\/([^/]+)\/submit$/);
    if (req.method === "POST" && mSub) {
      if (req.headers.authorization !== "Bearer staging-token") return send(res, 401, { error: "bad token" });
      const payload = await bodyJson(req);
      if (!payload.prediction && !(payload.repoUrl && payload.commit)) {
        return send(res, 400, { error: "a submission needs a prediction or repoUrl+commit" });
      }
      subSeq += 1;
      return send(res, 200, { id: `staging-submission-${subSeq}`, bountySlug: mSub[1], status: "provenance_ok" });
    }
    return send(res, 404, { error: "not found" });
  } catch (e) {
    return send(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`staging arena on http://127.0.0.1:${PORT}`));

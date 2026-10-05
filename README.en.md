# Tuiyan Sandbox · A Judgment Ledger

[中文](./README.md) | English

![Node](https://img.shields.io/badge/Node-%E2%89%A522.5-339933)
![MCP](https://img.shields.io/badge/MCP-21_tools-6C5CE7)
![Platform](https://img.shields.io/badge/Platform-Windows_%7C_macOS_%7C_Linux-2D7DD2)
![Tests](https://img.shields.io/badge/Cases-1200%2B-4C9A2A)
![License](https://img.shields.io/badge/License-Apache--2.0-EAC435)

> **Write down what you believe, then prove you never changed it afterwards.**

Most "help you guess" apps make you *feel* more accurate. This one does the opposite:
**it never guesses.** It does the one thing nobody else does — records exactly what you
thought, then proves you didn't retroactively edit it.

```
   You write a question          What it does
   ┌──────────────────┐   ┌───────────────────────────────────┐
   │ Will Shanghai top│   │ ① Ledger    Records your confidence │
   │ 35°C tomorrow?   │──▶│           Append-only, fingerprinted│
   │       60%        │   │ ② Score     Looks up the real answer│
   └──────────────────┘   │           when it matures, scores it│
                         │ ③ Debrief   Shows where you're biased│
   ┌──────────────────┐   └───────────────────────────────────┘
   │ Brier 0.2259     │◀── "You're sharp on weather, 19% overconfident on FX"
   └──────────────────┘
```

---

## The problem it solves

You have probably had this moment: you said **60%** three months ago, and today you'd
swear you said **40%**. Not a lie — memory just rewrites itself, and once rewritten
you can't learn from being wrong.

This one thing it does:

- **It never predicts.** No point estimate on anything, ever. It does not tell you what it thinks will happen.
- **It never recommends.** It will not tell you what to bet, buy, or do.

It only records how you thought, then — once reality lands — hands you an accurate score
and tells you: **on this kind of question, you're systematically off in this direction.**

---

## What it deliberately does NOT do

This section matters more than the one above.

| It does not | Why |
|---|---|
| **Predict the future** | Its readings are judged against history, never claimed as forecasts |
| **Give you a number when it can't** | One of the six layers is *this cannot be computed at all* — it says so and refuses |
| **Touch markets or money** | Prices and odds come back verbatim, marked as market consensus, never processed |
| **Leave your machine** | Local by default. Your ledger stays in `data/` |

---

## 30 seconds in

```bash
git clone https://github.com/rui08984-dot/tuiyan-sandbox.git
cd tuiyan-sandbox
npm run bootstrap
cd p1b && node gates/gates.cjs
```

★**Use `bootstrap`, not `npm install`**: this repo has **three nested package.json
files** (engine `p1a-terminal`, backend `p1b`, frontend `p1b/web`), each with its own
dependency tree. Installing only the root leaves the engine and frontend uninstalled,
and the gates fail with "native module not requireable / vite not found" — error
messages nowhere near the real cause. `bootstrap` installs all three, in order.

Three checks that actually run: the plan audit, the four backend/frontend/type gates, and
the 15-item release audit. The release audit verifies there is **no API key left in the
tree, no real player name, no bundled node.exe** in the packaged output.

---

## The six-layer classification is the backbone

Not six models. Six verdicts on **whether this question can even be scored.**

| Layer | Plain language | Example | Its score |
|---|---|---|---:|
| **L1 Deterministic** | Has a fixed answer, pure math | When next year's eclipse peaks | **0.0000 (perfect)** |
| **L2 Stationary** | Has history, take the mean | How many balls someone averages | 0.2403 |
| **L3 Short-window** | Has a mechanism, but chaotic | FX rates, short-term moves | 0.2386 |
| **L4 Self-reflexive** | Your belief changes the outcome | "I think this stock drops" | **Unused** (self-fulfilling) |
| **L5 Pure random** | Mathematically unwinnable | Coin flips, lottery | 0.1578 |
| **L6 Adversarial** | Someone is working against you | Games, negotiations | 0.1755 |

**Why 0.1578 on "coin flips" is a feature, not a bug**: it means you answered 50% on
something with a 50% base rate and nothing else. That is the honest answer. A higher
number there would mean you were lucky, not good.

Also: **every question passes a three-question rejection gate** before entering the ledger —
is the truth anchor machine-checkable / is the cutoff before the decisive moment / does the
outcome vary per instance. Any "no" and it never enters.

---

## The honest scoreboard

Not pretty, but real.

- **Brier 0.2259** vs 0.2500 for always answering 50% — better, but only just
- And **indistinguishable from rolling dice weighted by your own probability** (0.2267)

Both those sentences are true at once. That is the most honest picture this project can
draw of itself today.

- **0 of the 1,994 ledger entries were written by a human.** They are all synthetic,
  by design: the point was to build the measurement instrument, not to have been measured.

---

## Three ways to use it

**① As an app** — web UI for writing predictions and reading results
**② MCP** — 21 tools, drop it into any MCP client
**③ As a library** — `require` the modules and call them directly

Access control, architecture, and the interface contracts are in
[docs/](docs/) — every endpoint documented as "what it does / what it cannot do / what
happens when you exceed it."

---

## The eight red lines

1. Generated text carries an implicit marker at generation time, never backfilled
2. No bet-recommendation semantics, anywhere, in any description or response
3. **Offline by default** — fetching data requires explicit confirmation
4. Server-side outbound allowlist, no anti-scraping bypass paths
5. External prices / odds returned verbatim with source and timestamp, marked **"market consensus data"**
6. **Local-first. No offshore hosting.** Your ledger does not leave your machine
7. The ledger **never writes** names, emails, or employee IDs
8. **Caller identity is not recorded by default** — only identity-free aggregate stats

---

## For developers

```bash
node p1b/scripts/secret-preflight.cjs   # health check; prints a fingerprint, never the key
node scripts/plan-audit.cjs             # 30-item mechanical audit
cd p1b && node gates/gates.cjs          # four gates: backend/build/frontend/types
node p1b/scripts/audit-release.cjs --tree <tree>   # 15-item release audit
```

---

## License

Apache-2.0 — see [LICENSE](./LICENSE).

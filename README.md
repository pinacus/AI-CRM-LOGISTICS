<div align="center">
<img src="https://capsule-render.vercel.app/api?type=waving&color=0:020617,50:172554,100:2563eb&height=230&section=header&text=FreightDesk&fontSize=52&fontColor=ffffff&animation=twinkling&fontAlignY=38&desc=AI-Driven%20CRM%20and%20Logistics%20Automation%20for%20Freight%20Brokerage&descAlignY=62&descSize=16&descColor=bfdbfe" width="100%"/>
 🚛 FreightDesk

### Requirement to payment, automated end to end.

An MVP for AI-driven CRM and logistics automation in freight brokerage — vendor matching, AI voice and Tamil WhatsApp quoting, L1 rate suggestion, vendor lock-in, trip tracking, billing and payment, all in one system.
Built from the design document `AI_CRM_Logistics_POC.docx`.

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-07405E?style=for-the-badge&logo=sqlite&logoColor=white)
![WhatsApp](https://img.shields.io/badge/WhatsApp-Cloud%20API-25D366?style=for-the-badge&logo=whatsapp&logoColor=white)
![Twilio](https://img.shields.io/badge/Twilio-Voice-F22F46?style=for-the-badge&logo=twilio&logoColor=white)

## </div>

## 🧩 What is FreightDesk?

## Freight brokerage runs on manual phone calls, scattered WhatsApp quotes, and spreadsheets tracking vendor rates. **FreightDesk** automates the entire pipeline: AI-assisted requirement intake, weighted vendor matching, AI-driven quote collection over voice and Tamil WhatsApp, margin-aware pricing, vendor lock-in, trip execution, and billing — with a full audit trail throughout.

## ✨ Key Features

| Feature                          | Description                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------ |
| 🧠 **AI Requirement Intake**     | Captures freight requirements and tracks them through pricing and trip lifecycle     |
| 🎯 **Vendor Matching**           | Scores vendors on route, service type, lane coverage, compliance and commercial fit  |
| 📋 **Weighted Shortlisting**     | Surfaces the most relevant vendors before outreach begins                            |
| 🗣️ **Voice & WhatsApp Quoting**  | AI-driven quote ingestion with confidence scoring and anomaly flags, including Tamil |
| 📞 **Sarvam AI Calls**           | Sarvam Voice Agents place the enquiry call and the transcript becomes a quote        |
| 💰 **Margin-Aware Pricing**      | Sales pricing with customer confirmation before booking                              |
| ✅ **L1 Rate Validation**        | Vendor acceptance flow feeding automated trip creation                               |
| 🚚 **End-to-End Trip Execution** | Dispatch → proof of delivery → invoice → receipt → vendor payout                     |
| 🎭 **Simulation Mode**           | Realistic operational signals so the repo demos without live telephony               |
| 🧪 **Testable Domain Logic**     | Matching, parsing, aggregation and rate-card checks are unit tested                  |

---

## 🚀 Quick Start

```bash
npm install
npm run build
npm start            # API + client on http://localhost:4000
```

For development with hot reload:

```bash
npm run dev           # API on 4000, Vite on 5173
```

First boot creates `data/freightdesk.db` (SQLite) and seeds it with sample vendors, customers, rate card rows, and six requirements across every lifecycle stage.

> 💾 **Data survives restarts** — the working set is snapshotted to SQLite after every write and reloaded on boot. Delete `data/` to reset to the seed.

---

## 🔐 Accounts

| Email                       | Password     | Role          |
| --------------------------- | ------------ | ------------- |
| `admin@freightdesk.local`   | `admin123`   | Administrator |
| `sales@freightdesk.local`   | `sales123`   | Sales         |
| `ops@freightdesk.local`     | `ops123`     | Operations    |
| `finance@freightdesk.local` | `finance123` | Finance       |

Sessions are HttpOnly cookies with a configurable lifetime. Administrators can create users, reset passwords, deactivate accounts, and read the audit trail on the **Users and audit** screen.

> ⚠️ Change the seed passwords before deploying this anywhere shared.

---

## 📁 Project Structure

```text
shared/types.ts            Types shared by the API and the client

server/src/
├── index.ts               Boot: open database, hydrate or seed, listen, persist on shutdown
├── config.ts              Environment configuration, including the Sarvam AI settings
├── routes.ts              REST API: auth, requirements, quotes, trips, payments, admin, webhooks
├── auth.ts                Password hashing (scrypt), sessions, role middleware
├── db.ts                  SQLite layer: schema, hydrate, snapshot persist
├── store.ts               In-memory working set and typed lookups
├── audit.ts               Append-only audit log
├── metrics.ts             Dashboard metrics
├── channels.ts            Twilio voice adapter and channel mode selection
├── whatsapp.ts            Twilio WhatsApp adapter, template, and webhook parsing
├── simulation.ts          Outreach and lock-in timelines, inbound reply application
├── sarvam.ts              Sarvam AI: enquiry script, instant outbound call, call webhook
├── seed.ts                Sample master data, demo requirements, Sarvam call target
├── *.test.ts              Unit tests for auth, channels, database and the Sarvam integration
└── domain/                Matching engine, quote parser, L1 aggregation, rate card (unit tested)

web/src/
├── main.tsx, App.tsx      Entry point and routes
├── api.ts, auth.tsx       Typed API client and session provider
├── components/            Shared UI (panels, badges, icons, score bars)
├── pages/                 Landing, login, console screens, admin console
└── styles.css             Design system

scripts/smoke_test.py      End-to-end suite: auth, admin, webhooks, full business flow
scripts/start_api.ps1      Windows helper to start the API in the background
```

---

## ⚙️ How the Pieces Work

### 🎯 Matching

Hard filters on fifteen vendor attributes, then a weighted score:

| Factor       | Weight |
| ------------ | ------ |
| Availability | 30%    |
| Reliability  | 30%    |
| Price        | 25%    |
| Response     | 15%    |

Excluded vendors carry their exclusion reasons.

### 📨 Outreach

Each shortlisted vendor gets an attempt on their preferred channel. In **simulation mode** (default), replies arrive on timers; in **live mode**, the message is actually sent and the reply arrives via webhook. Either way, the reply text goes through the same rules parser:

```text
"38500, toll extra"          →  parsed rate + confidence score
"rate 41k"                   →  parsed rate + confidence score
"Rs. 39,500"                 →  parsed rate + confidence score
"call me later, rate evening" →  no rate, flagged for an agent
```

Replies under **0.80 confidence** or more than **30% off** the rate card reference are flagged and need sales-agent verification before reaching L1.

### 💵 Pricing

L1, L2, average, and spread are computed over the usable quotes; customer price is L1 plus the agent's margin.

> **Worked example** (matches the design doc exactly): L1 = ₹37,800 · Average = ₹39,760 · Spread = ₹4,200 · Customer price = ₹40,824 at 8% margin

### 🔒 Lock-in to Payment

Top three vendors are offered the job → first acceptance wins (with vehicle and driver details) → the trip moves through **seven statuses** to paid → invoice raised at billing per the customer's credit terms → vendor payout tracked separately.

### 📝 Audit

Every sign-in, outreach run, verification, price, order, trip change, payment, and user-management action is recorded with the acting user and visible to administrators.

---

## 🌐 Going Live with Real Channels

Outreach stays in simulation mode until credentials are present (see `.env.example`):

**Twilio WhatsApp**

Use the [Twilio WhatsApp Sandbox](https://console.twilio.com/us1/develop/sms/try-it-out/whatsapp-sandbox). Copy the Twilio Account SID and Auth Token from the Twilio Console, then set:

```env
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
```

The recipient must send the Sandbox join code shown in Twilio to the Sandbox number before testing. `TWILIO_WHATSAPP_FROM` is separate from `TWILIO_FROM`, which remains reserved for voice calls.

Outbound messages go to Twilio. Inbound replies must be forwarded to `POST /api/webhooks/whatsapp` with the `x-webhook-token` header set to `WEBHOOK_TOKEN`.

The default message is:

```text
Hello {vendor_name}, we need a {vehicle_type} ({body_size}) for {weight} tonnes
from {origin} to {destination}. Loading: {date}, {time}.
Please reply with your best rate (Rs.) for this trip.
```

Set `WHATSAPP_TEMPLATE` to customize it. Supported placeholders are `{vendor_name}`, `{vehicle_type}`, `{body_size}`, `{weight}`, `{origin}`, `{destination}`, `{date}`, and `{time}`.

**Voice**

```env
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM=...
```

Calls are placed through Twilio reading the requirement script. A Twilio-formatted reply (`From`/`Body`) posted to `POST /api/webhooks/inbound` is parsed into a quote.

> The payload builders and inbound parser are unit tested; the calls themselves need real accounts and have not been exercised against live providers from this machine.

**Sarvam AI**

```env
SARVAM_API_KEY=...          # model API key, writes the script
SARVAM_VOICE_API_KEY=...    # workspace API key, places the call
SARVAM_ORG_ID=...
SARVAM_WORKSPACE_ID=...
SARVAM_APP_ID=...
SARVAM_CONNECTION_ID=...
SARVAM_AGENT_PHONE_NUMBER=+91...
```

With these set, `POST /api/requirements/:id/sarvam-call` places a real instant outbound call through Sarvam Voice Agents (the Sarvam chat model writes the spoken script, with a deterministic English fallback). The call record appears immediately and the transcript is posted to `POST /api/webhooks/sarvam`, which parses the vendor's spoken rate into a quote like any other channel. If the app has no public webhook URL, `POST /api/sarvam-calls/:id/sync` pulls the finished attempt and its English transcript from Sarvam's analytics API and creates the same quote.

Only one number is ever dialled: `SARVAM_VENDOR_PHONE` (default `6385106931`, David Transportation). That vendor is kept in the vendor master on boot (matched by name, never by a shared phone number), and the outbound payload builder refuses any other number, so the endpoint cannot be used as a dialler.

`SARVAM_API_KEY` and `SARVAM_VOICE_API_KEY` are different credentials: the first is the model API subscription key, the second is the workspace key that `apps.sarvam.ai` accepts as `X-API-Key`. A missing or wrong workspace key fails the call with a 401 and a message saying so.

> The payload builders, script fallback and webhook parser are unit tested; the call itself needs Sarvam credentials and has not been exercised against the live API from this machine.

---

## 🧪 Tests

```bash
npm run typecheck              # server and client
npm test                       # 53 unit tests: matching, parser, aggregation, rate card, db, auth, channels, Sarvam
python scripts/smoke_test.py   # 68 end-to-end checks against a running server
```

---

## 🚢 Deployment

The build is `web/dist` (static), served by the single Node process:

```bash
npm run build
PORT=4000 DB_PATH=/var/lib/freightdesk/freightdesk.db WEBHOOK_TOKEN=... npm start
```

- 💾 **Back up** by copying the SQLite file (WAL mode — safe to copy while the process is running via `sqlite3 .backup`, or stop the process first)
- 🛑 Termination signals persist the working set before exit
- 🐳 No Dockerfile included — the process needs **Node 22+** and no other system dependencies

---

## ⚠️ Known Limitations

- 📞 Voice replies via webhook carry transcribed text only — a live voice conversation (barge-in, DTMF) is out of scope for this MVP
- 🗄️ The store is a single SQLite file: one process, no clustering — move to PostgreSQL before running multiple instances
- 🔐 Lock-in acceptance is simulated even in live mode — it needs a real vendor confirmation flow (reply keyword or operator action) before going live

---

<div align="center">
## 👨‍💻 Author

### Shaik Abdullah Azam

**B.Tech Artificial Intelligence Student**

AI • Full-Stack Development • Automation

<a href="https://github.com/Azam-star">
<img src="https://img.shields.io/badge/GitHub-Azam--star-181717?style=for-the-badge&logo=github&logoColor=white"/>
</a>
</div>
---

## ⭐ Support

If you found this project interesting:

- ⭐ Star the repository
- 🍴 Fork it
- 🐛 Open an issue
- 💡 Suggest an improvement

---

<div align="center">
**From a freight requirement to a paid, delivered trip — automated.**

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:2563eb,50:172554,100:020617&height=120&section=footer" width="100%"/>
</div>

push from asus tuf

"""End to end smoke test for the FreightDesk MVP API.

Covers:
  - authentication (login, session, logout, role enforcement)
  - admin (user create, password reset, deactivate/reactivate, audit, system)
  - the full business flow: intake, matching, outreach, an inbound webhook
    reply parsed into a quote, pricing, confirmation, vendor lock-in, trip
    statuses, invoice, payment and vendor payout
  - that the database file backing all of it exists on disk

Usage: python scripts/smoke_test.py [base_url]
Requires the API to be running (npm start, or scripts/start_api.ps1).
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4000/api"
FAILURES = []

ADMIN_EMAIL = "admin@freightdesk.local"
ADMIN_PASSWORD = "admin123"
SALES_EMAIL = "sales@freightdesk.local"
SALES_PASSWORD = "sales123"


def dotenv_value(name):
    """Read one non-secret setting from the project .env when not exported."""
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    env_path = os.path.join(root, ".env")
    try:
        with open(env_path, encoding="utf-8") as env_file:
            for line in env_file:
                trimmed = line.strip()
                if not trimmed or trimmed.startswith("#") or "=" not in trimmed:
                    continue
                key, value = trimmed.split("=", 1)
                if key.strip() == name:
                    return value.strip().strip('"').strip("'")
    except OSError:
        pass
    return None


WEBHOOK_TOKEN = os.environ.get("WEBHOOK_TOKEN") or dotenv_value("WEBHOOK_TOKEN") or "freightdesk-dev-token"


def raw(method, path, body=None, cookie=None, headers=None):
    """Returns (status, parsed_json_or_text)."""
    data = json.dumps(body).encode() if body is not None else None
    head = {"Content-Type": "application/json"}
    if cookie:
        head["Cookie"] = cookie
    if headers:
        head.update(headers)
    req = urllib.request.Request(f"{BASE}{path}", data=data, method=method, headers=head)
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            payload = res.read().decode()
            set_cookie = res.headers.get("Set-Cookie")
            status = res.status
    except urllib.error.HTTPError as err:
        payload = err.read().decode()
        set_cookie = err.headers.get("Set-Cookie")
        status = err.code
    try:
        parsed = json.loads(payload)
    except ValueError:
        parsed = payload
    return status, parsed, set_cookie


def call(method, path, body=None, cookie=None):
    status, parsed, _ = raw(method, path, body, cookie=cookie)
    if status >= 400:
        raise RuntimeError(f"{method} {path} -> {status}: {parsed}")
    return parsed


def session_cookie(login_body):
    status, parsed, set_cookie = raw("POST", "/auth/login", login_body)
    if status != 200:
        raise RuntimeError(f"login failed -> {status}: {parsed}")
    if not set_cookie:
        raise RuntimeError("login returned no session cookie")
    return set_cookie.split(";")[0]


def check(label, condition, detail=""):
    mark = "ok  " if condition else "FAIL"
    print(f"[{mark}] {label}{(' ' + str(detail)) if detail else ''}")
    if not condition:
        FAILURES.append(label)


def wait_for(label, probe, timeout=35, interval=1.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        value = probe()
        if value:
            return value
        time.sleep(interval)
    check(label, False, "(timed out)")
    return None


def main():
    health = call("GET", "/health")
    check("api is up", health.get("ok") is True, health)

    # ------------------------------------------------------------------ auth
    status, _, _ = raw("GET", "/requirements")
    check("anonymous request rejected", status == 401, status)

    status, _, _ = raw("POST", "/auth/login", {"email": ADMIN_EMAIL, "password": "wrong-password"})
    check("wrong password rejected", status == 401, status)

    admin = session_cookie({"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    me = call("GET", "/auth/me", cookie=admin)
    check("admin session resolves", me["user"]["email"] == ADMIN_EMAIL and me["user"]["role"] == "admin", me)

    sales = session_cookie({"email": SALES_EMAIL, "password": SALES_PASSWORD})
    status, _, _ = raw("GET", "/admin/users", cookie=sales)
    check("sales role cannot open admin endpoints", status == 403, status)

    # ----------------------------------------------------------------- admin
    users = call("GET", "/admin/users", cookie=admin)
    check("seed accounts exist", len(users) >= 4, f"{len(users)} users")

    stamp = str(int(time.time()))
    new_email = f"smoke-{stamp}@test.local"
    created = call(
        "POST",
        "/admin/users",
        {"name": "Smoke Tester", "email": new_email, "password": "smoke1234", "role": "ops"},
        cookie=admin,
    )
    users = call("GET", "/admin/users", cookie=admin)
    check("created user appears in the list", any(u["email"] == new_email for u in users), new_email)

    status, _, _ = raw("POST", "/auth/login", {"email": new_email, "password": "smoke1234"})
    check("new user can sign in", status == 200, status)

    call("POST", f"/admin/users/{created['id']}/reset", {"password": "smoke4321"}, cookie=admin)
    status, _, _ = raw("POST", "/auth/login", {"email": new_email, "password": "smoke1234"})
    check("old password dead after reset", status == 401, status)
    status, _, _ = raw("POST", "/auth/login", {"email": new_email, "password": "smoke4321"})
    check("reset password works", status == 200, status)

    call("POST", f"/admin/users/{created['id']}/active", {"active": False}, cookie=admin)
    status, _, _ = raw("POST", "/auth/login", {"email": new_email, "password": "smoke4321"})
    check("deactivated user cannot sign in", status == 401, status)
    call("POST", f"/admin/users/{created['id']}/active", {"active": True}, cookie=admin)
    status, _, _ = raw("POST", "/auth/login", {"email": new_email, "password": "smoke4321"})
    check("re-enabled user can sign in again", status == 200, status)

    audit = call("GET", "/admin/audit?limit=100", cookie=admin)
    actions = {row["action"] for row in audit}
    check("audit records logins", "auth.login" in actions, sorted(actions))
    check("audit records user management", "user.create" in actions and "user.reset_password" in actions)

    system = call("GET", "/system", cookie=admin)
    check("system reports the database path", bool(system.get("dbPath")), system.get("dbPath"))
    check("database file exists on disk", os.path.exists(system["dbPath"]), system["dbPath"])
    check("channel modes reported", system["channels"]["whatsapp"] in ("simulation", "live"), system["channels"])
    check("counts are populated", system["counts"]["requirements"] >= 1, system["counts"])

    # ------------------------------------------------- build an exact scenario
    rate_rows = call("GET", "/ratecard?q=Ambattur&limit=200", cookie=admin)["rows"]
    band_weight = {"0-3 T": 2, "3-5 T": 4, "5-9 T": 7, "9-16 T": 10, "16+ T": 18}
    pick = next(
        (
            r
            for r in rate_rows
            if r["destination"] == "Bengaluru"
            and r["vehicleType"] == "open_truck"
            and r["bodySizeFt"] in (19, 22, 32)
            and r["weightBand"] in band_weight
        ),
        None,
    )
    if pick:
        inputs = {
            "origin": pick["origin"],
            "destination": pick["destination"],
            "cargo": "General",
            "weightT": band_weight[pick["weightBand"]],
            "vehicleType": pick["vehicleType"],
            "bodySizeFt": pick["bodySizeFt"],
            "axle": pick["axle"],
        }
    else:
        inputs = {
            "origin": "Ambattur",
            "destination": "Bengaluru",
            "cargo": "General",
            "weightT": 9,
            "vehicleType": "open_truck",
            "bodySizeFt": 32,
            "axle": "multi",
        }

    tomorrow = time.strftime("%Y-%m-%d", time.localtime(time.time() + 86400))
    created = call(
        "POST",
        "/requirements",
        {
            "customerName": "Sundaram Auto Components Pvt Ltd",
            "loadingDate": tomorrow,
            "loadingTime": "08:00",
            "notes": "Smoke test requirement",
            **inputs,
        },
        cookie=admin,
    )
    req_id = created["requirement"]["id"]
    check("new requirement created", req_id.startswith("REQ-"), req_id)
    check("requirement starts at intake", created["requirement"]["status"] == "intake")
    check(
        "rate card answered instantly",
        created["requirement"]["rateCardMatch"] == "exact",
        f"{created['requirement']['rateCardMatch']} {created['requirement']['rateCardRate']}",
    )

    # -------------------------------------------------------------- matching
    detail = call("POST", f"/requirements/{req_id}/match", {}, cookie=admin)
    shortlist = detail["match"]["matched"] if detail["match"] else []
    check("shortlist produced", len(shortlist) >= 4, f"{len(shortlist)} vendors")
    check("shortlist is ranked", all(m["rank"] for m in shortlist))
    check("score within 0 to 100", all(0 <= m["score"] <= 100 for m in shortlist))
    check(
        "excluded vendors carry reasons",
        all(e["reasons"] for e in detail["match"]["excluded"]) or detail["match"]["excludedCount"] == 0,
    )

    # -------------------------------------------------------------- outreach
    vendors = {v["id"]: v for v in call("GET", "/vendors", cookie=admin)["rows"]}
    detail = call("POST", f"/requirements/{req_id}/outreach", {}, cookie=admin)
    check("outreach started", detail["requirement"]["status"] == "outreach", f"{len(detail['attempts'])} attempts")

    # Inbound webhook reply while the attempt is still open: the reply must be
    # parsed into a quote by the same parser the simulator uses.
    target = detail["attempts"][0]
    vendor = vendors.get(target["vendorId"], {})
    reply_text = "Rs. 41,300, toll extra, vehicle ready"
    status, body, _ = raw(
        "POST",
        "/webhooks/inbound",
        {"from": vendor.get("phone", ""), "text": reply_text},
        headers={"x-webhook-token": WEBHOOK_TOKEN},
    )
    check("webhook reply accepted", status == 200 and body.get("ok") is True, body)
    webhook_quote_id = body.get("quoteId")

    status, _, _ = raw(
        "POST",
        "/webhooks/inbound",
        {"from": vendor.get("phone", ""), "text": "42000"},
    )
    check("webhook without token rejected", status == 403, status)

    detail = wait_for(
        "replies parsed into quotes",
        lambda: (lambda d: d if d["requirement"]["status"] == "quoted" else None)(
            call("GET", f"/requirements/{req_id}", cookie=admin)
        ),
    )
    if not detail:
        return

    quotes = detail["quotes"]
    minimum_quotes = 1 if system["channels"]["whatsapp"] == "live" else 3
    check("quotes received", len(quotes) >= minimum_quotes, f"{len(quotes)} quotes (minimum {minimum_quotes})")
    check(
        "webhook reply became a quote",
        any(q["id"] == webhook_quote_id and q["rawText"] == reply_text for q in quotes),
        webhook_quote_id,
    )
    check(
        "every quote parsed to a number or is flagged",
        all(q["rate"] is not None or q["flagReason"] for q in quotes),
    )
    check("confidence scores are bounded", all(0 <= q["confidence"] <= 1 for q in quotes))

    summary = detail["summary"]
    check("L1 is the lowest usable quote", summary["l1"] is not None)
    if summary["l1"]:
        usable = [q for q in quotes if q["rate"] is not None and (q["flagReason"] is None or q["verified"])]
        check("L1 equals min of usable", summary["l1"]["normalisedRate"] == min(q["normalisedRate"] for q in usable))
        check("average above or equal to L1", summary["average"] >= summary["l1"]["normalisedRate"])
        check("spread computed", summary["spread"] is not None)

    flagged = [q for q in quotes if q["flagReason"] and not q["verified"]]
    for q in flagged:
        call("POST", f"/quotes/{q['id']}/verify", {}, cookie=admin)
    if flagged:
        check("flagged quotes verified by agent", True, f"{len(flagged)} verified")

    # --------------------------------------------------------------- pricing
    detail = call("POST", f"/requirements/{req_id}/pricing", {"marginPct": 8}, cookie=admin)
    check("priced for customer", detail["requirement"]["status"] == "awaiting_customer")
    check(
        "customer price carries margin",
        detail["summary"]["customerPrice"] >= detail["summary"]["l1"]["normalisedRate"],
    )

    detail = call("POST", f"/requirements/{req_id}/confirm", {}, cookie=admin)
    check("lock-in started", detail["requirement"]["status"] == "locking")

    detail = wait_for(
        "vendor accepted the job",
        lambda: (lambda d: d if d["order"] and d["order"]["status"] == "confirmed" else None)(
            call("GET", f"/requirements/{req_id}", cookie=admin)
        ),
        timeout=30,
    )
    if not detail:
        return

    accepted = [a for a in detail["order"]["attempts"] if a["status"] == "accepted"]
    check("first valid acceptance wins", len(accepted) == 1)
    check("vehicle captured", bool(accepted and accepted[0]["vehicleNo"]))
    check("trip created", detail["trip"] is not None)
    trip_id = detail["trip"]["id"]
    check("requirement confirmed", detail["requirement"]["status"] == "confirmed")

    # ------------------------------------------------------------------ trips
    call("POST", f"/trips/{trip_id}/pod", {"file": f"POD_{trip_id}.pdf"}, cookie=admin)
    order = ["vehicle_assigned", "dispatched", "in_transit", "delivered", "billed"]
    invoice_id = None
    for expected in order:
        res = call("POST", f"/trips/{trip_id}/advance", {}, cookie=admin)
        check(f"trip advances to {expected}", res["trip"]["status"] == expected, res["trip"]["status"])
        if expected == "billed":
            check("invoice raised at billing", res["invoice"] is not None)
            invoice_id = res["invoice"]["id"] if res["invoice"] else None

    # --------------------------------------------------------------- payments
    payments = call("GET", "/payments", cookie=admin)
    row = next((r for r in payments["rows"] if r["id"] == invoice_id), None)
    check("unpaid invoice appears on the payments screen", row is not None)
    check("receivable outstanding while unpaid", row and row["status"] == "unpaid")

    paid = call("POST", f"/payments/{invoice_id}/pay", {}, cookie=admin)
    check("invoice marked paid", paid["status"] == "paid")
    detail = call("GET", f"/requirements/{req_id}", cookie=admin)
    check("trip follows the payment to paid", detail["trip"]["status"] == "paid", detail["trip"]["status"])

    payments = call("GET", "/payments", cookie=admin)
    row = next((r for r in payments["rows"] if r["id"] == invoice_id), None)
    check("receivable cleared", row and row["status"] == "paid")

    call("POST", f"/payments/{invoice_id}/payout", {"status": "approved"}, cookie=admin)
    payout = call("POST", f"/payments/{invoice_id}/payout", {"status": "paid"}, cookie=admin)
    check("vendor payout released", payout["vendorPayoutStatus"] == "paid")

    # --------------------------------------------------------------- metrics
    metrics = call("GET", "/metrics", cookie=admin)
    check("metrics computed", isinstance(metrics["avgMinutesToL1"], (int, float)), metrics)
    check("response rate computed", metrics["responseRatePct"] is not None, metrics["responseRatePct"])
    check("margin booked is positive", metrics["marginBooked"] > 0, metrics["marginBooked"])

    # --------------------------------------------- rate card miss path intake
    created = call(
        "POST",
        "/requirements",
        {
            "customerName": "Meridian Plastics",
            "origin": "Vellore",
            "destination": "Kochi",
            "cargo": "General",
            "weightT": 7,
            "vehicleType": "container",
            "bodySizeFt": 22,
            "axle": "single",
            "loadingDate": tomorrow,
            "loadingTime": "07:00",
            "notes": "Smoke test requirement",
        },
        cookie=admin,
    )
    check("second requirement created", created["requirement"]["id"].startswith("REQ-"))
    check("rate card lookup ran on create", created["requirement"]["rateCardMatch"] in ("exact", "nearest", "none"))
    match = call("POST", f"/requirements/{created['requirement']['id']}/match", {}, cookie=admin)
    check("matching runs on the new requirement", match["match"] is not None)

    # ------------------------------------------------------------ audit trail
    audit = call("GET", "/admin/audit?limit=200", cookie=admin)
    actions = {row["action"] for row in audit}
    for expected_action in ("requirement.create", "requirement.match", "outreach.start", "trip.advance", "payment.record"):
        check(f"audit records {expected_action}", expected_action in actions)

    # ----------------------------------------------------------------- logout
    call("POST", "/auth/logout", {}, cookie=admin)
    status, _, _ = raw("GET", "/requirements", cookie=admin)
    check("session dead after logout", status == 401, status)

    print()
    if FAILURES:
        print(f"{len(FAILURES)} checks failed:")
        for f in FAILURES:
            print(f"  - {f}")
        sys.exit(1)
    print("all smoke checks passed")


if __name__ == "__main__":
    main()

# Telegram: how outreach is limited and how “mass spam” is handled

This note summarizes how Telegram (MTProto / user accounts) reacts to automated or high-volume messaging. It is **not** legal or policy advice; it is technical context for why this codebase uses queues, jitter, per-account limits, and error handling.

## Official error surface

Telegram documents RPC errors such as **`FLOOD_WAIT_X`**: you must wait *X* seconds before repeating the same class of action. See the API error reference: [core.telegram.org/api/errors](https://core.telegram.org/api/errors).

- **`FLOOD_WAIT_X`** — hard throttle: backoff for at least *X* seconds (often add a small buffer).
- Other `420` / flood-class errors — same family: treat as “slow down now”.

Libraries (gramJS, Telethon, etc.) surface these as exceptions; they do not remove the limits.

## “Soft” vs hard limits

In practice, limits are often **dynamic** and **behavior-based**, not a single published table:

- **Hard signals** — explicit errors (`FLOOD_WAIT_*`, auth/session errors, etc.).
- **Soft signals** — elevated failure rates, `PEER_FLOOD`, uneven delivery, sudden inability to message non-contacts, or restrictions reported by [@SpamBot](https://t.me/SpamBot) in the official app.

Third-party clients and MTProto automation are **easier to abuse**, so Telegram applies aggressive heuristics (velocity, bursts, repetition, similarity of text, new-account behavior, IP/proxy reputation, reports/blocks). The [Telethon FAQ](https://docs.telethon.dev/en/stable/quick-references/faq.html) states clearly that misuse leads to bans and that limits have become stricter over time.

## `PEER_FLOOD` and similar

`PEER_FLOOD` is widely treated as **spam suspicion** on the account (outreach to many users who do not already have a trusted relationship), not merely “you sent N messages in one minute.” Recovery may require waiting, reducing volume, and sometimes interacting with @SpamBot or support flows. Retrying the same pattern immediately tends to deepen restrictions.

## What this project does (defensive, not evasive)

The code is structured to:

- **Throttle** sends per account (BullMQ limiter, daily caps, time windows).
- **Randomize** delays (lognormal jitter) to avoid perfectly periodic automation.
- **Deduplicate** messages to the same contact + text hash to avoid accidental repeats.
- **Map errors** (`FLOOD_WAIT`, `PEER_FLOOD`, privacy blocks) to backoff, quarantine, or permanent skip.
- **Isolate** accounts (per-account queues) so one flood wait does not stall the whole system.

None of this guarantees account safety. **Legitimate bulk messaging** should comply with Telegram’s Terms of Service, applicable law (e.g. consent, opt-out), and the expectations of recipients.

## Testing without real accounts

Automated tests in this repo **do not** connect to Telegram. They cover crypto, hashing, template rendering, phone normalization, window logic, and error mapping. Use a **single test account** only for rare manual checks, and keep volume minimal.

## “Frozen” sessions (`FROZEN_METHOD_INVALID`)

Telegram has documented **frozen / limited** account behaviour in recent API layers (see [account freeze discussion](https://github.com/LonamiWebs/Telethon/issues/4610) and the official [error list](https://core.telegram.org/api/errors)). In practice:

- **`FROZEN_METHOD_INVALID` (HTTP 406 class)** means *this specific RPC is not allowed for your session right now*, not necessarily “you already sent spam.”
- It often appears **without any outbound messages yet**: new MTProto login, device verification pending, or recent **security-sensitive** actions in the official client (2FA, profile, photo, etc.).
- Passive reads (`getMe`) may work while **write-like or search** methods fail until you **open the official Telegram app** (mobile or desktop), dismiss prompts, and sometimes **wait** for the restriction window to clear.
- Third-party documentation is sparse; TDLib and user-client libraries report inconsistent behaviour per method ([example](https://github.com/tdlib/td/issues/3471)). There is no reliable server-side “unfreeze” API — recovery is through normal client use and time.

**Operational takeaway:** if both `contacts.search` / `messages.sendMessage` and related calls return `FROZEN_METHOD_INVALID`, treat the session as **not production-ready** until the official app shows a healthy, verified session.

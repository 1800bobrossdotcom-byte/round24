# Round24 Community — Architecture Spec (v0.3)

**The resident product.** A per-building community + maintenance layer that turns
residents from ticket-submitters into a self-governing community, wired into the
same ops spine Pro already runs on.

> Status: design, pre-build. Author pass for Gianni + Declan. Nothing here is
> shipped yet — this is the plan we de-risk before writing code.

---

## 1. Product framing

Three personas, one backend (unchanged decision: **keep Portfolio, add Community**):

| Product | Who | Pays? | Role in the flywheel |
|---|---|---|---|
| **Round24 Pro** | PM company (Office + Crew) | ✅ the buyer | the system of record |
| **Round24 Portfolio** | individual owners | ✅ (or a Pro role) | owner-facing transparency |
| **Round24 Community** | **residents** | ❌ free, bundled with Pro | adoption + retention + moat |

**Why Community matters (the thesis):** every competitor (AppWork, Property Meld,
Latchel, RM's own portal) treats the resident as a ticket submitter. None treats
the building as a *community*. Community is:

- **Load reduction for the buyer.** "4B turn the music down" and "4th-floor
  hallway clogged" today escalate to management → a call → sometimes a work order
  → staff cost. Peer-to-peer resolution removes that load. That's the pitch to
  the PM: fewer nuisance tickets, fewer after-hours calls.
- **A closed loop to Round24's labor engine.** Buildings with real community have
  lower turnover → fewer make-readies → less turn labor, which Pro *already
  measures per door*. Round24 becomes the only company that can tell an owner:
  *"the buildings where residents actually talk cost you $X less in make-ready
  labor last year."* Nobody else has both sides of that equation.
- **The first resident-side network effect in the category.** Once a building's
  residents are on it, switching PM software carries a *social* cost. That's
  stickiness AppWork's raise can't buy with tickets.
- **A GTM wedge into Rent Manager's installed base.** "Give your residents a
  community app" is a far easier first sale than "replace your maintenance
  workflow." Land with Community (viral inside a building), expand to Pro.

---

## 2. The identity spine — how a resident binds to org + building + unit

**This is the whole ballgame** (Gianni's note: *"tenant needs to be synced to Pro
so it's connected to the right building and PM company"*). A resident is only
useful once the system knows *which unit* they occupy. Everything else — which
building's chat they see, which floor, which PM company, which owner — **derives
from one foreign key: `resident.unit_id`.**

```
resident ──unit_id──▶ units ──property_id──▶ properties ──org_id──▶ orgs
   (person)             (the door)             (the building)        (the PM co)
```

Bind the resident to a unit and "synced to Pro" is automatic: the unit is already
a row in Pro's rent roll. Verifying a resident = confirming that binding against
the lease.

### Binding paths (support several, ranked by trust)

1. **Rent Manager / Google OAuth (best case, when RM creds land).** Resident signs
   in against their RM tenant record → auto-matched to unit + lease, verified with
   zero office work. *This is where the RM integration pays off twice.*
2. **Lease-email match (available now).** Resident enters their email; if it
   matches a tenant email already in Round24's rent roll (we import these), bind +
   auto-verify. No manual step.
3. **Per-unit invite.** Office sends an invite to the lease email (reuse the
   existing invite-code system) → binds directly to that unit, pre-verified.
4. **Building QR / join code + office approval (fallback, always works).** A code
   posted in the lobby → resident scans → self-selects unit → lands in an office
   **"Verify residents" queue** → office confirms against the lease → approved.
   Same triage pattern as maintenance requests and workspace requests. Extends the
   `?request=<orgId>` link we already ship to `?join=<orgId>&b=<building>`.

### Verification states

`pending` → `verified` → `moved_out` (and `declined`).

- **pending** (self-claimed): can submit maintenance requests, but **cannot see
  neighbor identities/pseudonyms or post to community** until verified. Prevents a
  stranger from lurking a building's chat by claiming a unit.
- **verified**: full community access, scoped to their building.
- **moved_out**: when a lease ends (RM sync, or office marks the unit vacant / on
  the turn board), the binding flips → community access revoked, but the resident's
  maintenance history **stays with the unit** for the next occupant's context.
  Ties into the make-ready board we already built.

---

## 3. Pseudonymity + moderation — the make-or-break

Anonymous neighbor messaging is a harassment and fair-housing liability minefield.
The design that makes it safe (and is non-negotiable, day one):

**Pseudonymity WITH accountability — never true anonymity.**

- The system **always** knows who you are (via `unit_id`). Neighbors see a
  pseudonym + coarse location: *"4th-floor neighbor"*, *"a resident in your
  building"*. Never a name or unit unless the resident chooses to reveal.
- **The office (and Round24) can unmask a *reported* message.** This single
  property kills ~90% of abuse: bad actors know they aren't actually anonymous.
  Unmasking is office-only and **audited** (reuse `platform_audit`-style logging).

### Message scopes (who you can reach)

| Scope | Example | Sensitivity |
|---|---|---|
| Building broadcast | "Anyone else lose hot water?" · "Party Fri, sorry in advance" | low |
| Floor | "4th-floor hallway is clogged" | low |
| Direct-to-unit (pseudonymous) | "4B, music down please — home sick" | **high** |

Direct-to-unit is the powerful and dangerous one. Extra guardrails there:
per-day cap to any single unit, recipient can mute a sender pseudonym, repeated
reports auto-escalate to the office queue.

### Resident reachability controls (the resident's own privacy dial)

Adoption gate: privacy-conscious residents won't join if opening the app means
any stranger can reach them. Every resident controls their *own* reachability —
overriding **down** from the building default (never up; if the office turned
social off, a resident can't turn it on). Four independent switches, not one:

**1. Direct messages — who can DM me:**

| Mode | Behavior |
|---|---|
| `open` | any verified neighbor can DM (pseudonymously) |
| `requests` *(recommended default)* | a stranger's first message waits in a **Requests tray** — accept (→ trusted) or decline/block; trusted contacts DM directly |
| `trusted` | only already-approved contacts; strangers can't even send a request |
| `off` | no DMs at all |

`requests` mode **is** "only trusted neighbors" — Instagram/Signal-style message
requests, and it works while everyone is still pseudonymous (you approve "4B",
not a name). It's the sweet spot: never bothered by strangers, but a genuine
neighbor can still reach out and earn trust.

**2. Neighbor broadcasts** (building/floor posts): on / off.
**3. Community pages** (tips, events, favorites): opt-in by simply visiting — no toggle.
**4. Official office announcements:** **always delivered when the office flags them
urgent** (water shut-off, inspection). FYI ones are mutable. A privacy setting
must never cause a resident to miss a mandatory notice — safety/legal line.

→ "I only want maintenance, no social" = DMs off + broadcasts off. The account
still submits repairs. À-la-carte participation falls out for free.

**The tension to resolve — "DMs off" vs the flagship "turn your music down" case.**
If a resident can mute everyone, the noisy neighbor just turns messaging off and
the nudge never lands — the privacy dial quietly kills the self-governing feature.
Resolution: split **open conversation** from a **courtesy nudge**.

- A *courtesy nudge* is a **structured, one-directional, rate-limited,
  template-assisted** one-liner ("noise, please" / "package in wrong spot" /
  "hallway blocked"). Not a thread, capped per day, reportable — hard to abuse.
- Nudges stay **on by default even for residents with DMs off**, because that's
  the load-reducing behavior the PM is paying for.
- A resident *can* still disable even nudges. If they do, a neighbor's only
  recourse is to **escalate to the office** — exactly today's status quo, so no
  worse than before, and the office sees the pattern. The dial goes all the way to
  silent, but the *default* keeps the loop working.

### Notifications & Away mode (how I'm told, vs who can reach me)

Reachability decides *who* reaches me; delivery decides *how I'm notified* of what
does. Separate axis, per resident:

- **Channels:** in-app · push (mobile) · **email** · daily digest. Mix per
  category (e.g. urgent announcements → push + email; neighbor broadcasts →
  digest only).
- **Away / out-of-town mode:** one toggle that routes every *eligible* message
  (respecting reachability) to **email** so nothing's missed while traveling —
  the water shut-off notice, a package alert, an accepted DM. Reuses the existing
  Resend email edge function; no new infra.
- Quiet hours (no push overnight) as a later nicety.

### Guardrails (baked in, not bolted on)

- **Rate limits** — reuse the `intake_guard` trigger pattern from migration 0046.
- **Report → office moderation queue.** Block / mute per resident.
- **Content filter** — a Claude moderation edge function (same shape as
  receipt-ocr / stock-check) classifies toxicity/harassment before a message
  posts; borderline → held for office review.
- **Opt-in per resident**; office can **disable social per building** (some
  owners won't want it — that's fine, maintenance still works).
- **Fair-housing guard** — reporting flow + no targeting by protected attributes;
  documented policy surfaced at signup.

---

## 4. Floor maps (start simple)

Don't block on CAD floorplans. The rent roll already has units per building, and
floor is usually inferable from the unit number (`4B` → floor 4).

- **v1:** "your floor" and "your building" are *derived groupings* used for message
  scoping — no visual required.
- **Later (delight layer):** office uploads a floor image and drops unit pins
  (reuse the canvas work from the QR-poster generator). Purely additive.

---

## 5. Community pages (the retention layer)

Scoped to the building, pseudonymous or opt-in named:

- **Feed** — tips, favorites (local businesses/services), events (RSVP + building
  calendar).
- **Requests, extended** — the existing `maintenance_requests` gain a `type`
  (repair / improvement / suggestion) and a `visibility`. Repairs stay
  office-private; **improvements & suggestions can be shared to the building and
  upvoted** — giving the office (and owner) a demand signal for capex.
- Everything actionable stays actionable: a noise pattern becomes documented, a
  suggestion with 20 upvotes becomes a capex note to the owner, a repair becomes a
  work order — all on the spine Pro already runs.

---

## 6. Data model (new tables + extensions)

```
residents(id=auth.uid, org_id, unit_id→units, pseudonym, status, verified_by,
          joined_at, moved_out_at, social_opt_in,
          -- reachability dial (§3): who can reach me + how I'm notified
          dm_mode('open'|'requests'|'trusted'|'off'), nudges_on, broadcasts_on,
          announce_mute_fyi, notify_channels(jsonb per-category), away_mode)
resident_contacts(resident_id, other_resident_id,
          state('trusted'|'requested'|'blocked'), created_at)       -- trust + block lists
resident_join_codes(org_id, property_id, code, expires_at)        -- lobby QR/codes
community_messages(id, org_id, property_id, scope['building'|'floor'|'unit'|'nudge'],
          floor, target_unit_id, sender_resident_id, pseudonym_snapshot, body,
          delivery('inbox'|'request'), created_at, flagged, hidden)
community_posts(id, org_id, property_id, kind['tip'|'favorite'|'event'],
          author_resident_id, pseudonym_snapshot, title, body, event_at, created_at)
post_votes(post_id, resident_id)                                  -- upvotes
moderation_reports(id, org_id, message_id|post_id, reporter_resident_id,
          reason, status, resolved_by, created_at)
-- extend: maintenance_requests += type, visibility, resident_id, upvotes
```

**RLS is stricter here than anywhere else in the app** — residents are a *new auth
audience* and must be walled off from all Pro data:

- A resident can read/write **only their own building's** community + **their own**
  requests. Scoped via `unit_id → property_id`.
- A resident can **never** read the rent roll, financials, labor, other residents'
  PII, or another building. This is a hard boundary — the failure mode (a resident
  seeing rent data) is catastrophic, so it gets deny-by-default + explicit tests.
- Office (`is_org_staff`) moderates + verifies + unmasks (audited).
- Pseudonym unmask exposed only through a gated `SECURITY DEFINER` function, never
  a broad grant.

---

## 7. How it wires into Pro (office side)

- New **Residents** surface in the office shell: verify queue, moderation queue,
  per-building social on/off, resident roster by unit.
- Dashboard card tying it back to money: **resident engagement ↔ turnover ↔
  make-ready cost** — the story only Round24 can tell.
- Maintenance already flows resident → office → work order → crew; Community adds
  verified identity + the social layer on top of the pipe that exists.

---

## 8. Phasing (ship value early, don't boil the ocean)

1. **Identity + verification.** Resident accounts, unit binding (lease-email match
   + join codes + office verify queue), authed resident home with the existing
   maintenance flow inside it. *This alone is shippable and valuable* — it makes
   the resident form a real account, not a one-shot.
2. **Pseudonymous messaging + moderation.** Building/floor/unit scopes, report
   queue, content filter, unmask-on-report. The hard, high-value core.
3. **Community pages.** Tips / favorites / events, upvoted suggestions.
4. **Delight + automation.** Visual floor maps, RM-OAuth auto-binding, the
   turnover-analytics tie-in.

---

## 9. Risks & open questions

| Risk | Mitigation |
|---|---|
| Resident adoption is historically low | The **maintenance request is the wedge** — residents come for the repair, stay for the community. |
| Harassment / fair-housing liability | Pseudonymity **with** accountability; office moderation + unmask + content filter; per-building opt-out. |
| Best-case binding depends on RM | Three fallbacks (lease-email, invite, office-verify) all work without RM. |
| A resident seeing Pro data | New deny-by-default RLS audience + explicit RLS integration tests before launch. |
| Second auth audience = cost/complexity | Reuse Supabase Auth; residents are just a role with a hard-walled scope. |

**Open questions for the partner/product calls:**
- Does RM's API expose a tenant→unit mapping we can OAuth against? (check on the
  RM partner call — it's the auto-binding jackpot).
- Do we let residents post named (opt-in) or pseudonym-only? (start pseudonym-only).
- Per-building social default: on or off? (recommend **off**, office opts in).

---

## 10. One-line pitch

**Round24 Pro measures the true cost of running a building. Round24 Community
lowers it — by turning residents into a self-governing community that resolves
its own friction, reports its own problems, and stays longer.** Nobody else in
the category has both halves.

---

## 11. Shaping pass — the committed bet (Shape Up style)

The design above is the territory. This section is the *bet*: what we actually
commit to building first, sized, with the rabbit holes fenced off. Two shaped
slices; each is independently shippable and demoable at Evolution24.

### Slice 1 — "Community Core" (identity + verified requests)

**Problem, one line:** the resident form is a one-shot — no account, no history,
no verified identity, so nothing else can be built on it.

**Appetite:** small batch. This is mostly plumbing we already have (Supabase
Auth, invite codes, the request pipeline, the office-queue pattern).

**Fat-marker sketch — resident side (mobile-first, whitelabeled):**

```
┌──────────────────────────┐   ┌──────────────────────────┐
│  [Evolution24 logo]      │   │  MY HOME  · 121 Park 4B  │
│  Join your building      │   │  ────────────────────    │
│  ─ email (lease match)   │   │  ⚒ Report an issue       │
│  ─ or building code      │   │  ⏱ My requests (2 open)  │
│  → pick building + unit  │   │     • Leak — in progress │
│  → pending / verified ✓  │   │     • Bulb — done ✓      │
└──────────────────────────┘   │  📣 Announcements        │
                               │  ⚙ My settings           │
                               └──────────────────────────┘
```

**Fat-marker sketch — office side:** a **Residents** tab: verify queue (approve /
decline against the lease, same interaction as the request queue), roster by
building/unit, per-building join-code + QR (reuse the poster generator).

**In scope:** resident auth (email OTP/password), unit binding via lease-email
match + join code, verify states, "My requests" with live status (the request →
WO status already exists — just surface it), announcements read-only, settings
stub. **Done =** a real Evolution24 resident signs up, gets verified, submits a
request, and watches it move to done.

**Rabbit holes — do NOT enter:** RM/Google OAuth (Phase 4); editing requests
after submit; per-unit invite emails (join code is enough for v1); password
reset flows beyond Supabase defaults; native app (PWA only).

### Slice 2 — "Neighbor Layer" (messaging + moderation)

**Problem, one line:** friction between neighbors escalates to management
because there's no lighter channel.

**Appetite:** big batch — the moderation/reachability machinery (§3) is the
product. Do not start until Slice 1 is live and a real building has verified
residents (messaging into an empty room is worthless).

**Fat-marker sketch:**

```
┌──────────────────────────┐   Office adds two queues:
│  MY BUILDING             │   ─ Reports (unmask, audited)
│  ── Building feed ────── │   ─ Requests-to-join trays
│  "hot water out? — 3rd   │
│   floor neighbor" 💬 4    │   Resident settings adds the dial:
│  ── Nudge a neighbor ─── │   DMs: off/requests/trusted/open
│  unit ▸ template ▸ send  │   Nudges ▸ Broadcasts ▸ Away→email
│  ── Requests tray (1) ── │
└──────────────────────────┘
```

**In scope:** building/floor feed, courtesy nudges (template-first), DM with the
reachability dial + requests tray, report → office queue → unmask (audited),
Claude content filter, rate limits (0046 pattern), away→email. **Done =** two
real residents resolve a nudge-worthy issue without the office touching it.

**Rabbit holes — do NOT enter:** visual floor maps; read receipts/typing
indicators; media attachments in DMs (text first — photos are where abuse
lives); resident-to-resident marketplace; push-notification infra beyond what
the PWA already does (email covers Away mode).

### No-gos (both slices — hard lines)

- **No true anonymity.** Pseudonymity with audited unmask, or nothing.
- **No resident PII visible to neighbors, ever** — including in payloads.
- **No building goes social by default.** Office opts each building in.
- **No custom chat infra.** Supabase realtime + Postgres, same as team chat.
- **No public launch of Slice 2 without the moderation queue live** — the
  content filter alone is not enough.

### Sequencing note

Slice 1 has zero social risk and compounds immediately (verified identities make
every future feature better). Ship it, seed Evolution24's buildings, *then* bet
on Slice 2 with real residents in the room.

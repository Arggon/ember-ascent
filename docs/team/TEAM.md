# Full-Stack Software Development Team

Eleven Saved Agents covering the entire software lifecycle — from a vague idea to shipped, reviewed, documented, secure software. Each has one clear remit, a fixed output format, explicit boundaries, and named handoffs. No two overlap; nothing falls between them.

---

## 1. Roster

| # | Agent | Remit (owns) | Does NOT do | Primary handoff |
|---|-------|--------------|-------------|-----------------|
| 1 | **Tech Lead** | Orchestration, work breakdown, routing, Definition of Done, conflict resolution | Bulk implementation | to everyone |
| 2 | **Product Manager** | Problem framing, scope/MVP, user stories, acceptance criteria, priorities, success metrics | Tech choices, design, code | Tech Lead → Architect, UX |
| 3 | **System Architect** | Components, stack choices, API contracts, data models, ADRs, non-functional plan | Feature code, visual design | Tech Lead → FE, BE, DevOps |
| 4 | **UX Designer** | User flows, screen specs, tokens, interaction states, accessibility requirements | Frameworks, production code, backend contracts | Tech Lead → Frontend |
| 5 | **Frontend Engineer** | UI implementation, state, routing, a11y, client perf, component tests | API contracts, redesign, CI/CD | Code Reviewer, QA |
| 6 | **Backend Engineer** | APIs, business logic, data access, auth/authz, migrations, service tests | System design, UI, infra | Code Reviewer, Security, QA |
| 7 | **DevOps Engineer** | Build/repo setup, CI/CD, containers, IaC, environments, observability, rollback | Product code, architecture choices | Code Reviewer, QA |
| 8 | **QA Engineer** | Test strategy, regression/e2e, bug reproduction, release go/no-go verdicts | Fixing product code, redesign | owning engineer, Security |
| 9 | **Security Engineer** | Threat model, authn/authz review, input handling, secrets, dependency/CVE audit, hardening | Offensive tooling, weakening controls | owning engineer, QA |
| 10 | **Code Reviewer** | Independent adversarial review of diffs vs. spec; severity-ranked verdicts | Fixing code, style bikeshedding | requesting engineer |
| 11 | **Technical Writer** | READMEs, runbooks, API/architecture docs, changelogs, onboarding | Changing code, guessing at behavior | Tech Lead, owner |

### Agent IDs (for exact targeting)

| Agent | agentId |
|-------|---------|
| Tech Lead | `43031261-584b-4ec5-be3d-c0809acec8bb` |
| Product Manager | `e7b8e9c2-622f-49b9-b74e-e608fbffd10a` |
| System Architect | `8f209268-def8-4873-adc8-7c3e945a6fcb` |
| UX Designer | `8133c4bf-60a4-4f6e-bc86-7ee1c95b8fd6` |
| Frontend Engineer | `aaaeefe0-2b00-4c4a-b011-a339a04a52ee` |
| Backend Engineer | `25645c37-6ea5-40ee-81f1-12a1b11fdb04` |
| DevOps Engineer | `21fba894-84df-4a79-9732-9a42702db407` |
| QA Engineer | `93e7e904-b764-4fd6-972e-5167460230ca` |
| Security Engineer | `f6611251-810d-43b8-bee4-8b39187e5b67` |
| Code Reviewer | `c0ebd3c0-af0b-4d06-91b4-a7108f1d9c99` |
| Technical Writer | `35dba2ea-48ad-499e-8d97-03f49a776a6b` |

---

## 2. Which agent do I call?

| Your situation | Call |
|---|---|
| "Build me / add / change X" (whole feature) | **Tech Lead** — it routes the rest |
| "I don't know what exactly I want yet" | **Product Manager** |
| "How should this be structured / what stack / define the API" | **System Architect** |
| "Design this screen / feel of this flow" | **UX Designer** |
| "Make this UI" | **Frontend Engineer** |
| "Make this endpoint / query / job" | **Backend Engineer** |
| "Get it building / deployed / monitored" | **DevOps Engineer** |
| "Prove it works / is it safe to ship" | **QA Engineer** |
| "Is this safe / review auth / check dependencies" | **Security Engineer** |
| "Review this PR / diff before I merge" | **Code Reviewer** |
| "Write the README / runbook / API docs" | **Technical Writer** |

**Rule of thumb:** if the task spans more than one role, start with **Tech Lead** and let it decompose. If it fits exactly one row above, call that specialist directly — it is faster and cheaper.

---

## 3. Handoff protocol

Every handoff carries five things, or it is not a handoff:

1. **Goal** — the outcome wanted, in one sentence.
2. **Context** — constraints, prior decisions, and the reason they were made.
3. **Inputs** — the exact files, specs, contracts, or artifacts to work from.
4. **Expected output** — the shape of the deliverable.
5. **Done-check** — how the receiver's work will be judged.

Standard flow for a feature:

```
User
 └─> Tech Lead            frames goal, decomposes, routes
      ├─> Product Manager  stories + acceptance criteria + scope   ─┐
      ├─> System Architect contracts + ADRs + NFRs                  │ shared
      ├─> UX Designer      flows + screen specs + a11y              │ context
      ├─> Frontend / Backend / DevOps   implementation              ┘
      ├─> Code Reviewer    blocker/major/minor findings  ──> back to owner
      ├─> Security Engineer findings (auth / input / deps paths)
      ├─> QA Engineer      criterion map + GO / NO-GO verdict
      └─> Technical Writer README / runbook / API docs
      └─> Tech Lead        declares done against Definition of Done
```

Loop rule: **Reviewers never fix.** Findings go back to the owning engineer, who fixes and re-submits. Only the reviewer clears its own blocker.

---

## 4. Definition of Done

The **Tech Lead** is the only agent that can declare a chunk complete, and only when all seven hold:

1. It does what the spec said it would.
2. It actually runs.
3. Tests covering it exist and pass.
4. No unresolved **blocker** or **major** from Code Reviewer.
5. No unresolved security blocker.
6. It is documented enough for another developer to pick it up.
7. Evidence exists — commands run, output shown — not just an assertion that it works.

If any is missing, it goes back to the owner with a specific gap list.

---

## 5. Evidence discipline (the anti-hallucination rule)

Every agent is instructed to distinguish **verified** from **assumed**, and to never claim a test passed, a build succeeded, a bug was fixed, or a command ran without showing the actual output. When an agent says "verified", you should find the command and its result nearby. When it cannot execute something, it must say so and name what remains unverified.

This is the single most important property of this team. Hold every agent to it.

---

## 6. Copy-paste prompts

**Full feature, handled end to end**
```
Build <feature>. Context: <who it's for, constraints, existing code>.
Act as Tech Lead: decompose it, route each chunk to the right specialist on
the team, and drive it through review, security, QA, and docs. Stop and ask me
only about decisions that would be expensive to reverse. Report back with the
status of every chunk and the evidence for each.
```

**Frame a vague idea**
```
I'm thinking about <idea>. Act as Product Manager: frame the problem, give me
an MVP scope with explicit cuts, user stories with testable acceptance criteria,
priorities, and the success metrics. List what you'd defer to phase 2.
```

**Design before coding**
```
For <feature>, act as System Architect: components, interfaces, API and data
contracts with error cases, stack choices with rejected alternatives, ADRs, and
the non-functional plan. Flag what's expensive to change later.
```

**Implement from a spec**
```
Implement <spec / file / story> end to end. Follow the existing conventions.
Write tests that would fail if this regressed. Run them, then show me the exact
commands and output. Do not claim anything you did not run.
```

**Review before merging**
```
Act as Code Reviewer on this diff <paste / path>. Judge against <spec>. Give a
verdict with blockers, major, and minor findings ranked by severity, each with
location, impact, and the minimal fix. Say what you actually ran.
```

**Harden a change**
```
Act as Security Engineer on <area>. Threat model it, review authn/authz,
input handling, and secrets, audit dependencies for known CVEs, and give me
severity-ranked findings with concrete fixes. State clearly what you examined
and what you did not.
```

**Ship readiness**
```
Act as QA Engineer for this release. Map each acceptance criterion to a test and
a result, report bugs with minimal reproductions, and give me a GO / NO-GO
verdict with the evidence and any blockers.
```

**Document it**
```
Act as Technical Writer. Write a <README / runbook / API reference> for
<audience>. Verify each command before documenting it and mark anything you
could not verify as unverified.
```

---

## 7. Capabilities (permissions)

Stored in `agent_members.policy_json.capabilities`. Read fresh from the database at every run admission, so a change applies from the **next run** — no app restart, but never to a run already in flight.

| Agent | ↑r | ↑w | web | exec | Badge |
|---|:--:|:--:|:--:|:--:|---|
| Tech Lead | ✅ | — | ✅ | — | `[ro,web]` |
| Product Manager | ✅ | — | ✅ | — | `[ro,web]` |
| System Architect | ✅ | ✅ | ✅ | ✅ | `[rw,web,exec]` |
| UX Designer | ✅ | ✅ | ✅ | — | `[rw,web]` |
| Frontend Engineer | ✅ | ✅ | ✅ | ✅ | `[rw,web,exec]` |
| Backend Engineer | ✅ | ✅ | ✅ | ✅ | `[rw,web,exec]` |
| DevOps Engineer | ✅ | ✅ | ✅ | ✅ | `[rw,web,exec]` |
| QA Engineer | ✅ | ✅ | ✅ | ✅ | `[rw,web,exec]` |
| Security Engineer | ✅ | ✅ | ✅ | ✅ | `[rw,web,exec]` |
| Code Reviewer | ✅ | — | ✅ | ✅ | `[ro,web,exec]` |
| Technical Writer | ✅ | ✅ | ✅ | — | `[rw,web]` |

Rationale for the non-obvious calls:

- **Code Reviewer** gets `exec` but **not** `write` — it must run the test suite to verify a claim, but must never edit the code it is reviewing.
- **Tech Lead** and **Product Manager** stay read-only — they orchestrate and specify; the doing belongs to the specialists they delegate to.
- **System Architect** gets `write` + `exec` so it can write schemas/ADRs and run throwaway spikes to settle an uncertainty, without owning feature code.
- **UX Designer** and **Technical Writer** get `write` (they produce real deliverables) but not `exec`.

Applying a change: edit the capability arrays in `set-agent-capabilities.sql` and run
`sqlite3 <account>/runtime/runtime.sqlite < set-agent-capabilities.sql`.
The script rewrites only `$.capabilities` and preserves `outputContract` and `executionPolicy`.

---

## 8. Activation notes (2 non-obvious steps)

Two things are **not** handled by creating an agent, and both were discovered the hard way.

**1. Visibility — the agent needs an `agent_presets` row.**
Both the sidebar Agents tab and Settings → Agent management → "My Agents" list an agent only when a row exists in `agent_presets` for it; everything else is filed under "See more Agents you can set as conversational". Programmatic creation writes `agents` + `agent_members` but **not** `agent_presets`.

Fix in the UI: expand that collapsed "See more…" row and enable the **Conversational** toggle on the agent. (Read out of the app bundle — the on-screen label may differ slightly.)

**2. Capabilities — a new agent defaults to read-only.**
Created agents get `["workspace.read","web.search","web.fetch"]` with no `workspace.write` and no `external.process_execute`. **No UI control edits this** — the agent editor has no capability field. Set it via `set-agent-capabilities.sql` (section 7). Applying the Conversational toggle does **not** grant permissions; the two are independent.

---

## 9. Notes

- These eleven agents were created owner-wide and can be edited or removed individually from Settings.
- This team is separate from any pre-existing agents in your catalog; nothing existing was renamed or modified to build it.
- `AGENTS.md` in this workspace is the short routing reference for the same team.
- Capability enforcement, for reference: `workspace.write` gates write tools (and is additionally AND-ed with a parent-side writer flag), `external.process_execute` gates process-execution tools, and the `web.*` tokens gate web tools. `workspace.read` is effectively the ungated baseline.

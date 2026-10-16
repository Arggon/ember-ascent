# AGENTS.md

This workspace is driven by a full-software-development agent team. Prefer delegating software work to the right specialist rather than doing everything inline. Full playbook: `TEAM.md`.

## Routing

| Task | Delegate to |
|---|---|
| Whole feature / spans multiple roles / unclear scope | **Tech Lead** `43031261-584b-4ec5-be3d-c0809acec8bb` |
| Requirements, scope, acceptance criteria | **Product Manager** `e7b8e9c2-622f-49b9-b74e-e608fbffd10a` |
| System design, stack, API/data contracts, ADRs | **System Architect** `8f209268-def8-4873-adc8-7c3e945a6fcb` |
| Flows, screen specs, tokens, accessibility requirements | **UX Designer** `8133c4bf-60a4-4f6e-bc86-7ee1c95b8fd6` |
| UI implementation, client state, component tests | **Frontend Engineer** `aaaeefe0-2b00-4c4a-b011-a339a04a52ee` |
| APIs, business logic, data, migrations, service tests | **Backend Engineer** `25645c37-6ea5-40ee-81f1-12a1b11fdb04` |
| Build, CI/CD, containers, infra, observability, rollback | **DevOps Engineer** `21fba894-84df-4a79-9732-9a42702db407` |
| Test strategy, regression, release verification | **QA Engineer** `93e7e904-b764-4fd6-972e-5167460230ca` |
| Threat model, auth review, secrets, dependency CVEs | **Security Engineer** `f6611251-810d-43b8-bee4-8b39187e5b67` |
| Review a diff/PR before merge | **Code Reviewer** `c0ebd3c0-af0b-4d06-91b4-a7108f1d9c99` |
| READMEs, runbooks, API/architecture docs, changelogs | **Technical Writer** `35dba2ea-48ad-499e-8d97-03f49a776a6b` |

## Conventions

- Multi-role task → start with **Tech Lead**; it decomposes and routes.
- Every handoff carries: goal, context, inputs, expected output, done-check.
- Reviewers report findings; the owning engineer fixes them.
- Only **Tech Lead** declares work done, against the Definition of Done in `TEAM.md`.
- Evidence over assertion: no agent claims a test passed, a build succeeded, or a command ran without showing the actual output.

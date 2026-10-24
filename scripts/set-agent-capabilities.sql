-- Least-privilege capability sets for the dev-team agents.
-- Rewrites ONLY $.capabilities via json_set; outputContract and executionPolicy are preserved.
-- Effective from the next run admission (the runtime reads agent_members policy_json fresh per run).
-- Apply:  sqlite3 <account>/runtime/runtime.sqlite < set-agent-capabilities.sql
--
-- SHAPE: the grants live in the intended_caps table below, one row per agent, next to
-- the human-readable reason for that grant level. The UPDATE itself is written once
-- and never copy-pasted per agent — to change someone's grants, edit their row.

BEGIN;

CREATE TEMP TABLE intended_caps(agent_id TEXT PRIMARY KEY, caps TEXT NOT NULL);

INSERT INTO intended_caps(agent_id, caps) VALUES
  -- Read-only + web orchestration (no file writes, no exec)
  ('43031261-584b-4ec5-be3d-c0809acec8bb',
   '["workspace.read","web.search","web.fetch","web.source_inspection"]'),            -- Tech Lead
  -- Read-only + web, no write at all
  ('e7b8e9c2-622f-49b9-b74e-e608fbffd10a',
   '["workspace.read","web.search","web.fetch"]'),                                     -- Product Manager
  -- Design authority: writes docs/specs and may run throwaway spikes
  ('8f209268-def8-4873-adc8-7c3e945a6fcb',
   '["workspace.read","workspace.write","web.search","web.fetch","web.source_inspection","external.process_execute"]'), -- System Architect
  -- Writes deliverable specs; no code execution
  ('8133c4bf-60a4-4f6e-bc86-7ee1c95b8fd6',
   '["workspace.read","workspace.write","web.search","web.fetch"]'),                   -- UX Designer
  ('35dba2ea-48ad-499e-8d97-03f49a776a6b',
   '["workspace.read","workspace.write","web.search","web.fetch"]'),                   -- Technical Writer
  -- Builders and assurance: full read/write/web/exec
  ('aaaeefe0-2b00-4c4a-b011-a339a04a52ee',
   '["workspace.read","workspace.write","web.search","web.fetch","web.source_inspection","external.process_execute"]'), -- Frontend Engineer
  ('25645c37-6ea5-40ee-81f1-12a1b11fdb04',
   '["workspace.read","workspace.write","web.search","web.fetch","web.source_inspection","external.process_execute"]'), -- Backend Engineer
  ('21fba894-84df-4a79-9732-9a42702db407',
   '["workspace.read","workspace.write","web.search","web.fetch","web.source_inspection","external.process_execute"]'), -- DevOps Engineer
  ('93e7e904-b764-4fd6-972e-5167460230ca',
   '["workspace.read","workspace.write","web.search","web.fetch","web.source_inspection","external.process_execute"]'), -- QA Engineer
  ('f6611251-810d-43b8-bee4-8b39187e5b67',
   '["workspace.read","workspace.write","web.search","web.fetch","web.source_inspection","external.process_execute"]'), -- Security Engineer
  -- Runs code to verify findings, never edits the code under review
  ('c0ebd3c0-af0b-4d06-91b4-a7108f1d9c99',
   '["workspace.read","web.search","web.fetch","web.source_inspection","external.process_execute"]');                   -- Code Reviewer

UPDATE agent_members
SET policy_json = json_set(policy_json, '$.capabilities',
                           json((SELECT caps FROM intended_caps WHERE intended_caps.agent_id = agent_members.agent_id))),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE agent_id IN (SELECT agent_id FROM intended_caps);

COMMIT;

-- Read-only receipt: what each touched agent now carries, so the operator can see the
-- grant that takes effect at the next run admission without a follow-up query.
SELECT json_extract(policy_json, '$.capabilities') AS capabilities, agent_id
FROM agent_members
WHERE agent_id IN (SELECT agent_id FROM intended_caps)
ORDER BY capabilities, agent_id;

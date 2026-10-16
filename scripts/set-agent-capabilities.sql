-- Least-privilege capability sets for the dev-team agents.
-- Rewrites ONLY $.capabilities via json_set; outputContract and executionPolicy are preserved.
-- Effective from the next run admission (the runtime reads agent_members policy_json fresh per run).
-- Apply:  sqlite3 <account>/runtime/runtime.sqlite < set-agent-capabilities.sql

BEGIN;

-- Read-only + web orchestration (no file writes, no exec)
UPDATE agent_members SET policy_json = json_set(policy_json, '$.capabilities',
  json('["workspace.read","web.search","web.fetch","web.source_inspection"]')),
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE agent_id = '43031261-584b-4ec5-be3d-c0809acec8bb';  -- Tech Lead

-- Read-only + web, no write at all
UPDATE agent_members SET policy_json = json_set(policy_json, '$.capabilities',
  json('["workspace.read","web.search","web.fetch"]')),
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE agent_id = 'e7b8e9c2-622f-49b9-b74e-e608fbffd10a';  -- Product Manager

-- Design authority: writes docs/specs and may run throwaway spikes
UPDATE agent_members SET policy_json = json_set(policy_json, '$.capabilities',
  json('["workspace.read","workspace.write","web.search","web.fetch","web.source_inspection","external.process_execute"]')),
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE agent_id = '8f209268-def8-4873-adc8-7c3e945a6fcb';  -- System Architect

-- Writes deliverable specs; no code execution
UPDATE agent_members SET policy_json = json_set(policy_json, '$.capabilities',
  json('["workspace.read","workspace.write","web.search","web.fetch"]')),
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE agent_id IN ('8133c4bf-60a4-4f6e-bc86-7ee1c95b8fd6',   -- UX Designer
                     '35dba2ea-48ad-499e-8d97-03f49a776a6b'); -- Technical Writer

-- Builders and assurance: full read/write/web/exec
UPDATE agent_members SET policy_json = json_set(policy_json, '$.capabilities',
  json('["workspace.read","workspace.write","web.search","web.fetch","web.source_inspection","external.process_execute"]')),
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE agent_id IN ('aaaeefe0-2b00-4c4a-b011-a339a04a52ee',  -- Frontend Engineer
                     '25645c37-6ea5-40ee-81f1-12a1b11fdb04',  -- Backend Engineer
                     '21fba894-84df-4a79-9732-9a42702db407',  -- DevOps Engineer
                     '93e7e904-b764-4fd6-972e-5167460230ca',  -- QA Engineer
                     'f6611251-810d-43b8-bee4-8b39187e5b67'); -- Security Engineer

-- Runs code to verify findings, never edits the code under review
UPDATE agent_members SET policy_json = json_set(policy_json, '$.capabilities',
  json('["workspace.read","web.search","web.fetch","web.source_inspection","external.process_execute"]')),
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE agent_id = 'c0ebd3c0-af0b-4d06-91b4-a7108f1d9c99';  -- Code Reviewer

COMMIT;

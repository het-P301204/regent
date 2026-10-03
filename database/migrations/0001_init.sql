-- REGENT schema, version 1.
--
-- Every tenant-owned row carries organization_id and every query filters on it.
-- Evidence tables deliberately have NO foreign keys between principals,
-- delegations and actions: imported evidence is untrusted, and a dangling
-- reference is a finding to report, not a row to reject. Foreign keys are used
-- only for REGENT's own data (organizations, users, datasets, runs).

CREATE TABLE organizations (
  id               text PRIMARY KEY,
  name             text NOT NULL,
  slug             text NOT NULL UNIQUE,
  ruleset_revision integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id                text PRIMARY KEY,
  organization_id   text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email             text NOT NULL UNIQUE,
  display_name      text NOT NULL,
  role              text NOT NULL CHECK (role IN ('viewer', 'auditor', 'analyst', 'admin')),
  password_hash     text,
  is_demo_persona   boolean NOT NULL DEFAULT false,
  active_dataset_id text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX users_org ON users(organization_id);

-- Session tokens are stored only as SHA-256 hashes.
CREATE TABLE sessions (
  token_hash      text PRIMARY KEY,
  user_id         text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  csrf_token      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  last_seen_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user ON sessions(user_id);

-- API tokens for automation (Authorization: Bearer). Hash only; the token is shown once.
CREATE TABLE api_tokens (
  token_hash      text PRIMARY KEY,
  token_prefix    text NOT NULL,
  user_id         text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_used_at    timestamptz,
  revoked_at      timestamptz
);

CREATE TABLE datasets (
  id              text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  source          text NOT NULL CHECK (source IN ('demo', 'scenario', 'import', 'builder')),
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  input_sha256    text NOT NULL,
  records_read    integer NOT NULL,
  records_accepted integer NOT NULL,
  records_rejected integer NOT NULL,
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX datasets_org ON datasets(organization_id, created_at DESC);

CREATE TABLE ingest_issues (
  dataset_id      text NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  organization_id text NOT NULL,
  seq             integer NOT NULL,
  severity        text NOT NULL,
  code            text NOT NULL,
  message         text NOT NULL,
  record_index    integer,
  record_type     text,
  record_id       text,
  field           text,
  PRIMARY KEY (dataset_id, seq)
);

-- ---------------------------------------------------------------- evidence

CREATE TABLE principals (
  dataset_id        text NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  organization_id   text NOT NULL,
  principal_id      text NOT NULL,
  principal_type    text NOT NULL CHECK (principal_type IN ('human', 'agent', 'sub_agent', 'workload', 'service')),
  display_name      text NOT NULL,
  issuer            text,
  provisioned_scope text[],
  root_eligible     boolean NOT NULL,
  created_at        timestamptz,
  suspended_at      timestamptz,
  revoked_at        timestamptz,
  expires_at        timestamptz,
  recorded_status   text NOT NULL,
  event_id          text,
  PRIMARY KEY (dataset_id, principal_id)
);

CREATE TABLE execution_identities (
  dataset_id            text NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  organization_id       text NOT NULL,
  execution_identity_id text NOT NULL,
  kind                  text NOT NULL,
  bound_principal_id    text,
  spiffe_id             text,
  provisioned_scope     text[],
  issued_at             timestamptz,
  revoked_at            timestamptz,
  expires_at            timestamptz,
  recorded_status       text NOT NULL,
  event_id              text,
  PRIMARY KEY (dataset_id, execution_identity_id)
);

-- Credential METADATA only. REGENT never stores credential material.
CREATE TABLE credentials (
  dataset_id            text NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  organization_id       text NOT NULL,
  credential_id         text NOT NULL,
  credential_type       text NOT NULL,
  execution_identity_id text,
  issued_at             timestamptz,
  expires_at            timestamptz,
  revoked_at            timestamptz,
  recorded_status       text NOT NULL,
  event_id              text,
  PRIMARY KEY (dataset_id, credential_id)
);

CREATE TABLE tools (
  dataset_id      text NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  organization_id text NOT NULL,
  tool_id         text NOT NULL,
  display_name    text NOT NULL,
  kind            text NOT NULL,
  event_id        text,
  PRIMARY KEY (dataset_id, tool_id)
);

CREATE TABLE resources (
  dataset_id      text NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  organization_id text NOT NULL,
  resource_id     text NOT NULL,
  display_name    text NOT NULL,
  kind            text NOT NULL,
  event_id        text,
  PRIMARY KEY (dataset_id, resource_id)
);

CREATE TABLE authz_policies (
  dataset_id            text NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  organization_id       text NOT NULL,
  policy_id             text NOT NULL,
  policy_version        text NOT NULL,
  display_name          text NOT NULL,
  scope_ceiling         text[],
  approval_required_for text[] NOT NULL,
  event_id              text,
  PRIMARY KEY (dataset_id, policy_id, policy_version)
);

CREATE TABLE delegations (
  dataset_id             text NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  organization_id        text NOT NULL,
  delegation_id          text NOT NULL,
  parent_delegation_id   text,
  root_principal_id      text,
  delegator_principal_id text,
  delegatee_principal_id text,
  granted_scope          text[],
  requested_scope        text[],
  restrictions           text[] NOT NULL,
  policy_id              text,
  policy_version         text,
  created_at             timestamptz,
  expires_at             timestamptz,
  revoked_at             timestamptz,
  approval_state         text NOT NULL,
  recorded_status        text NOT NULL,
  event_id               text,
  PRIMARY KEY (dataset_id, delegation_id)
);
CREATE INDEX delegations_delegatee ON delegations(dataset_id, delegatee_principal_id);
CREATE INDEX delegations_delegator ON delegations(dataset_id, delegator_principal_id);

CREATE TABLE actions (
  dataset_id                 text NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  organization_id            text NOT NULL,
  action_id                  text NOT NULL,
  event_id                   text NOT NULL,
  ts                         timestamptz,
  root_principal_id          text,
  actor_principal_id         text,
  parent_principal_id        text,
  delegation_id              text,
  parent_event_id            text,
  execution_identity_id      text,
  credential_id              text,
  tool_id                    text,
  resource_id                text,
  operation                  text,
  parameters                 jsonb,
  requested_scope            text[],
  exercised_scope            text[],
  policy_id                  text,
  policy_version             text,
  recorded_decision          text,
  decision_reason            text,
  authorization_evaluated_at timestamptz,
  approval_state             text NOT NULL,
  downstream_result          text,
  PRIMARY KEY (dataset_id, action_id)
);
CREATE INDEX actions_actor ON actions(dataset_id, actor_principal_id);
CREATE INDEX actions_ts ON actions(dataset_id, ts);

-- ------------------------------------------------------------ verification

CREATE TABLE rule_configs (
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rule_id         text NOT NULL,
  enabled         boolean NOT NULL,
  severity        text NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
  applies_to      text[] NOT NULL,
  remediation     text NOT NULL,
  updated_by      text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, rule_id)
);

CREATE TABLE verification_runs (
  id              text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  dataset_id      text NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  input_digest    text NOT NULL,
  ruleset_version text NOT NULL,
  engine_version  text NOT NULL,
  summary         jsonb NOT NULL,
  duration_ms     integer NOT NULL,
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX runs_dataset ON verification_runs(dataset_id, created_at DESC);

-- One row per action per run. The full verification is retained as derived evidence.
CREATE TABLE action_results (
  run_id             text NOT NULL REFERENCES verification_runs(id) ON DELETE CASCADE,
  organization_id    text NOT NULL,
  action_id          text NOT NULL,
  event_id           text NOT NULL,
  ts                 timestamptz,
  actor_principal_id text,
  root_principal_id  text,
  resource_id        text,
  overall            text NOT NULL,
  health             text NOT NULL CHECK (health IN ('verified', 'incomplete', 'violated', 'unknown')),
  derived_decision   text NOT NULL,
  recorded_decision  text,
  finding_count      integer NOT NULL,
  result             jsonb NOT NULL,
  PRIMARY KEY (run_id, action_id)
);

CREATE TABLE findings (
  run_id          text NOT NULL REFERENCES verification_runs(id) ON DELETE CASCADE,
  organization_id text NOT NULL,
  dataset_id      text NOT NULL,
  finding_id      text NOT NULL,
  type            text NOT NULL,
  rule_id         text NOT NULL,
  severity        text NOT NULL,
  title           text NOT NULL,
  summary         text NOT NULL,
  action_id       text,
  delegation_id   text,
  first_seen      timestamptz,
  last_seen       timestamptz,
  body            jsonb NOT NULL,
  PRIMARY KEY (run_id, finding_id)
);
CREATE INDEX findings_type ON findings(run_id, type);

-- Triage state survives re-runs because finding ids are content hashes.
CREATE TABLE finding_states (
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  dataset_id      text NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  finding_id      text NOT NULL,
  status          text NOT NULL CHECK (status IN ('OPEN', 'INVESTIGATING', 'ACCEPTED', 'RESOLVED', 'SUPPRESSED')),
  note            text,
  updated_by      text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, dataset_id, finding_id)
);

-- REGENT's own audit trail of who did what in REGENT.
CREATE TABLE audit_log (
  id              bigserial PRIMARY KEY,
  organization_id text NOT NULL,
  user_id         text,
  action          text NOT NULL,
  target          text,
  detail          jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_org ON audit_log(organization_id, created_at DESC);

-- Members, institute batch list, and an audit trail of admin actions.

CREATE TYPE member_status AS ENUM ('pending', 'verified', 'rejected', 'suspended');
CREATE TYPE member_role AS ENUM ('member', 'moderator', 'admin');
CREATE TYPE member_source AS ENUM ('form', 'import', 'admin');
CREATE TYPE batch_match AS ENUM ('full', 'partial', 'none');
CREATE TYPE visibility AS ENUM ('members', 'batch', 'admins');

CREATE TABLE members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone varchar(16) NOT NULL,                 -- E.164, e.g. +919876543210
  name varchar(120) NOT NULL,
  email varchar(254),
  roll_no varchar(32),                        -- stored upper-case
  degree varchar(40) NOT NULL,
  branch varchar(80) NOT NULL,
  batch smallint NOT NULL,                    -- passing year
  position varchar(120),
  organisation varchar(160),
  home_district varchar(40) NOT NULL,         -- one of Bihar's districts
  home_state varchar(40) NOT NULL DEFAULT 'Bihar',
  work_district varchar(80),
  work_state varchar(60),
  linkedin varchar(300),
  skills varchar(300),
  open_to_mentor boolean NOT NULL DEFAULT false,
  phone_visibility visibility NOT NULL DEFAULT 'members',
  email_visibility visibility NOT NULL DEFAULT 'members',
  photo bytea,
  photo_type varchar(40),
  proof bytea,
  proof_type varchar(40),
  proof_name varchar(200),
  vouched_by varchar(160),
  status member_status NOT NULL DEFAULT 'pending',
  role member_role NOT NULL DEFAULT 'member',
  title varchar(40),
  source member_source NOT NULL,
  batch_match batch_match NOT NULL DEFAULT 'none',
  batch_match_notes text,
  reject_reason text,
  decided_by varchar(120),
  decided_at timestamptz,
  consent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT members_phone_key UNIQUE (phone),
  CONSTRAINT members_roll_no_key UNIQUE (roll_no),
  CONSTRAINT members_home_state_bihar CHECK (home_state = 'Bihar')
);
CREATE INDEX members_status_idx ON members (status, created_at);
CREATE INDEX members_home_district_idx ON members (home_district);
CREATE INDEX members_batch_idx ON members (batch);

CREATE TABLE batch_records (
  roll_no varchar(32) PRIMARY KEY,
  name varchar(120) NOT NULL,
  batch smallint NOT NULL,
  branch varchar(80) NOT NULL,
  degree varchar(40) NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  actor varchar(120) NOT NULL,
  action varchar(60) NOT NULL,
  target varchar(120),
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC);

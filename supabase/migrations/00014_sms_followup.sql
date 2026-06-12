-- ============================================
-- Migration 00014: Twilio SMS Follow-up System
-- ============================================
-- Adds the schema needed to send and receive one-to-one business SMS via
-- Twilio. Live sending is gated by the SMS_SENDING_ENABLED env var — this
-- migration only adds the data model. No outbound calls happen here.

-- 1. Per-lead SMS contact status. `unknown` is the default for legacy rows
--    so existing leads remain neither allowed nor blocked until reviewed.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS sms_status text NOT NULL DEFAULT 'unknown'
  CHECK (sms_status IN ('allowed', 'opted_out', 'do_not_contact', 'unknown'));
ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_sms_sent_at timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_sms_received_at timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS sms_notes text;

CREATE INDEX IF NOT EXISTS idx_leads_sms_status ON leads (sms_status);

-- 2. SMS message log. Inbound rows may have a null lead_id when Twilio's
--    From number cannot be matched to a lead.
CREATE TABLE IF NOT EXISTS sms_messages (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id              uuid REFERENCES leads(id) ON DELETE SET NULL,
  direction            text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  status               text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft',
    'queued',
    'sent',
    'delivered',
    'failed',
    'received',
    'blocked',
    'disabled'
  )),
  from_number          text,
  to_number            text,
  body                 text NOT NULL,
  twilio_message_sid   text,
  twilio_status        text,
  error_message        text,
  created_by           uuid REFERENCES agent_profiles(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  sent_at              timestamptz,
  received_at          timestamptz
);

CREATE INDEX IF NOT EXISTS idx_sms_messages_lead_id ON sms_messages (lead_id);
CREATE INDEX IF NOT EXISTS idx_sms_messages_from_number ON sms_messages (from_number);
CREATE INDEX IF NOT EXISTS idx_sms_messages_to_number ON sms_messages (to_number);
CREATE INDEX IF NOT EXISTS idx_sms_messages_created_at ON sms_messages (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_messages_twilio_message_sid ON sms_messages (twilio_message_sid);
CREATE INDEX IF NOT EXISTS idx_sms_messages_direction ON sms_messages (direction);

CREATE TRIGGER sms_messages_updated_at
  BEFORE UPDATE ON sms_messages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 3. RLS — match the existing internal-tool pattern: authenticated users
--    have full access. Service role bypasses RLS for server-side writes
--    from the Twilio webhook.
ALTER TABLE sms_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage sms_messages"
  ON sms_messages FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

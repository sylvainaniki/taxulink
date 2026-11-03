ALTER TABLE courses ADD COLUMN customer_id uuid REFERENCES contacts(id);
ALTER TABLE courses ADD COLUMN passenger_name text NOT NULL DEFAULT '';
ALTER TABLE courses ADD COLUMN passenger_phone text NOT NULL DEFAULT '';
CREATE INDEX messages_group_sequence ON messages(group_id,created_at,id);
CREATE INDEX private_message_sequence ON private_messages(conversation_id,created_at,id);
CREATE INDEX notification_recipient ON notifications(tenant_id,user_id,created_at);
CREATE INDEX target_group ON offer_targets(group_id,offer_id);

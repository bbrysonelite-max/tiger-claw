ALTER TABLE tenants ADD COLUMN IF NOT EXISTS line_channel_secret TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS line_channel_access_token TEXT;

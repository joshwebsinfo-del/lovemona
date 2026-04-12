-- Paste this entire file into the Supabase SQL Editor and hit "Run"

-- 1. Create the Users table
CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    nickname TEXT,
    avatar TEXT,
    real_pin TEXT,
    fake_pin TEXT,
    public_key TEXT NOT NULL,
    private_key TEXT NOT NULL,
    wallpaper TEXT,
    created_at BIGINT NOT NULL
);

-- 2. Create the Partnerships table
CREATE TABLE IF NOT EXISTS partnerships (
    user_id TEXT PRIMARY KEY,
    partner_id TEXT NOT NULL,
    partner_public_key TEXT,
    partner_nickname TEXT,
    partner_avatar TEXT,
    paired_at BIGINT NOT NULL
);

-- 3. Create the persistent messages table
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    sender_id TEXT NOT NULL,
    recipient_id TEXT NOT NULL,
    encrypted_payload TEXT NOT NULL,
    iv TEXT NOT NULL,
    timestamp BIGINT NOT NULL
);

-- 4. Create the Vault table
CREATE TABLE IF NOT EXISTS vault (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    name TEXT,
    type TEXT,
    encrypted_data TEXT NOT NULL,
    iv TEXT NOT NULL,
    timestamp BIGINT NOT NULL
);

-- If you ran a previous version of this script, these lines will safely add any missing columns:
ALTER TABLE vault ADD COLUMN IF NOT EXISTS iv TEXT NOT NULL DEFAULT '';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS iv TEXT NOT NULL DEFAULT '';

-- 5. Enable pure Realtime broadcasting
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'messages'
    ) THEN
        EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE messages';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'vault'
    ) THEN
        EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE vault';
    END IF;
END $$;


-- 6. Disable RLS for smooth client-side cryptography syncing
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE partnerships DISABLE ROW LEVEL SECURITY;
ALTER TABLE messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE vault DISABLE ROW LEVEL SECURITY;

-- 7. Create the Storage Bucket for Video Notes and Vault Media
INSERT INTO storage.buckets (id, name, public) 
VALUES ('vault', 'vault', true)
ON CONFLICT (id) DO NOTHING;

-- Give public access to the bucket for all users (required for the app's crypto-first sync)
CREATE POLICY "Public Access" ON storage.objects FOR ALL USING ( bucket_id = 'vault' );



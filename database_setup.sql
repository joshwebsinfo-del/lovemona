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

-- 5. Create Leaderboard table
CREATE TABLE IF NOT EXISTS leaderboard (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    partner_id TEXT NOT NULL,
    game_type TEXT NOT NULL,
    total_wins INTEGER DEFAULT 0,
    updated_at BIGINT NOT NULL
);

-- 6. Create Hub Sync table (for Sticky Notes, Moods, Countdowns)
CREATE TABLE IF NOT EXISTS hub_sync (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    partner_id TEXT NOT NULL,
    encrypted_payload TEXT NOT NULL,
    iv TEXT NOT NULL,
    updated_at BIGINT NOT NULL
);

-- Add missing columns if existing table
ALTER TABLE vault ADD COLUMN IF NOT EXISTS iv TEXT NOT NULL DEFAULT '';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS iv TEXT NOT NULL DEFAULT '';

-- 7. Enable Realtime broadcasting
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'messages') THEN
        EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE messages';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'vault') THEN
        EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE vault';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'hub_sync') THEN
        EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE hub_sync';
    END IF;
END $$;

-- 6. GRANT full access to anon and authenticated roles
-- This is the CRITICAL fix: DISABLE RLS alone does NOT work for the anon API key.
-- Supabase JS client uses the anon role, which still needs explicit permissions.
GRANT ALL ON users TO anon, authenticated;
GRANT ALL ON partnerships TO anon, authenticated;
GRANT ALL ON messages TO anon, authenticated;
GRANT ALL ON vault TO anon, authenticated;
GRANT ALL ON hub_sync TO anon, authenticated;

-- 7. Enable RLS but add fully permissive policies for the anon role
-- This ensures the Supabase client can read/write all rows freely.
ALTER TABLE vault ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "vault_all_access" ON vault;
CREATE POLICY "vault_all_access" ON vault FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "messages_all_access" ON messages;
CREATE POLICY "messages_all_access" ON messages FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_all_access" ON users;
CREATE POLICY "users_all_access" ON users FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE partnerships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "partnerships_all_access" ON partnerships;
CREATE POLICY "partnerships_all_access" ON partnerships FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE hub_sync ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "hub_sync_all_access" ON hub_sync;
CREATE POLICY "hub_sync_all_access" ON hub_sync FOR ALL USING (true) WITH CHECK (true);

-- 8. Create the Storage Bucket
INSERT INTO storage.buckets (id, name, public) 
VALUES ('vault', 'vault', true)
ON CONFLICT (id) DO NOTHING;

-- Storage Policy - allow all operations on the vault bucket
DROP POLICY IF EXISTS "Public Access" ON storage.objects;
CREATE POLICY "Public Access" ON storage.objects FOR ALL USING ( bucket_id = 'vault' );

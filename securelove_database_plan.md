# SecureLove Database Architecture Plan

With the migration to a fully persistent Supabase backend, SecureLove has transformed from a purely local protocol into a highly robust cloud-hybrid application. Below is the full breakdown of how the data structures operate, sync, and remain mathematically private.

## 1. Table Breakdown

| Table Matrix | Purpose & Behavior | Is it Encrypted? |
| :--- | :--- | :--- |
| **`users`** | Acts as the master registry for an installed app. Secures the user's nickname, avatar, fake pins, and critical Cryptographic RSA Keypairs. | **Partial**. Personal identifers (nicknames, avatars) are plain text for easy discovery, but the RSA `private_key` acts as the master lock. *(Note: We currently upload the private key directly for future cloud recovery features)* |
| **`partnerships`** | Links two `user_id`s together. This replaces the transient QR socket connection with a firm relational link between two people. | **No**. This maps routing topology so the system knows exactly who your partner is. |
| **`messages`** | The persistent ledger of communication. | **Yes 🔒**. Contains strictly AES-GCM encrypted strings (`encrypted_payload` & `iv`). The raw database administrator can never read the contents. |
| **`vault`** | The secure storage locker for massive file blobs (Photos, Audio, Video). | **Yes 🔒**. Every Megabyte of uploaded Base64 string is encrypted using the cryptographic `shared_key` between partners. |

---

## 2. The Syncing Lifecycles

### 🌀 The Initialization Sync (Loading the App)
When you first open SecureLove, the application follows a strict startup sequence:
1. **Local Authentication:** Intercepts your PIN locally without making any network requests.
2. **Key Derivation:** Validates your identity and unlocks the private cryptography keys saved in the local IndexedDB Cache.
3. **Cloud Web Request:** Calls `supabase.from('messages')` and `supabase.from('vault')` fetching everything attached to your active `user_id`.
4. **Hydration Phase:** The app locally mathematics-unlocks every single downloaded message and media file using your private keys. It writes the unlocked files to IndexedDB sequentially for instant UI rendering.

### 🔥 The Live Action Sync (Sending a Message)
1. You type a message and push `Send`.
2. The phone utilizes the Cryptography Engine to turn the `string` into an encrypted payload bundle.
3. **Dual Stream Delivery:**
   - **Route A (Socket.io Signaling):** The payload is instantly shot via the WebRTC signaling server. Extremely fast, but fragile if a user loses connection mid-flight.
   - **Route B (Supabase DB):** The payload is `.insert()` into the physical cloud database. 
4. The `ChatScreen` continuously listens to a **Supabase PostgreSQL Realtime Subscription**. Whichever route (A or B) successfully delivers the unique `msgId` first triggers the UI rendering. The secondary arriving route is gracefully ignored.

---

## 3. Account Recovery Framework (Next Steps)
Now that the database is fully implemented and storing the `users` config, we have the architectural foundation to implement **"Cloud Account Restore"**:

If your phone breaks, currently you lose your account forever. But with the database active, we can implement the following:
1. Turn `SetupScreen.tsx` into a "Login or Setup" UI.
2. The user types their `user_id` and their `Master PIN`.
3. The app reaches into Supabase, downloads the `identity.private_key`, unlocks it, and instantly downloads all thousands of messages and vault files from the cloud flawlessly onto the new phone!

## 4. Maintenance Notes
- **Storage Limits:** Vault attachments are pushed to the database as Base64 text. Supabase Postgres handles TEXT arrays very efficiently, but scaling to hundreds of heavy HD videos could strain database compute. In the future, we will transition the `vault` Table to use **Supabase Buckets**.
- **Message Expiration:** In the future, we intend to hook into the `timestamp` column and create a Supabase Edge Function that automatically runs a sweeping `DELETE FROM messages WHERE timestamp < [7 Days Ago]` to enforce ephemeral deletion automatically globally.

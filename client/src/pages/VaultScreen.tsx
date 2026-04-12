import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, Plus, Image as ImageIcon, Video, Mic, FolderOpen, Trash2, X, RefreshCw } from 'lucide-react';
import { initDB } from '../lib/db';
import { supabase } from '../lib/supabase';
import { encryptMessage, decryptMessage, importPublicKey, deriveSharedSecret, encryptBuffer, decryptBuffer, base64ToBuffer, bufferToBase64 } from '../lib/crypto';

// ─── HELPERS ───
async function getKeys() {
  const db = await initDB();
  const identity = await db.get('identity', 'me');
  const partner = await db.get('partner', 'partner');
  if (!identity || !partner) return null;
  const pk = await importPublicKey(partner.publicKeyPem);
  const sk = await deriveSharedSecret(identity.privateKey, pk);
  return { db, identity, partner, sharedKey: sk };
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function compressImage(file: File, maxSize = 1200, quality = 0.75): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let { width, height } = img;
      if (width > height && width > maxSize) { height *= maxSize / width; width = maxSize; }
      else if (height > maxSize) { width *= maxSize / height; height = maxSize; }
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d')?.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// ─── MAIN COMPONENT ───
export const VaultScreen: React.FC = () => {
  const [items, setItems] = useState<any[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [viewItem, setViewItem] = useState<any>(null);
  const [pendingSecretFile, setPendingSecretFile] = useState<{ b64: string; name: string; mediaType: string } | null>(null);
  const [secretPassword, setSecretPassword] = useState('');
  const [unlockPrompt, setUnlockPrompt] = useState<any>(null);
  const [unlockPassword, setUnlockPassword] = useState('');
  const [secretFilter, setSecretFilter] = useState<'all' | 'me' | 'partner'>('all');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const secretInputRef = useRef<HTMLInputElement>(null);

  // ═══════════════════════════════════════════════
  // 1. LOAD VAULT (local + cloud sync)
  // ═══════════════════════════════════════════════
  const loadVault = async () => {
    const db = await initDB();
    
    // Always load local items first (instant)
    const local = (await db.getAll('vault')) || [];
    setItems(local.sort((a: any, b: any) => b.timestamp - a.timestamp));

    // Then try cloud sync
    const keys = await getKeys();
    if (!keys) return;
    
    setIsSyncing(true);
    setSyncProgress(0);
    
    try {
      const { data: cloud, error } = await supabase
        .from('vault')
        .select('*')
        .eq('owner_id', keys.identity.userId);

      if (error) {
        console.error('VAULT CLOUD FETCH ERROR:', error);
        return;
      }

      console.log(`Vault: ${cloud?.length || 0} cloud items found`);
      
      if (cloud && cloud.length > 0) {
        let newItemsFound = false;
        for (let i = 0; i < cloud.length; i++) {
          setSyncProgress(Math.round(((i + 1) / cloud.length) * 100));
          const row = cloud[i];
          
          // Skip if we already have this item locally
          const existing = await keys.db.get('vault', row.id);
          if (existing) continue;
          
          try {
            const decrypted = await decryptMessage(keys.sharedKey, row.encrypted_data, row.iv);
            await keys.db.put('vault', {
              id: row.id,
              name: row.name,
              type: row.type,
              data: decrypted,
              timestamp: row.timestamp,
              locked: true,
            });
            newItemsFound = true;
            console.log('Vault: Synced cloud item', row.id);
          } catch (decErr) {
            console.warn('Vault: Could not decrypt item', row.id, decErr);
          }
        }
        
        if (newItemsFound) {
          const updated = (await keys.db.getAll('vault')) || [];
          setItems(updated.sort((a: any, b: any) => b.timestamp - a.timestamp));
        }
      }
    } catch (err) {
      console.error('Vault sync error:', err);
    } finally {
      setIsSyncing(false);
      setSyncProgress(100);
    }
  };

  useEffect(() => {
    loadVault();
    
    // Realtime: auto-refresh when partner inserts a vault item for us
    const ch = supabase
      .channel('vault_live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'vault' }, () => {
        console.log('Vault: Realtime INSERT detected, syncing...');
        loadVault();
      })
      .subscribe((status) => console.log('Vault realtime:', status));

    return () => { supabase.removeChannel(ch); };
  }, []);

  // ═══════════════════════════════════════════════
  // 2. UPLOAD A REGULAR FILE (photo/video/voice)
  // ═══════════════════════════════════════════════
  const handleRegularUpload = async (file: File) => {
    setIsUploading(true);
    setUploadStatus('Reading file...');

    try {
      // Step 1: Read the file
      let b64: string;
      if (file.type.startsWith('image/')) {
        b64 = await compressImage(file);
        setUploadStatus('Image compressed');
      } else {
        b64 = await readFileAsBase64(file);
        setUploadStatus('File read');
      }

      const id = Date.now().toString();
      const type = file.type.startsWith('video') ? 'video' 
                 : file.type.startsWith('audio') ? 'voice' 
                 : 'photo';

      // Step 2: Save locally immediately
      const db = await initDB();
      await db.put('vault', { id, name: file.name, type, data: b64, timestamp: Date.now(), locked: true });
      setUploadStatus('Saved locally ✓');
      await loadVault(); // Show it in the UI right away

      // Step 3: Cloud sync (background - won't block UI)
      const keys = await getKeys();
      if (keys) {
        setUploadStatus('Encrypting for cloud...');
        
        let cloudData = b64;
        
        // For large files (>4MB), use Storage bucket instead of DB text column
        if (b64.length > 4 * 1024 * 1024) {
          setUploadStatus('Uploading large file to storage...');
          const raw = base64ToBuffer(b64.split(',')[1] || b64);
          const { encrypted, iv } = await encryptBuffer(keys.sharedKey, raw);
          const path = `vault/${keys.identity.userId}/${id}_${file.name}`;
          const { error: upErr } = await supabase.storage
            .from('vault')
            .upload(path, new Blob([encrypted]), { contentType: 'application/octet-stream' });
          
          if (upErr) {
            console.error('Storage upload failed:', upErr);
            setUploadStatus('Storage upload failed: ' + upErr.message);
          } else {
            cloudData = `storage://${path}::${bufferToBase64(iv.buffer as ArrayBuffer)}`;
            setUploadStatus('Uploaded to storage ✓');
          }
        }

        // Encrypt metadata/data for DB
        const enc = await encryptMessage(keys.sharedKey, cloudData);
        setUploadStatus('Syncing to partner...');

        const { error: insertErr } = await supabase.from('vault').insert([
          { id: id + '_me', owner_id: keys.identity.userId, name: file.name, type, encrypted_data: enc.encrypted, iv: enc.iv, timestamp: Date.now() },
          { id: id + '_partner', owner_id: keys.partner.userId, name: file.name, type, encrypted_data: enc.encrypted, iv: enc.iv, timestamp: Date.now() },
        ]);

        if (insertErr) {
          console.error('VAULT INSERT ERROR:', insertErr);
          setUploadStatus('Cloud sync failed: ' + insertErr.message);
        } else {
          setUploadStatus('Synced to partner ✓');
          console.log('Vault: Successfully synced to both users');
        }
      }
    } catch (err: any) {
      console.error('Upload error:', err);
      setUploadStatus('Error: ' + err.message);
      alert('Upload failed: ' + err.message);
    } finally {
      setTimeout(() => { setIsUploading(false); setUploadStatus(''); }, 2000);
    }
  };

  // ═══════════════════════════════════════════════
  // 3. SECRET DROP
  // ═══════════════════════════════════════════════
  const handleSecretFileSelect = async (file: File) => {
    try {
      let b64: string;
      if (file.type.startsWith('image/')) {
        b64 = await compressImage(file);
      } else {
        b64 = await readFileAsBase64(file);
      }
      const mediaType = file.type.startsWith('video') ? 'video' : 'photo';
      setPendingSecretFile({ b64, name: file.name, mediaType });
    } catch (err: any) {
      alert('Failed to read file: ' + err.message);
    }
  };

  const handleSaveSecretDrop = async () => {
    if (!pendingSecretFile || !secretPassword.trim()) return;
    
    const captured = { ...pendingSecretFile };
    const pw = secretPassword;
    setPendingSecretFile(null);
    setSecretPassword('');
    setIsUploading(true);
    setUploadStatus('Preparing secret drop...');

    try {
      const id = Date.now().toString();
      const db = await initDB();
      const keys = await getKeys();

      // Build the secret payload (password + media)
      let targetMedia = captured.b64;

      // For large secret videos, upload encrypted binary to storage
      if (captured.mediaType === 'video' && keys && captured.b64.length > 4 * 1024 * 1024) {
        setUploadStatus('Encrypting video for storage...');
        const raw = base64ToBuffer(captured.b64.split(',')[1] || captured.b64);
        const { encrypted, iv } = await encryptBuffer(keys.sharedKey, raw);
        const path = `vault/${keys.identity.userId}/${id}_secret.mp4`;
        const { error: upErr } = await supabase.storage
          .from('vault')
          .upload(path, new Blob([encrypted]), { contentType: 'application/octet-stream' });
        if (!upErr) {
          targetMedia = `storage://${path}::${bufferToBase64(iv.buffer as ArrayBuffer)}`;
          setUploadStatus('Video uploaded to storage ✓');
        } else {
          console.error('Secret storage upload error:', upErr);
        }
      }

      const secretPayload = JSON.stringify({
        password: pw,
        mediaData: targetMedia,
        actualType: captured.mediaType,
      });

      // Save locally
      await db.put('vault', { id, name: captured.name, type: 'secret', data: secretPayload, timestamp: Date.now(), locked: true });
      setUploadStatus('Saved locally ✓');
      await loadVault();

      // Cloud sync for both users
      if (keys) {
        setUploadStatus('Encrypting for partner...');
        const enc = await encryptMessage(keys.sharedKey, secretPayload);

        const { error: insertErr } = await supabase.from('vault').insert([
          { id: id + '_me', owner_id: keys.identity.userId, name: captured.name, type: 'secret', encrypted_data: enc.encrypted, iv: enc.iv, timestamp: Date.now() },
          { id: id + '_partner', owner_id: keys.partner.userId, name: captured.name, type: 'secret', encrypted_data: enc.encrypted, iv: enc.iv, timestamp: Date.now() },
        ]);

        if (insertErr) {
          console.error('SECRET DROP INSERT ERROR:', insertErr);
          setUploadStatus('Partner sync FAILED: ' + insertErr.message);
          alert('Secret Drop cloud sync failed: ' + insertErr.message);
        } else {
          setUploadStatus('Secret dropped to partner ✓');
          console.log('Secret Drop: Successfully synced to both users');
        }
      } else {
        setUploadStatus('No partner paired - saved locally only');
      }
    } catch (err: any) {
      console.error('Secret drop error:', err);
      alert('Secret Drop failed: ' + err.message);
    } finally {
      setTimeout(() => { setIsUploading(false); setUploadStatus(''); }, 2500);
    }
  };

  // ═══════════════════════════════════════════════
  // 4. FILE INPUT ROUTER
  // ═══════════════════════════════════════════════
  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>, isSecret: boolean) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ''; // Reset input immediately

    if (isSecret) {
      handleSecretFileSelect(file);
    } else {
      handleRegularUpload(file);
    }
  };

  // ═══════════════════════════════════════════════
  // 5. DELETE & NUCLEAR CLEAR
  // ═══════════════════════════════════════════════
  const deleteItem = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!confirm('Delete from vault?')) return;
    
    const db = await initDB();
    const item = await db.get('vault', id);
    
    // Clean up storage if it's a storage:// reference
    if (item?.data?.startsWith?.('storage://')) {
      try {
        const path = item.data.replace('storage://', '').split('::')[0];
        await supabase.storage.from('vault').remove([path]);
      } catch {}
    }
    
    await db.delete('vault', id);
    
    // Also delete from cloud
    const keys = await getKeys();
    if (keys) {
      await supabase.from('vault').delete().eq('id', id);
    }
    
    if (viewItem?.id === id) setViewItem(null);
    await loadVault();
  };

  const clearAllVault = async () => {
    if (!confirm('☢️ NUCLEAR RESET: Delete EVERY file from your vault on ALL devices?')) return;
    setIsSyncing(true);
    try {
      const db = await initDB();
      const allItems = (await db.getAll('vault')) || [];
      const keys = await getKeys();

      if (keys) {
        // Delete all my rows from cloud
        await supabase.from('vault').delete().eq('owner_id', keys.identity.userId);
        
        // Delete storage files
        const storagePaths = allItems
          .filter((i: any) => i.data?.startsWith?.('storage://'))
          .map((i: any) => i.data.replace('storage://', '').split('::')[0]);
        if (storagePaths.length > 0) {
          await supabase.storage.from('vault').remove(storagePaths);
        }
      }

      await db.clear('vault');
      setItems([]);
      alert('Vault wiped.');
    } catch (err) {
      console.error('Nuclear clear error:', err);
    } finally {
      setIsSyncing(false);
    }
  };

  // ═══════════════════════════════════════════════
  // 6. FILTERED ITEMS
  // ═══════════════════════════════════════════════
  const filteredItems = activeCategory
    ? items.filter((i: any) => {
        if (i.type !== activeCategory) return false;
        if (activeCategory === 'secret') {
          if (secretFilter === 'me') return i.id.endsWith('_me');
          if (secretFilter === 'partner') return i.id.endsWith('_partner');
        }
        return true;
      })
    : [];

  const folders = [
    { id: 'photo', label: 'Gallery', icon: ImageIcon, color: 'from-blue-500 to-indigo-600' },
    { id: 'video', label: 'Cinema', icon: Video, color: 'from-purple-500 to-pink-600' },
    { id: 'voice', label: 'Voices', icon: Mic, color: 'from-orange-500 to-red-600' },
    { id: 'secret', label: 'Secrets', icon: Lock, color: 'from-emerald-500 to-teal-600' },
  ];

  // ═══════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════
  return (
    <div className="min-h-screen bg-[#0a0a0c] text-white selection:bg-primary/30">
      <div className="fixed inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent pointer-events-none" />

      {/* ── HEADER ── */}
      <header className="fixed top-0 w-full z-40 bg-[#0a0a0c]/80 backdrop-blur-xl border-b border-white/5 pt-12 pb-5 px-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-black tracking-tighter bg-gradient-to-br from-white to-white/40 bg-clip-text text-transparent">VAULT</h1>
            <p className="text-[10px] text-white/30 uppercase tracking-[3px] font-black mt-0.5">Encrypted Memories</p>
          </div>
          {!activeCategory && (
            <div className="flex space-x-2">
              <button onClick={loadVault} disabled={isSyncing} className="bg-white/5 border border-white/10 text-white/40 text-[9px] py-2 px-3 rounded-full font-black uppercase tracking-widest active:scale-95 transition-all flex items-center space-x-1.5">
                <RefreshCw size={10} className={isSyncing ? 'animate-spin' : ''} />
                <span>{isSyncing ? `${syncProgress}%` : 'Sync'}</span>
              </button>
              <button onClick={clearAllVault} className="bg-red-500/10 border border-red-500/20 text-red-500 text-[9px] py-2 px-3 rounded-full font-black uppercase tracking-widest active:scale-95 transition-all">☢️</button>
            </div>
          )}
        </div>
        {isSyncing && (
          <div className="mt-3 h-[2px] w-full bg-white/5 rounded-full overflow-hidden">
            <motion.div initial={{ width: 0 }} animate={{ width: `${syncProgress}%` }} className="h-full bg-primary shadow-[0_0_10px_rgba(255,107,0,0.5)]" />
          </div>
        )}
        {uploadStatus && (
          <div className="mt-2 text-[10px] text-primary font-bold uppercase tracking-widest animate-pulse">{uploadStatus}</div>
        )}
      </header>

      {/* ── MAIN CONTENT ── */}
      <main className="pt-40 pb-36 px-6">
        <AnimatePresence mode="wait">
          {!activeCategory ? (
            <motion.div key="folders" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} className="grid grid-cols-2 gap-4">
              {folders.map(f => (
                <button key={f.id} onClick={() => setActiveCategory(f.id)} className="group relative h-44 rounded-3xl overflow-hidden bg-white/5 border border-white/10 active:scale-95 transition-all">
                  <div className={`absolute inset-0 bg-gradient-to-br ${f.color} opacity-0 group-hover:opacity-10 transition-opacity`} />
                  <div className="absolute inset-0 flex flex-col items-center justify-center space-y-3">
                    <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${f.color} flex items-center justify-center shadow-lg`}>
                      <f.icon size={24} className="text-white" />
                    </div>
                    <div className="text-center">
                      <p className="font-bold text-sm tracking-tight">{f.label}</p>
                      <p className="text-[10px] text-white/30 font-black uppercase tracking-widest">{items.filter((i: any) => i.type === f.id).length} Items</p>
                    </div>
                  </div>
                </button>
              ))}
            </motion.div>
          ) : (
            <motion.div key="list" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}>
              <button onClick={() => setActiveCategory(null)} className="flex items-center text-white/40 text-sm font-bold mb-6 hover:text-white transition-colors">
                <span className="mr-2">←</span> Back to Folders
              </button>

              {activeCategory === 'secret' && (
                <div className="flex bg-white/5 p-1 rounded-2xl mb-8 border border-white/10">
                  {(['all', 'me', 'partner'] as const).map(f => (
                    <button key={f} onClick={() => setSecretFilter(f)} className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${secretFilter === f ? 'bg-white text-black shadow-lg' : 'text-white/40'}`}>
                      {f === 'me' ? 'From Me' : f === 'partner' ? 'By Her' : 'All'}
                    </button>
                  ))}
                </div>
              )}

              {filteredItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-white/20">
                  <FolderOpen size={48} className="mb-4 opacity-20" />
                  <p>Empty</p>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-3">
                  {filteredItems.map((item: any) => (
                    <div key={item.id} onClick={() => item.type === 'secret' ? setUnlockPrompt(item) : setViewItem(item)} className="aspect-square bg-white/5 rounded-2xl border border-white/10 p-1 relative group cursor-pointer active:scale-95 transition-all overflow-hidden">
                      {item.type === 'photo' && <img src={item.data} className="w-full h-full object-cover rounded-xl" alt="" />}
                      {item.type === 'video' && <div className="w-full h-full flex items-center justify-center bg-zinc-900 rounded-xl"><Video size={20} className="text-white/20" /></div>}
                      {item.type === 'voice' && <div className="w-full h-full flex items-center justify-center bg-zinc-900 rounded-xl"><Mic size={20} className="text-white/20" /></div>}
                      {item.type === 'secret' && <div className="w-full h-full flex items-center justify-center bg-red-500/10 rounded-xl"><Lock size={20} className="text-red-500/40" /></div>}
                      <button onClick={(e) => deleteItem(item.id, e)} className="absolute top-2 right-2 p-1.5 bg-black/60 backdrop-blur-md rounded-lg opacity-0 group-hover:opacity-100 transition-opacity text-red-400"><Trash2 size={12} /></button>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* ── MODALS ── */}
      <AnimatePresence>
        {viewItem && <VaultLightbox item={viewItem} onClose={() => setViewItem(null)} />}

        {pendingSecretFile && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-2xl flex items-center justify-center p-8">
            <div className="bg-zinc-900/50 border border-white/10 p-8 rounded-[40px] w-full max-w-sm text-center">
              <div className="w-16 h-16 bg-red-600 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-2xl shadow-red-600/30"><Lock size={32} className="text-white" /></div>
              <h2 className="text-xl font-black mb-2 tracking-tight">SET SECRET KEY</h2>
              <p className="text-white/40 text-[10px] uppercase font-bold tracking-[2px] mb-8">This file requires a password to unlock.</p>
              <input type="password" placeholder="Enter Secret Password" value={secretPassword} onChange={(e) => setSecretPassword(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 outline-none focus:border-red-600/50 transition-colors text-center font-bold tracking-[4px]" />
              <div className="mt-8 flex space-x-3">
                <button onClick={() => { setPendingSecretFile(null); setSecretPassword(''); }} className="flex-1 py-4 text-white/40 font-black uppercase tracking-widest text-[10px]">Cancel</button>
                <button onClick={handleSaveSecretDrop} disabled={!secretPassword.trim()} className="flex-1 bg-red-600 py-4 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl shadow-red-600/20 active:scale-95 transition-all disabled:opacity-30">Drop It</button>
              </div>
            </div>
          </motion.div>
        )}

        {unlockPrompt && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-2xl flex items-center justify-center p-8">
            <div className="bg-zinc-900/50 border border-white/10 p-8 rounded-[40px] w-full max-w-sm text-center">
              <div className="w-16 h-16 bg-primary rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-2xl shadow-primary/30"><Lock size={32} className="text-white" /></div>
              <h2 className="text-xl font-black mb-2 tracking-tight">LOCKED DROP</h2>
              <p className="text-white/40 text-[10px] uppercase font-bold tracking-[2px] mb-8">Enter the secret key to view.</p>
              <input type="password" placeholder="••••••••" value={unlockPassword} onChange={(e) => setUnlockPassword(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 outline-none focus:border-primary/50 transition-colors text-center font-bold tracking-[6px]" />
              <div className="mt-8 flex space-x-3">
                <button onClick={() => { setUnlockPrompt(null); setUnlockPassword(''); }} className="flex-1 py-4 text-white/40 font-black uppercase tracking-widest text-[10px]">Back</button>
                <button onClick={() => {
                  try {
                    const dec = JSON.parse(unlockPrompt.data);
                    if (dec.password === unlockPassword.trim()) {
                      setViewItem({ ...unlockPrompt, data: dec.mediaData, type: dec.actualType });
                      setUnlockPrompt(null); setUnlockPassword('');
                    } else { alert('Wrong Key!'); setUnlockPassword(''); }
                  } catch { alert('Corrupted drop.'); }
                }} className="flex-1 bg-primary py-4 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl shadow-primary/20 active:scale-95 transition-all">Unlock</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── FLOATING ACTION BUTTONS (bottom-right, never covers nav) ── */}
      <div className="fixed bottom-32 right-5 flex flex-col space-y-3 z-30">
        <button onClick={() => fileInputRef.current?.click()} disabled={isUploading} className="w-14 h-14 bg-gradient-to-br from-primary to-orange-500 rounded-2xl flex items-center justify-center text-white shadow-2xl shadow-primary/30 active:scale-95 transition-all">
          {isUploading && !pendingSecretFile ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Plus size={24} strokeWidth={3} />}
        </button>
        <button onClick={() => secretInputRef.current?.click()} disabled={isUploading} className="w-14 h-14 bg-red-600 rounded-2xl flex items-center justify-center text-white shadow-2xl shadow-red-500/40 active:scale-95 transition-all">
          <Lock size={24} strokeWidth={3} />
        </button>
      </div>

      {/* Hidden file inputs */}
      <input type="file" ref={fileInputRef} className="hidden" accept="image/*,video/*,audio/*" onChange={(e) => handleFileInput(e, false)} />
      <input type="file" ref={secretInputRef} className="hidden" accept="image/*,video/*" onChange={(e) => handleFileInput(e, true)} />
    </div>
  );
};

// ═══════════════════════════════════════════════
// LIGHTBOX (handles both base64 and storage:// URLs)
// ═══════════════════════════════════════════════
const VaultLightbox = ({ item, onClose }: { item: any; onClose: () => void }) => {
  const isStorageRef = typeof item.data === 'string' && item.data.startsWith('storage://');
  const [src, setSrc] = useState(isStorageRef ? '' : item.data);
  const [loading, setLoading] = useState(isStorageRef);

  useEffect(() => {
    if (!isStorageRef) return;
    
    (async () => {
      try {
        const keys = await getKeys();
        if (!keys) throw new Error('No keys');

        const parts = item.data.replace('storage://', '').split('::');
        const path = parts[0];
        const ivB64 = parts[1];

        const { data, error } = await supabase.storage.from('vault').download(path);
        if (error) throw error;

        const iv = new Uint8Array(base64ToBuffer(ivB64));
        const dec = await decryptBuffer(keys.sharedKey, await data.arrayBuffer(), iv);
        setSrc(URL.createObjectURL(new Blob([dec])));
      } catch (e) {
        console.error('Lightbox decrypt error:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, [item]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-3xl flex items-center justify-center p-6">
      <button onClick={onClose} className="absolute top-8 right-8 w-12 h-12 bg-white/10 rounded-full flex items-center justify-center text-white active:scale-95 z-10"><X size={24} /></button>
      <div className="w-full max-w-lg">
        <div className="rounded-3xl overflow-hidden shadow-2xl border border-white/10 bg-zinc-900/50 min-h-[200px] flex items-center justify-center">
          {loading ? (
            <div className="flex flex-col items-center space-y-4 py-16">
              <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
              <p className="text-[10px] text-primary font-black uppercase tracking-[4px]">Decrypting...</p>
            </div>
          ) : (
            <>
              {item.type === 'photo' && <img src={src} className="w-full h-auto" alt="" />}
              {item.type === 'video' && <video src={src} className="w-full h-auto" controls autoPlay playsInline />}
              {item.type === 'voice' && <audio src={src} className="w-full p-8" controls autoPlay />}
            </>
          )}
        </div>
        {!loading && (
          <div className="mt-6 flex justify-between items-center text-white/40 px-2 text-[10px] font-bold uppercase tracking-widest">
            <span>{item.name}</span>
            <span>{new Date(item.timestamp).toLocaleDateString()}</span>
          </div>
        )}
      </div>
    </motion.div>
  );
};

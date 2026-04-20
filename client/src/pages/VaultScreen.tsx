import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Image as ImageIcon, Video, FolderOpen, Trash2, X, RefreshCw } from 'lucide-react';
import { initDB } from '../lib/db';
import { supabase } from '../lib/supabase';
import { encryptMessage, decryptMessage, importPublicKey, deriveSharedSecret, encryptBuffer, decryptBuffer, base64ToBuffer, bufferToBase64 } from '../lib/crypto';

async function getKeys() {
  const db = await initDB();
  const identity = await db.get('identity', 'me');
  const partner = await db.get('partner', 'partner');
  if (!identity || !partner) return null;
  const pk = await importPublicKey(partner.publicKeyPem);
  const sk = await deriveSharedSecret(identity.privateKey, pk);
  return { db, identity, partner, sharedKey: sk };
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

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export const VaultScreen: React.FC<{ isLiteMode?: boolean }> = ({ isLiteMode }) => {
  const [items, setItems] = useState<any[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [activeCategory, setActiveCategory] = useState<'photo' | 'video' | null>(null);
  const [viewItem, setViewItem] = useState<any>(null);
  const [sharedKey, setSharedKey] = useState<CryptoKey | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── LOAD VAULT ──
  const loadVault = async () => {
    const db = await initDB();
    const local = (await db.getAll('vault')) || [];
    const filtered = local.filter((i: any) => i.type === 'photo' || i.type === 'video');
    setItems(filtered.sort((a: any, b: any) => b.timestamp - a.timestamp));

    const keys = await getKeys();
    if (!keys) return;
    setSharedKey(keys.sharedKey);

    setIsSyncing(true);
    setSyncProgress(0);
    try {
      const { data: cloud, error } = await supabase.from('vault').select('*').eq('owner_id', keys.identity.userId);
      if (error) { console.error('Vault fetch error:', error); return; }

      if (cloud && cloud.length > 0) {
        let added = false;
        for (let i = 0; i < cloud.length; i++) {
          setSyncProgress(Math.round(((i + 1) / cloud.length) * 100));
          const row = cloud[i];
          if (row.type !== 'photo' && row.type !== 'video') continue;
          const ex = await keys.db.get('vault', row.id);
          if (ex) continue;
          try {
            const dec = await decryptMessage(keys.sharedKey, row.encrypted_data, row.iv);
            await keys.db.put('vault', { id: row.id, name: row.name, type: row.type, data: dec, timestamp: row.timestamp, locked: true });
            added = true;
          } catch {}
        }
        if (added) {
          const updated = (await keys.db.getAll('vault')) || [];
          setItems(updated.filter((i: any) => i.type === 'photo' || i.type === 'video').sort((a: any, b: any) => b.timestamp - a.timestamp));
        }
      }
    } catch (err) { console.error('Vault sync error:', err); }
    finally { setIsSyncing(false); setSyncProgress(100); }
  };

  useEffect(() => {
    loadVault();
    const ch = supabase.channel('vault_live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'vault' }, () => loadVault())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // ── UPLOAD ──
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setIsUploading(true);
    setUploadStatus('Reading file...');

      try {
        let b64: string;
        if (file.type.startsWith('image/')) {
          b64 = await compressImage(file);
        } else {
          b64 = await readFileAsBase64(file);
        }

        const db = await initDB();
        const existing = await db.getAll('vault');
        if (existing?.find((i: any) => i.data === b64)) {
           setUploadStatus('Already in Vault ✓');
           setIsUploading(false);
           return;
        }

        const id = Date.now().toString();
      const type = file.type.startsWith('video') ? 'video' : 'photo';

      const db = await initDB();
      await db.put('vault', { id, name: file.name, type, data: b64, timestamp: Date.now(), locked: true });
      setUploadStatus('Saved ✓');
      await loadVault();

      const keys = await getKeys();
      if (keys) {
        setUploadStatus('Syncing...');
        let cloudData = b64;

        if (b64.length > 4 * 1024 * 1024) {
          setUploadStatus('Uploading to storage...');
          const raw = base64ToBuffer(b64.split(',')[1] || b64);
          const { encrypted, iv } = await encryptBuffer(keys.sharedKey, raw);
          const path = `vault/${keys.identity.userId}/${id}_${file.name}`;
          const { error: upErr } = await supabase.storage.from('vault').upload(path, new Blob([encrypted]), { contentType: 'application/octet-stream' });
          if (!upErr) cloudData = `storage://${path}::${bufferToBase64(iv.buffer as ArrayBuffer)}`;
        }

        const enc = await encryptMessage(keys.sharedKey, cloudData);
        const { error: insErr } = await supabase.from('vault').insert([
          { id: id + '_me', owner_id: keys.identity.userId, name: file.name, type, encrypted_data: enc.encrypted, iv: enc.iv, timestamp: Date.now() },
          { id: id + '_partner', owner_id: keys.partner.userId, name: file.name, type, encrypted_data: enc.encrypted, iv: enc.iv, timestamp: Date.now() },
        ]);
        if (insErr) { setUploadStatus('Sync failed: ' + insErr.message); alert('Cloud sync failed: ' + insErr.message); }
        else setUploadStatus('Synced ✓');
      }
    } catch (err: any) {
      alert('Upload failed: ' + err.message);
    } finally {
      setTimeout(() => { setIsUploading(false); setUploadStatus(''); }, 2000);
    }
  };

  // ── DELETE ──
  const deleteItem = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!confirm('Delete from vault?')) return;
    const db = await initDB();
    const item = await db.get('vault', id);
    if (item?.data?.startsWith?.('storage://')) {
      try { await supabase.storage.from('vault').remove([item.data.replace('storage://', '').split('::')[0]]); } catch {}
    }
    await db.delete('vault', id);
    const keys = await getKeys();
    if (keys) await supabase.from('vault').delete().eq('id', id);
    if (viewItem?.id === id) setViewItem(null);
    await loadVault();
  };

  const clearAll = async () => {
    if (!confirm('☢️ NUCLEAR RESET: Delete EVERY file?')) return;
    setIsSyncing(true);
    try {
      const db = await initDB();
      const all = (await db.getAll('vault')) || [];
      const keys = await getKeys();
      if (keys) {
        await supabase.from('vault').delete().eq('owner_id', keys.identity.userId);
        const paths = all.filter((i: any) => i.data?.startsWith?.('storage://')).map((i: any) => i.data.replace('storage://', '').split('::')[0]);
        if (paths.length > 0) await supabase.storage.from('vault').remove(paths);
      }
      await db.clear('vault');
      setItems([]);
    } catch {} finally { setIsSyncing(false); }
  };

  // ── FILTERED ──
  const shown = activeCategory ? items.filter((i: any) => i.type === activeCategory) : [];
  const photos = items.filter((i: any) => i.type === 'photo');
  const videos = items.filter((i: any) => i.type === 'video');

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-white">
      <div className="fixed inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent pointer-events-none" />

      {/* HEADER */}
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
              <button onClick={clearAll} className="bg-red-500/10 border border-red-500/20 text-red-500 text-[9px] py-2 px-3 rounded-full font-black uppercase tracking-widest active:scale-95">☢️</button>
            </div>
          )}
        </div>
        {isSyncing && (
          <div className="mt-3 h-[2px] w-full bg-white/5 rounded-full overflow-hidden">
            <motion.div initial={{ width: 0 }} animate={{ width: `${syncProgress}%` }} className="h-full bg-primary" />
          </div>
        )}
        {uploadStatus && <div className="mt-2 text-[10px] text-primary font-bold uppercase tracking-widest">{uploadStatus}</div>}
      </header>

      {/* CONTENT */}

      <main className="pt-40 pb-36 px-6">
        <AnimatePresence mode="wait">
          {!activeCategory ? (
            <motion.div key="folders" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} className="grid grid-cols-2 gap-5 will-change-transform">
              <button onClick={() => setActiveCategory('photo')} className="group relative h-48 rounded-3xl overflow-hidden bg-white/5 border border-white/10 active:scale-95 transition-all">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-indigo-600 opacity-0 group-hover:opacity-10 transition-opacity" />
                <div className="absolute inset-0 flex flex-col items-center justify-center space-y-3">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg">
                    <ImageIcon size={28} className="text-white" />
                  </div>
                  <p className="font-bold text-sm">Gallery</p>
                  <p className="text-[10px] text-white/30 font-black uppercase tracking-widest">{photos.length} Photos</p>
                </div>
              </button>

              <button onClick={() => setActiveCategory('video')} className="group relative h-48 rounded-3xl overflow-hidden bg-white/5 border border-white/10 active:scale-95 transition-all">
                <div className="absolute inset-0 bg-gradient-to-br from-purple-500 to-pink-600 opacity-0 group-hover:opacity-10 transition-opacity" />
                <div className="absolute inset-0 flex flex-col items-center justify-center space-y-3">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center shadow-lg">
                    <Video size={28} className="text-white" />
                  </div>
                  <p className="font-bold text-sm">Cinema</p>
                  <p className="text-[10px] text-white/30 font-black uppercase tracking-widest">{videos.length} Videos</p>
                </div>
              </button>
            </motion.div>
          ) : (
            <motion.div key="grid" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} className="will-change-transform">
              <button onClick={() => setActiveCategory(null)} className="flex items-center text-white/40 text-sm font-bold mb-6 hover:text-white transition-colors">
                <span className="mr-2">←</span> Back
              </button>
              {shown.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-white/20">
                  <FolderOpen size={48} className="mb-4 opacity-20" />
                  <p>Empty</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 pb-32">
                   {shown.map((item: any) => (
                     <VaultGridItem key={item.id} item={item} setViewItem={setViewItem} deleteItem={deleteItem} sharedKey={sharedKey} />
                   ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* LIGHTBOX */}
      <AnimatePresence>
        {viewItem && <VaultLightbox item={viewItem} onClose={() => setViewItem(null)} isLiteMode={isLiteMode} />}
      </AnimatePresence>

      {/* UPLOAD BUTTON */}
      <div className="fixed bottom-32 right-5 z-30">
        <button onClick={() => fileInputRef.current?.click()} disabled={isUploading} className="w-14 h-14 bg-gradient-to-br from-primary to-orange-500 rounded-2xl flex items-center justify-center text-white shadow-2xl shadow-primary/30 active:scale-95 transition-all">
          {isUploading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Plus size={24} strokeWidth={3} />}
        </button>
      </div>

      <input type="file" ref={fileInputRef} className="hidden" accept="image/*,video/*" onChange={handleUpload} />
    </div>
  );
};

// ── LIGHTBOX ──
const VaultLightbox = ({ item, onClose, isLiteMode }: { item: any; onClose: () => void; isLiteMode?: boolean }) => {
  const isStorage = typeof item.data === 'string' && item.data.startsWith('storage://');
  const [src, setSrc] = useState(isStorage ? '' : item.data);
  const [loading, setLoading] = useState(isStorage);

  useEffect(() => {
    if (!isStorage) return;
    let url = '';
    (async () => {
      try {
        const _keys = await getKeys();
        if (!_keys) return;
        const parts = item.data.replace('storage://', '').split('::');
        const { data, error } = await supabase.storage.from('vault').download(parts[0]);
        if (error) throw error;
        const iv = new Uint8Array(base64ToBuffer(parts[1]));
        const dec = await decryptBuffer(_keys.sharedKey, await data.arrayBuffer(), iv);
        url = URL.createObjectURL(new Blob([dec]));
        setSrc(url);
      } catch (e) { console.error('Lightbox error:', e); }
      finally { setLoading(false); }
    })();
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [item, isLiteMode]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-3xl flex items-center justify-center p-6 will-change-opacity">
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

// --- SUB-COMPONENTS ---

const VaultGridItem = React.memo(({ item, setViewItem, deleteItem, sharedKey }: any) => {
  const isStorage = item.data.startsWith('storage://');
  const [previewSrc, setPreviewSrc] = useState(isStorage ? '' : item.data);
  const [loading, setLoading] = useState(isStorage);

  useEffect(() => {
    if (!isStorage) return;
    let url = '';
    const loadPreview = async () => {
      try {
        const parts = item.data.replace('storage://', '').split('::');
        const path = parts[0];
        const ivB64 = parts[1];
        const { data, error } = await supabase.storage.from('vault').download(path);
        if (error) throw error;
        if (sharedKey) {
          const iv = new Uint8Array(base64ToBuffer(ivB64));
          const dec = await decryptBuffer(sharedKey, await data.arrayBuffer(), iv);
          url = URL.createObjectURL(new Blob([dec], { type: item.type === 'photo' ? 'image/jpeg' : 'video/mp4' }));
          setPreviewSrc(url);
        }
      } catch (e) {
        console.error('Vault preview fail:', e);
      } finally {
        setLoading(false);
      }
    };
    loadPreview();
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [item.id, sharedKey]); 

  return (
    <div onClick={() => setViewItem(item)} className="aspect-square bg-white/5 rounded-2xl border border-white/10 p-1 relative group cursor-pointer active:scale-95 transition-all overflow-hidden content-auto">
      {loading ? (
        <div className="w-full h-full flex items-center justify-center bg-zinc-900/50 rounded-xl">
           <div className="w-4 h-4 border border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {item.type === 'photo' && <img src={previewSrc} className="w-full h-full object-cover rounded-xl" alt="" loading="lazy" />}
          {item.type === 'video' && (
             <div className="w-full h-full relative rounded-xl overflow-hidden">
                {previewSrc ? (
                   <video src={previewSrc} className="w-full h-full object-cover" muted playsInline />
                ) : (
                   <div className="w-full h-full flex items-center justify-center bg-zinc-900">
                      <Video size={16} className="text-white/20" />
                   </div>
                )}
                <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                   <Video size={14} className="text-white/60" />
                </div>
             </div>
          )}
        </>
      )}
      <button onClick={(e) => deleteItem(item.id, e)} className="absolute top-2 right-2 p-1.5 bg-black/60 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity text-red-400">
        <Trash2 size={12} />
      </button>
    </div>
  );
});

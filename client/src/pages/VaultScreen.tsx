import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, Plus, Image as ImageIcon, Video, Mic, FolderOpen, Trash2, X } from 'lucide-react';
import { initDB } from '../lib/db';
import { supabase } from '../lib/supabase';
import { encryptMessage, decryptMessage, importPublicKey, deriveSharedSecret, encryptBuffer, base64ToBuffer, bufferToBase64, decryptBuffer } from '../lib/crypto';

export const VaultScreen: React.FC = () => {
  const [items, setItems] = useState<{id: string, name: string, type: string, data: string, timestamp: number}[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [activeCategory, setActiveCategory] = useState<'photo' | 'video' | 'voice' | 'secret' | null>(null);
  const [viewItem, setViewItem] = useState<{id: string, name: string, type: string, data: string, timestamp: number} | null>(null);
  
  const [pendingSecretFile, setPendingSecretFile] = useState<{ b64: string, name: string, type: string } | null>(null);
  const [secretPassword, setSecretPassword] = useState('');
  const [unlockPrompt, setUnlockPrompt] = useState<any | null>(null);
  const [unlockPassword, setUnlockPassword] = useState('');
  const [secretFilter, setSecretFilter] = useState<'all' | 'me' | 'partner'>('all');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const secretFileInputRef = useRef<HTMLInputElement>(null);

  // 1. Load Vault & Sync
  const loadVault = async () => {
    const db = await initDB();
    const identity = await db.get('identity', 'me');
    const partner = await db.get('partner', 'partner');
    
    if (identity && partner) {
      console.log("Vault Sync Logic: Starting sync for", identity.userId);
      setIsSyncing(true);
      setSyncProgress(0);
      try {
        const pk = await importPublicKey(partner.publicKeyPem);
        const sk = await deriveSharedSecret(identity.privateKey, pk);
        
        // Fetch all items owned by me in cloud
        const { data: cloud, error: fetchError } = await supabase.from('vault').select('*').eq('owner_id', identity.userId);
        if (fetchError) {
          console.error("Vault Sync: FETCH FAILED!", fetchError.message, fetchError.code, fetchError.details);
          throw fetchError;
        }

        console.log(`Vault Sync: Found ${cloud?.length || 0} cloud items for user ${identity.userId}`);
        if (cloud && cloud.length > 0) {
          for (let i = 0; i < cloud.length; i++) {
            setSyncProgress(Math.round(((i + 1) / cloud.length) * 100));
            const ci = cloud[i];
            const ex = await db.get('vault', ci.id);
            if (!ex) {
              try {
                const dec = await decryptMessage(sk, ci.encrypted_data, ci.iv);
                await db.put('vault', {
                  id: ci.id,
                  name: ci.name,
                  type: ci.type,
                  data: dec,
                  timestamp: ci.timestamp,
                  locked: true
                });
                console.log("Vault Sync: Successfully synced item", ci.id);
              } catch (decErr) {
                console.warn("Vault Sync: Decryption failed for item " + ci.id);
              }
            }
          }
        }
      } catch (err) {
        console.error("Vault Sync: Fatal error", err);
      } finally {
        setIsSyncing(false);
        setSyncProgress(100);
      }
    }
    const vItems = await db.getAll('vault') || [];
    setItems(vItems.sort((a, b) => b.timestamp - a.timestamp));
  };

  useEffect(() => {
    loadVault();
    
    const channel = supabase.channel('vault_sync')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'vault' }, (payload) => {
          console.log("Vault Realtime: New item detected", payload);
          loadVault(); 
      })
      .subscribe((status) => {
         console.log("Vault Realtime: Status is", status);
      });
      
    return () => { supabase.removeChannel(channel); };
  }, []);

  // 2. Upload Handlers
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      let b64 = '';
      if (file.type.startsWith('image/')) {
         b64 = await new Promise<string>((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
               const canvas = document.createElement('canvas');
               const MAX_SIZE = 1200;
               let { width, height } = img;
               if (width > height && width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; }
               else if (height > MAX_SIZE) { width *= MAX_SIZE / height; height = MAX_SIZE; }
               canvas.width = width; canvas.height = height;
               const ctx = canvas.getContext('2d');
               ctx?.drawImage(img, 0, 0, width, height);
               resolve(canvas.toDataURL('image/jpeg', 0.8));
            };
            img.onerror = reject;
            img.src = URL.createObjectURL(file);
         });
      } else {
         b64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
         });
      }

      if (e.target === secretFileInputRef.current) {
         setPendingSecretFile({ b64, name: file.name, type: file.type.startsWith('video') ? 'video' : 'photo' });
         setIsUploading(false);
         return;
      }

      const newItem = {
        id: Date.now().toString(),
        name: file.name,
        type: file.type.startsWith('video') ? 'video' : file.type.startsWith('audio') ? 'voice' : 'photo',
        data: b64,
        timestamp: Date.now()
      };

      const db = await initDB();
      await db.put('vault', newItem);
      
      const identity = await db.get('identity', 'me');
      const partner = await db.get('partner', 'partner');
      if (identity && partner) {
         try {
             const pk = await importPublicKey(partner.publicKeyPem);
             const sharedKey = await deriveSharedSecret(identity.privateKey, pk);
             
             let dbData = b64;
             if (file.type.startsWith('video')) {
                 const arrayBuffer = await new Promise<ArrayBuffer>((res, rej) => {
                     const fr = new FileReader(); fr.onload = () => res(fr.result as ArrayBuffer); fr.onerror = rej; fr.readAsArrayBuffer(file);
                 });
                 const { encrypted, iv } = await encryptBuffer(sharedKey, arrayBuffer);
                 const storagePath = `vault/${identity.userId}/${newItem.id}_${file.name}`;
                 const { error: uploadErr } = await supabase.storage.from('vault').upload(storagePath, new Blob([encrypted], { type: 'application/octet-stream' }));
                 if (uploadErr) throw uploadErr;
                 dbData = `storage://${storagePath}::${bufferToBase64(iv.buffer as any)}`;
             }

             const enc = await encryptMessage(sharedKey, dbData);
              const { error: vaultInsertErr } = await supabase.from('vault').insert([
                { id: newItem.id + "_me", owner_id: identity.userId, name: newItem.name, type: newItem.type, encrypted_data: enc.encrypted, iv: enc.iv, timestamp: newItem.timestamp },
                { id: newItem.id + "_partner", owner_id: partner.userId, name: newItem.name, type: newItem.type, encrypted_data: enc.encrypted, iv: enc.iv, timestamp: newItem.timestamp }
              ]);
              if (vaultInsertErr) {
                console.error('Vault Cloud Insert Error:', vaultInsertErr);
                alert('Cloud sync error: ' + vaultInsertErr.message);
              } else {
                console.log('Vault: File synced to cloud for both partners!');
              }
          } catch(e) { console.error('Cloud Sync Error:', e); alert('Cloud sync exception: ' + (e as Error).message); }
      }
      await loadVault();
    } catch(e) {
      console.error(e);
      alert('Failed to save to Vault.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (secretFileInputRef.current) secretFileInputRef.current.value = '';
    }
  };

  const handleSaveSecretDrop = async () => {
     if (!pendingSecretFile || !secretPassword) return;
     setIsUploading(true);
     setPendingSecretFile(null);

     try {
       const id = Date.now().toString();
       let targetMedia = pendingSecretFile.b64;
       
       const db = await initDB();
       const identity = await db.get('identity', 'me');
       const partner = await db.get('partner', 'partner');

       if (pendingSecretFile.type === 'video' && identity && partner) {
           try {
               const pk = await importPublicKey(partner.publicKeyPem);
               const sharedKey = await deriveSharedSecret(identity.privateKey, pk);
               const arrayBuffer = base64ToBuffer(pendingSecretFile.b64.split(',')[1]);
               const { encrypted, iv } = await encryptBuffer(sharedKey, arrayBuffer);
               const storagePath = `vault/${identity.userId}/${id}_secret.mp4`;
               await supabase.storage.from('vault').upload(storagePath, new Blob([encrypted], { type: 'application/octet-stream' }));
               targetMedia = `storage://${storagePath}::${bufferToBase64(iv.buffer as any)}`;
           } catch (e) {
               console.error("Storage error", e);
           }
       }

       const secretData = JSON.stringify({ password: secretPassword, mediaData: targetMedia, actualType: pendingSecretFile.type });
       const newItem = {
          id,
          name: pendingSecretFile.name,
          type: 'secret',
          data: secretData,
          timestamp: Date.now()
       };
       await db.put('vault', newItem);
       
       if (identity && partner) {
          try {
              const pk = await importPublicKey(partner.publicKeyPem);
              const sharedKey = await deriveSharedSecret(identity.privateKey, pk);
              const enc = await encryptMessage(sharedKey, secretData);
              const { error: insErr } = await supabase.from('vault').insert([
                { id: id + "_me", owner_id: identity.userId, name: newItem.name, type: 'secret', encrypted_data: enc.encrypted, iv: enc.iv, timestamp: newItem.timestamp },
                { id: id + "_partner", owner_id: partner.userId, name: newItem.name, type: 'secret', encrypted_data: enc.encrypted, iv: enc.iv, timestamp: newItem.timestamp }
              ]);
              if (insErr) {
                 console.error("Cloud Secret Drop Failed", insErr);
                 alert("Sync failed: " + insErr.message);
              }
          } catch(e) { console.error('Drop Ins:', e) }
       }
       await loadVault();
     } catch (err) {
       console.error(err);
       alert('Failed to save Secret Drop');
     } finally {
       setIsUploading(false);
       setSecretPassword('');
     }
  };

  // 3. Action Handlers
  const deleteItem = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (confirm('Permanently delete from vault?')) {
      const db = await initDB();
      const item = await db.get('vault', id);
      if (item && typeof item.data === 'string' && item.data.startsWith('storage://')) {
          try {
             const path = item.data.replace('storage://', '').split('::')[0];
             await supabase.storage.from('vault').remove([path]);
          } catch(e) { console.error('Storage cleanup failed', e); }
      }
      await db.delete('vault', id);
      const identity = await db.get('identity', 'me');
      if (identity) {
         await supabase.from('vault').delete().eq('id', id).eq('owner_id', identity.userId);
      }
      await loadVault();
      if (viewItem && viewItem.id === id) setViewItem(null);
    }
  };

  const clearAllVault = async () => {
    if (!confirm('☢️ NUCLEAR RESET: Are you sure? This will delete EVERY file in this vault across all your devices.')) return;
    setIsSyncing(true);
    try {
       const db = await initDB();
       const allItems = await db.getAll('vault');
       const identity = await db.get('identity', 'me');
       if (identity) {
          await supabase.from('vault').delete().eq('owner_id', identity.userId);
          const sps = allItems.filter(i => typeof i.data === 'string' && i.data.startsWith('storage://')).map(i => i.data.replace('storage://', '').split('::')[0]);
          if (sps.length > 0) await supabase.storage.from('vault').remove(sps);
       }
       await db.clear('vault');
       alert('Vault Wiped.');
       await loadVault();
    } catch(e) { console.error(e); } finally { setIsSyncing(false); }
  };

  // 4. Content Prep
  const filteredItems = activeCategory 
    ? items.filter(i => {
        if (i.type !== activeCategory) return false;
        if (activeCategory === 'secret') {
           if (secretFilter === 'me') return i.id.endsWith('_me');
           if (secretFilter === 'partner') return i.id.endsWith('_partner');
        }
        return true;
      })
    : [];

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-white selection:bg-primary/30">
      <div className="fixed inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent pointer-events-none" />
      
      {/* ── HEADER ── */}
      <header className="fixed top-0 w-full z-40 bg-[#0a0a0c]/80 backdrop-blur-xl border-b border-white/5 pt-12 pb-6 px-8">
        <div className="flex justify-between items-end">
          <div>
            <h1 className="text-3xl font-black tracking-tighter bg-gradient-to-br from-white to-white/40 bg-clip-text text-transparent">VAULT</h1>
            <p className="text-[10px] text-white/30 uppercase tracking-[3px] font-black mt-1">Encrypted Memories</p>
          </div>
          <div className="text-right">
             <div className="flex space-x-2">
                {!activeCategory && (
                   <>
                      <button onClick={clearAllVault} className="bg-red-500/10 border border-red-500/20 text-red-500 text-[10px] py-2 px-4 rounded-full font-black uppercase tracking-widest active:scale-95 transition-all">Nuclear Clear</button>
                      <button onClick={loadVault} className="bg-white/5 border border-white/10 text-white/40 text-[10px] py-2 px-4 rounded-full font-black uppercase tracking-widest active:scale-95 transition-all">
                         {isSyncing ? `Syncing ${syncProgress}%` : 'Sync Cloud'}
                      </button>
                   </>
                )}
             </div>
          </div>
        </div>

        {isSyncing && (
           <div className="mt-4 h-[2px] w-full bg-white/5 rounded-full overflow-hidden">
              <motion.div initial={{ width: 0 }} animate={{ width: `${syncProgress}%` }} className="h-full bg-primary shadow-[0_0_10px_rgba(255,107,0,0.5)]" />
           </div>
        )}
      </header>

      {/* ── MAIN CONTENT ── */}
      <main className="pt-44 pb-32 px-6">
        <AnimatePresence mode="wait">
          {!activeCategory ? (
            <motion.div key="folders" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} className="grid grid-cols-2 gap-4">
              {[
                { id: 'photo', label: 'Gallery', icon: ImageIcon, color: 'from-blue-500 to-indigo-600', count: items.filter(i => i.type === 'photo').length },
                { id: 'video', label: 'Cinema', icon: Video, color: 'from-purple-500 to-pink-600', count: items.filter(i => i.type === 'video').length },
                { id: 'voice', label: 'Voices', icon: Mic, color: 'from-orange-500 to-red-600', count: items.filter(i => i.type === 'voice').length },
                { id: 'secret', label: 'Secrets', icon: Lock, color: 'from-emerald-500 to-teal-600', count: items.filter(i => i.type === 'secret').length },
              ].map(folder => (
                <button 
                  key={folder.id} onClick={() => setActiveCategory(folder.id as any)}
                  className="group relative h-44 rounded-3xl overflow-hidden bg-white/5 border border-white/10 active:scale-95 transition-all"
                >
                  <div className={`absolute inset-0 bg-gradient-to-br ${folder.color} opacity-0 group-hover:opacity-10 transition-opacity`} />
                  <div className="absolute inset-0 flex flex-col items-center justify-center space-y-3">
                     <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${folder.color} flex items-center justify-center shadow-lg`}>
                        <folder.icon size={24} className="text-white" />
                     </div>
                     <div className="text-center">
                        <p className="font-bold text-sm tracking-tight">{folder.label}</p>
                        <p className="text-[10px] text-white/30 font-black uppercase tracking-widest">{folder.count} Items</p>
                     </div>
                  </div>
                </button>
              ))}
            </motion.div>
          ) : (
            <motion.div key="grid" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}>
               <button onClick={() => setActiveCategory(null)} className="flex items-center text-white/40 text-sm font-bold mb-6 hover:text-white transition-colors">
                  <span className="mr-2">←</span> Back to Folders
               </button>

               {activeCategory === 'secret' && (
                  <div className="flex bg-white/5 p-1 rounded-2xl mb-8 border border-white/10">
                     {['all', 'me', 'partner'].map(f => (
                        <button 
                           key={f} onClick={() => setSecretFilter(f as any)} 
                           className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${secretFilter === f ? 'bg-white text-black shadow-lg' : 'text-white/40'}`}
                        >
                           {f === 'me' ? 'From Me' : f === 'partner' ? 'By Her' : 'All'}
                        </button>
                     ))}
                  </div>
               )}

               {filteredItems.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-white/20">
                     <FolderOpen size={48} className="mb-4 opacity-20" />
                     <p>Folder Empty</p>
                  </div>
               ) : (
                  <div className="grid grid-cols-3 gap-3">
                    {filteredItems.map(item => (
                      <div 
                        key={item.id} onClick={() => { if (item.type === 'secret') setUnlockPrompt(item); else setViewItem(item); }}
                        className="aspect-square bg-white/5 rounded-2xl border border-white/10 p-1 relative group cursor-pointer active:scale-95 transition-all overflow-hidden"
                      >
                         {item.type === 'photo' && <img src={item.data} className="w-full h-full object-cover rounded-xl" />}
                         {item.type === 'video' && <div className="w-full h-full flex items-center justify-center bg-zinc-900 rounded-xl"><Video size={20} className="text-white/20" /></div>}
                         {item.type === 'voice' && <div className="w-full h-full flex items-center justify-center bg-zinc-900 rounded-xl"><Mic size={20} className="text-white/20" /></div>}
                         {item.type === 'secret' && <div className="w-full h-full flex items-center justify-center bg-red-500/10 rounded-xl"><Lock size={20} className="text-red-500/40" /></div>}
                         <button onClick={(e) => deleteItem(item.id, e)} className="absolute top-2 right-2 p-1.5 bg-black/60 backdrop-blur-md rounded-lg opacity-0 group-hover:opacity-100 transition-opacity text-red-400">
                            <Trash2 size={12} />
                         </button>
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
        {/* Lightbox */}
        {viewItem && (
          <Lightbox 
            item={viewItem} 
            onClose={() => setViewItem(null)} 
          />
        )}

        {/* Secret Drop Setup */}
        {pendingSecretFile && (
           <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-2xl flex items-center justify-center p-8">
              <div className="bg-zinc-900/50 border border-white/10 p-8 rounded-[40px] w-full max-w-sm text-center">
                 <div className="w-16 h-16 bg-red-600 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-2xl shadow-red-600/30">
                    <Lock size={32} className="text-white" />
                 </div>
                 <h2 className="text-xl font-black mb-2 tracking-tight">SET SECRET KEY</h2>
                 <p className="text-white/40 text-[10px] uppercase font-bold tracking-[2px] mb-8">This file requires a password to unlock.</p>
                 <input 
                    type="password" placeholder="Enter Secret Password" value={secretPassword} onChange={(e) => setSecretPassword(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 outline-none focus:border-red-600/50 transition-colors text-center font-bold tracking-[4px]"
                 />
                 <div className="mt-8 flex space-x-3">
                    <button onClick={() => setPendingSecretFile(null)} className="flex-1 py-4 text-white/40 font-black uppercase tracking-widest text-[10px]">Cancel</button>
                    <button onClick={handleSaveSecretDrop} className="flex-1 bg-red-600 py-4 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl shadow-red-600/20 active:scale-95 transition-all">Drop It</button>
                 </div>
              </div>
           </motion.div>
        )}

        {/* Unlock Prompt */}
        {unlockPrompt && (
           <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-2xl flex items-center justify-center p-8">
              <div className="bg-zinc-900/50 border border-white/10 p-8 rounded-[40px] w-full max-w-sm text-center">
                 <div className="w-16 h-16 bg-primary rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-2xl shadow-primary/30">
                    <Lock size={32} className="text-white" />
                 </div>
                 <h2 className="text-xl font-black mb-2 tracking-tight">LOCKED DROP</h2>
                 <p className="text-white/40 text-[10px] uppercase font-bold tracking-[2px] mb-8">Enter the secret key to view.</p>
                 <input 
                    type="password" placeholder="••••••••" value={unlockPassword} onChange={(e) => setUnlockPassword(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 outline-none focus:border-primary/50 transition-colors text-center font-bold tracking-[6px]"
                 />
                 <div className="mt-8 flex space-x-3">
                    <button onClick={() => { setUnlockPrompt(null); setUnlockPassword(''); }} className="flex-1 py-4 text-white/40 font-black uppercase tracking-widest text-[10px]">Back</button>
                    <button 
                       onClick={() => {
                          try {
                             const dec = JSON.parse(unlockPrompt.data);
                             if (dec.password === unlockPassword.trim()) {
                                setViewItem({ ...unlockPrompt, data: dec.mediaData, type: dec.actualType });
                                setUnlockPrompt(null); setUnlockPassword('');
                             } else { alert('Wrong Key!'); setUnlockPassword(''); }
                          } catch { alert('Corrupted'); }
                       }}
                       className="flex-1 bg-primary py-4 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl shadow-primary/20 active:scale-95 transition-all"
                    >
                       Unlock
                    </button>
                 </div>
              </div>
           </motion.div>
        )}
      </AnimatePresence>

      {/* ── FLOATING BUTTONS ── */}
      <div className="fixed bottom-32 right-6 flex flex-col space-y-4 z-40">
          <button 
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="w-14 h-14 bg-gradient-to-br from-primary to-orange-500 rounded-2xl flex items-center justify-center text-white shadow-2xl shadow-primary/30 active:scale-95 transition-all"
          >
            {isUploading && !pendingSecretFile ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Plus size={24} strokeWidth={3} />}
          </button>
          <button 
            onClick={() => secretFileInputRef.current?.click()}
            disabled={isUploading}
            className="w-14 h-14 bg-red-600 rounded-2xl flex items-center justify-center text-white shadow-2xl shadow-red-500/40 active:scale-95 transition-all"
          >
             <Lock size={24} strokeWidth={3} />
          </button>
      </div>

      <input type="file" ref={fileInputRef} className="hidden" accept="image/*,video/*,audio/*" onChange={handleFileUpload} />
      <input type="file" ref={secretFileInputRef} className="hidden" accept="image/*,video/*" onChange={handleFileUpload} />
    </div>
  );
};

// Optimization: Lightbox component with streaming decryption for large files
const Lightbox = ({ item, onClose }: { item: any, onClose: () => void }) => {
   const [src, setSrc] = useState(item.data.startsWith('storage://') ? '' : item.data);
   const [loading, setLoading] = useState(item.data.startsWith('storage://'));

   useEffect(() => {
     if (item.data.startsWith('storage://')) {
       const load = async () => {
         try {
           const db = await initDB();
           const identity = await db.get('identity', 'me');
           const partner = await db.get('partner', 'partner');
           if (identity && partner) {
              const pk = await importPublicKey(partner.publicKeyPem);
              const sk = await deriveSharedSecret(identity.privateKey, pk);
              
              const parts = item.data.replace('storage://', '').split('::');
              const path = parts[0];
              const ivStr = parts[1];

              const { data, error } = await supabase.storage.from('vault').download(path);
              if (error) throw error;

              const iv = new Uint8Array(base64ToBuffer(ivStr));
              const dec = await decryptBuffer(sk, await data.arrayBuffer(), iv);
              const url = URL.createObjectURL(new Blob([dec]));
              setSrc(url);
           }
         } catch (e) {
           console.error('Lightbox load error', e);
         } finally {
           setLoading(false);
         }
       };
       load();
     }
   }, [item]);

   return (
     <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-3xl flex items-center justify-center p-6">
       <button onClick={onClose} className="absolute top-8 right-8 w-12 h-12 bg-white/10 rounded-full flex items-center justify-center text-white active:scale-95"><X size={24} /></button>
       <div className="w-full max-w-lg">
           <div className="rounded-3xl overflow-hidden shadow-2xl border border-white/10 bg-zinc-900/50 min-h-[300px] flex items-center justify-center">
              {loading ? (
                 <div className="flex flex-col items-center space-y-4">
                    <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
                    <p className="text-[10px] text-primary font-black uppercase tracking-[4px]">Decrypting Magic...</p>
                 </div>
              ) : (
                <>
                  {item.type === 'photo' && <img src={src} className="w-full h-auto" />}
                  {item.type === 'video' && <video src={src} className="w-full h-auto" controls autoPlay />}
                  {item.type === 'voice' && <audio src={src} className="w-full p-8" controls autoPlay />}
                </>
              )}
           </div>
           {!loading && (
              <div className="mt-8 flex justify-between items-center text-white/50 px-2 text-xs font-bold uppercase tracking-widest">
                 <span>{item.name}</span>
                 <span>{new Date(item.timestamp).toLocaleDateString()}</span>
              </div>
           )}
       </div>
     </motion.div>
   );
};

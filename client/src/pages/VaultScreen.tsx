
import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, Plus, Image as ImageIcon, Video, Mic, FolderOpen, Trash2, Download, X } from 'lucide-react';
import { initDB } from '../lib/db';
import { supabase } from '../lib/supabase';
import { encryptMessage, decryptMessage, importPublicKey, deriveSharedSecret } from '../lib/crypto';

export const VaultScreen: React.FC = () => {
  const [items, setItems] = useState<{id: string, name: string, type: string, data: string, timestamp: number}[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [activeCategory, setActiveCategory] = useState<'photo' | 'video' | 'voice' | 'secret' | null>(null);
  const [viewItem, setViewItem] = useState<{id: string, name: string, type: string, data: string, timestamp: number} | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const secretFileInputRef = useRef<HTMLInputElement>(null);
  const [pendingSecretFile, setPendingSecretFile] = useState<{ b64: string, name: string, type: string } | null>(null);
  const [secretPassword, setSecretPassword] = useState('');
  const [unlockPrompt, setUnlockPrompt] = useState<any | null>(null);
  const [unlockPassword, setUnlockPassword] = useState('');

  const loadVault = async () => {
    const db = await initDB();
    const identity = await db.get('identity', 'me');
    const partner = await db.get('partner', 'partner');
    
    if (identity && partner) {
       try {
           const importedPartnerKey = await importPublicKey(partner.publicKeyPem);
           const sharedKey = await deriveSharedSecret(identity.privateKey, importedPartnerKey);

           const { data: cloudItems } = await supabase.from('vault').select('*').eq('owner_id', identity.userId);
           if (cloudItems) {
              for (const ci of cloudItems) {
                 const existing = await db.get('vault', ci.id);
                 if (!existing) {
                    try {
                       const dec = await decryptMessage(sharedKey, ci.encrypted_data, ci.iv);
                       await db.put('vault', {
                          id: ci.id,
                          name: ci.name,
                          type: ci.type,
                          data: dec,
                          timestamp: ci.timestamp,
                          locked: true
                       });
                    } catch { /* ignored */ }
                 }
              }
           }
       } catch (e: unknown) { console.error('Vault sync error', e); }
    }

    const vaultItems = await db.getAll('vault') || [];
    setItems(vaultItems.sort((a, b) => b.timestamp - a.timestamp));
  };

  useEffect(() => {
    loadVault();
    
    // Listen for Realtime Secret Drops and Uploads from partner
    const channel = supabase.channel('vault_sync')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'vault' }, () => {
          loadVault(); // trigger immediate local sync and render
      })
      .subscribe();
      
    return () => { supabase.removeChannel(channel); };
  }, []);

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
        timestamp: Date.now(),
        locked: true
      };

      const db = await initDB();
      await db.put('vault', newItem);
      
      const identity = await db.get('identity', 'me');
      const partner = await db.get('partner', 'partner');
      if (identity && partner) {
         try {
             const pk = await importPublicKey(partner.publicKeyPem);
             const sharedKey = await deriveSharedSecret(identity.privateKey, pk);
             const enc = await encryptMessage(sharedKey, b64);
             await supabase.from('vault').insert([
               {
                 id: newItem.id + "_me",
                 owner_id: identity.userId,
                 name: newItem.name,
                 type: newItem.type,
                 encrypted_data: enc.encrypted,
                 iv: enc.iv,
                 timestamp: newItem.timestamp
               },
               {
                 id: newItem.id + "_partner",
                 owner_id: partner.userId,
                 name: newItem.name,
                 type: newItem.type,
                 encrypted_data: enc.encrypted,
                 iv: enc.iv,
                 timestamp: newItem.timestamp
               }
             ]);
         } catch { /* ignored */ }
      }
      
      await loadVault();

    } catch {
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
     setPendingSecretFile(null); // Close the prompt immediately

     try {
       const newItem = {
         id: Date.now().toString(),
         name: pendingSecretFile.name,
         type: 'secret',
         data: JSON.stringify({ password: secretPassword, mediaData: pendingSecretFile.b64, actualType: pendingSecretFile.type }),
         timestamp: Date.now(),
         locked: true
       };
       
       const db = await initDB();
       await db.put('vault', newItem);
       
       const identity = await db.get('identity', 'me');
       const partner = await db.get('partner', 'partner');
       if (identity && partner) {
          try {
              const pk = await importPublicKey(partner.publicKeyPem);
              const sharedKey = await deriveSharedSecret(identity.privateKey, pk);
              const enc = await encryptMessage(sharedKey, newItem.data);
              await supabase.from('vault').insert([
                { id: newItem.id + "_me", owner_id: identity.userId, name: newItem.name, type: newItem.type, encrypted_data: enc.encrypted, iv: enc.iv, timestamp: newItem.timestamp },
                { id: newItem.id + "_partner", owner_id: partner.userId, name: newItem.name, type: newItem.type, encrypted_data: enc.encrypted, iv: enc.iv, timestamp: newItem.timestamp }
              ]);
          } catch { /* ignored */ }
       }
       await loadVault();
     } catch {
       alert('Failed to save Secret Drop');
     } finally {
       setIsUploading(false);
       setSecretPassword('');
     }
  };

  const handleUnlockDrop = () => {
     if (!unlockPrompt) return;
     try {
       const dec = JSON.parse(unlockPrompt.data);
       if (dec.password === unlockPassword.trim()) {
           setViewItem({ ...unlockPrompt, data: dec.mediaData, type: dec.actualType });
           setUnlockPrompt(null);
           setUnlockPassword('');
       } else {
           alert('Incorrect Password!');
           setUnlockPassword('');
       }
     } catch {
         alert('Corrupted drop.');
     }
  };

  const deleteItem = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (confirm('Permanently delete from vault?')) {
      const db = await initDB();
      await db.delete('vault', id);
      
      const identity = await db.get('identity', 'me');
      if (identity) {
         await supabase.from('vault').delete().eq('id', id).eq('owner_id', identity.userId);
      }
      
      await loadVault();
      if (viewItem && viewItem.id === id) setViewItem(null);
    }
  };

  const downloadItem = (item: {data: string, type: string}, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const a = document.createElement('a');
    a.href = item.data;
    a.download = `secure_${item.type}_${Date.now()}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const filteredItems = activeCategory ? items.filter(i => i.type === activeCategory) : [];

  return (
    <div className="flex flex-col h-full bg-[#0a0a0c] no-scrollbar overflow-y-auto w-full">
      <div className="pt-20 px-6 pb-6 text-center">
        <h1 className="text-2xl font-semibold text-white mb-1">
           {activeCategory ? (activeCategory === 'photo' ? 'Photos' : activeCategory === 'video' ? 'Videos' : activeCategory === 'secret' ? 'Secret Drops' : 'Voice Notes') : 'Memory Vault 🔒'}
        </h1>
        <p className="text-sm text-white/40">{activeCategory ? 'Your private collection' : 'Locally Encrypted & Secure'}</p>
      </div>

      <AnimatePresence mode="wait">
        {!activeCategory ? (
          <motion.div 
            key="folders"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="px-6 space-y-4"
          >
            {[
              { id: 'photo', icon: ImageIcon, label: 'Photos',      count: items.filter(i => i.type === 'photo').length, color: 'text-blue-400', bg: 'bg-blue-500/10' },
              { id: 'video', icon: Video,     label: 'Videos',      count: items.filter(i => i.type === 'video').length, color: 'text-amber-400', bg: 'bg-amber-500/10' },
              { id: 'voice', icon: Mic,       label: 'Voice Notes', count: items.filter(i => i.type === 'voice').length, color: 'text-pink-400', bg: 'bg-pink-500/10' },
              { id: 'secret', icon: Lock,     label: 'Secret Drops',count: items.filter(i => i.type === 'secret').length, color: 'text-red-400', bg: 'bg-red-500/20' },
            ].map((folder) => (
              <button 
                key={folder.id}
                onClick={() => setActiveCategory(folder.id as any)}
                className="w-full flex items-center p-5 rounded-[28px] bg-white/5 border border-white/10 hover:bg-white/[0.08] transition-all active:scale-[0.98] group"
              >
                <div className={`w-14 h-14 rounded-2xl ${folder.bg} flex items-center justify-center ${folder.color} mr-4 group-hover:scale-110 transition-transform`}>
                  <folder.icon size={28} />
                </div>
                <div className="flex-1 text-left">
                  <h3 className="text-white font-bold text-lg">{folder.label}</h3>
                  <p className="text-white/40 text-sm font-medium">{folder.count} items stored</p>
                </div>
                <span className="text-white/20 text-2xl font-light pr-2">›</span>
              </button>
            ))}

            {items.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-center mt-4">
                <div className="w-20 h-20 rounded-[28px] bg-white/5 border border-white/10 flex items-center justify-center mb-5">
                  <FolderOpen size={36} className="text-white/20" />
                </div>
                <h3 className="text-white/50 font-semibold mb-2">Vault is empty</h3>
                <p className="text-white/25 text-[13px] max-w-xs leading-relaxed">
                  Tap the button below to add your first secure file or save them directly from the chat.
                </p>
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div 
            key="grid"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="px-6 pb-32"
          >
            <button 
              onClick={() => setActiveCategory(null)}
              className="flex items-center text-white/40 text-sm font-bold mb-6 hover:text-white transition-colors"
            >
               <span className="mr-2">←</span> Back to Folders
            </button>

            {filteredItems.length === 0 ? (
               <div className="flex flex-col items-center justify-center py-20 text-white/20 text-center">
                  <FolderOpen size={48} className="mb-4 opacity-20" />
                  <p>No {activeCategory}s yet</p>
               </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                {filteredItems.map(item => (
                  <motion.div
                    key={item.id}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => {
                        if (item.type === 'secret') setUnlockPrompt(item);
                        else setViewItem(item);
                    }}
                    className="relative aspect-square rounded-[24px] overflow-hidden bg-white/5 border border-white/10 group cursor-pointer shadow-lg"
                  >
                    {item.type === 'secret' ? (
                      <div className="w-full h-full flex items-center justify-center bg-red-500/10"><Lock size={36} className="text-red-500/50" /></div>
                    ) : item.type === 'photo' ? (
                      <img src={item.data} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" alt={item.name} />
                    ) : item.type === 'video' ? (
                      <video src={item.data} className="w-full h-full object-cover opacity-80" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-white/5"><Mic size={36} className="text-pink-500/50" /></div>
                    )}
                    
                    <div className="absolute top-2 right-2 flex space-x-2">
                       <div className="w-7 h-7 bg-black/50 backdrop-blur-md rounded-full flex items-center justify-center">
                         <Lock size={12} className="text-white/80" />
                       </div>
                    </div>

                    <div className="absolute top-2 left-2 flex space-x-2 opacity-0 group-hover:opacity-100 transition-opacity">
                       <button onClick={(e) => deleteItem(item.id, e)} className="w-7 h-7 bg-red-500/80 backdrop-blur-md rounded-full flex items-center justify-center hover:bg-red-500">
                          <Trash2 size={12} className="text-white" />
                       </button>
                       <button onClick={(e) => downloadItem(item, e)} className="w-7 h-7 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center hover:bg-white/40">
                          <Download size={12} className="text-white" />
                       </button>
                    </div>

                    <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black to-transparent">
                      <p className="text-[11px] font-medium text-white/90 truncate drop-shadow-md">{item.name}</p>
                      <p className="text-[9px] text-white/50">{new Date(item.timestamp).toLocaleDateString()}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <input type="file" ref={fileInputRef} className="hidden" accept="image/*,video/*,audio/*" onChange={handleFileUpload} />
      <input type="file" ref={secretFileInputRef} className="hidden" accept="image/*,video/*" onChange={handleFileUpload} />

      <div className="fixed bottom-24 left-1/2 -translate-x-1/2 flex space-x-2 z-30">
          <button 
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="flex items-center space-x-2 px-6 py-3.5 bg-gradient-to-br from-primary to-orange-500 rounded-full text-white text-[15px] font-bold shadow-2xl shadow-primary/30 active:scale-95 transition-all"
          >
            {isUploading && !pendingSecretFile ? (
               <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
               <>
                 <Plus size={18} strokeWidth={2.5} />
                 <span>Upload</span>
               </>
            )}
          </button>
          
          <button 
            onClick={() => secretFileInputRef.current?.click()}
            disabled={isUploading}
            className="flex items-center space-x-2 px-6 py-3.5 bg-red-600 rounded-full text-white text-[15px] font-bold shadow-2xl shadow-red-500/30 active:scale-95 transition-all"
          >
             <Lock size={18} strokeWidth={2.5} />
             <span>Secret Drop</span>
          </button>
      </div>

      {/* Secret Password Setup Prompt */}
      {pendingSecretFile && (
         <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-md flex flex-col justify-center items-center px-6">
            <h2 className="text-white font-bold text-2xl mb-2 text-center text-red-500">Lock This Drop</h2>
            <p className="text-white/60 text-center mb-8 text-sm max-w-sm">Determine a password. Your partner will only be able to open this media if they guess or know the password.</p>
            
            <input 
               type="text" 
               placeholder="Enter Secret Key Password..." 
               value={secretPassword}
               onChange={(e) => setSecretPassword(e.target.value)}
               className="w-full max-w-xs bg-white/10 px-6 py-4 rounded-2xl text-white text-center font-bold tracking-widest outline-none border border-red-500/50 focus:border-red-500 focus:bg-red-500/10 transition-all mb-8 shadow-[0_0_20px_rgba(239,68,68,0.2)]"
            />
            
            <div className="flex space-x-4">
               <button onClick={() => setPendingSecretFile(null)} className="px-6 py-3 rounded-full bg-white/10 text-white font-bold">Cancel</button>
               <button onClick={handleSaveSecretDrop} className="px-6 py-3 rounded-full bg-red-500 text-white font-bold shadow-[0_0_20px_rgba(239,68,68,0.5)]">Lock & Upload</button>
            </div>
         </div>
      )}

      {/* Secret Key Unlock Prompt */}
      {unlockPrompt && (
         <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-md flex flex-col justify-center items-center px-6">
            <div className="w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center mb-6 border border-red-500/50">
               <Lock size={32} className="text-red-500" />
            </div>
            <h2 className="text-white font-bold text-xl mb-8 tracking-widest uppercase">Encrypted Drop</h2>
            
            <input 
               type="password" 
               placeholder="Enter Key..." 
               value={unlockPassword}
               onChange={(e) => setUnlockPassword(e.target.value)}
               className="w-full max-w-xs bg-white/10 px-6 py-4 rounded-2xl text-white text-center font-bold tracking-widest outline-none border border-white/20 focus:border-white focus:bg-white/20 transition-all mb-8"
            />
            
            <div className="flex space-x-4">
               <button onClick={() => { setUnlockPrompt(null); setUnlockPassword(''); }} className="px-6 py-3 rounded-full bg-white/10 text-white font-bold">Cancel</button>
               <button onClick={handleUnlockDrop} className="px-6 py-3 rounded-full bg-white text-black font-bold active:scale-95">Unlock</button>
            </div>
         </div>
      )}

      <AnimatePresence>
         {viewItem && (
            <motion.div
               initial={{ opacity: 0 }}
               animate={{ opacity: 1 }}
               exit={{ opacity: 0 }}
               className="fixed inset-0 z-50 bg-black/95 backdrop-blur-2xl flex flex-col"
            >
               <div className="pt-12 px-6 pb-4 flex justify-between items-center z-10 glass">
                  <div>
                     <p className="text-white font-semibold text-lg">{viewItem.name || 'Secure File'}</p>
                     <p className="text-white/40 text-xs">{new Date(viewItem.timestamp).toLocaleString()}</p>
                  </div>
                  <button onClick={() => setViewItem(null)} className="w-10 h-10 bg-white/10 rounded-full flex items-center justify-center text-white/60 active:scale-95">
                     <X size={20} />
                  </button>
               </div>

               <div className="flex-1 flex items-center justify-center p-4 overflow-hidden relative">
                  {viewItem.type === 'photo' && <img src={viewItem.data} className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" />}
                  {viewItem.type === 'video' && <video src={viewItem.data} controls autoPlay className="max-w-full max-h-full rounded-lg shadow-2xl" />}
                  {viewItem.type === 'voice' && (
                     <div className="w-full max-w-sm bg-white/10 p-8 rounded-[32px] border border-white/10 flex flex-col items-center">
                        <div className="w-24 h-24 bg-primary/20 text-primary rounded-full flex items-center justify-center mb-6">
                           <Mic size={40} />
                        </div>
                        <audio src={viewItem.data} controls className="w-full" />
                     </div>
                  )}
               </div>

               <div className="pb-12 pt-6 px-8 flex justify-center space-x-6 glass">
                  <button onClick={() => deleteItem(viewItem.id)} className="w-14 h-14 bg-red-500/20 text-red-500 border border-red-500/30 rounded-full flex items-center justify-center active:scale-95 transition-transform">
                     <Trash2 size={22} />
                  </button>
                  <button onClick={() => downloadItem(viewItem)} className="flex-1 h-14 bg-white text-black font-bold text-[15px] rounded-full flex items-center justify-center space-x-2 active:scale-95 transition-transform shadow-[0_0_20px_rgba(255,255,255,0.2)]">
                     <Download size={20} />
                     <span>Save to Device</span>
                  </button>
               </div>
            </motion.div>
         )}
      </AnimatePresence>
    </div>
  );
};

import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageCircle, Lock, Heart, Activity, Settings, Phone, Video, Gamepad2, Edit3, Clock, Image as ImageIcon, Bell } from 'lucide-react';
import { useNotifications } from '../components/NotificationProvider';
import { ConnectionHealth } from '../components/ConnectionHealth';
import { initDB } from '../lib/db';
import { supabase } from '../lib/supabase';
import { importPublicKey, deriveSharedSecret, decryptMessage, encryptMessage } from '../lib/crypto';
import { initSocket, getSocket } from '../lib/socket';
import type { Partner, AuthConfig } from '../lib/types';

// --- COUNTDOWN TICKER (Separated to prevent full-screen re-renders) ---
const CountdownWidget = React.memo(({ target }: { target: number }) => {
  const [now, setNow] = useState(Date.now());
  
  useEffect(() => {
     const t = setInterval(() => setNow(Date.now()), 1000);
     return () => clearInterval(t);
  }, []);

  const diff = Math.max(0, target - now);
  const d = Math.floor(diff / (1000 * 60 * 60 * 24));
  const h = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const m = Math.floor(diff / 1000 / 60) % 60;

  return (
    <div className="flex flex-col items-center">
      <span className="text-2xl font-black text-white px-2 tracking-tighter drop-shadow-[0_0_15px_rgba(255,255,255,0.3)]">
        {d}d {h}h {m}m
      </span>
      <span className="text-[10px] text-primary/80 font-black uppercase tracking-[2px] mt-1">Anniversary</span>
    </div>
  );
});

// --- ROMANTIC FLOATING LIGHTS --- Moved to GlobalBackground

export const DashboardScreen = React.memo(() => {
  const navigate = useNavigate();
  const [partner, setPartner] = useState<Partner | null>(null);
  const [me, setMe] = useState<AuthConfig | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [isOnline, setIsOnline] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isTugging, setIsTugging] = useState(false);
  const [partnerMood, setPartnerMood] = useState<string>('default');
  const [syncStatus, setSyncStatus] = useState(99.1);
  const [myNote, setMyNote] = useState('Type a note...');
  const [partnerNote, setPartnerNote] = useState('Partner is typing...');
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [noteInput, setNoteInput] = useState('');
  const [vaultMemory, setVaultMemory] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number>(Date.now() + 86400000 * 5);
  const [myIdentity, setMyIdentity] = useState<any>(null);
  const [sharedKey, setSharedKey] = useState<CryptoKey | null>(null);
  const [scores, setScores] = useState<any[]>([]);
  const [showPushBanner, setShowPushBanner] = useState(false);
  
  const { subscribeToPush, isPushSupported } = useNotifications();
  
  const typingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tugRef = useRef<ReturnType<typeof setTimeout> | null>(null);


  // ── Socket Connection & Messaging ──
  useEffect(() => {
    if (!myIdentity || !partner || !sharedKey) return;

    const s = getSocket() || initSocket(myIdentity.userId);
    const pid = partner.userId;

    const handleReceive = async (data: { encrypted: string; iv: string; messageId?: string; senderId: string; timestamp?: number }) => {
      try {
         const dec = await decryptMessage(sharedKey, data.encrypted, data.iv);
         const payload = JSON.parse(dec);
         if (payload.type === 'typing') {
            setIsTyping(true);
            if (typingRef.current) clearTimeout(typingRef.current);
            typingRef.current = setTimeout(() => setIsTyping(false), 3000);
         } else if (payload.type === 'signal:tug') {
            setIsTugging(true);
            if (navigator.vibrate) navigator.vibrate([20, 40, 20]);
            if (tugRef.current) clearTimeout(tugRef.current);
            tugRef.current = setTimeout(() => setIsTugging(false), 5000);
         } else if (payload.type === 'signal:mood') {
            setPartnerMood(payload.mood);
         } else if (payload.type === 'hub:game_invite') {
             window.dispatchEvent(new CustomEvent('incoming-game-invite', { 
                detail: { type: 'game', isGameMode: true, gameType: payload.game || 'categories' } 
             }));
          } else if (payload.type === 'hub:note') {
             setPartnerNote(payload.text);
             const db2 = await initDB();
             await db2.put('settings', { id: 'sticky_note_partner', data: payload.text });
          } else if (payload.type === 'text' || payload.type === 'media') {
             setUnreadCount(c => c + 1);
          }
      } catch { /* ignored */ }
    };

    const handleStatus = (data: { isOnline: boolean }) => setIsOnline(data.isOnline);
    const doSubscribe = () => {
      setSocketConnected(true);
      s.emit('status:subscribe', { partnerId: pid });
    };

    s.on('message:receive', handleReceive);
    s.on('status:update', handleStatus);
    s.on('connect', doSubscribe);
    s.on('disconnect', () => setSocketConnected(false));
    if (s.connected) doSubscribe();

    return () => {
      s.off('message:receive', handleReceive);
      s.off('status:update', handleStatus);
      s.off('connect', doSubscribe);
      s.off('disconnect');
    };
  }, [myIdentity, partner, sharedKey]);

  // ── Cloud Sync ──
  useEffect(() => {
    if (!myIdentity || !partner || !sharedKey) return;
    const id = myIdentity.userId;

    const channel = supabase
      .channel('hub_realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'hub_sync' }, async (payload) => {
         const row = payload.new;
         if (row.partner_id === id && sharedKey) {
            try {
               const dec = await decryptMessage(sharedKey, row.encrypted_payload, row.iv);
               const data = JSON.parse(dec);
               if (row.type === 'note') {
                  if (row.owner_id === id) setMyNote(data.text);
                  else setPartnerNote(data.text);
                  const db2 = await initDB();
                  await db2.put('settings', { id: row.owner_id === id ? 'sticky_note_me' : 'sticky_note_partner', data: data.text });
               } else if (row.type === 'mood') {
                  setPartnerMood(data.mood);
               } else if (row.type === 'countdown') {
                  setCountdown(data.target);
                  const db2 = await initDB();
                  await db2.put('settings', { id: 'countdown_target', data: data.target });
               }
            } catch(e) { console.error('Cloud Sync Decrypt Failed', e); }
         }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [myIdentity, partner, sharedKey]);

  useEffect(() => {
    const load = async () => {
      const db = await initDB();
      const p = await db.get('partner', 'partner');
      const auth = await db.get('auth', 'pins');
      const identity = await db.get('identity', 'me');
      const settings = await db.get('settings', 'main');
      
      if (p) setPartner(p);
      if (auth) setMe(auth);
      if (identity) setMyIdentity(identity);

      if (settings) {
         setPartnerMood(settings.theme || 'default');
      }
      
      const mySticky = await db.get('settings', 'sticky_note_me');
      if (mySticky) setMyNote(mySticky.data);
      const partnerSticky = await db.get('settings', 'sticky_note_partner');
      if (partnerSticky) setPartnerNote(partnerSticky.data);

      const cd = await db.get('settings', 'countdown_target');
      if (cd) setCountdown(cd.data);

      const vaultItems = await db.getAll('vault') || [];
      const localPhotos = vaultItems.filter((v: any) => v.type === 'photo' && v.data && !v.data.startsWith('storage://'));
      if (localPhotos.length > 0) {
          setVaultMemory(localPhotos[Math.floor(Math.random() * localPhotos.length)].data);
      }

      if (p && identity) {
        try {
          // Force refresh partner profile from Cloud
          try {
             const { data: cloudPartner } = await supabase.from('users').select('nickname, avatar').eq('user_id', p.userId).single();
             if (cloudPartner) {
                const changed = (p.nick !== cloudPartner.nickname) || (p.avatar !== cloudPartner.avatar);
                if (changed) {
                   p.nick = cloudPartner.nickname || p.nick;
                   p.avatar = cloudPartner.avatar || p.avatar;
                   await db.put('partner', p);
                   setPartner({ ...p });
                }
             }
          } catch(e) { console.warn('Supabase fetch failed', e); }

          const importedPartnerKey = await importPublicKey(p.publicKeyPem);
          const key = await deriveSharedSecret(identity.privateKey, importedPartnerKey);
          setSharedKey(key);
          
          const msgs = await db.getAll('messages') || [];
          const currentUnread = msgs.filter((m: {status: string, senderId: string}) => m.status === 'unread' && m.senderId === p.userId).length;
          setUnreadCount(currentUnread);

          const fetchCloudData = async () => {
             try {
                const { data: rows } = await supabase
                  .from('hub_sync')
                  .select('*')
                  .or(`and(owner_id.eq.${identity.userId},partner_id.eq.${p.userId}),and(owner_id.eq.${p.userId},partner_id.eq.${identity.userId})`)
                  .order('updated_at', { ascending: false });
                if (rows && rows.length > 0 && key) {
                    const processedTypes = new Set();
                    const db = await initDB();
                    for (const row of rows) {
                       if (processedTypes.has(row.type)) continue;
                       processedTypes.add(row.type);
                       try {
                          const dec = await decryptMessage(key, row.encrypted_payload, row.iv);
                          const parsed = JSON.parse(dec);
                          if (row.type === 'note') {
                             if (row.owner_id === identity.userId) setMyNote(parsed.text);
                             else setPartnerNote(parsed.text);
                             await db.put('settings', { id: row.owner_id === identity.userId ? 'sticky_note_me' : 'sticky_note_partner', data: parsed.text });
                          } else if (row.type === 'mood' && row.owner_id === p.userId) {
                             setPartnerMood(parsed.mood);
                          } else if (row.type === 'countdown') {
                             setCountdown(parsed.target);
                             await db.put('settings', { id: 'countdown_target', data: parsed.target });
                          }
                       } catch(e) {}
                    }
                 }
              } catch(e) {}
           };
           fetchCloudData();

           const fetchScores = async () => {
              const { data } = await supabase.from('leaderboard')
                .select('*')
                .or(`owner_id.eq.${identity.userId},partner_id.eq.${identity.userId}`);
              if (data) setScores(data);
           };
           fetchScores();

           // REALTIME LEADERBOARD
           const scoreChannel = supabase.channel('leaderboard_sync')
             .on('postgres_changes', { event: '*', schema: 'public', table: 'leaderboard' }, fetchScores)
             .subscribe();

           return () => { 
              supabase.removeChannel(scoreChannel);
           };
        } catch { /* ignored */ }
      }
    };
    load();

    const interval = setInterval(() => {
       setSyncStatus(s => s + (Math.random() > 0.5 ? 0.005 : -0.005));
    }, 4000);

    // Cycle vault memories
    const memoryInterval = setInterval(async () => {
       const db = await initDB();
       const vaultItems = await db.getAll('vault') || [];
       const localPhotos = vaultItems.filter((v: any) => v.type === 'photo' && v.data && !v.data.startsWith('storage://'));
       if (localPhotos.length > 0) {
           setVaultMemory(localPhotos[Math.floor(Math.random() * localPhotos.length)].data);
       }
    }, 15000);

    // Check for push permission
    if ('Notification' in window && Notification.permission !== 'granted') {
       setShowPushBanner(true);
    }

    window.addEventListener('pair:updated', load);
    load();
    return () => {
       clearInterval(interval);
       clearInterval(memoryInterval);
       window.removeEventListener('pair:updated', load);
    };
  }, []);

  // Mood Gradient logic moved to GlobalBackground

  const saveStickyNote = async () => {
     if (!noteInput.trim()) return setIsEditingNote(false);
     setIsEditingNote(false);
     setMyNote(noteInput);
     const db = await initDB();
     await db.put('settings', { id: 'sticky_note_me', data: noteInput });
     
     const s = getSocket();
     if (s && myIdentity && partner && sharedKey) {
          const payload = { type: 'hub:note', text: noteInput };
          const enc = await encryptMessage(sharedKey, JSON.stringify(payload));
          s.emit('message:send', { to: partner.userId, encrypted: enc.encrypted, iv: enc.iv, senderId: myIdentity.userId });

          // Cloud Sync (Persistent)
          await supabase.from('hub_sync').insert([{
             id: `note_${myIdentity.userId}_${Date.now()}`,
             type: 'note',
             owner_id: myIdentity.userId,
             partner_id: partner.userId,
             encrypted_payload: enc.encrypted,
             iv: enc.iv,
             updated_at: Date.now()
          }]);
     }
  };

  const sendGameInvite = async () => {
     const s = getSocket();
     if (s && myIdentity && partner && sharedKey) {
          const payload = { type: 'hub:game_invite', game: 'categories' };
          const enc = await encryptMessage(sharedKey, JSON.stringify(payload));
          s.emit('message:send', { to: partner.userId, encrypted: enc.encrypted, iv: enc.iv, senderId: myIdentity.userId });
          
          // Start local side in game mode
          window.dispatchEvent(new CustomEvent('start-global-call', { detail: { type: 'game', isGameMode: true, gameType: 'categories' } }));
     }
  };

  const setMood = async (m: string) => {
      const db = await initDB();
      const settings = (await db.get('settings', 'main')) || { id: 'main' };
      settings.theme = m;
      await db.put('settings', settings);
      setPartnerMood(m);
      window.dispatchEvent(new CustomEvent('theme-updated', { detail: { mood: m } }));
      
      const s = getSocket();
      if (s && myIdentity && partner && sharedKey) {
          const payload = { type: 'signal:mood', mood: m };
          const enc = await encryptMessage(sharedKey, JSON.stringify(payload));
          s.emit('message:send', { to: partner.userId, encrypted: enc.encrypted, iv: enc.iv, senderId: myIdentity.userId });

          // Cloud Sync
          const cloudPayload = { mood: m };
          const cloudEnc = await encryptMessage(sharedKey, JSON.stringify(cloudPayload));
          await supabase.from('hub_sync').insert([{
             id: `mood_${myIdentity.userId}_${Date.now()}`,
             type: 'mood',
             owner_id: myIdentity.userId,
             partner_id: partner.userId,
             encrypted_payload: cloudEnc.encrypted,
             iv: cloudEnc.iv,
             updated_at: Date.now()
          }]);
      }
  };


  const updateCountdown = async () => {
      const dateStr = prompt('Enter a special date (YYYY-MM-DD):', new Date(countdown).toISOString().split('T')[0]);
      if (dateStr && myIdentity && partner && sharedKey) {
          const newDate = new Date(dateStr).getTime();
          if (!isNaN(newDate)) {
              setCountdown(newDate);
              const db = await initDB();
              await db.put('settings', { id: 'countdown_target', data: newDate });

              const enc = await encryptMessage(sharedKey, JSON.stringify({ target: newDate }));
              await supabase.from('hub_sync').insert([{
                  id: `countdown_${myIdentity.userId}_${Date.now()}`,
                  type: 'countdown',
                  owner_id: myIdentity.userId,
                  partner_id: partner.userId,
                  encrypted_payload: enc.encrypted,
                  iv: enc.iv,
                  updated_at: Date.now()
              }]);
          }
      }
  };

  return (
    <div className={`flex flex-col h-full bg-transparent relative overflow-hidden transition-all duration-1000`}>

      {/* PUSH NOTIFICATION BANNER */}
      <AnimatePresence>
        {showPushBanner && isPushSupported && (
          <motion.div 
            initial={{ y: -100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -100, opacity: 0 }}
            className="fixed top-24 left-6 right-6 z-[100] bg-primary/20 backdrop-blur-3xl border border-primary/30 rounded-3xl p-5 shadow-2xl flex items-center justify-between"
          >
            <div className="flex items-center space-x-4">
              <div className="w-12 h-12 bg-primary rounded-2xl flex items-center justify-center text-white shadow-lg animate-pulse">
                <Bell size={24} />
              </div>
              <div className="flex flex-col">
                <span className="text-white font-black text-xs uppercase tracking-widest">Notification Access</span>
                <span className="text-white/60 text-[10px] font-medium uppercase tracking-wider">Stay connected in your world</span>
              </div>
            </div>
            <div className="flex space-x-2">
              <button 
                onClick={() => setShowPushBanner(false)}
                className="px-4 py-2 bg-white/5 rounded-xl text-[10px] font-black text-white/40 uppercase tracking-widest active:scale-95"
              >
                Later
              </button>
              <button 
                onClick={async () => {
                  if (myIdentity) {
                    const success = await subscribeToPush(myIdentity.userId);
                    if (success) setShowPushBanner(false);
                  }
                }}
                className="px-6 py-2 bg-primary rounded-xl text-[10px] font-black text-white uppercase tracking-widest shadow-lg shadow-primary/40 active:scale-95"
              >
                Enable
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* COMPACT TOP BAR */}
      <div className="pt-12 px-8 flex justify-between items-center z-20">
         <motion.button 
           whileTap={{ scale: 0.9 }}
           onClick={() => navigate('/settings')}
           className="w-11 h-11 bg-white/5 backdrop-blur-2xl rounded-2xl border border-white/5 flex items-center justify-center text-white/40 shadow-inner"
         >
            <Settings size={18} />
         </motion.button>
         
         {/* STATUS INDICATOR */}
         <div className="flex items-center space-x-3 bg-white/5 backdrop-blur-2xl px-4 py-2 rounded-full border border-white/5 shadow-inner">
            <Activity size={12} className={`text-primary ${isOnline ? 'animate-pulse' : 'opacity-20'}`} />
            <span className="text-[10px] font-black text-white/40 uppercase tracking-[2px]">{syncStatus.toFixed(2)}% Sync</span>
         </div>

         <motion.button 
           whileTap={{ scale: 0.9 }}
           onClick={() => navigate('/vault')}
           className="w-11 h-11 bg-white/5 backdrop-blur-2xl rounded-2xl border border-white/5 flex items-center justify-center text-white/40 shadow-inner"
         >
            <Lock size={18} />
         </motion.button>
      </div>

      {/* HERO PARTNER SECTION - MINI */}
      <div className="flex-1 flex flex-col items-center justify-center -mt-6 z-10 px-8">
         <motion.div 
           initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
           className="relative mb-6"
         >
            <motion.div 
              animate={isOnline ? { scale: [1, 1.1, 1], opacity: [0.2, 0.4, 0.2] } : {}}
              transition={{ repeat: Infinity, duration: 4 }}
              className="absolute inset-[-12px] rounded-[54px] border border-primary/20 blur-[2px]"
            />
            <div className="relative w-36 h-36 rounded-[56px] bg-zinc-900 p-1 shadow-[0_0_40px_rgba(255,107,0,0.15)] ring-1 ring-white/5">
               <img 
                 src={partner?.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${partner?.userId || 'partner'}`} 
                 alt="Partner" 
                 className="w-full h-full object-cover rounded-[50px] border border-white/10" 
               />
               <AnimatePresence>
                  {isOnline && (
                     <motion.div 
                        initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
                        className="absolute -bottom-1 -right-1 w-9 h-9 bg-black border-[3px] border-green-500 rounded-full flex items-center justify-center shadow-2xl"
                     >
                        <Heart size={14} fill="#22c55e" className="text-green-500" />
                     </motion.div>
                  )}
               </AnimatePresence>
            </div>
         </motion.div>

          <div className="text-center relative">
             <motion.h1 
               initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
               className="text-4xl font-black text-white tracking-tighter uppercase mb-1 drop-shadow-2xl"
             >
               {partner?.nick || 'Partner'}
             </motion.h1>
             <motion.div 
               initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}
               className="flex items-center justify-center space-x-2"
             >
                <div className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-green-500 animate-pulse shadow-[0_0_10px_#22c55e]' : 'bg-white/20'}`} />
                <p className="text-white/40 text-[11px] font-black uppercase tracking-[3px]">
                   {isTyping ? 'Whispering secrets...' : (isOnline ? 'Active' : 'Offline')}
                </p>
             </motion.div>
          </div>
      </div>

      {/* ACTION TRAY - PREMIUM CARDS */}
      <div className="pb-32 px-6 flex flex-col space-y-4 z-20 flex-1 overflow-y-auto no-scrollbar pt-4">
         
         {/* STICKY NOTES BOARD */}
         <div className="grid grid-cols-2 gap-3 w-full relative z-20 mb-2">
            {/* My Note */}
            <div 
              className="bg-yellow-200/90 text-zinc-900 p-4 rounded-sm shadow-lg transform -rotate-1 hover:rotate-0 transition-transform cursor-pointer relative min-h-[140px] flex flex-col justify-between"
              onClick={() => { setIsEditingNote(true); setNoteInput(myNote); }}
            >
               <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-8 h-8 bg-zinc-400/20 rounded-full blur-sm" />
               <div className="absolute top-2 right-2 opacity-20"><Edit3 size={14} /></div>
               <p className="font-handwriting text-[15px] leading-snug break-words">{myNote}</p>
               <p className="text-[9px] mt-2 opacity-40 font-black uppercase tracking-widest text-right">— Me</p>
            </div>

            {/* Partner Note */}
            <div 
              className="bg-sky-200/90 text-zinc-900 p-4 rounded-sm shadow-lg transform rotate-2 hover:rotate-0 transition-transform relative min-h-[140px] flex flex-col justify-between"
            >
               <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-8 h-8 bg-zinc-400/20 rounded-full blur-sm" />
               <p className="font-handwriting text-[15px] leading-snug break-words">{partnerNote}</p>
               <p className="text-[9px] mt-2 opacity-40 font-black uppercase tracking-widest text-right truncate">— {partner?.nick || 'Partner'}</p>
            </div>
         </div>

         {isEditingNote && (
            <div className="flex flex-col space-y-2 relative z-50 mb-4 bg-zinc-900 p-4 rounded-2xl border border-white/10">
               <textarea 
                  value={noteInput} onChange={e => setNoteInput(e.target.value)}
                  className="bg-black/50 text-white rounded-xl p-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary h-20 resize-none font-medium italic"
                  autoFocus
                  placeholder="Tell your partner something..."
               />
               <div className="flex justify-end space-x-2">
                  <button onClick={() => setIsEditingNote(false)} className="px-3 py-1 bg-white/10 rounded-lg text-xs font-bold active:scale-95 text-white/60">Cancel</button>
                  <button onClick={saveStickyNote} className="px-3 py-1 bg-primary rounded-lg text-xs font-bold text-white active:scale-95 shadow-lg shadow-primary/30">Save Note</button>
               </div>
            </div>
         )}

          <div className="grid grid-cols-2 gap-4">
            {/* OUR WORLD */}
            <motion.button 
               whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }}
               onClick={() => navigate('/chat')}
               className="col-span-2 h-20 rounded-[28px] bg-white text-black flex items-center justify-between px-8 shadow-[0_20px_40px_rgba(0,0,0,0.3)] relative overflow-hidden group"
            >
               <div className="absolute right-[-5%] top-[-50%] p-5 opacity-[0.03] group-hover:rotate-12 group-hover:scale-110 transition-all duration-500">
                  <MessageCircle size={120} />
               </div>
               <div className="flex flex-col text-left relative z-10">
                  <span className="text-xl font-black tracking-tighter leading-none mb-1 text-black">OUR WORLD</span>
                  <span className="text-[9px] font-bold uppercase tracking-[2px] opacity-40">Private Connection</span>
               </div>
               <div className="relative z-10">
                  <div className="w-10 h-10 bg-black rounded-xl flex items-center justify-center text-white shadow-xl group-hover:bg-primary transition-colors">
                     <MessageCircle size={18} />
                  </div>
                  <AnimatePresence>
                    {unreadCount > 0 && (
                       <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="absolute -top-2 -right-2 bg-primary text-white w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black border-2 border-white shadow-lg">
                          {unreadCount}
                       </motion.div>
                    )}
                  </AnimatePresence>
               </div>
            </motion.button>

            {/* CALLS */}
            <motion.button 
               whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }}
               onClick={() => window.dispatchEvent(new CustomEvent('start-global-call', { detail: { type: 'voice' } }))}
               className="h-20 col-span-1 rounded-[24px] bg-sky-500/90 text-white flex flex-col items-center justify-center shadow-lg active:scale-95 group relative overflow-hidden backdrop-blur-md"
            >
               <Phone size={24} fill="currentColor" className="mb-1.5 group-hover:scale-110 transition-transform opacity-90" />
               <span className="text-[9px] font-black uppercase tracking-wider">Voice</span>
            </motion.button>
            <motion.button 
               whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }}
               onClick={() => window.dispatchEvent(new CustomEvent('start-global-call', { detail: { type: 'video' } }))}
               className="h-20 col-span-1 rounded-[24px] bg-primary text-white flex flex-col items-center justify-center shadow-lg active:scale-95 group relative overflow-hidden"
            >
               <Video size={24} fill="currentColor" className="mb-1.5 group-hover:scale-110 transition-transform opacity-90" />
               <span className="text-[9px] font-black uppercase tracking-wider">Video</span>
            </motion.button>

            {/* VAULT POLAROID */}
            <motion.button 
               whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }}
               onClick={() => navigate('/vault')}
               className="h-32 col-span-1 rounded-[24px] bg-[#1a1a1c] border border-white/10 flex flex-col items-start justify-between p-4 shadow-xl relative overflow-hidden group p-0"
            >
               {vaultMemory ? (
                 <div className="absolute inset-0">
                    <img src={vaultMemory} className="w-full h-full object-cover opacity-60 group-hover:opacity-100 group-hover:scale-110 transition-all duration-700" alt="Vault Memory" />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#1a1a1c] via-[#1a1a1c]/20 to-transparent" />
                 </div>
               ) : (
                 <div className="absolute inset-0 flex items-center justify-center opacity-10">
                    <ImageIcon size={40} />
                 </div>
               )}
               <div className="relative z-10 p-4 h-full flex flex-col justify-between w-full">
                  <div className="w-7 h-7 bg-white/10 backdrop-blur-md rounded-lg flex items-center justify-center text-white border border-white/20">
                     <Lock size={14} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h1 className="text-2xl font-black text-white tracking-tight flex items-center">
                      {me?.nickname || 'SecureLove'}
                    </h1>
                    <div className="flex items-center space-x-2 mt-1">
                       <ConnectionHealth 
                          isSocketConnected={socketConnected}
                          isPartnerOnline={isOnline}
                          isEncryptionReady={!!sharedKey}
                       />
                    </div>
                  </div>
               </div>
            </motion.button>

            {/* COUNTDOWN WIDGET */}
            <motion.button 
               whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }}
               onClick={updateCountdown}
               className="h-32 col-span-1 rounded-[24px] bg-white/5 border border-white/10 flex flex-col items-center justify-center shadow-xl relative overflow-hidden group"
            >
               <div className="absolute -top-6 -right-6 opacity-[0.03] group-hover:rotate-[30deg] transition-transform duration-700">
                  <Clock size={100} />
               </div>
               <CountdownWidget target={countdown} />
            </motion.button>

            {/* QUICK GAMES PORTAL */}
            <motion.button 
               whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }}
               onClick={sendGameInvite}
               className="h-16 col-span-1 rounded-[20px] bg-purple-600/20 border border-purple-500/30 flex items-center justify-center space-x-2 shadow-xl hover:bg-purple-600/30 transition-colors"
            >
               <Gamepad2 size={16} className="text-purple-400" />
               <span className="text-[10px] font-black text-purple-100 uppercase tracking-widest">Instant Game</span>
            </motion.button>

            {/* LOVE TAP */}
            <motion.button 
               whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }}
               onClick={() => {
                  getSocket()?.emit('message:send', { to: partner?.userId, encrypted: 'tug', iv: 'tug', senderId: 'me' });
                  if (navigator.vibrate) navigator.vibrate([10, 30, 10]);
               }}
               className={`h-16 col-span-1 rounded-[20px] border flex items-center justify-center space-x-2 shadow-xl transition-all duration-500 ${isTugging ? 'bg-primary border-primary flex-row-reverse space-x-reverse' : 'bg-white/5 border-white/10'}`}
            >
               <Heart size={16} className={isTugging ? 'text-white animate-ping' : 'text-primary opacity-60'} />
               <span className={`text-[10px] uppercase font-black tracking-widest ${isTugging ? 'text-white' : 'text-white/60'}`}>Love Tap</span>
            </motion.button>
         </div>

         {/* LEADERBOARD WIDGET */}
         <div className="mt-8 mb-12 bg-white/5 border border-white/10 rounded-[28px] p-6 backdrop-blur-md">
            <div className="flex items-center justify-between mb-4">
               <h3 className="text-white/60 text-[10px] font-black uppercase tracking-[3px]">Match Scoreboard</h3>
               <span className="text-primary text-[10px] font-black uppercase tracking-widest">Live Updates</span>
            </div>
            
            <div className="space-y-4">
               {['Categories', 'Roulette', 'Stare', 'Jigsaw'].map(g => {
                  const gameTypeMap: Record<string, string> = {
                     'Categories': 'categories',
                     'Roulette': 'reaction',
                     'Stare': 'soul_stare',
                     'Jigsaw': 'jigsaw'
                  };
                  const type = gameTypeMap[g];
                  const myWins = scores.filter(s => s.owner_id === myIdentity?.userId && s.game_type === type).reduce((a,b) => a + b.total_wins, 0);
                  const partnerWins = scores.filter(s => s.partner_id === myIdentity?.userId && s.game_type === type).reduce((a,b) => a + b.total_wins, 0);

                  return (
                     <div key={g} className="flex flex-col">
                        <div className="flex justify-between items-end mb-2">
                           <span className="text-white text-xs font-bold opacity-80">{g}</span>
                           <div className="flex space-x-3 text-[10px] font-black">
                              <span className="text-primary">Me: {myWins}</span>
                              <span className="text-white/40">{partner?.nick}: {partnerWins}</span>
                           </div>
                        </div>
                        <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden flex">
                           <motion.div 
                              initial={{ width: 0 }} 
                              animate={{ width: `${(myWins / (myWins + partnerWins + 0.001)) * 100}%` }}
                              className="h-full bg-primary"
                           />
                           <motion.div 
                              initial={{ width: 0 }} 
                              animate={{ width: `${(partnerWins / (myWins + partnerWins + 0.001)) * 100}%` }}
                              className="h-full bg-white/20"
                           />
                        </div>
                     </div>
                  );
               })}
            </div>
         </div>

         {/* INTERACTIVE MOOD DOTS */}
         <div className="flex flex-col items-center justify-center pt-6 pb-2">
            <span className="text-[8px] uppercase font-black text-white/20 tracking-[4px] mb-3">Broadcast Your Mood</span>
            <div className="flex justify-center space-x-6">
               {['default', 'passionate', 'calm', 'playful'].map(m => (
                  <button 
                     key={m}
                     onClick={() => setMood(m)}
                     className={`w-3 h-3 rounded-full transition-all duration-300 ${partnerMood === m ? 'scale-150 shadow-[0_0_15px_rgba(255,255,255,0.2)] ring-2 ring-offset-2 ring-offset-[#050505] ring-white/20' : 'opacity-40 hover:opacity-100 hover:scale-125'} ${
                        m === 'default' ? 'bg-zinc-400' : 
                        m === 'passionate' ? 'bg-rose-500 shadow-rose-500/50' :
                        m === 'calm' ? 'bg-sky-500 shadow-sky-500/50' : 'bg-fuchsia-500 shadow-fuchsia-500/50'
                     }`}
                  />
               ))}
            </div>
         </div>

      </div>

      <div className="absolute bottom-6 left-0 right-0 flex flex-col items-center opacity-5 pointer-events-none">
         <p className="text-[7px] font-black text-white uppercase tracking-[10px]">Heartbeat Encryption</p>
      </div>

    </div>
  );
});

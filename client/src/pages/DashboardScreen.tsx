import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageCircle, Camera, Lock, Heart, Activity, Settings, ShieldAlert } from 'lucide-react';
import { initDB } from '../lib/db';
import { importPublicKey, deriveSharedSecret, decryptMessage } from '../lib/crypto';
import { initSocket, getSocket } from '../lib/socket';
import type { Partner, AuthConfig } from '../lib/types';

// --- ROMANTIC FLOATING LIGHTS ---
const RomanticAtmosphere: React.FC = () => {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      <motion.div 
        animate={{ 
          scale: [1, 1.15, 1],
          opacity: [0.2, 0.4, 0.2],
        }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        className="absolute top-[-20%] left-[-10%] w-[100vw] h-[100vw] bg-rose-500/10 blur-[150px] rounded-full" 
      />
      <motion.div 
        animate={{ 
          scale: [1, 1.25, 1],
          opacity: [0.15, 0.35, 0.15],
        }}
        transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
        className="absolute bottom-[-30%] right-[-20%] w-[120vw] h-[120vw] bg-purple-600/10 blur-[180px] rounded-full" 
      />
      
      {[0.15, 0.45, 0.75, 0.25, 0.85, 0.55].map((val, i) => (
        <motion.div
          key={i}
          initial={{ y: '110vh', x: `${val * 100}vw`, opacity: 0 }}
          animate={{ y: '-10vh', opacity: [0, 0.4, 0] }}
          transition={{ duration: val * 8 + 12, repeat: Infinity, delay: i * 3 }}
          className="absolute w-1 h-1 bg-white rounded-full blur-[1px]"
        />
      ))}
    </div>
  );
};

export const DashboardScreen: React.FC = () => {
  const navigate = useNavigate();
  const [partner, setPartner] = useState<Partner | null>(null);
  const [, setMe] = useState<AuthConfig | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [isOnline, setIsOnline] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isTugging, setIsTugging] = useState(false);
  const [partnerMood, setPartnerMood] = useState<string>('default');
  const [syncStatus, setSyncStatus] = useState(99.1);
  
  const typingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tugRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const load = async () => {
      const db = await initDB();
      const p = await db.get('partner', 'partner');
      const auth = await db.get('auth', 'pins');
      const identity = await db.get('identity', 'me');
      const settings = await db.get('settings', 'main');
      
      if (p) setPartner(p);
      if (auth) {
        setMe(auth);
      }
      if (settings) {
         setPartnerMood(settings.theme || 'default');
      }

      if (p && identity) {
        try {
          const importedPartnerKey = await importPublicKey(p.publicKeyPem);
          const key = await deriveSharedSecret(identity.privateKey, importedPartnerKey);
          
          const msgs = await db.getAll('messages') || [];
          const currentUnread = msgs.filter((m: {status: string, senderId: string}) => m.status === 'unread' && m.senderId === p.userId).length;
          setUnreadCount(currentUnread);

          const s = getSocket() || initSocket(identity.userId);
          
          const handleReceive = async (data: { encrypted: string; iv: string; messageId?: string; senderId: string; timestamp?: number }) => {
             try {
                const dec = await decryptMessage(key, data.encrypted, data.iv);
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
                } else if (payload.type === 'text' || payload.type === 'media') {
                   setUnreadCount(c => c + 1);
                }
             } catch { /* ignored */ }
          };

          const handleStatus = (data: { isOnline: boolean }) => setIsOnline(data.isOnline);
          s.on('message:receive', handleReceive);
          s.on('status:update', handleStatus);
          
          if (s.connected && p.userId) s.emit('status:subscribe', { partnerId: p.userId });

          return () => { 
             s.off('message:receive', handleReceive); 
             s.off('status:update', handleStatus); 
          };
        } catch { /* ignored */ }
      }
    };
    load();

    const interval = setInterval(() => {
       setSyncStatus(s => s + (Math.random() > 0.5 ? 0.005 : -0.005));
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  const getMoodGradient = () => {
     switch(partnerMood) {
        case 'passionate': return 'from-rose-500/30 via-zinc-950 to-black';
        case 'calm': return 'from-sky-500/20 via-zinc-950 to-black';
        case 'playful': return 'from-fuchsia-500/20 via-zinc-950 to-black';
        default: return 'from-zinc-800 via-zinc-950 to-black';
     }
  };

  return (
    <div className={`flex flex-col h-full bg-[#050505] relative overflow-hidden transition-all duration-1000 bg-gradient-to-b ${getMoodGradient()}`}>
      
      <RomanticAtmosphere />

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

         <div className="text-center">
            <h1 className="text-3xl font-black text-white tracking-tighter uppercase mb-0.5">{partner?.nick || 'Partner'}</h1>
            <p className="text-white/30 text-[10px] font-black uppercase tracking-[4px]">
               {isTyping ? 'Whispering secrets...' : (isOnline ? 'Active Spirit' : 'Sleeping Spirit')}
            </p>
         </div>
      </div>

      {/* ACTION TRAY - COMPACT */}
      <div className="pb-16 px-8 flex flex-col space-y-4 z-20">
         
         <div className="grid grid-cols-2 gap-4">
            <motion.button 
               whileTap={{ scale: 0.96 }}
               onClick={() => navigate('/chat')}
               className="col-span-2 h-20 rounded-[32px] bg-white text-black flex items-center justify-between px-7 shadow-2xl relative overflow-hidden group"
            >
               <div className="absolute right-0 top-0 p-5 opacity-[0.03] group-hover:rotate-12 transition-transform">
                  <MessageCircle size={90} />
               </div>
               <div className="flex flex-col text-left">
                  <span className="text-xl font-black tracking-tighter leading-none mb-1">OUR WORLD</span>
                  <span className="text-[9px] font-bold uppercase tracking-widest opacity-40">Messages & Taps</span>
               </div>
               <div className="relative">
                  <div className="w-10 h-10 bg-black rounded-2xl flex items-center justify-center text-white shadow-inner">
                     <MessageCircle size={18} />
                  </div>
                  {unreadCount > 0 && (
                     <div className="absolute -top-2 -right-2 bg-primary text-white w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black border-2 border-white shadow-lg animate-bounce">
                        {unreadCount}
                     </div>
                  )}
               </div>
            </motion.button>

            <motion.button 
               whileTap={{ scale: 0.96 }}
               onClick={() => navigate('/vault')}
               className="h-16 rounded-[28px] bg-zinc-900 border border-white/5 flex items-center justify-center space-x-2 px-4 shadow-xl active:bg-zinc-800 transition-colors"
            >
               <Camera size={18} className="text-primary/70" />
               <span className="text-[11px] font-black text-white/80 tracking-widest uppercase">Vault</span>
            </motion.button>

            <motion.button 
               whileTap={{ scale: 0.96 }}
               onClick={() => {
                  getSocket()?.emit('message:send', { to: partner?.userId, encrypted: 'tug', iv: 'tug', senderId: 'me' });
                  if (navigator.vibrate) navigator.vibrate([10]);
               }}
               className={`h-16 rounded-[28px] border flex items-center justify-center space-x-2 px-4 shadow-xl transition-all duration-500 ${isTugging ? 'bg-primary border-primary' : 'bg-white/5 border-white/5'}`}
            >
               <ShieldAlert size={18} className={isTugging ? 'text-white' : 'text-primary/70'} />
               <span className={`text-[11px] font-black uppercase tracking-widest ${isTugging ? 'text-white' : 'text-white/40'}`}>
                  {isTugging ? 'Love Tap' : 'Tug'}
               </span>
            </motion.button>
         </div>

         {/* MOOD DOTS */}
         <div className="flex justify-center space-x-4 pt-4 opacity-50">
            {['default', 'passionate', 'calm', 'playful'].map(m => (
               <div 
                  key={m}
                  className={`w-1.5 h-1.5 rounded-full transition-all duration-700 ${partnerMood === m ? 'scale-150 shadow-lg' : 'opacity-20'} ${
                     m === 'default' ? 'bg-white' : 
                     m === 'passionate' ? 'bg-rose-500 shadow-rose-500/50' :
                     m === 'calm' ? 'bg-sky-500 shadow-sky-500/50' : 'bg-fuchsia-500 shadow-fuchsia-500/50'
                  }`}
               />
            ))}
         </div>

      </div>

      <div className="absolute bottom-6 left-0 right-0 flex flex-col items-center opacity-5 pointer-events-none">
         <p className="text-[7px] font-black text-white uppercase tracking-[10px]">Heartbeat Encryption</p>
      </div>

    </div>
  );
};

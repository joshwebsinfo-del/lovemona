import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Camera, Mic, Phone, Video, MoreVertical, Fingerprint, X, Volume2, Eye, EyeOff, MapPin, Wand2, ChevronLeft, Check, Share2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { type Message, initDB } from '../lib/db';
import { supabase } from '../lib/supabase';
import { initSocket, getSocket } from '../lib/socket';
import { encryptMessage, decryptMessage, deriveSharedSecret, importPublicKey, encryptBuffer, decryptBuffer, bufferToBase64, base64ToBuffer } from '../lib/crypto';
import { ConnectionHealth } from '../components/ConnectionHealth';

import { LiveWallpaper } from '../components/LiveWallpaper';
const EmojiPicker = React.lazy(() => import('emoji-picker-react'));

interface ChatScreenProps {
  partnerNickname?: string;
  isLiteMode?: boolean;
}

interface SupabaseMessage { id: string; sender_id: string; recipient_id: string; encrypted_payload: string; iv: string; timestamp: number }

interface ChatPayload {
  type: 'text' | 'media' | 'location' | 'typing' | 'call:offer' | 'call:answer' | 'call:ice' | 'call:end' | 'reaction' | 'identity:sync' | 'location:request' | 'delete';
  text?: string;
  mediaType?: string;
  mediaData?: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  callType?: 'video' | 'voice';
  messageId?: string;
  messageIds?: string[];
  reaction?: string;
  nick?: string;
  avatar?: string;
  storagePath?: string;
  storageIv?: string;
  lat?: number;
  lng?: number;
  expiresAt?: number;
  replyTo?: { id: string; text: string };
}

const MediaWrapper = ({ pl, sharedKey, setViewMedia, startAudioAnalysis, stopAudioAnalysis }: { 
  pl: ChatPayload, 
  sharedKey: CryptoKey | null, 
  setViewMedia: (v: { url: string, type: 'photo' | 'video' } | null) => void,
  startAudioAnalysis: (el: HTMLAudioElement) => void,
  stopAudioAnalysis: () => void
}) => {
   const [src, setSrc] = React.useState(pl.mediaData || '');
   const [loading, setLoading] = React.useState(!!pl.storagePath && !pl.mediaData);

   const isImg = pl.mediaType?.startsWith('image');
   const isAudio = pl.mediaType?.startsWith('audio');
   const isVideo = pl.mediaType?.startsWith('video');

   const match = pl.mediaType?.match(/effect=(chipmunk|deep)/);
   const effect = match ? match[1] : null;
   const audioRef = React.useRef<HTMLAudioElement>(null);

   React.useEffect(() => {
      if (audioRef.current && effect) {
         (audioRef.current as any).preservesPitch = false;
         audioRef.current.playbackRate = effect === 'chipmunk' ? 1.6 : 0.6;
      }
   }, [src, effect]);

   React.useEffect(() => {
      let url = '';
      if (pl.storagePath && pl.storageIv && !src) {
         const loadBlob = async () => {
            try {
               const { data, error } = await supabase.storage.from('vault').download(pl.storagePath!);
               if (error) throw error;
               if (sharedKey) {
                  const iv = new Uint8Array(base64ToBuffer(pl.storageIv!));
                  const dec = await decryptBuffer(sharedKey, await data.arrayBuffer(), iv);
                  url = URL.createObjectURL(new Blob([dec], { type: pl.mediaType }));
                  setSrc(url);
               }
            } catch (e) {
               console.error('Failed to load storage media', e);
            } finally {
               setLoading(false);
            }
         };
         loadBlob();
      }
      return () => {
         // Only revoke if we aren't currently viewing this specific media in the enlarged lightbox
         // to prevent the "media not found" error when scrolling while viewing.
         // In a butter-smooth mobile app, we can afford to keep some blobs in memory.
         // if (url) URL.revokeObjectURL(url);
      };
   }, [pl, sharedKey, src]);

   if (loading) return <div className="w-44 h-56 flex items-center justify-center bg-white/5 rounded-xl border border-white/10 text-[10px] text-white/30 uppercase tracking-widest font-black">Decrypting...</div>;
   if (!src) return <div className="w-44 h-56 flex items-center justify-center bg-red-500/10 rounded-xl border border-red-500/20 text-[10px] text-red-500/50 uppercase tracking-widest font-black">Media Unavailable</div>;

   return (
      <div className="flex flex-col space-y-2 relative group mt-1 mb-1">
         {isImg && <img src={src} onClick={() => setViewMedia({ url: src, type: 'photo' })} className="max-h-56 max-w-44 object-cover rounded-xl shadow-md border border-white/10 cursor-pointer transition-transform active:scale-95" alt="Shared media" />}
         {isVideo && (
            <div className="relative group cursor-pointer" onClick={() => setViewMedia({ url: src, type: 'video' })}>
               <video 
                  src={src} 
                  key={src}
                  className="max-h-56 max-w-44 object-cover rounded-xl shadow-md border border-white/10" 
                  playsInline 
                  muted 
                  loop 
                  autoPlay 
                  onLoadedData={(e) => (e.target as HTMLVideoElement).play().catch(() => {})}
               />
               <div className="absolute inset-0 flex items-center justify-center bg-black/10 rounded-xl">
                  <div className="w-10 h-10 bg-black/50 backdrop-blur-md rounded-full flex items-center justify-center text-white scale-90 group-hover:scale-100 transition-transform">
                     <Video size={20} />
                  </div>
               </div>
            </div>
         )}
         {isAudio && (
            <div className="flex items-center space-x-3 bg-white/10 py-2 px-3 rounded-xl border border-white/10">
               <div className={`w-8 h-8 rounded-full flex items-center justify-center ${effect === 'chipmunk' ? 'bg-fuchsia-500/20 text-fuchsia-500' : effect === 'deep' ? 'bg-indigo-600/20 text-indigo-400' : 'bg-primary/20 text-primary'}`}>
                  {effect ? <Wand2 size={16} /> : <Volume2 size={16} />}
               </div>
               <audio 
                  ref={audioRef} 
                  src={src} 
                  controls 
                  onPlay={() => startAudioAnalysis(audioRef.current!)} 
                  onPause={stopAudioAnalysis} 
                  onEnded={stopAudioAnalysis}
                  className="h-8 w-[150px]" 
               />
            </div>
         )}
         {!isImg && !isAudio && !isVideo && <span className="underline italic text-white/50">Unsupported media</span>}
      </div>
   );
};

export const ChatScreen: React.FC<ChatScreenProps> = ({ partnerNickname, isLiteMode }) => {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [sharedKey, setSharedKey] = useState<CryptoKey | null>(null);
  const [myUserId, setMyUserId] = useState('');
  const [partnerInfo, setPartnerInfo] = useState<{ userId: string; nick: string; avatar?: string }>({ userId: '', nick: 'Partner ❤️' });
  const [showMenu, setShowMenu] = useState(false);
  const [isBlurred, setIsBlurred] = useState(false); // Shoulder surfing protection
  const [partnerOnline, setPartnerOnline] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const partnerIdRef = useRef('');
  
  // States
  const [isProcessingMedia, setIsProcessingMedia] = useState(false);
  const [viewMedia, setViewMedia] = useState<{ url: string; type: 'photo' | 'video' } | null>(null);
  const [fullScreenMap, setFullScreenMap] = useState<{lat: number, lng: number} | null>(null);
  const [isPartnerTyping, setIsPartnerTyping] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isVideoRecording, setIsVideoRecording] = useState(false);
  const [recordDuration, setRecordDuration] = useState(0);
  const [wallpaper, setWallpaper] = useState('');
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [replyingTo, setReplyingTo] = useState<any>(null);

  // Refs
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notificationSound = useRef<HTMLAudioElement | null>(null);
  const videoPreviewRef = useRef<HTMLVideoElement>(null);

  // Initialize notification sound & permissions
  useEffect(() => {
    notificationSound.current = new Audio('https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3');
    notificationSound.current.volume = 0.5;
  }, []);
  
  // MediaRecorder Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const activeVoiceEffectRef = useRef<string | null>(null);

  // Soundscape States
  const [showEmoji, setShowEmoji] = useState(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationIdRef = useRef<number | null>(null);

  const audioSourceMap = useRef<Map<HTMLAudioElement, MediaElementAudioSourceNode>>(new Map());

  const startAudioAnalysis = (audioElement: HTMLAudioElement) => {
    if (isLiteMode) return; 
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') ctx.resume();

      let source = audioSourceMap.current.get(audioElement);
      if (!source) {
        source = ctx.createMediaElementSource(audioElement);
        audioSourceMap.current.set(audioElement, source);
      }
      
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64; 
      source.disconnect(); 
      source.connect(analyser);
      analyser.connect(ctx.destination);
      analyserRef.current = analyser;
      
      // Removed per-frame setAudioLevel re-renders for maximum performance
    } catch (e) { console.error('Audio analysis failed', e); }
  };

  const handleMessageTap = useCallback((id: string) => {
    if (isSelectionMode) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        if (next.size === 0) setIsSelectionMode(false);
        return next;
      });
      return;
    }
    setSelectedMessageId(prev => prev === id ? null : id);
  }, [isSelectionMode]);

  const toggleSelectionMode = (id: string) => {
    setIsSelectionMode(true);
    setSelectedIds(new Set([id]));
    setSelectedMessageId(null);
  };

  const handleTyping = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);
    if (!sharedKey) return;
    
    // Send typing status throttled
    if (!typingTimeoutRef.current) {
       sendSecurePayload({ type: 'typing' });
    } else {
       clearTimeout(typingTimeoutRef.current);
    }
    typingTimeoutRef.current = setTimeout(() => {
       typingTimeoutRef.current = null;
    }, 2000);
  };

  const stopAudioAnalysis = () => {
    if (animationIdRef.current) cancelAnimationFrame(animationIdRef.current);
  };

  // Setup keys and history
  useEffect(() => {
    const setup = async () => {
      try {
        const db = await initDB();
        const identity = await db.get('identity', 'me');
        const partner = await db.get('partner', 'partner');

        if (identity && partner) {
          setMyUserId(identity.userId);
          setPartnerInfo({ userId: partner.userId, nick: partner.nick || 'Partner ❤️', avatar: partner.avatar });

          const importedPartnerKey = await importPublicKey(partner.publicKeyPem);
          const derived = await deriveSharedSecret(identity.privateKey, importedPartnerKey);
          setSharedKey(derived);
        }

        const [history, settings] = await Promise.all([
           db.getAll('messages'),
           db.get('settings', 'main')
        ]);
        if (settings) setWallpaper(settings.wallpaper || '');
        const currentMessages = history ? history.sort((a, b) => a.timestamp - b.timestamp) : [];
        setMessages(currentMessages);

        // ── SUPABASE REALTIME SYNC ──
        if (identity && partner) {
           const importedPartnerKey = await importPublicKey(partner.publicKeyPem);
           const derived = await deriveSharedSecret(identity.privateKey, importedPartnerKey);

           const { data: cloudMessages } = await supabase
             .from('messages')
             .select('*')
             .or(`and(sender_id.eq.${identity.userId},recipient_id.eq.${partner.userId}),and(sender_id.eq.${partner.userId},recipient_id.eq.${identity.userId})`)
             .order('timestamp', { ascending: true });

           if (cloudMessages && cloudMessages.length > 0) {
              let newLocalsAdded = false;
              for (const cm of cloudMessages) {
                 const exists = currentMessages.find(m => m.id === cm.id);
                 if (!exists) {
                    try {
                       const dec = await decryptMessage(derived, cm.encrypted_payload, cm.iv);
                       const payload = JSON.parse(dec); // try parse format check
                       const sm: Message = {
                          id: cm.id, senderId: cm.sender_id, text: JSON.stringify(payload), timestamp: cm.timestamp, status: 'read'
                       };
                       await db.put('messages', sm);
                       currentMessages.push(sm);
                       newLocalsAdded = true;
                    } catch { /* ignored */ }
                 }
              }
              if (newLocalsAdded) {
                 currentMessages.sort((a, b) => a.timestamp - b.timestamp);
                 setMessages([...currentMessages]);
                 scrollToBottom();
              }
           }
           
           // Live Sync
           supabase.channel('public:messages')
             .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async (payload) => {
                 const cm = payload.new as SupabaseMessage;
                 if ((cm.recipient_id === identity.userId && cm.sender_id === partner.userId) || 
                     (cm.sender_id === identity.userId && cm.recipient_id === partner.userId)) {
                    
                    const existing = await db.get('messages', cm.id);
                    if (!existing) {
                       try {
                          const dec = await decryptMessage(derived, cm.encrypted_payload, cm.iv);
                          const decoded = JSON.parse(dec);
                          const sm: Message = {
                              id: cm.id, senderId: cm.sender_id, text: JSON.stringify(decoded), timestamp: cm.timestamp, status: 'read'
                          };
                          setMessages(prev => {
                              if (!prev.find(m => m.id === sm.id)) {
                                 const n = [...prev, sm].sort((a,b)=>a.timestamp-b.timestamp);
                                 setTimeout(scrollToBottom, 100);
                                 return n;
                              }
                              return prev;
                          });
                          await db.put('messages', sm);
                       } catch { /* ignored */ }
                    }
                 }
             }).subscribe();
        }
      
         const msgs = await db.getAll('messages');
         for (const m of msgs) {
            if (m.senderId === partner.userId && m.status !== 'read') {
               m.status = 'read';
               await db.put('messages', m);
            }
         }
      } catch (e) {
        console.error('Chat setup error:', e);
      }
    };
    window.addEventListener('pair:updated', setup);
    setup();
    return () => window.removeEventListener('pair:updated', setup);
  }, [partnerNickname]);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    });
  }, []);

  // Keep partnerIdRef in sync so closures always have the latest value
  useEffect(() => { partnerIdRef.current = partnerInfo.userId; }, [partnerInfo.userId]);

  // Setup Socket listener once sharedKey is ready
  useEffect(() => {
    if (!sharedKey || !myUserId) return;
    
    const s = getSocket() || initSocket(myUserId);
    const doSubscribe = () => {
       setSocketConnected(true);
       const pid = partnerIdRef.current;
       if (pid) s.emit('status:subscribe', { partnerId: pid });
    };

    const handleStatus = (data: { isOnline: boolean }) => setPartnerOnline(data.isOnline);
    s.on('status:update', handleStatus);
    s.on('connect', doSubscribe);
    s.on('disconnect', () => setSocketConnected(false));
    if (s.connected) doSubscribe();

    const handleReceive = async (data: { encrypted: string; iv: string; messageId?: string; senderId: string; timestamp?: number }) => {
      try {
        const decryptedStr = await decryptMessage(sharedKey, data.encrypted, data.iv);
        let payload: ChatPayload;
        try {
          payload = JSON.parse(decryptedStr);
        } catch {
          payload = { type: 'text', text: decryptedStr };
        }

        if (payload.type === 'typing') {
          setIsPartnerTyping(true);
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = setTimeout(() => setIsPartnerTyping(false), 3000);
          scrollToBottom();
          return;
        }
        
        if (payload.type === 'reaction' && payload.messageId) {
           setMessages(prev => prev.map(m => m.id === payload.messageId ? { ...m, reaction: payload.reaction } : m));
           const db = await initDB();
           const msg = await db.get('messages', payload.messageId);
           if (msg) await db.put('messages', { ...msg, reaction: payload.reaction });
           return;
        }

        if (payload.type === 'delete' && payload.messageIds) {
           const db = await initDB();
           setMessages(prev => prev.filter(m => !payload.messageIds!.includes(m.id)));
           for (const id of payload.messageIds) {
              await db.delete('messages', id);
           }
           return;
        }
        
        if (payload.type === 'location:request') {
           const doShare = confirm(`${partnerInfo.nick} requested your live location. Share now?`);
           if (doShare) sendLocation();
           return;
        }

        if (payload.type === 'identity:sync') {
           setPartnerInfo(prev => ({ ...prev, nick: payload.nick || prev.nick, avatar: payload.avatar || prev.avatar }));
           // Better to just db.get then db.put
           const db = await initDB();
           const p = await db.get('partner', 'partner');
           if (p) {
               await db.put('partner', { ...p, nick: payload.nick, avatar: payload.avatar });
           }
           return;
        }

        if (payload.type === 'text' || payload.type === 'media' || payload.type === 'location') {
          setIsPartnerTyping(false); // Cancel typing when message arrives
          const db = await initDB();
          const incomingId = data.messageId || Date.now().toString();
          
          const msgExists = await db.get('messages', incomingId);
          if (msgExists) return; // Prevent duplicate if Supabase already synced it
          
          const msg: Message = {
            id: incomingId,
            senderId: data.senderId,
            text: JSON.stringify(payload),
            timestamp: data.timestamp || Date.now(),
            status: 'read',
          };
          setMessages(prev => [...prev, msg]);
          await db.put('messages', msg);

          // ── NOTIFICATIONS & SOUNDS ──
          if (data.senderId !== myUserId) {
            notificationSound.current?.play().catch(() => {});
            if ('vibrate' in navigator) navigator.vibrate([100, 50, 100]);
            
            if (document.visibilityState === 'hidden' && Notification.permission === 'granted') {
              if (navigator.serviceWorker) {
                 navigator.serviceWorker.ready.then(reg => {
                    reg.showNotification(partnerInfo.nick || 'SecureLove', {
                       body: payload.type === 'text' ? payload.text : `Sent a ${payload.type}`,
                       icon: partnerInfo.avatar || '/pwa-192x192.png',
                       badge: '/icon.png',
                       vibrate: [200, 100, 200],
                       tag: 'chat',
                       renotify: true
                    } as any);
                 }).catch(() => {
                    new Notification(partnerInfo.nick || 'SecureLove', { body: payload.type === 'text' ? payload.text : `Sent a ${payload.type}`, icon: partnerInfo.avatar || '/pwa-192x192.png' });
                 });
              } else {
                 new Notification(partnerInfo.nick || 'SecureLove', { body: payload.type === 'text' ? payload.text : `Sent a ${payload.type}`, icon: partnerInfo.avatar || '/pwa-192x192.png' });
              }
            }
          }
          
          if (payload.type === 'media') {
              const vType = payload.mediaType?.startsWith('audio') ? 'voice' : (payload.mediaType?.startsWith('video') ? 'video' : 'photo');
              const vId = incomingId + '_recv_' + Date.now();
              
              // Determine what data to save locally
              // For storage-based media (video notes), save the storage pointer
              // For inline media (photos, voice), save the base64 data
              const localData = payload.storagePath 
                ? `storage://${payload.storagePath}::${payload.storageIv}` 
                : (payload.mediaData || '');
              
              if (localData) {
                await db.put('vault', {
                   id: vId,
                   name: payload.text || 'Received Media',
                   type: vType,
                   data: localData,
                   timestamp: Date.now(),
                   locked: true
                });
                
                // Cloud backup for BOTH users so it syncs across devices
                try {
                   const encMedia = await encryptMessage(sharedKey, localData);
                   await supabase.from('vault').insert([
                     {
                       id: vId + '_me',
                       owner_id: myUserId,
                       name: payload.text || 'Received Media',
                       type: vType,
                       encrypted_data: encMedia.encrypted,
                       iv: encMedia.iv,
                       timestamp: Date.now()
                     },
                     {
                       id: vId + '_partner',
                       owner_id: data.senderId,
                       name: payload.text || 'Received Media',
                       type: vType,
                       encrypted_data: encMedia.encrypted,
                       iv: encMedia.iv,
                       timestamp: Date.now()
                     }
                   ]);
                } catch (vaultErr) { console.error('Vault cloud backup error:', vaultErr); }
              }
           }
          
          scrollToBottom();
        } 
        // Calling is now handled by the Global Calling Manager in App.tsx
      } catch (e) {
        console.warn('Decryption failed for incoming message', e);
      }
    };

    s.on('message:receive', handleReceive);
    return () => { 
      s.off('message:receive', handleReceive); 
      s.off('status:update', handleStatus);
      s.off('connect', doSubscribe);
      s.off('disconnect');
    };
  }, [sharedKey, myUserId, partnerInfo.userId]);

  const sendSecurePayload = async (payload: ChatPayload, messageId?: string) => {
    if (!sharedKey) { console.warn('Cannot send: sharedKey is null'); return; }
    if (!partnerInfo.userId) { console.warn('Cannot send: partnerId is null'); return; }
    const s = getSocket();
    if (!s) { console.warn('Cannot send: socket is null'); return; }

    try {
      const payloadStr = JSON.stringify(payload);
      const enc = await encryptMessage(sharedKey, payloadStr);
      
      // 1. Send via Socket for instant display
      s.emit('message:send', {
        to: partnerInfo.userId,
        encrypted: enc.encrypted,
        iv: enc.iv,
        senderId: myUserId,
        messageId: messageId
      });
      
      // 2. Persist real payloads to Supabase Database
      if (payload.type === 'text' || payload.type === 'media' || payload.type === 'location') {
         await supabase.from('messages').insert({
            id: messageId || Date.now().toString(),
            sender_id: myUserId,
            recipient_id: partnerInfo.userId,
            encrypted_payload: enc.encrypted,
            iv: enc.iv,
            timestamp: Date.now()
         });
      }
    } catch { /* ignored */ }
  };



  const sendReaction = async (msgId: string, emoji: string) => {
      setSelectedMessageId(null);
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, reaction: emoji } : m));
      const db = await initDB();
      const msg = await db.get('messages', msgId);
      if (msg) await db.put('messages', { ...msg, reaction: emoji });
      
      const payload: ChatPayload = { type: 'reaction', messageId: msgId, reaction: emoji };
      const s = getSocket();
      if (s && sharedKey) {
         const enc = await encryptMessage(sharedKey, JSON.stringify(payload));
         s.emit('message:send', { to: partnerInfo.userId, encrypted: enc.encrypted, iv: enc.iv, senderId: myUserId });
      }
  };

  const handleSendText = async () => {
    if (!inputValue.trim()) return;
    const txt = inputValue;
    setInputValue('');
    const currentReply = replyingTo;
    setReplyingTo(null);

    const payload: ChatPayload = { type: 'text', text: txt };
    if (currentReply) {
       try {
           const rp = JSON.parse(currentReply.text);
           payload.replyTo = { id: currentReply.id, text: rp.text || (rp.type === 'media' ? 'Media File' : 'Location') };
       } catch {}
    }
    const msgId = Date.now().toString();
    
    const msg: Message = {
      id: msgId,
      senderId: myUserId,
      text: JSON.stringify(payload),
      timestamp: Date.now(),
      status: 'sent',
    };
    setMessages(prev => [...prev, msg]);
    scrollToBottom();

    const db = await initDB();
    await db.put('messages', msg);

    await sendSecurePayload(payload, msgId);
  };

  const deleteMessagesForEveryone = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} message(s) for everyone?`)) return;

    const idsToDelete = Array.from(selectedIds);
    const db = await initDB();
    
    // 1. Local Delete
    setMessages(prev => prev.filter(m => !selectedIds.has(m.id)));
    for (const id of idsToDelete) {
       await db.delete('messages', id);
    }
    
    // 2. Cloud Delete
    await supabase.from('messages').delete().in('id', idsToDelete);
    
    // 3. Socket Signal
    await sendSecurePayload({ type: 'delete', messageIds: idsToDelete });
    
    setIsSelectionMode(false);
    setSelectedIds(new Set());
  };

  const repairConnection = async () => {
    if (!sharedKey || !myUserId) return;
    try {
      const db = await initDB();
      const auth = await db.get('auth', 'pins');
      await sendSecurePayload({ type: 'identity:sync', nick: auth?.nickname, avatar: auth?.avatar });
      alert('Sync signal sent! If your partner is online, your bridge should turn green in a few seconds.');
    } catch {
      alert('Failed to send sync signal. Check your internet.');
    }
  };

  useEffect(() => {
    if (sharedKey && socketConnected) {
       // Send an invisible sync heartbeat on mount
       initDB().then(db => db.get('auth', 'pins')).then(auth => {
         if (auth) sendSecurePayload({ type: 'identity:sync', nick: auth.nickname, avatar: auth.avatar });
       });
    }
  }, [sharedKey, socketConnected]);

  // ── SEND LOCATION (one-tap) ──
  const sendLocation = () => {
    if (!navigator.geolocation) return alert('Location not supported by your browser');
    setIsProcessingMedia(true);

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        console.log('📍 Location Acquired:', lat, lng);
        
        const payload: ChatPayload = { 
          type: 'location', 
          lat, 
          lng, 
          text: `📍 My Live Location`
        };
        
        const msgId = Date.now().toString();
        const msg: Message = { id: msgId, senderId: myUserId, text: JSON.stringify(payload), timestamp: Date.now(), status: 'sent' };
        
        setMessages(prev => [...prev, msg]);
        scrollToBottom();
        
        const db = await initDB();
        await db.put('messages', msg);
        await sendSecurePayload(payload, msgId);
        
        setIsProcessingMedia(false);
      },
      (err) => {
        setIsProcessingMedia(false);
        console.error('❌ Geolocation Error:', err);
        let errMsg = 'Failed to get location.';
        if (err.code === 1) errMsg = 'Location access denied. Please allow location permissions in your browser settings.';
        else if (err.code === 2) errMsg = 'Location signals are weak. Try moving near a window or outdoors.';
        else if (err.code === 3) errMsg = 'Location request timed out. Try again.';
        alert(errMsg);
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  };

  // ── PHOTO/VIDEO UPLOAD ──
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (fileInputRef.current) fileInputRef.current.value = '';

    setIsProcessingMedia(true);

    try {
      if (!sharedKey) throw new Error('Not paired yet');
      const db = await initDB();
      const msgId = Date.now().toString();
      const isVideo = file.type.startsWith('video');
      const isImage = file.type.startsWith('image');

      // ── HIGH QUALITY image compression (keeps detail, just limits dimensions) ──
      const getImageB64 = (f: File): Promise<string> => {
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX = 1800;
            let { width, height } = img;
            if (width > height && width > MAX) { height *= MAX / width; width = MAX; }
            else if (height > MAX) { width *= MAX / height; height = MAX; }
            canvas.width = width; canvas.height = height;
            canvas.getContext('2d')?.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', 0.85));
          };
          img.onerror = reject;
          img.src = URL.createObjectURL(f);
        });
      };

      // ── Step 1: Upload raw encrypted file to Supabase Storage ──
      const arrayBuffer = await file.arrayBuffer();
      const { encrypted, iv } = await encryptBuffer(sharedKey, arrayBuffer);
      const storagePath = `vault/${myUserId}/${msgId}_${file.name}`;
      const ivB64 = bufferToBase64(iv.buffer as ArrayBuffer);

      const { error: storageErr } = await supabase.storage
        .from('vault')
        .upload(storagePath, new Blob([encrypted], { type: 'application/octet-stream' }), { contentType: 'application/octet-stream' });

      if (storageErr) throw new Error('Storage upload failed: ' + storageErr.message);

      // ── Step 2: Send chat message with storage pointer ──
      const payload: ChatPayload = {
        type: 'media',
        text: file.name,
        mediaType: file.type || (isImage ? 'image/jpeg' : 'video/mp4'),
        storagePath,
        storageIv: ivB64,
      };

      // Also generate a preview thumbnail for images (for inline chat display)
      if (isImage) {
        try {
          const thumb = await getImageB64(file);
          (payload as any).mediaData = thumb;
        } catch {}
      }

      const msg: Message = { id: msgId, senderId: myUserId, text: JSON.stringify(payload), timestamp: Date.now(), status: 'sent' };
      setMessages(prev => [...prev, msg]);
      scrollToBottom();
      await db.put('messages', msg);
      await sendSecurePayload(payload, msgId);

      // ── Step 3: Vault backup for both partners ──
      const vType = isVideo ? 'video' : 'photo';
      const storagePointer = `storage://${storagePath}::${ivB64}`;
      const previewData = isImage ? ((payload as any).mediaData || storagePointer) : storagePointer;

      await db.put('vault', { id: msgId + '_me', name: file.name, type: vType, data: previewData, timestamp: Date.now(), locked: true });

      try {
        const encVault = await encryptMessage(sharedKey, storagePointer);
        await supabase.from('vault').insert([
          { id: msgId + '_me', owner_id: myUserId, name: file.name, type: vType, encrypted_data: encVault.encrypted, iv: encVault.iv, timestamp: Date.now() },
          { id: msgId + '_partner', owner_id: partnerInfo.userId, name: file.name, type: vType, encrypted_data: encVault.encrypted, iv: encVault.iv, timestamp: Date.now() },
        ]);
      } catch (vErr) { console.error('Vault backup error:', vErr); }

    } catch (err: any) {
      console.error('Upload error:', err);
      alert('Upload failed: ' + (err?.message || 'Unknown error'));
    } finally {
      setIsProcessingMedia(false);
    }
  };


  // ── VOICE NOTES ──
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      audioChunksRef.current = [];
      
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        const effectStr = activeVoiceEffectRef.current ? `;effect=${activeVoiceEffectRef.current}` : '';
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onload = async () => {
          const b64 = reader.result as string;
          const payload: ChatPayload = { type: 'media', text: 'Voice Note' + (activeVoiceEffectRef.current ? ` (${activeVoiceEffectRef.current})` : ''), mediaType: 'audio/webm' + effectStr, mediaData: b64 };
          const msgId = Date.now().toString();
          
          const msg: Message = { id: msgId, senderId: myUserId, text: JSON.stringify(payload), timestamp: Date.now(), status: 'sent' };
          setMessages(prev => [...prev, msg]);
          scrollToBottom();
          const db = await initDB();
          await db.put('messages', msg);
          await sendSecurePayload(payload, msgId);

          // Backup voice to vault cloud for both partners
          if (sharedKey) {
            const encMedia = await encryptMessage(sharedKey, b64);
            
            await db.put('vault', {
               id: msgId + '_me', name: 'Voice Note', type: 'voice', data: b64, timestamp: Date.now(), locked: true
            });
            
            await supabase.from('vault').insert([
               {
                  id: msgId + '_me', 
                  owner_id: myUserId, 
                  name: 'Voice Note', 
                  type: 'voice', 
                  encrypted_data: encMedia.encrypted, 
                  iv: encMedia.iv,
                  timestamp: Date.now()
               },
               {
                  id: msgId + '_partner', 
                  owner_id: partnerInfo.userId, 
                  name: 'Voice Note', 
                  type: 'voice', 
                  encrypted_data: encMedia.encrypted, 
                  iv: encMedia.iv,
                  timestamp: Date.now()
               }
            ]);
          }
        };
        reader.readAsDataURL(audioBlob);
        stream.getTracks().forEach(t => t.stop());
      };
      
      mr.start();
      setIsRecording(true);
      setRecordDuration(0);
      recordTimerRef.current = setInterval(() => setRecordDuration(p => p + 1), 1000);
    } catch {
      alert('Could not access microphone.');
    }
  };

  const stopRecording = (effect?: 'chipmunk' | 'deep') => {
    activeVoiceEffectRef.current = effect || null;
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    }
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && (isRecording || isVideoRecording)) {
      mediaRecorderRef.current.stop();
      audioChunksRef.current = []; // dump the array
      setIsRecording(false);
      setIsVideoRecording(false);
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      if (videoPreviewRef.current?.srcObject) {
         (videoPreviewRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
         videoPreviewRef.current.srcObject = null;
      }
    }
  };

  const startVideoNote = async () => {
    try {
      // Safely bound the resolution to avoid OutOfMemory on older mobile devices
      const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { facingMode: 'user', width: { ideal: 480, max: 640 }, height: { ideal: 480, max: 640 } }, 
          audio: { echoCancellation: true, noiseSuppression: true } 
      });
      
      // Let the browser choose the native OS codec and bound bitrate to 1Mbps max
      const mr = new MediaRecorder(stream, { videoBitsPerSecond: 1000000 });
      mediaRecorderRef.current = mr;
      audioChunksRef.current = [];
      
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = async () => {
         if (audioChunksRef.current.length === 0) return;
         // Use the recorder's native returned mimeType instead of hardcoding webm
         const mimeType = mr.mimeType || 'video/mp4';
         const videoBlob = new Blob(audioChunksRef.current, { type: mimeType });
         
         const file = new File([videoBlob], `VideoNote_${Date.now()}.mp4`, { type: mimeType });
         
         setIsProcessingMedia(true);
         try {
            const db = await initDB();
            const msgId = Date.now().toString();
            
            if (sharedKey) {
               // Use standard FileReader which is bulletproof on absolute iOS versions
               const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
                   const reader = new FileReader();
                   reader.onload = () => resolve(reader.result as ArrayBuffer);
                   reader.onerror = reject;
                   reader.readAsArrayBuffer(file);
               });
               
               const { encrypted, iv } = await encryptBuffer(sharedKey, arrayBuffer);
               const storagePath = `vault/${myUserId}/${msgId}_${file.name}`;
               const ivB64 = bufferToBase64(iv.buffer as any);
               
               // Wrap the encrypted ArrayBuffer into a perfectly compliant Blob for Supabase
               const encryptedBlob = new Blob([encrypted], { type: 'application/octet-stream' });
               const { error: storageErr } = await supabase.storage.from('vault').upload(storagePath, encryptedBlob, { contentType: 'application/octet-stream' });
               if (storageErr) throw storageErr;
               
               const payload: ChatPayload = { type: 'media', text: 'Video Note', mediaType: mimeType, storagePath, storageIv: ivB64 };
                
                const msg: Message = { id: msgId, senderId: myUserId, text: JSON.stringify(payload), timestamp: Date.now(), status: 'sent' };
                setMessages(prev => [...prev, msg]);
                scrollToBottom();
                await db.put('messages', msg);
                await sendSecurePayload(payload, msgId);
                
                // Save video note to vault for both partners
                const storagePointer = `storage://${storagePath}::${ivB64}`;
                await db.put('vault', { id: msgId + '_me', name: 'Video Note', type: 'video', data: storagePointer, timestamp: Date.now(), locked: true });
                try {
                  const encVault = await encryptMessage(sharedKey, storagePointer);
                  await supabase.from('vault').insert([
                    { id: msgId + '_me', owner_id: myUserId, name: 'Video Note', type: 'video', encrypted_data: encVault.encrypted, iv: encVault.iv, timestamp: Date.now() },
                    { id: msgId + '_partner', owner_id: partnerInfo.userId, name: 'Video Note', type: 'video', encrypted_data: encVault.encrypted, iv: encVault.iv, timestamp: Date.now() }
                  ]);
                } catch (vErr) { console.error('Video note vault sync error:', vErr); }
            }
         } catch(e: any) {
            console.error('VideoNote Error:', e);
            const errDetails = e?.message || JSON.stringify(e) || 'Unknown Crash';
            alert(`Video Note Error: ${errDetails}. Please ensure you have a "vault" storage bucket created in Supabase with Public access.`);
         } finally {
            setIsProcessingMedia(false);
         }
      };
      
      mr.start();
      setIsVideoRecording(true);
      setRecordDuration(0);
      
      // Hook up UI Preview
      setTimeout(() => {
         if (videoPreviewRef.current) {
            videoPreviewRef.current.srcObject = stream;
            videoPreviewRef.current.play().catch(()=>{});
         }
      }, 100);

      recordTimerRef.current = setInterval(() => {
         setRecordDuration((prev) => {
            if (prev >= 59) {
               stopVideoNote();
               return prev + 1;
            }
            return prev + 1;
         });
      }, 1000);
    } catch {
      alert('Could not access camera for Video Note.');
    }
  };

  const stopVideoNote = () => {
     if (mediaRecorderRef.current && isVideoRecording) {
        mediaRecorderRef.current.stop();
        setIsVideoRecording(false);
        if (recordTimerRef.current) clearInterval(recordTimerRef.current);
        if (videoPreviewRef.current?.srcObject) {
           (videoPreviewRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
        }
     }
  };

  const clearChat = async () => {
    if (!confirm('Nuclear-wipe chat history for BOTH you and your partner?')) return;
    const db = await initDB();
    
    // 1. Delete from Cloud
    if (myUserId && partnerInfo.userId) {
       await supabase.from('messages')
         .delete()
         .or(`and(sender_id.eq.${myUserId},recipient_id.eq.${partnerInfo.userId}),and(sender_id.eq.${partnerInfo.userId},recipient_id.eq.${myUserId})`);
    }

    // 2. Clear locally
    await db.clear('messages');
    setMessages([]);
    setShowMenu(false);
  };

  const startCall = (type: 'video' | 'voice') => { 
    window.dispatchEvent(new CustomEvent('start-global-call', { detail: { type } }));
  };

  // Generate pretty duration string
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };


  return (
    <div className="flex flex-col h-full bg-[#0a0a0c] relative overflow-hidden w-full">
      <LiveWallpaper type={wallpaper} />
      <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-[#0a0a0c] z-0 pointer-events-none" />

      {isVideoRecording && (
         <div className="absolute inset-0 z-[100] bg-black/95 flex flex-col items-center justify-center pt-20 pb-40">
            <h2 className="text-white/60 text-xs mb-8 uppercase tracking-widest bg-white/5 py-1.5 px-6 rounded-full border border-white/10 shadow-[0_0_20px_rgba(255,255,255,0.1)]">Video Note Recording</h2>
            <div className="relative w-full max-w-[320px] aspect-[3/4] rounded-[40px] overflow-hidden shadow-[0_0_60px_rgba(239,68,68,0.3)] border-2 border-red-500/30">
               <video ref={videoPreviewRef} className="w-full h-full object-cover" muted playsInline />
               <div className="absolute top-4 right-4 bg-black/60 px-3 py-1 rounded-full text-red-400 font-black text-sm tracking-widest border border-red-500/30">
                  {formatTime(recordDuration)}
               </div>
            </div>
            <div className="absolute bottom-16 flex space-x-6 items-center">
               <button onClick={cancelRecording} className="w-14 h-14 bg-white/10 border border-white/20 rounded-full flex items-center justify-center text-white active:scale-95 transition-transform hover:bg-white/20"><X size={24} /></button>
               <button onClick={stopVideoNote} className="w-20 h-20 bg-red-500 rounded-full flex items-center justify-center text-white active:scale-95 shadow-[0_0_40px_rgba(239,68,68,0.6)] transition-transform hover:bg-red-400"><Send size={32} /></button>
            </div>
         </div>
      )}

       <AnimatePresence>
          {isSelectionMode ? (
             <SelectionHeader 
                selectedCount={selectedIds.size} 
                onCancel={() => { setIsSelectionMode(false); setSelectedIds(new Set()); }}
                onDelete={deleteMessagesForEveryone}
             />
          ) : (
             <ChatHeader 
               partnerInfo={partnerInfo} partnerOnline={partnerOnline} isBlurred={isBlurred} 
               setIsBlurred={setIsBlurred} startCall={startCall} showMenu={showMenu} 
               setShowMenu={setShowMenu} clearChat={clearChat} 
               sendSecurePayload={sendSecurePayload} wallpaper={wallpaper} 
               setWallpaper={setWallpaper} navigate={navigate} 
               socketConnected={socketConnected} sharedKey={sharedKey}
               repairConnection={repairConnection}
               isLiteMode={isLiteMode}
             />
          )}
       </AnimatePresence>

      <div ref={scrollRef} className="flex-1 overflow-y-auto mt-[80px] px-2 sm:px-4 space-y-4 pt-4 pb-[180px] no-scrollbar scroll-container" style={{ contain: 'content', willChange: 'transform', WebkitOverflowScrolling: 'touch' }}>
             {messages.map((m, idx) => (
               <MessageBubble 
                 key={m.id} msg={m} isMe={m.senderId === myUserId} isNew={idx === messages.length - 1} 
                 selectedMessageId={selectedMessageId} isBlurred={isBlurred} handleMessageTap={handleMessageTap} 
                 sendReaction={sendReaction} setReplyingTo={setReplyingTo} setSelectedMessageId={setSelectedMessageId} 
                 sharedKey={sharedKey} setViewMedia={setViewMedia} setFullScreenMap={setFullScreenMap}
                 startAudioAnalysis={startAudioAnalysis} stopAudioAnalysis={stopAudioAnalysis}
                 isSelectionMode={isSelectionMode} isSelected={selectedIds.has(m.id)}
                 toggleSelectionMode={toggleSelectionMode}
               />
             ))}

        {isPartnerTyping && (
              <div className="flex justify-start w-full animate-fade-in">
                 <div className="bg-zinc-800/80 px-4 py-3 rounded-2xl rounded-bl-sm border border-white/5 flex items-center space-x-1.5">
                    <div className="w-1.5 h-1.5 bg-white/50 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                    <div className="w-1.5 h-1.5 bg-white/50 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                    <div className="w-1.5 h-1.5 bg-white/50 rounded-full animate-bounce"></div>
                 </div>
              </div>
           )}
      </div>

      <ChatInput 
        replyingTo={replyingTo} setReplyingTo={setReplyingTo} isProcessingMedia={isProcessingMedia} 
        isRecording={isRecording} formatTime={formatTime} recordDuration={recordDuration} 
        sendLocation={sendLocation} fileInputRef={fileInputRef} handleFileUpload={handleFileUpload} 
        startVideoNote={startVideoNote} inputValue={inputValue} handleTyping={handleTyping} 
        handleSendText={handleSendText} startRecording={startRecording} 
        cancelRecording={cancelRecording} stopRecording={stopRecording} 
        showEmoji={showEmoji} setShowEmoji={setShowEmoji}
      />

      <AnimatePresence>
        {showEmoji && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
            className="fixed bottom-[180px] left-4 right-4 z-[100] h-[350px] overflow-hidden rounded-3xl border border-white/10 shadow-2xl bg-zinc-900"
          >
             <React.Suspense fallback={<div className="h-full w-full bg-zinc-900 flex items-center justify-center text-white/20 text-xs font-black uppercase tracking-widest">Loading Emojis...</div>}>
               <EmojiPicker 
                  onEmojiClick={(e: any) => { setInputValue(prev => prev + e.emoji); setShowEmoji(false); }}
                  theme={'dark' as any}
                  width="100%"
                  height="100%"
               />
             </React.Suspense>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {viewMedia && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[110] bg-black/95 flex flex-col justify-center items-center">
            <button onClick={() => setViewMedia(null)} className="absolute top-6 right-6 w-12 h-12 bg-white/10 rounded-full flex items-center justify-center text-white active:scale-95 z-10"><X size={24} /></button>
            {viewMedia.type === 'photo' && <img src={viewMedia.url} className="max-w-full max-h-full object-contain" alt="Enlarged" />}
            {viewMedia.type === 'video' && <video src={viewMedia.url} className="max-w-full max-h-full" controls autoPlay />}
          </motion.div>
        )}
      </AnimatePresence>

        {fullScreenMap && (
          <div className="fixed inset-0 z-[120] bg-black flex flex-col animate-in fade-in duration-300">
            <div className="p-4 bg-[#0a0a0c] border-b border-white/5 flex justify-between items-center z-10 shadow-2xl">
               <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                    <MapPin className="text-primary" size={20} />
                  </div>
                  <div>
                    <h3 className="text-white font-bold text-sm tracking-wide">Live Location</h3>
                    <div className="flex items-center space-x-1.5">
                      <div className="w-2 h-2 bg-green-500 rounded-full" />
                      <p className="text-green-400 text-[10px] uppercase font-black tracking-widest leading-none">High-Detail Hybrid</p>
                    </div>
                  </div>
               </div>
               <button onClick={() => setFullScreenMap(null)} className="w-11 h-11 bg-white/5 rounded-full flex items-center justify-center text-white active:scale-90 transition-transform"><X size={22} /></button>
            </div>
            
            <div className="flex-1 bg-black relative">
               <LeafletMap key={`${fullScreenMap.lat}-${fullScreenMap.lng}`} lat={fullScreenMap.lat} lng={fullScreenMap.lng} />
            </div>

            <div className="p-6 bg-[#0a0a0c] border-t border-white/5 flex flex-col space-y-4">
               <button 
                  onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${fullScreenMap.lat},${fullScreenMap.lng}`, '_blank')}
                  className="bg-primary hover:bg-primary/90 text-white font-black px-8 py-4 rounded-3xl text-xs uppercase tracking-[0.2em] shadow-2xl active:scale-95 transition-all flex items-center justify-center space-x-3"
               >
                  <span>🧭 Open in Google Maps</span>
               </button>
               <p className="text-[10px] text-white/30 text-center uppercase tracking-widest font-black">Stable Satellite Connectivity Active</p>
            </div>
          </div>
        )}
    </div>
  );
};

// --- SUB-COMPONENTS (Memoized for speed & re-render isolation) ---

const MessageBubble = React.memo(({ 
  msg, isMe, isNew, selectedMessageId, isBlurred, handleMessageTap, 
  sendReaction, setReplyingTo, setSelectedMessageId, sharedKey, setViewMedia, 
  setFullScreenMap, startAudioAnalysis, stopAudioAnalysis,
  isSelectionMode, isSelected, toggleSelectionMode
}: any) => {
  const pl: ChatPayload = JSON.parse(msg.text);
  const [swipeX, setSwipeX] = useState(0);
  const touchStart = useRef(0);

  const onLongPress = (e: any) => {
    e.preventDefault();
    toggleSelectionMode(msg.id);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStart.current = e.touches[0].clientX;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (isSelectionMode) return;
    const delta = e.touches[0].clientX - touchStart.current;
    if (delta > 0 && delta < 80) setSwipeX(delta);
  };

  const handleTouchEnd = () => {
    if (swipeX > 50) {
      setReplyingTo(msg);
      if (window.navigator.vibrate) window.navigator.vibrate(10);
    }
    setSwipeX(0);
  };
  
  return (
    <div 
      className={`flex flex-col w-full ${isMe ? 'items-end' : 'items-start'} mb-1 content-auto ${isNew ? 'animate-fade-in' : ''}`}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{ transform: `translateX(${swipeX}px)`, transition: swipeX === 0 ? 'transform 0.2s ease-out' : 'none' }}
    >
      <div className={`flex items-center space-x-3 w-full ${isMe ? 'flex-row-reverse space-x-reverse' : 'flex-row'}`}>
        {swipeX > 30 && (
          <div className="absolute -left-10 flex items-center justify-center text-primary/40">
            <Share2 size={24} className="animate-pulse" />
          </div>
        )}

        {isSelectionMode && (
          <div className="flex items-center justify-center w-6 h-6 shrink-0">
             <div className={`w-5 h-5 rounded-full border-2 transition-all flex items-center justify-center ${isSelected ? 'bg-primary border-primary' : 'border-white/20'}`}>
                {isSelected && <Check size={12} className="text-white" />}
             </div>
          </div>
        )}
        
        <div 
          onClick={() => handleMessageTap(msg.id)}
          onContextMenu={(e) => onLongPress(e)}
          className={`relative max-w-[85%] group ${isBlurred ? 'blur-md hover:blur-none transition-all duration-500' : ''}`}
        >
          <div className={`
            px-4 py-2.5 rounded-3xl shadow-lg relative overflow-hidden border
            ${isMe ? 'bg-primary/90 text-white border-white/10 rounded-br-none' : 'bg-zinc-800/90 text-zinc-100 border-white/5 rounded-bl-none'}
            ${selectedMessageId === msg.id || isSelected ? 'ring-2 ring-white/50 scale-[1.02]' : ''}
            transition-transform duration-150 active:scale-95
          `}>
          {pl.replyTo && (
            <div className="mb-2 bg-black/20 rounded-lg px-2 py-1.5 border-l-2 border-white/30 text-[10px] opacity-70">
               <p className="font-black uppercase tracking-widest mb-0.5">Response to</p>
               <p className="truncate italic">{pl.replyTo.text}</p>
            </div>
          )}

          {pl.type === 'text' && <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{pl.text}</p>}
          
          {pl.type === 'media' && (
            <MediaWrapper 
              pl={pl} sharedKey={sharedKey} setViewMedia={setViewMedia} 
              startAudioAnalysis={startAudioAnalysis} stopAudioAnalysis={stopAudioAnalysis} 
            />
          )}

          {pl.type === 'location' && (
             <div onClick={() => setFullScreenMap({ lat: pl.lat!, lng: pl.lng! })} className="w-48 h-32 rounded-xl overflow-hidden mt-1 relative border border-white/10 cursor-pointer group/map">
                <img 
                  src={`https://static-maps.yandex.ru/1.x/?ll=${pl.lng},${pl.lat}&z=14&l=sat,skl&size=300,200&pt=${pl.lng},${pl.lat},pm2rdm`} 
                  className="w-full h-full object-cover" 
                  alt="Location Map" 
                  onError={(e: any) => e.target.src = 'https://www.openstreetmap.org/assets/embed-map-78e7f53a.png'}
                />
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover/map:opacity-100 transition-opacity">
                   <div className="bg-primary px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest text-white shadow-xl">Open Map</div>
                </div>
                <div className="absolute top-2 left-2 bg-black/60 px-2 py-0.5 rounded-lg border border-white/10 flex items-center space-x-1.5">
                   <MapPin size={10} className="text-primary" />
                   <span className="text-[9px] font-bold text-white/80">Satellite Live</span>
                </div>
             </div>
          )}

          {msg.reaction && (
            <div className={`absolute -bottom-2 ${isMe ? '-left-2' : '-right-2'} bg-zinc-900 border border-white/10 rounded-full px-1.5 py-0.5 text-xs shadow-xl`}>
              {msg.reaction}
            </div>
          )}

          <div className="flex items-center justify-end mt-1 space-x-1.5 opacity-60">
            <span className="text-[10px] font-medium tracking-wide">
              {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            {isMe && <span className="text-[10px] tracking-tighter">✓✓</span>}
          </div>
        </div>

        <AnimatePresence>
          {selectedMessageId === msg.id && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9 }} className={`absolute top-full mt-2 z-20 flex bg-zinc-900/95 border border-white/10 rounded-2xl p-1.5 shadow-2xl space-x-2 ${isMe ? 'right-0' : 'left-0'}`}>
              {['❤️', '🔥', '😂', '😮', '😢', '👍'].map(emoji => (
                <button key={emoji} onClick={(e) => { e.stopPropagation(); sendReaction(msg.id, emoji); }} className="p-1.5 hover:bg-white/10 rounded-lg text-lg transition-transform hover:scale-125 active:scale-90">{emoji}</button>
              ))}
              <div className="w-[1px] bg-white/10 mx-1 self-stretch" />
              <button onClick={(e) => { e.stopPropagation(); setReplyingTo(msg); setSelectedMessageId(null); }} className="p-1.5 px-3 bg-primary/20 text-primary rounded-lg text-xs font-black uppercase tracking-widest border border-primary/20">Reply</button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  </div>
  );
});

const SelectionHeader = React.memo(({ selectedCount, onCancel, onDelete }: any) => (
  <div className="fixed top-0 w-full z-40 bg-zinc-900 border-b border-white/10 px-4 py-3 flex items-center justify-between animate-in slide-in-from-top duration-300 shadow-2xl">
    <div className="flex items-center space-x-4">
      <button onClick={onCancel} className="p-2 text-white/60 hover:text-white transition-all"><X size={24} /></button>
      <div className="flex flex-col">
        <span className="text-white font-bold text-base">{selectedCount} Selected</span>
        <span className="text-white/30 text-[9px] font-black uppercase tracking-widest leading-none">Global Control Active</span>
      </div>
    </div>
    <div className="flex items-center space-x-2">
       <button 
          onClick={onDelete}
          className="bg-red-500/10 border border-red-500/20 text-red-500 px-6 py-2 rounded-full font-black text-[10px] uppercase tracking-widest active:scale-95 transition-all shadow-lg"
       >
          Delete for Everyone
       </button>
    </div>
  </div>
));

const ChatHeader = React.memo(({ partnerInfo, partnerOnline, isBlurred, setIsBlurred, startCall, showMenu, setShowMenu, clearChat, sendSecurePayload, wallpaper, setWallpaper, navigate, socketConnected, sharedKey, repairConnection }: any) => (
  <div className={`fixed top-0 w-full z-30 bg-[#0a0a0c]/98 border-b border-white/5 shadow-2xl px-2 sm:px-4 py-3 flex items-center justify-between`}>
    <div className="flex items-center space-x-2 sm:space-x-3 flex-1 min-w-0 pr-2">
      <button onClick={() => navigate('/')} className="p-2 -ml-1 sm:-ml-2 text-white/40 hover:text-white transition-colors active:scale-90 shrink-0">
         <ChevronLeft size={24} />
      </button>
      <div className="relative shrink-0">
        {partnerOnline && <div className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-[#0a0a0c] z-10" />}
        <div className="relative w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-gradient-to-tr from-primary to-accent overflow-hidden border border-white/10">
          <img src={partnerInfo.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${partnerInfo.userId || 'partner'}`} alt={partnerInfo.nick} className="w-full h-full object-cover" loading="lazy" />
        </div>
        <div className={`absolute bottom-0 right-0 w-3 h-3 sm:w-3.5 sm:h-3.5 border-2 border-[#0a0a0c] rounded-full ${partnerOnline ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-white/20'}`} />
      </div>
      <div className="flex-1 min-w-0">
        <h2 className="text-white font-bold truncate text-sm sm:text-base">{partnerInfo.nick || 'Partner'}</h2>
        <div className="flex items-center space-x-2 mt-0.5">
          <ConnectionHealth 
            isSocketConnected={socketConnected}
            isPartnerOnline={partnerOnline}
            isEncryptionReady={!!sharedKey}
          />
        </div>
      </div>
    </div>
    
    <div className="flex items-center space-x-1 sm:space-x-3 text-white/60 shrink-0">
       <button onClick={() => setIsBlurred(!isBlurred)} className={`p-2 sm:p-2.5 rounded-full active:scale-95 transition-all ${isBlurred ? 'bg-primary/20 text-primary' : 'text-white/60 hover:bg-white/10'}`}>
         {isBlurred ? <EyeOff size={18} className="sm:size-5" /> : <Eye size={18} className="sm:size-5" />}
       </button>
      <button onClick={() => startCall('voice')} className="p-2 hover:text-white transition-colors active:scale-95"><Phone size={20} className="sm:size-5.5" /></button>
      <button onClick={() => startCall('video')} className="p-2 hover:text-white transition-colors active:scale-95"><Video size={20} className="sm:size-6" /></button>
      <div className="relative">
        <button onClick={() => setShowMenu(!showMenu)} className="p-2 hover:text-white transition-colors active:scale-95">
          <MoreVertical size={20} className="sm:size-6" />
        </button>
        <AnimatePresence>
          {showMenu && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: -10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: -10 }}
              className="absolute right-0 top-10 w-44 bg-zinc-900 border border-white/10 rounded-xl shadow-2xl py-2 z-50 overflow-hidden"
            >
                <button onClick={() => { sendSecurePayload({ type: 'location:request' }); setShowMenu(false); }} className="w-full text-left px-4 py-2 text-white text-sm hover:bg-white/5 active:bg-white/10 transition-colors border-b border-white/5 flex items-center justify-between">
                  Ping Location <MapPin size={14} className="text-primary" />
                </button>
                <button onClick={repairConnection} className="w-full flex items-center space-x-3 p-3 rounded-xl hover:bg-white/5 transition-colors text-primary">
                  <Fingerprint size={18} />
                  <span className="text-sm font-semibold">Repair Connection</span>
                </button>
                <button onClick={clearChat} className="w-full flex items-center space-x-3 p-3 rounded-xl hover:bg-white/5 transition-colors text-red-500">
                  Clear History
                </button>
                <div className="px-4 py-2">
                   <p className="text-[10px] text-white/30 uppercase tracking-widest font-black mb-2">Wallpaper</p>
                   <div className="grid grid-cols-2 gap-2">
                      {[
                        { name: 'Nebula', type: 'nebula' },
                        { name: 'Dream', type: 'video:https://cdn.pixabay.com/video/2021/09/01/87134-596489432_tiny.mp4' },
                        { name: 'Aurora', type: 'video:https://cdn.pixabay.com/video/2024/02/09/199738-911226105_tiny.mp4' },
                        { name: 'Rose', type: 'rose' },
                        { name: 'Silk', type: '/themes/silk.png' },
                        { name: 'Midnight', type: '/themes/midnight.png' },
                        { name: 'Golden', type: '/themes/golden.png' }
                      ].map(w => (
                         <button 
                            key={w.name} 
                            onClick={() => { setWallpaper(w.type); setShowMenu(false); }}
                            className={`px-2 py-1.5 rounded-lg text-[9px] font-bold uppercase transition-all ${wallpaper === w.type ? 'bg-primary text-white' : 'bg-white/5 text-white/50 hover:bg-white/10'}`}
                         >
                            {w.name}
                         </button>
                      ))}
                   </div>
                </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  </div>
));

const ChatInput = React.memo(({ 
  replyingTo, setReplyingTo, isProcessingMedia, isRecording, formatTime, recordDuration, sendLocation, 
  fileInputRef, handleFileUpload, startVideoNote, inputValue, handleTyping, handleSendText, 
  startRecording, cancelRecording, stopRecording, showEmoji, setShowEmoji
}: any) => (
  <div className="fixed bottom-0 w-full p-4 pb-12 z-20 bg-gradient-to-t from-[#0a0a0c] via-[#0a0a0c] to-transparent pt-12">
    <div className="flex flex-col space-y-2 relative">
      <AnimatePresence>
         {replyingTo && (
            <motion.div initial={{opacity: 0, y: 10}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, scale: 0.95}} className="flex items-center justify-between bg-zinc-900 border border-white/10 rounded-xl px-4 py-2 text-white/80 mx-2 shadow-xl">
               <div className="flex flex-col overflow-hidden">
                  <span className="text-[10px] text-primary font-black uppercase tracking-widest">Replying</span>
                  <span className="text-xs truncate max-w-[200px] italic">
                     {(() => { try { const p = JSON.parse(replyingTo.text); return p.text || (p.type==='media'?'Media File':'Message'); } catch { return 'Message'; }})()}
                  </span>
               </div>
               <button onClick={() => setReplyingTo(null)} className="p-1 hover:bg-white/10 rounded-full"><X size={16}/></button>
            </motion.div>
         )}
      </AnimatePresence>

      <div className="w-full flex items-center bg-[#151518]/95 border border-white/5 rounded-[40px] px-2 py-2 relative min-h-[60px] shadow-2xl overflow-hidden">
        {isProcessingMedia && <div className="absolute inset-0 bg-black/60 rounded-[40px] flex items-center justify-center z-10 backdrop-blur-sm"><div className="w-5 h-5 border-2 border-primary/50 border-t-primary rounded-full animate-spin" /></div>}
        <div className="flex-1 flex items-center min-w-0">
           {isRecording ? (
             <div className="flex-1 flex items-center px-4">
                <div className="w-2.5 h-2.5 bg-red-500 rounded-full mr-3 animate-pulse" /><span className="text-red-400 font-bold tracking-widest text-sm">{formatTime(recordDuration)}</span>
                <div className="ml-auto text-[10px] text-white/40 uppercase tracking-widest font-black mr-2">Recording</div>
             </div>
           ) : (
             <>
               <button onClick={sendLocation} className="p-2 text-white/40 hover:text-primary transition-colors rounded-full active:scale-90"><MapPin size={22} /></button>
               <button onClick={() => fileInputRef.current?.click()} className="p-2 text-white/30 hover:text-white transition-colors rounded-full active:scale-90"><Camera size={22} /></button>
               <button onClick={startVideoNote} className="p-2 text-white/30 hover:text-white transition-colors rounded-full active:scale-90"><Video size={22} /></button>
               <input
                  type="text" value={inputValue} onChange={handleTyping} onKeyDown={(e) => e.key === 'Enter' && handleSendText()} 
                  placeholder="Whisper something..." className="bg-transparent flex-1 filter-none min-w-0 outline-none text-white text-[16px] px-3 placeholder:text-white/20" 
               />
               <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept="image/*,video/*" />
             </>
           )}
        </div>
        <div className="flex items-center space-x-1.5 ml-1 flex-shrink-0 mr-1">
           <button onClick={() => setShowEmoji(!showEmoji)} className="w-11 h-11 text-white/30 hover:text-white transition-colors active:scale-90 flex items-center justify-center">
              <span className="text-xl">😊</span>
           </button>
           {inputValue.trim() ? (
             <motion.button layoutId="chat-primary-action" onClick={handleSendText} className="w-11 h-11 bg-primary rounded-full flex items-center justify-center text-white active:scale-90 shadow-lg"><Send size={18} className="ml-0.5" /></motion.button>
           ) : isRecording ? (
              <div className="flex items-center space-x-1">
                 <button onClick={cancelRecording} className="w-9 h-9 bg-white/10 rounded-full flex items-center justify-center text-white/60 active:scale-95"><X size={16} /></button>
                 <button onClick={() => stopRecording('deep')} className="w-10 h-10 bg-indigo-600 rounded-full flex items-center justify-center text-white text-[8px] font-black active:scale-95">DEEP</button>
                 <button onClick={() => stopRecording('chipmunk')} className="w-10 h-10 bg-fuchsia-500 rounded-full flex items-center justify-center text-white text-[8px] font-black active:scale-95">FUN</button>
                 <button onClick={() => stopRecording()} className="w-11 h-11 bg-red-500 rounded-full flex items-center justify-center text-white active:scale-95 shadow-lg"><Send size={18} /></button>
              </div>
           ) : (
              <motion.button layoutId="chat-primary-action" onClick={startRecording} className="w-11 h-11 bg-white/5 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-all active:scale-90"><Mic size={20} /></motion.button>
           )}
        </div>
      </div>
    </div>
  </div>
));

const LeafletMap = ({ lat, lng }: { lat: number; lng: number }) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      if (mapRef.current && !mapInstance.current) {
        const L = (window as any).L;
        if (!L) return;
        clearInterval(timer);

        try {
          const map = L.map(mapRef.current, {
            zoomControl: false,
            attributionControl: false,
            fadeAnimation: true,
            zoomAnimation: true
          }).setView([lat, lng], 16);

          // Premium Hybrid Tiles
          L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
            maxZoom: 20
          }).addTo(map);

          L.control.zoom({ position: 'bottomright' }).addTo(map);

          const icon = L.divIcon({
            className: 'custom-map-marker',
            html: `
              <div class="relative flex items-center justify-center animate-pulse">
                <div class="absolute w-12 h-12 bg-primary/30 rounded-full"></div>
                <div class="relative w-5 h-5 bg-primary border-2 border-white rounded-full shadow-2xl"></div>
              </div>
            `,
            iconSize: [48, 48],
            iconAnchor: [24, 24]
          });

          L.marker([lat, lng], { icon }).addTo(map);
          mapInstance.current = map;

          // --- LIVE ROADMAP LOGIC ---
          if (navigator.geolocation) {
             navigator.geolocation.getCurrentPosition(async (pos) => {
                const uLat = pos.coords.latitude;
                const uLng = pos.coords.longitude;
                
                // Add User Marker
                const userIcon = L.divIcon({
                  className: 'user-map-marker',
                  html: `<div class="w-4 h-4 bg-blue-500 border-2 border-white rounded-full shadow-lg"></div>`,
                  iconSize: [16, 16],
                  iconAnchor: [8, 8]
                });
                L.marker([uLat, uLng], { icon: userIcon }).addTo(map);

                try {
                  const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${uLng},${uLat};${lng},${lat}?overview=full&geometries=geojson`);
                  const data = await res.json();
                  if (data.routes && data.routes[0]) {
                    const coords = data.routes[0].geometry.coordinates.map((c: any) => [c[1], c[0]]);
                    const route = L.polyline(coords, {
                      color: '#ef4444',
                      weight: 5,
                      opacity: 0.8,
                      lineJoin: 'round',
                      dashArray: '1, 10'
                    }).addTo(map);
                    
                    // Fit map to show both
                    map.fitBounds(route.getBounds(), { padding: [50, 50] });
                    
                    // Animate the route line
                    let offset = 0;
                    const animate = () => {
                       offset = (offset + 1) % 20;
                       route.setStyle({ dashOffset: `${-offset}` });
                       requestAnimationFrame(animate);
                    };
                    animate();
                  }
                } catch (err) { console.error('Routing failed', err); }
             });
          }

          setTimeout(() => map.invalidateSize(), 200);
        } catch (e) {
          console.error('Map Load Error:', e);
        }
      }
    }, 150);

    return () => {
      clearInterval(timer);
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, [lat, lng]);

  return (
    <div className="relative w-full h-full">
      <div ref={mapRef} className="w-full h-full bg-black border-none outline-none overflow-hidden" />
      <div className="absolute top-6 left-1/2 -translate-x-1/2 z-[1000] flex flex-col items-center">
         <div className="bg-black/60 backdrop-blur-md border border-white/10 px-4 py-2 rounded-2xl shadow-2xl flex items-center space-x-3 pointer-events-auto">
            <div className="w-2 h-2 bg-red-500 rounded-full animate-ping" />
            <span className="text-white text-[10px] font-black uppercase tracking-[0.2em]">Partner Live Roadmap</span>
         </div>
         <button 
           onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, '_blank')}
           className="mt-4 bg-primary px-6 py-2.5 rounded-full text-white text-xs font-black uppercase tracking-widest shadow-[0_0_20px_rgba(239,68,68,0.4)] active:scale-95 transition-transform"
         >
           Get Directions
         </button>
      </div>
    </div>
  );
};




import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Camera, Mic, Phone, Video, MoreVertical, ShieldCheck, X, Volume2, Eye, EyeOff, MapPin, Wand2 } from 'lucide-react';
import { type Message, initDB } from '../lib/db';
import { supabase } from '../lib/supabase';
import { initSocket, getSocket } from '../lib/socket';
import { encryptMessage, decryptMessage, deriveSharedSecret, importPublicKey, encryptBuffer, decryptBuffer, bufferToBase64, base64ToBuffer } from '../lib/crypto';
import { LiveWallpaper } from '../components/LiveWallpaper';

interface ChatScreenProps {
  partnerNickname?: string;
}

interface SupabaseMessage { id: string; sender_id: string; recipient_id: string; encrypted_payload: string; iv: string; timestamp: number }

interface ChatPayload {
  type: 'text' | 'media' | 'location' | 'typing' | 'call:offer' | 'call:answer' | 'call:ice' | 'call:end' | 'reaction' | 'identity:sync';
  text?: string;
  mediaType?: string;
  mediaData?: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  callType?: 'video' | 'voice';
  messageId?: string;
  reaction?: string;
  nick?: string;
  avatar?: string;
  storagePath?: string;
  storageIv?: string;
  lat?: number;
  lng?: number;
}

export const ChatScreen: React.FC<ChatScreenProps> = ({ partnerNickname }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [sharedKey, setSharedKey] = useState<CryptoKey | null>(null);
  const [myUserId, setMyUserId] = useState('');
  const [partnerInfo, setPartnerInfo] = useState<{ userId: string; nick: string; avatar?: string }>({ userId: '', nick: 'Partner ❤️' });
  const [showMenu, setShowMenu] = useState(false);
  const [isBlurred, setIsBlurred] = useState(false); // Shoulder surfing protection
  const lastTapRef = useRef<{ id: string, time: number }>({ id: '', time: 0 });
  const [partnerOnline, setPartnerOnline] = useState(false);
  const partnerIdRef = useRef('');
  
  // States
  const [isProcessingMedia, setIsProcessingMedia] = useState(false);
  const [viewMedia, setViewMedia] = useState<{ url: string; type: 'photo' | 'video' } | null>(null);
  const [fullScreenMap, setFullScreenMap] = useState<{lat: number, lng: number} | null>(null);
  const [isPartnerTyping, setIsPartnerTyping] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordDuration, setRecordDuration] = useState(0);
  const [wallpaper, setWallpaper] = useState('');

  // Refs
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // MediaRecorder Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const activeVoiceEffectRef = useRef<string | null>(null);

  // Video Call Enhancements
  const callRecorderRef = useRef<MediaRecorder | null>(null);
  const callChunksRef = useRef<Blob[]>([]);
  const [videoFilter, setVideoFilter] = useState<{id:string, label:string, css:string}>({id:'none', label:'Normal', css:'none'});

  const VIDEO_FILTERS = [
    { id: 'none', label: 'Normal', css: 'none' },
    { id: 'romantic', label: 'Romantic', css: 'saturate(1.2) contrast(1.1) brightness(1.1) hue-rotate(-10deg) sepia(0.2)' },
    { id: 'vintage', label: 'Vintage', css: 'sepia(0.6) contrast(1.2) brightness(0.9)' },
    { id: 'bw', label: 'Noir', css: 'grayscale(1) contrast(1.3)' }
  ];

  // WebRTC Refs
  const [callState, setCallState] = useState<{ active: boolean; type: 'video' | 'voice'; incoming: boolean; connected: boolean; pendingSdp?: RTCSessionDescriptionInit; }>({ active: false, type: 'video', incoming: false, connected: false });
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const iceCandidateQueue = useRef<RTCIceCandidateInit[]>([]);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

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
    setup();
  }, [partnerNickname]);

  const scrollToBottom = () => {
    setTimeout(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, 100);
  };

  // Keep partnerIdRef in sync so closures always have the latest value
  useEffect(() => { partnerIdRef.current = partnerInfo.userId; }, [partnerInfo.userId]);

  // Setup Socket listener once sharedKey is ready
  useEffect(() => {
    if (!sharedKey || !myUserId) return;
    
    const s = getSocket() || initSocket(myUserId);
    const doSubscribe = () => {
       const pid = partnerIdRef.current;
       if (pid) s.emit('status:subscribe', { partnerId: pid });
    };

    const handleStatus = (data: { isOnline: boolean }) => setPartnerOnline(data.isOnline);
    s.on('status:update', handleStatus);
    s.on('connect', doSubscribe);
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

        if (payload.type === 'text' || payload.type === 'media') {
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
          
          if (payload.type === 'media') {
             const vType = payload.mediaType?.startsWith('audio') ? 'voice' : (payload.mediaType?.startsWith('video') ? 'video' : 'photo');
             const vId = incomingId + Math.random().toString();
             await db.put('vault', {
                id: vId,
                name: payload.text || 'Received Media',
                type: vType,
                data: payload.mediaData,
                timestamp: Date.now(),
                locked: true
             });
             
             try {
                if (payload.mediaData) {
                   const encMedia = await encryptMessage(sharedKey, payload.mediaData);
                   await supabase.from('vault').insert({
                      id: vId,
                      owner_id: myUserId,
                      name: payload.text || 'Received Media',
                      type: vType,
                      encrypted_data: encMedia.encrypted,
                      iv: encMedia.iv,
                      timestamp: Date.now()
                   });
                }
             } catch { /* ignored */ }
          }
          
          scrollToBottom();
        } 
        else if (payload.type === 'call:offer') {
          setCallState({ active: true, incoming: true, type: payload.callType || 'video', connected: false, pendingSdp: payload.sdp });
        }
        else if (payload.type === 'call:answer' && payload.sdp) {
          await pcRef.current?.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          setCallState(s => ({ ...s, connected: true }));
          
          // Process any queued ice candidates on the caller side once answer is received
          while (iceCandidateQueue.current.length > 0) {
            const cand = iceCandidateQueue.current.shift();
            if (cand && pcRef.current) await pcRef.current.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
          }
        }
        else if (payload.type === 'call:ice') {
          if (payload.candidate) {
            if (pcRef.current?.remoteDescription) {
              await pcRef.current.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(() => {});
            } else {
              iceCandidateQueue.current.push(payload.candidate);
            }
          }
        }
        else if (payload.type === 'call:end') {
          endCallUI();
        }
      } catch (e) {
        console.warn('Decryption failed for incoming message', e);
      }
    };

    s.on('message:receive', handleReceive);
    return () => { 
      s.off('message:receive', handleReceive); 
      s.off('status:update', handleStatus);
      s.off('connect', doSubscribe);
    };
  }, [sharedKey, myUserId, partnerInfo.userId]);

  const sendSecurePayload = async (payload: ChatPayload, messageId?: string) => {
    if (!sharedKey || !partnerInfo.userId) return;
    const s = getSocket();
    if (!s) return;

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
      if (payload.type === 'text' || payload.type === 'media') {
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

  const handleTyping = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    if (Math.random() > 0.8) sendSecurePayload({ type: 'typing' });
  };

  const handleMessageTap = async (msgId: string) => {
    const now = Date.now();
    const last = lastTapRef.current;
    if (last.id === msgId && (now - last.time) < 400) {
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, reaction: '❤️' } : m));
      const db = await initDB();
      const msg = await db.get('messages', msgId);
      if (msg) await db.put('messages', { ...msg, reaction: '❤️' });
      
      const payload = { type: 'reaction', messageId: msgId, reaction: '❤️' };
      const s = getSocket();
      if (s && sharedKey) {
         const enc = await encryptMessage(sharedKey, JSON.stringify(payload));
         s.emit('message:send', { to: partnerInfo.userId, encrypted: enc.encrypted, iv: enc.iv, senderId: myUserId });
      }
      lastTapRef.current = { id: '', time: 0 };
    } else {
      lastTapRef.current = { id: msgId, time: now };
    }
  };

  const handleSendText = async () => {
    if (!inputValue.trim()) return;
    const txt = inputValue;
    setInputValue('');

    const payload: ChatPayload = { type: 'text', text: txt };
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

  // ── LOCATION DROP ──
  const handleLocationDrop = () => {
    if (!navigator.geolocation) return alert('Location not supported by your browser');
    setIsProcessingMedia(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setIsProcessingMedia(false);
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        
        const payload: ChatPayload = { type: 'location', lat, lng, text: `📍 Live Check-In` };
        const msgId = Date.now().toString();
        
        const msg: Message = { id: msgId, senderId: myUserId, text: JSON.stringify(payload), timestamp: Date.now(), status: 'sent' };
        setMessages(prev => [...prev, msg]);
        scrollToBottom();
        const db = await initDB();
        await db.put('messages', msg);
        await sendSecurePayload(payload, msgId);
      },
      () => {
        setIsProcessingMedia(false);
        alert('Failed to drop location pin. Please allow location access.');
      }
    );
  };

  // ── PHOTO UPLOAD ──
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessingMedia(true);

    const compressImage = (f: File): Promise<string> => {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.src = URL.createObjectURL(f);
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_SIZE = 1200;
          let { width, height } = img;
          if (width > height && width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; }
          else if (height > MAX_SIZE) { width *= MAX_SIZE / height; height = MAX_SIZE; }
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.7)); 
        };
        img.onerror = reject;
      });
    };

    try {
      const db = await initDB();
      const msgId = Date.now().toString();

      let payload: ChatPayload;
      
      let b64 = '';
      // If file is > 1MB, use Supabase Storage
      if (file.size > 1024 * 1024) {
         const arrayBuffer = await file.arrayBuffer();
         if (!sharedKey) throw new Error("No shared key");
         const { encrypted, iv } = await encryptBuffer(sharedKey, arrayBuffer as any);
         const storagePath = `media/${myUserId}/${msgId}_${file.name}`;
         const ivB64 = bufferToBase64(iv.buffer as any);

         // Upload encrypted blob to storage
         const { error: storageErr } = await supabase.storage.from('media').upload(storagePath, encrypted);
         if (storageErr) {
            console.error('Storage upload failed:', storageErr);
            // Fallback to compressed b64 if storage fails
            b64 = await compressImage(file);
            payload = { type: 'media', text: file.name, mediaType: file.type || 'image/jpeg', mediaData: b64 };
         } else {
            payload = { type: 'media', text: file.name, mediaType: file.type, storagePath, storageIv: ivB64 };
            // For vault backup of large files, we still use compressed b64 for thumbnail/preview
            b64 = await compressImage(file);
         }
      } else {
         b64 = file.type.startsWith('video/') 
            ? await new Promise<string>((resolve, reject) => {
               const reader = new FileReader();
               reader.onload = () => resolve(reader.result as string);
               reader.onerror = reject;
               reader.readAsDataURL(file);
            })
            : await compressImage(file);
         
         payload = { type: 'media', text: file.name, mediaType: file.type || 'image/jpeg', mediaData: b64 };
      }

      const msg: Message = { id: msgId, senderId: myUserId, text: JSON.stringify(payload), timestamp: Date.now(), status: 'sent' };
      setMessages(prev => [...prev, msg]);
      scrollToBottom();
      await db.put('messages', msg);
      await sendSecurePayload(payload, msgId);

      // Also backup image to Supabase Vault for both partners
      if (!sharedKey) return;
      const encMedia = await encryptMessage(sharedKey, b64);
      const vType = file.type.startsWith('video') ? 'video' : 'photo';
      
      await db.put('vault', {
         id: msgId + '_me', name: file.name, type: vType, data: b64, timestamp: Date.now(), locked: true
      });
      
      await supabase.from('vault').insert([
         {
            id: msgId + '_me', 
            owner_id: myUserId, 
            name: file.name, 
            type: vType, 
            encrypted_data: encMedia.encrypted, 
            iv: encMedia.iv,
            timestamp: Date.now()
         },
         {
            id: msgId + '_partner', 
            owner_id: partnerInfo.userId, 
            name: file.name, 
            type: vType, 
            encrypted_data: encMedia.encrypted, 
            iv: encMedia.iv,
            timestamp: Date.now()
         }
      ]);

    } catch {
      alert('Failed to process image. Try a smaller file.');
    } finally {
      setIsProcessingMedia(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
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
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      audioChunksRef.current = []; // dump the array
      setIsRecording(false);
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
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

  // ── CALL LOGIC ──
  const setupWebRTC = async (type: 'video' | 'voice', isInitiator: boolean, remoteSdp?: any) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: type === 'video' ? { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } } : false, 
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } 
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      const pc = new RTCPeerConnection({ 
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:stun3.l.google.com:19302' },
          { urls: 'stun:stun4.l.google.com:19302' },
          { urls: 'stun:stun.services.mozilla.com' },
          { urls: 'stun:stun.l.google.com:19305' },
          { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
          { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
          { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" }
        ],
        iceTransportPolicy: 'all',
        iceCandidatePoolSize: 10
      });
      pcRef.current = pc;
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      pc.ontrack = (event) => { 
          if (remoteVideoRef.current) remoteVideoRef.current.srcObject = event.streams[0]; 

          // Mix Remote Stream + Local Audio to record full conversation memory
          if (type === 'video' && !callRecorderRef.current && typeof MediaRecorder !== 'undefined') {
              try {
                 const remoteStream = event.streams[0];
                 const mixedStream = new MediaStream([
                     ...remoteStream.getVideoTracks(),
                     ...remoteStream.getAudioTracks(),
                     ...stream.getAudioTracks()
                 ]);
                 
                 callChunksRef.current = [];
                 const mr = new MediaRecorder(mixedStream, { mimeType: 'video/webm' });
                 mr.ondataavailable = e => { if (e.data.size > 0) callChunksRef.current.push(e.data); };
                 mr.onstop = async () => {
                     if (callChunksRef.current.length === 0) return;
                     const blob = new Blob(callChunksRef.current, { type: 'video/webm' });
                     callChunksRef.current = [];
                     const reader = new FileReader();
                     reader.onload = async () => {
                         const b64 = reader.result as string;
                         const msgId = 'call_' + Date.now();
                         const db = await initDB();
                         
                         const msg: Message = { id: msgId, senderId: myUserId || '', text: JSON.stringify({ type: 'text', text: '📽️ Video Call Memory Saved Automatically to Vault' }), timestamp: Date.now(), status: 'sent' };
                         await db.put('messages', msg);
                         setMessages(prev => [...prev, msg]);
                         
                         // Save to Vault Locally
                         await db.put('vault', {
                             id: msgId, name: 'Video Call Memory', type: 'video', data: b64, timestamp: Date.now(), locked: true
                         });
                         
                         // Save to Cloud Securely
                         if (sharedKey && myUserId) {
                             try {
                                const enc = await encryptMessage(sharedKey, b64);
                                await supabase.from('vault').insert([{
                                    id: msgId, owner_id: myUserId, name: 'Video Call Memory', type: 'video', encrypted_data: enc.encrypted, iv: enc.iv, timestamp: Date.now()
                                }]);
                             } catch(e) { console.error('Failed call vault save', e); }
                         }
                     };
                     reader.readAsDataURL(blob);
                 };
                 mr.start(1000);
                 callRecorderRef.current = mr;
              } catch(e) { console.warn('Could not auto-record call', e); }
          }
      };
      
      pc.onicecandidate = (event) => {
        if (event.candidate) sendSecurePayload({ type: 'call:ice', candidate: event.candidate });
      };

      if (isInitiator) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendSecurePayload({ type: 'call:offer', callType: type, sdp: pc.localDescription || undefined });
      } else if (remoteSdp) {
        await pc.setRemoteDescription(new RTCSessionDescription(remoteSdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendSecurePayload({ type: 'call:answer', sdp: pc.localDescription || undefined });
        
        // Drain ice candidates that arrived early
        while (iceCandidateQueue.current.length > 0) {
          const cand = iceCandidateQueue.current.shift();
          if (cand) await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
        }
      }
    } catch {
      alert('Could not set up call.');
      endCallUI();
    }
  };

  const startCall = (type: 'video' | 'voice') => { setCallState({ active: true, type, incoming: false, connected: false }); setupWebRTC(type, true); };
  const acceptCall = () => { setCallState(s => ({ ...s, incoming: false, connected: true })); setupWebRTC(callState.type, false, callState.pendingSdp); };
  const rejectCall = () => { sendSecurePayload({ type: 'call:end' }); endCallUI(); };
  const endCallUI = useCallback(() => {
    if (callRecorderRef.current && callRecorderRef.current.state !== 'inactive') {
        callRecorderRef.current.stop();
        callRecorderRef.current = null;
    }
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
    if (localStreamRef.current) { localStreamRef.current.getTracks().forEach(t => t.stop()); localStreamRef.current = null; }
    setCallState({ active: false, type: 'video', incoming: false, connected: false });
  }, []);
  const handleEndCallAction = () => { sendSecurePayload({ type: 'call:end' }); endCallUI(); };

  // Generate pretty duration string
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // Render a single message
  const renderMessageContent = (msgContent: string) => {
    try {
      const payload: ChatPayload = JSON.parse(msgContent);
      if (payload.type === 'media') {
        const isImg = payload.mediaType?.startsWith('image');
        const isAudio = payload.mediaType?.startsWith('audio');
        const isVideo = payload.mediaType?.startsWith('video');

        // NEW: Inline storage downloader component
        const MediaWrapper = ({ pl }: { pl: ChatPayload }) => {
           const [src, setSrc] = React.useState(pl.mediaData || '');
           const [loading, setLoading] = React.useState(!!pl.storagePath && !pl.mediaData);

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
              if (pl.storagePath && pl.storageIv && !src) {
                 const loadBlob = async () => {
                    try {
                       const { data, error } = await supabase.storage.from('media').download(pl.storagePath!);
                       if (error) throw error;
                       if (sharedKey) {
                          const iv = new Uint8Array(base64ToBuffer(pl.storageIv!));
                          const dec = await decryptBuffer(sharedKey, await data.arrayBuffer(), iv);
                          const url = URL.createObjectURL(new Blob([dec], { type: pl.mediaType }));
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
           }, [pl]);

           if (loading) return <div className="w-44 h-56 flex items-center justify-center bg-white/5 rounded-xl border border-white/10 animate-pulse text-[10px] text-white/30 uppercase tracking-widest font-black">Decrypting...</div>;
           if (!src) return <div className="w-44 h-56 flex items-center justify-center bg-red-500/10 rounded-xl border border-red-500/20 text-[10px] text-red-500/50 uppercase tracking-widest font-black">Media Unavailable</div>;

           return (
              <div className="flex flex-col space-y-2 relative group mt-1 mb-1">
                 {isImg && <img src={src} onClick={() => setViewMedia({ url: src, type: 'photo' })} className="max-h-56 max-w-44 object-cover rounded-xl shadow-md border border-white/10 cursor-pointer transition-transform active:scale-95" alt="Shared media" />}
                 {isVideo && (
                    <div className="relative group cursor-pointer" onClick={() => setViewMedia({ url: src, type: 'video' })}>
                       <video src={src} className="max-h-56 max-w-44 object-cover rounded-xl shadow-md border border-white/10" />
                       <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/30 rounded-xl transition-opacity">
                          <span className="text-white bg-black/50 p-2 rounded-full font-bold">⤢</span>
                       </div>
                    </div>
                 )}
                 {isAudio && (
                    <div className="flex items-center space-x-3 bg-white/10 py-2 px-3 rounded-xl border border-white/10">
                       <div className={`w-8 h-8 rounded-full flex items-center justify-center ${effect === 'chipmunk' ? 'bg-fuchsia-500/20 text-fuchsia-500' : effect === 'deep' ? 'bg-indigo-600/20 text-indigo-400' : 'bg-primary/20 text-primary'}`}>
                          {effect ? <Wand2 size={16} /> : <Volume2 size={16} />}
                       </div>
                       <audio ref={audioRef} src={src} controls className="h-8 w-[150px]" />
                    </div>
                 )}
                 {!isImg && !isAudio && !isVideo && <span className="underline italic text-white/50">Unsupported media</span>}
              </div>
           );
        };

        return <MediaWrapper pl={payload} />;
      }
      if (payload.type === 'location' && payload.lat && payload.lng) {
        return (
          <div className="flex flex-col space-y-2 w-[220px]">
            <p className="text-[13px] font-bold text-white mb-0.5 tracking-tight flex items-center">
               <MapPin size={14} className="text-primary mr-1" /> Live Check-In
            </p>
            <div className="rounded-[20px] overflow-hidden shadow-xl border border-white/10 h-40 w-full cursor-pointer relative group"
                 onClick={() => setFullScreenMap({ lat: payload.lat!, lng: payload.lng! })}>
               <iframe 
                 src={`https://maps.google.com/maps?q=${payload.lat},${payload.lng}&t=k&z=15&output=embed`}
                 className="w-full h-full pointer-events-none"
                 style={{ border: 0 }}
                 scrolling="no"
               />
               <div className="absolute inset-0 bg-black/10 group-hover:bg-black/30 transition-colors flex items-center justify-center pointer-events-none">
                  <div className="bg-primary text-white rounded-full p-2 shadow-2xl backdrop-blur-md group-hover:scale-110 transition-transform">
                     <MapPin size={24} className="fill-current" />
                  </div>
               </div>
            </div>
            <p className="text-[10px] text-white/50 text-center uppercase tracking-widest mt-1">Tap to explore</p>
          </div>
        );
      }
      return <p className="text-[15px] leading-relaxed break-words">{payload.text}</p>;
    } catch {
      return <p className="text-[15px] leading-relaxed break-words">{msgContent}</p>;
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0a0a0c] relative overflow-hidden w-full">
      {/* BACKGROUND WALLPAPER */}
      <LiveWallpaper type={wallpaper} />
      
      <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-[#0a0a0c] z-0 pointer-events-none" />
      
      {/* ── TOP HEADER ── */}
      <div className="fixed top-0 w-full z-30 bg-black/60 backdrop-blur-xl border-b border-white/5 shadow-2xl px-5 py-3.5 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="relative">
            {/* Animated online pulse */}
            <div className="absolute inset-0 bg-primary/30 rounded-full animate-ping" />
            <div className="relative w-11 h-11 rounded-full bg-gradient-to-tr from-primary to-accent overflow-hidden border border-white/10">
              <img src={partnerInfo.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${partnerInfo.userId || 'partner'}`} alt={partnerInfo.nick} className="w-full h-full object-cover" />
            </div>
            <div className={`absolute bottom-0 right-0 w-3.5 h-3.5 border-2 border-[#0a0a0c] rounded-full ${partnerOnline ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-white/20'}`} />
          </div>
          <div>
            <h2 className="font-semibold text-white text-[16px] tracking-wide leading-tight">{partnerInfo.nick}</h2>
            <div className="flex items-center mt-0.5 space-x-1">
               <ShieldCheck size={12} className={partnerOnline ? "text-green-400" : "text-white/30"} />
               <p className={`text-[11px] font-medium tracking-wider uppercase ${partnerOnline ? 'text-green-400' : 'text-white/30'}`}>
                 {partnerOnline ? 'Online & Secure' : 'Secure Line'}
               </p>
            </div>
          </div>
        </div>
        
        <div className="flex items-center space-x-3 text-white/60">
           <button onClick={() => setIsBlurred(!isBlurred)} className={`p-2.5 rounded-full active:scale-95 transition-all ${isBlurred ? 'bg-primary/20 text-primary' : 'text-white/60 hover:bg-white/10'}`}>
             {isBlurred ? <EyeOff size={20} /> : <Eye size={20} />}
           </button>
          <button onClick={() => startCall('voice')} className="hover:text-white transition-colors active:scale-95"><Phone size={22} /></button>
          <button onClick={() => startCall('video')} className="hover:text-white transition-colors active:scale-95"><Video size={24} /></button>
          <div className="relative">
            <button onClick={() => setShowMenu(!showMenu)} className="hover:text-white transition-colors">
              <MoreVertical size={24} />
            </button>
            <AnimatePresence>
              {showMenu && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95, y: -10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: -10 }}
                  className="absolute right-0 top-10 w-44 bg-zinc-900 border border-white/10 rounded-xl shadow-2xl py-2 z-50 overflow-hidden"
                >
                   <button onClick={clearChat} className="w-full text-left px-4 py-2 text-red-400 text-sm hover:bg-white/5 active:bg-white/10 transition-colors">
                     Clear Chat History
                   </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* ── MESSAGE LIST ── */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto mt-[80px] px-4 space-y-5 pt-6 pb-[180px] no-scrollbar scroll-smooth"
      >
        {messages.map((msg, i) => {
          const isMe = msg.senderId === myUserId;
          const showTail = i === messages.length - 1 || messages[i + 1].senderId !== msg.senderId;

          return (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 15, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className={`flex ${isMe ? 'justify-end' : 'justify-start'} w-full`}
            >
              <div
                onClick={() => handleMessageTap(msg.id)}
                className={`max-w-[80%] px-4 py-2.5 shadow-lg relative ${
                  isMe
                    ? 'bg-gradient-sender text-white ' + (showTail ? 'rounded-2xl rounded-br-sm' : 'rounded-2xl')
                    : 'bg-gradient-receiver border border-white/5 text-white/90 ' + (showTail ? 'rounded-2xl rounded-bl-sm' : 'rounded-2xl')
                } ${isBlurred ? 'blur-md hover:blur-none active:blur-none transition-all duration-300' : ''}`}
                style={{ userSelect: 'none' }}
              >
                {renderMessageContent(msg.text)}
                
                {msg.reaction && (
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className={`absolute -bottom-3 ${isMe ? '-left-2' : '-right-2'} text-xl bg-[#0a0a0c] border border-white/10 rounded-full px-1.5 py-0.5 shadow-2xl`}>
                    {msg.reaction}
                  </motion.div>
                )}

                <div className="flex items-center justify-end mt-1 space-x-1.5 opacity-60">
                  <span className="text-[10px] font-medium tracking-wide">
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {isMe && <span className="text-[10px] tracking-tighter">✓✓</span>}
                </div>
              </div>
            </motion.div>
          );
        })}

        {/* Typing Bubble */}
        <AnimatePresence>
          {isPartnerTyping && (
             <motion.div 
               initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9 }}
               className="flex justify-start w-full"
             >
                <div className="bg-zinc-800/80 backdrop-blur-md px-4 py-3 rounded-2xl rounded-bl-sm border border-white/5 flex items-center space-x-1.5">
                   <div className="w-1.5 h-1.5 bg-white/50 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                   <div className="w-1.5 h-1.5 bg-white/50 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                   <div className="w-1.5 h-1.5 bg-white/50 rounded-full animate-bounce"></div>
                </div>
             </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── BOTTOM INPUT BAR ── */}
      <div className="fixed bottom-20 w-full p-4 pb-4 z-20 bg-gradient-to-t from-[#0a0a0c] via-[#0a0a0c]/90 to-transparent pt-8">
        <div className="flex items-end space-x-3">
          
          {/* Main Input Container */}
          <div className="flex-1 flex items-center bg-white/10 backdrop-blur-xl border border-white/10 rounded-[24px] px-2 py-2 relative min-h-[56px] shadow-2xl">
            {isProcessingMedia && (
               <div className="absolute inset-0 bg-black/60 rounded-[24px] flex items-center justify-center z-10 backdrop-blur-sm">
                 <div className="w-5 h-5 border-2 border-primary/50 border-t-primary rounded-full animate-spin" />
               </div>
            )}
            
            {isRecording ? (
              <div className="flex-1 flex items-center px-4 animate-pulse">
                 <div className="w-3 h-3 bg-red-500 rounded-full mr-3 animate-ping" />
                 <span className="text-red-400 font-medium tracking-widest">{formatTime(recordDuration)}</span>
                 <div className="ml-auto text-[11px] text-white/40 uppercase tracking-widest">Recording</div>
              </div>
            ) : (
              <>
                <button onClick={handleLocationDrop} className="p-2 text-white/40 hover:text-white transition-colors rounded-full hover:bg-white/5 active:scale-95" title="Location Check-in">
                   <MapPin size={22} />
                </button>
                <button onClick={() => fileInputRef.current?.click()} className="p-2 text-white/40 hover:text-white transition-colors rounded-full hover:bg-white/5 active:scale-95" title="Media Upload">
                   <Camera size={22} />
                </button>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  className="hidden" 
                  accept="image/*,video/*"
                  onChange={handleFileUpload} 
                />
                
                <input
                  type="text"
                  value={inputValue}
                  onChange={handleTyping}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendText()}
                  placeholder="Message..."
                  className="bg-transparent flex-1 outline-none text-white text-[16px] px-2 placeholder:text-white/30"
                />
              </>
            )}
          </div>

          {/* Action Button (Send Text, or Record Audio) */}
          {inputValue.trim() ? (
            <button 
              onClick={handleSendText}
              className="w-14 h-14 bg-gradient-to-br from-primary to-rose-600 rounded-full flex items-center justify-center text-white active:scale-95 transition-transform shadow-lg shadow-primary/20"
            >
              <Send size={22} className="ml-1" />
            </button>
          ) : isRecording ? (
            <div className="flex items-center space-x-2">
               <button 
                 onClick={cancelRecording}
                 className="w-11 h-11 bg-zinc-800 rounded-full flex items-center justify-center text-white/50 hover:text-white active:scale-95 transition-transform border border-white/5"
               >
                 <X size={20} />
               </button>
               <button 
                 onClick={() => stopRecording('deep')}
                 className="w-11 h-11 bg-indigo-600 rounded-full flex items-center justify-center text-white active:scale-95 transition-transform shadow-lg"
                 title="Demon Voice"
               >
                 <span className="font-black text-[10px]">DEEP</span>
               </button>
               <button 
                 onClick={() => stopRecording('chipmunk')}
                 className="w-11 h-11 bg-fuchsia-500 rounded-full flex items-center justify-center text-white active:scale-95 transition-transform shadow-lg"
                 title="Chipmunk Voice"
               >
                 <span className="font-black text-[10px]">FUN</span>
               </button>
               <button 
                 onClick={() => stopRecording()}
                 className="w-14 h-14 bg-red-500 rounded-full flex items-center justify-center text-white active:scale-95 transition-transform shadow-lg shadow-red-500/30"
               >
                 <Send size={22} className="ml-1" />
               </button>
            </div>
          ) : (
            <button 
              onClick={startRecording}
              className="w-14 h-14 bg-white/10 rounded-full flex items-center justify-center text-white active:scale-95 transition-transform shadow-lg border border-white/5 hover:bg-white/20"
            >
              <Mic size={24} className="text-white/80" />
            </button>
          )}
        </div>
      </div>

      {/* ── Call Overlay ── */}
      <AnimatePresence>
        {callState.active && (
          <motion.div initial={{ opacity: 0, y: '100%' }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: '100%' }} className="fixed inset-0 bg-zinc-950 z-50 flex flex-col items-center">
            <div className="absolute inset-0 bg-primary/10 animate-pulse mix-blend-screen" />
            <div className="relative w-full h-full flex flex-col items-center pt-24 pb-12">
              <div className="w-32 h-32 rounded-full overflow-hidden mb-6 relative shadow-2xl shadow-primary/20 ring-4 ring-white/10">
                 <img src={partnerInfo.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${partnerInfo.userId || 'partner'}`} alt="Partner" className="w-full h-full object-cover" />
              </div>
              <h2 className="text-3xl font-bold text-white mb-2">{partnerInfo.nick}</h2>
              <p className="text-white/50 text-sm font-medium tracking-widest uppercase">
                {callState.incoming ? 'Incoming Call...' : callState.connected ? 'Secure Connection' : 'Ringing...'}
              </p>
              <div className={`mt-8 relative w-11/12 max-w-sm aspect-[3/4] rounded-[32px] overflow-hidden bg-black/50 border border-white/10 shadow-2xl ${callState.type === 'video' ? 'block' : 'hidden'}`}>
                <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover transition-all duration-500" style={{ filter: videoFilter.css }} />
                <video ref={localVideoRef} autoPlay playsInline muted className="absolute bottom-4 right-4 w-28 h-40 bg-black/80 rounded-2xl border-2 border-white/20 object-cover shadow-xl backdrop-blur-md transition-all duration-500" style={{ filter: videoFilter.css }} />
                
                {callState.type === 'video' && callState.connected && (
                   <div className="absolute top-4 right-4 flex flex-col space-y-2 z-50">
                      {VIDEO_FILTERS.map(f => (
                         <button 
                            key={f.id} 
                            onClick={() => setVideoFilter(f)}
                            className={`px-3 py-1.5 rounded-full text-[10px] font-black tracking-widest uppercase transition-all backdrop-blur-md ${videoFilter.id === f.id ? 'bg-primary text-white shadow-lg shadow-primary/30 border border-primary' : 'bg-black/50 text-white/50 border border-white/10 hover:bg-white/10'}`}
                         >
                            {f.label}
                         </button>
                      ))}
                   </div>
                )}
              </div>
              <div className="mt-auto flex items-center space-x-8">
                {callState.incoming ? (
                  <>
                    <button onClick={rejectCall} className="w-16 h-16 bg-red-500 rounded-full flex items-center justify-center shadow-lg active:scale-95"><X size={30} className="text-white" /></button>
                    <button onClick={acceptCall} className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center shadow-lg active:scale-95 animate-bounce"><Phone size={30} className="text-white fill-white" /></button>
                  </>
                ) : (
                  <button onClick={handleEndCallAction} className="w-16 h-16 bg-red-500 rounded-full flex items-center justify-center shadow-lg active:scale-95"><Phone size={30} className="text-white rotate-[135deg] fill-white" /></button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Lightbox Overlay ── */}
      <AnimatePresence>
        {viewMedia && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md flex flex-col justify-center items-center">
            <button onClick={() => setViewMedia(null)} className="absolute top-6 right-6 w-12 h-12 bg-white/10 rounded-full flex items-center justify-center text-white active:scale-95 z-10"><X size={24} /></button>
            {viewMedia.type === 'photo' && <img src={viewMedia.url} className="max-w-full max-h-full object-contain" alt="Enlarged" />}
            {viewMedia.type === 'video' && <video src={viewMedia.url} className="max-w-full max-h-full" controls autoPlay />}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Map Lightbox ── */}
      <AnimatePresence>
        {fullScreenMap && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black backdrop-blur-xl flex flex-col">
            <div className="absolute top-0 left-0 right-0 p-6 flex justify-between items-center z-10 bg-gradient-to-b from-black/80 to-transparent">
               <div className="flex items-center text-white font-bold">
                 <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center mr-3"><MapPin size={16} className="text-primary" /></div>
                 <span>Live Location</span>
               </div>
               <button onClick={() => setFullScreenMap(null)} className="w-10 h-10 bg-white/10 backdrop-blur-md rounded-full flex items-center justify-center text-white/80 active:scale-95"><X size={20} /></button>
            </div>
            <div className="flex-1 w-full relative">
               <iframe 
                 src={`https://maps.google.com/maps?q=${fullScreenMap.lat},${fullScreenMap.lng}&t=k&z=18&output=embed`}
                 className="w-full h-full"
                 style={{ border: 0 }}
                 allowFullScreen
               />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
};

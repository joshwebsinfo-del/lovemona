import { useState, useEffect, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageCircle, Home, Lock, Settings } from 'lucide-react';
import { DashboardScreen } from './pages/DashboardScreen';
import { ChatScreen } from './pages/ChatScreen';
import { VaultScreen } from './pages/VaultScreen';
import { PanicScreen } from './pages/PanicScreen';
import { LockScreen } from './pages/LockScreen';
import { SetupScreen } from './pages/SetupScreen';
import { PinSetupScreen } from './pages/PinSetupScreen';
import { SettingsScreen } from './pages/SettingsScreen';
import { CallScreen } from './pages/CallScreen';
import { initDB } from './lib/db';
import type { AuthConfig, Partner } from './lib/types';
import { initSocket, getSocket } from './lib/socket';
import { supabase } from './lib/supabase';
import { decryptMessage, encryptMessage, deriveSharedSecret, importPublicKey } from './lib/crypto';
import { NotificationProvider, useNotifications } from './components/NotificationProvider';

// ──────────────────────────────────────────────
// Bottom navigation
const BottomNav = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const navItems = [
    { id: 'home',  label: 'Home',  icon: Home,     path: '/' },
    { id: 'chat',  label: 'Chat',  icon: MessageCircle,  path: '/chat' },
    { id: 'vault', label: 'Vault', icon: Lock,     path: '/vault' },
    { id: 'settings', label: 'Setup', icon: Settings, path: '/settings' },
  ];

  const hidePaths = ['/chat', '/panic', '/lock', '/setup', '/pin-setup'];
  if (hidePaths.includes(location.pathname)) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] w-[90%] max-w-sm">
      <div className="bg-[#121214]/80 backdrop-blur-3xl border border-white/5 rounded-[40px] h-[72px] px-2 flex items-center justify-between shadow-[0_20px_50px_rgba(0,0,0,0.5)] relative overflow-hidden">
        <AnimatePresence>
          {navItems.map((item, i) => {
            const active = location.pathname === item.path;
            if (!active) return null;
            return (
              <motion.div
                key="indicator"
                layoutId="nav-indicator"
                initial={false}
                transition={{ type: 'spring', stiffness: 350, damping: 35 }}
                className="absolute h-14 bg-white/5 rounded-[32px] border border-white/10"
                style={{ width: `calc(100% / ${navItems.length} - 12px)`, left: `calc((${i} * (100% / ${navItems.length})) + 6px)` }}
              />
            );
          })}
        </AnimatePresence>

        {navItems.map(({ id, label, icon: Icon, path }) => {
          const active = location.pathname === path;
          return (
            <button key={id} onClick={() => navigate(path)} className="flex-1 relative z-10 flex flex-col items-center justify-center space-y-1 group">
              <motion.div animate={{ scale: active ? [1, 1.2, 1.1] : 1, y: active ? -2 : 0 }}>
                <Icon size={20} strokeWidth={active ? 2.5 : 1.5} className={`transition-colors duration-300 ${active ? 'text-primary' : 'text-white/30 group-hover:text-white/60'}`} />
              </motion.div>
              <span className={`text-[9px] font-black uppercase tracking-[1px] transition-colors duration-300 ${active ? 'text-white' : 'text-white/30'}`}>{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────
const FakeCalculator = () => (
  <div className="flex flex-col items-center justify-center h-full p-10 text-center select-none">
    <h2 className="text-2xl font-bold text-white/20">Calculator</h2>
    <p className="text-white/10 mt-1 text-sm italic mb-6">Basic calculator mode</p>
    <div className="grid grid-cols-4 gap-2 w-full max-w-xs opacity-20 grayscale">
      {[7,8,9,'÷',4,5,6,'×',1,2,3,'−','.',0,'=','+'].map((btn, i) => (
        <div key={i} className="h-14 border border-white/20 flex items-center justify-center rounded-xl text-white text-lg">{btn}</div>
      ))}
    </div>
  </div>
);

// ──────────────────────────────────────────────
// Main App Content
// ──────────────────────────────────────────────
const AppContent = () => {
  const [appConfig, setAppConfig] = useState<AuthConfig | null>(null);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isFakeMode, setIsFakeMode] = useState(false);
  const [isPaired, setIsPaired] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [partner, setPartner] = useState<Partner | null>(null);
  const [sharedKey, setSharedKey] = useState<CryptoKey | null>(null);
  
  // ── Call State ──
  const [callActive, setCallActive] = useState(false);
  const [callType, setCallType] = useState<'video' | 'voice' | 'game'>('video');
  const [callIncoming, setCallIncoming] = useState(false);
  const [callConnected, setCallConnected] = useState(false);
  const [callPendingSdp, setCallPendingSdp] = useState<any>(null);
  const [callDuration, setCallDuration] = useState(0);

  // ── Call Extended Feature States ──
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [localFilterIndex, setLocalFilterIndex] = useState(0);
  const [remoteFilter, setRemoteFilter] = useState('none');
  const [reactions, setReactions] = useState<{id: string, emoji: string, x: number}[]>([]);
  const [videoUpgradeRequested, setVideoUpgradeRequested] = useState(false);
  const [lastIncomingGameEvent, setLastIncomingGameEvent] = useState<any>(null);

  const FILTERS = ['none', 'grayscale(100%)', 'sepia(80%)', 'saturate(200%)', 'hue-rotate(90deg)', 'contrast(150%)', 'invert(100%)'];

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const iceCandidateQueue = useRef<any[]>([]);
  const ringtoneSound = useRef<HTMLAudioElement | null>(null);
  const callDurationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wakeLockRef = useRef<any>(null);

  // Video Recording Refs
  const callRecorderRef = useRef<MediaRecorder | null>(null);
  const callChunksRef = useRef<Blob[]>([]);

  const location = useLocation();
  const navigate = useNavigate();

  // ── Init ringtone ──
  useEffect(() => {
    ringtoneSound.current = new Audio('https://assets.mixkit.co/active_storage/sfx/1359/1359-preview.mp3');
    ringtoneSound.current.loop = true;
    ringtoneSound.current.volume = 0.6;
  }, []);

  // ── Load app config, partner, identity ──
  useEffect(() => {
    const load = async () => {
      try {
        const db = await initDB();
        const [config, p, identity] = await Promise.all([ db.get('auth', 'pins'), db.get('partner', 'partner'), db.get('identity', 'me') ]);
        if (config) setAppConfig(config);
        if (p) {
          setPartner(p);
          setIsPaired(true);
          if (identity) {
             const importedPartnerKey = await importPublicKey(p.publicKeyPem);
             const key = await deriveSharedSecret(identity.privateKey, importedPartnerKey);
             setSharedKey(key);
             initSocket(identity.userId);
          }
        }
      } catch (err) { console.error('Failed to load app config:', err); } finally { setIsLoading(false); }
    };
    load();
  }, []);

  // ── Visibility + Global call initiation ──
  const [isBlurred, setIsBlurred] = useState(false);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') { 
        setIsBlurred(false);
        const s = getSocket(); 
        if (s && !s.connected) s.connect(); 
      } else {
        setIsBlurred(true);
      }
    };
    
    // Extra protection for app switcher
    const handleBlur = () => setIsBlurred(true);
    const handleFocus = () => setIsBlurred(false);

    const handleGlobalCallStart = (e: CustomEvent) => {
       const { type, isGameMode } = e.detail;
       if (!partner || !sharedKey) return;
       setCallActive(true);
       setCallType(isGameMode ? 'game' : (type || 'video'));
       setCallIncoming(false);
       setCallConnected(false);
       setCallPendingSdp(null);
       setFacingMode('user');
       setLocalFilterIndex(0);
       setRemoteFilter('none');
       setVideoUpgradeRequested(false);
       setLastIncomingGameEvent(null);
       setupWebRTC(isGameMode ? 'game' : (type || 'video'), true, undefined, 'user');
    };

    const handleIncomingGameInvite = (e: CustomEvent) => {
       const { type } = e.detail;
       setCallActive(true);
       setCallType(type);
       setCallIncoming(true);
       setCallConnected(false);
       setCallPendingSdp(null);
    };

    const handleNavToChat = () => {
       navigate('/chat');
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('start-global-call', handleGlobalCallStart as any);
    window.addEventListener('incoming-game-invite', handleIncomingGameInvite as any);
    window.addEventListener('nav-to-chat', handleNavToChat);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('start-global-call', handleGlobalCallStart as any);
      window.removeEventListener('incoming-game-invite', handleIncomingGameInvite as any);
      window.removeEventListener('nav-to-chat', handleNavToChat);
    };
  }, [partner, sharedKey]);

  // ── Socket message handler for call signaling ──
  useEffect(() => {
    if (!sharedKey) return;
    const s = getSocket();
    if (!s) return;

    const { showNotification } = useNotifications();

    const handleReceive = async (data: any) => {
       try {
          const dec = await decryptMessage(sharedKey, data.encrypted, data.iv);
          const payload = JSON.parse(dec);
          
          if (payload.type === 'call:offer') {
             if (callActive) { // Mid-call renegotiation!
               if (pcRef.current) {
                  await pcRef.current.setRemoteDescription(new RTCSessionDescription(payload.sdp));
                  // If it upgraded to video, our side needs to turn on video too!
                  if (payload.callType === 'video' && callType === 'voice') {
                    setCallType('video');
                    await acquireVideoTrack('user');
                  }
                  const answer = await pcRef.current.createAnswer();
                  await pcRef.current.setLocalDescription(answer);
                  const enc = await encryptMessage(sharedKey, JSON.stringify({type:'call:answer', sdp: pcRef.current.localDescription}));
                  getSocket()?.emit('message:send', { to: partner?.userId, encrypted: enc.encrypted, iv: enc.iv, senderId: 'me' });
               }
             } else {
               setCallActive(true);
               setCallType(payload.callType || 'video');
               setCallIncoming(true);
               setCallConnected(false);
               setCallPendingSdp(payload.sdp);
               setLocalFilterIndex(0);
               setRemoteFilter('none');
               setVideoUpgradeRequested(false);
               if (payload.callType === 'game') {
                   if ('vibrate' in navigator) navigator.vibrate([100, 50, 100, 50, 100]);
               }
             }
          } else if (payload.type === 'call:answer' && pcRef.current) {
             await pcRef.current.setRemoteDescription(new RTCSessionDescription(payload.sdp));
             while (iceCandidateQueue.current.length > 0) {
                const cand = iceCandidateQueue.current.shift();
                await pcRef.current.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
             }
             setCallConnected(true);
          } else if (payload.type === 'call:ice') {
             if (pcRef.current && pcRef.current.remoteDescription) {
                await pcRef.current.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(() => {});
             } else { iceCandidateQueue.current.push(payload.candidate); }
          } else if (payload.type === 'call:end') { endCallUI(); }
          
          // Extended features handling
          else if (payload.type === 'call:reaction') {
             const r = { id: Math.random().toString(), emoji: payload.emoji, x: Math.random() * 80 + 10 };
             setReactions(prev => [...prev, r]);
             setTimeout(() => setReactions(prev => prev.filter(p => p.id !== r.id)), 3000);
          } else if (payload.type === 'call:filter') {
             setRemoteFilter(payload.filter);
          } else if (payload.type === 'call:upgrade_request') {
             setVideoUpgradeRequested(true);
          } else if (payload.type === 'call:upgrade_accept') {
             // Partner accepted! Turn on my camera and renegotiate
             setCallType('video');
             await acquireVideoTrack('user');
             if (pcRef.current) {
                const offer = await pcRef.current.createOffer();
                await pcRef.current.setLocalDescription(offer);
                const enc = await encryptMessage(sharedKey, JSON.stringify({type:'call:offer', callType: 'video', sdp: pcRef.current.localDescription}));
                getSocket()?.emit('message:send', { to: partner?.userId, encrypted: enc.encrypted, iv: enc.iv, senderId: 'me' });
             }
          } else if (payload.type === 'call:upgrade_decline') {
             setVideoUpgradeRequested(false);
          } else if (payload.type === 'call:game') {
             setLastIncomingGameEvent(payload.data);
          }
          
          // Global Push Notification for Chat Messages
          else if (payload.type === 'whisper' || !payload.type) {
             const currentPath = window.location.pathname;
             if (currentPath !== '/chat') {
                showNotification({
                   title: partner?.nick || 'Partner',
                   message: payload.text || 'Sent you a whisper',
                   type: 'message',
                   avatar: partner?.avatar,
                   action: () => window.dispatchEvent(new CustomEvent('nav-to-chat'))
                });
                if ('vibrate' in navigator) navigator.vibrate([100, 50, 100]);
             }
          }
       } catch {}
    };

    s.on('message:receive', handleReceive);
    return () => { s.off('message:receive', handleReceive); };
  }, [sharedKey, callActive, callType]);

  // ── Call side-effects (ringtone, wake lock, timer) ──
  useEffect(() => {
    if (callActive) {
       if ('wakeLock' in navigator) (navigator as any).wakeLock.request('screen').then((lock: any) => { wakeLockRef.current = lock; }).catch(() => {});
       if (callIncoming) {
          if (callType !== 'game') ringtoneSound.current?.play().catch(() => {});
          if ('Notification' in window && window.Notification && window.Notification.permission === 'granted') {
             if (navigator.serviceWorker) {
                navigator.serviceWorker.ready.then(reg => {
                   reg.showNotification(callType === 'game' ? 'New Game Challenge!' : 'Incoming Secure Line', {
                      body: callType === 'game' ? `${partner?.nick} wants to play a game` : 'Tap to Answer the Call',
                      icon: '/pwa-192x192.png',
                      badge: '/icon.png',
                      tag: 'call',
                      renotify: true,
                      vibrate: [500, 250, 500, 250, 500, 250, 500],
                      requireInteraction: true
                   } as any);
                }).catch(() => {
                   try { new window.Notification(callType === 'game' ? 'Game Challenge!' : 'Incoming Secure Line', { body: 'Tap to answer', tag: 'call', requireInteraction: true } as any); } catch(e) {}
                });
             } else {
                try { new window.Notification(callType === 'game' ? 'Game Challenge!' : 'Incoming Secure Line', { body: 'Tap to answer', tag: 'call', requireInteraction: true } as any); } catch(e) {}
             }
          }
       } else {
          ringtoneSound.current?.pause();
          if (ringtoneSound.current) ringtoneSound.current.currentTime = 0;
       }
       if (callConnected) {
          if (callDurationTimerRef.current) clearInterval(callDurationTimerRef.current);
          setCallDuration(0);
          callDurationTimerRef.current = setInterval(() => setCallDuration(d => d + 1), 1000);
       }
    } else {
       ringtoneSound.current?.pause();
       if (callDurationTimerRef.current) { clearInterval(callDurationTimerRef.current); callDurationTimerRef.current = null; }
       if (wakeLockRef.current) { if (wakeLockRef.current.release) wakeLockRef.current.release(); wakeLockRef.current = null; }
       setCallDuration(0);
       setReactions([]);
       setVideoUpgradeRequested(false);
       setLastIncomingGameEvent(null);
    }
  }, [callActive, callIncoming, callConnected]);

  // ── End call: cleanup everything ──
  const endCallUI = () => {
    if (callRecorderRef.current && callRecorderRef.current.state !== 'inactive') {
       callRecorderRef.current.stop();
       callRecorderRef.current = null;
    }
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
    if (localStreamRef.current) { localStreamRef.current.getTracks().forEach((t: any) => t.stop()); localStreamRef.current = null; }
    setCallActive(false);
    setCallIncoming(false);
    setCallConnected(false);
    setCallPendingSdp(null);
    setCallDuration(0);
    setLastIncomingGameEvent(null);
    iceCandidateQueue.current = [];
  };

  // ── Camera management ──
  const acquireVideoTrack = async (mode: 'user' | 'environment') => {
    try {
       let newStream;
      try {
          newStream = await navigator.mediaDevices.getUserMedia({ 
              video: { facingMode: { exact: mode }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } } 
          });
      } catch (fallout) {
          newStream = await navigator.mediaDevices.getUserMedia({ 
              video: { facingMode: mode, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } } 
          });
      }
      const newVideoTrack = newStream.getVideoTracks()[0];

      const oldTrack = localStreamRef.current?.getVideoTracks()[0] || null;
      
      if (!localStreamRef.current) {
         localStreamRef.current = new MediaStream([newVideoTrack]);
      } else {
         if (oldTrack) {
            localStreamRef.current.removeTrack(oldTrack);
         }
         localStreamRef.current.addTrack(newVideoTrack);
      }
      
      if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
      
      if (pcRef.current) {
         const sender = pcRef.current.getSenders().find(s => s.track?.kind === 'video');
         if (sender) {
            await sender.replaceTrack(newVideoTrack);
         } else {
            pcRef.current.addTrack(newVideoTrack, localStreamRef.current);
         }
      }
      
      if (oldTrack) oldTrack.stop();
      
      return newVideoTrack;
    } catch (e) {
      console.warn("Failed to acquire video track", e);
    }
  };

  // ── WebRTC setup ──
  const setupWebRTC = async (type: 'video' | 'voice' | 'game', isInitiator: boolean, remoteSdp?: any, mode: 'user' | 'environment' = 'user') => {
    if (isInitiator) iceCandidateQueue.current = [];
    try {
       const stream = await navigator.mediaDevices.getUserMedia({ 
          video: (type === 'video' || type === 'game') ? { facingMode: mode, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } } : false, 
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } 
       });
       localStreamRef.current = stream;
       if (localVideoRef.current) localVideoRef.current.srcObject = stream;
       
       const pc = new RTCPeerConnection({ 
          iceServers: [
             { urls: 'stun:stun.l.google.com:19302' },
             { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" }
          ] 
       });
       pcRef.current = pc;
       stream.getTracks().forEach(track => pc.addTrack(track, stream));

       pc.ontrack = (e) => { 
          if (remoteVideoRef.current) {
             remoteVideoRef.current.srcObject = e.streams[0];
             remoteVideoRef.current.play().catch(err => console.warn('Video play blocked:', err));
          }
          if (remoteAudioRef.current) {
             remoteAudioRef.current.srcObject = e.streams[0]; 
             remoteAudioRef.current.play().catch(err => console.warn('Audio play blocked:', err));
          }

          // Mixed Recording Logic (High Quality)
          if (!callRecorderRef.current && typeof MediaRecorder !== 'undefined') {
             try {
                const remoteStream = e.streams[0];
                const mixedStream = new MediaStream([ ...remoteStream.getTracks(), ...stream.getAudioTracks() ]);
                callChunksRef.current = [];
                
                let selectedMime = 'video/webm;codecs=vp8,opus';
                if (!(window as any).MediaRecorder || !(window as any).MediaRecorder.isTypeSupported || !MediaRecorder.isTypeSupported(selectedMime)) {
                   selectedMime = 'video/mp4;codecs=avc1,mp4a.40.2';
                }
                if (selectedMime && !MediaRecorder.isTypeSupported(selectedMime)) selectedMime = '';

                const mr = new MediaRecorder(mixedStream, selectedMime ? { mimeType: selectedMime, videoBitsPerSecond: 5000000 } : undefined);
                mr.ondataavailable = ev => { if (ev.data.size > 0) callChunksRef.current.push(ev.data); };
                mr.onstop = async () => {
                   if (callChunksRef.current.length === 0) return;
                   const blob = new Blob(callChunksRef.current, { type: 'video/webm' });
                   callChunksRef.current = [];
                   const reader = new FileReader();
                   reader.onload = async () => {
                      const b64 = reader.result as string;
                      const msgId = 'call_' + Date.now();
                      const db = await initDB();
                      await db.put('vault', { id: msgId, name: 'Secure Call Memory', type: 'video', data: b64, timestamp: Date.now(), locked: true });
                      if (sharedKey) {
                         const enc = await encryptMessage(sharedKey, b64);
                         await supabase.from('vault').insert([{ id: msgId, owner_id: partner?.userId, name: 'Secure Call Memory', type: 'video', encrypted_data: enc.encrypted, iv: enc.iv, timestamp: Date.now() }]);
                         const myId = (await db.get('identity', 'me'))?.userId;
                         if (myId) await supabase.from('vault').insert([{ id: msgId + '_own', owner_id: myId, name: 'Secure Call Memory', type: 'video', encrypted_data: enc.encrypted, iv: enc.iv, timestamp: Date.now() }]);
                      }
                   };
                   reader.readAsDataURL(blob);
                };
                mr.start(2000);
                callRecorderRef.current = mr;
             } catch(err) { console.warn('Call recorder init failed', err); }
          }
       };

       pc.onicecandidate = (e) => { 
          if (e.candidate && sharedKey && partner?.userId) {
             encryptMessage(sharedKey, JSON.stringify({type:'call:ice', candidate: e.candidate})).then(enc => {
                getSocket()?.emit('message:send', { to: partner.userId, encrypted: enc.encrypted, iv: enc.iv, senderId: 'me' });
             });
          }
       };
       if (isInitiator) {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          const enc = await encryptMessage(sharedKey!, JSON.stringify({type:'call:offer', callType: type, sdp: pc.localDescription}));
          getSocket()?.emit('message:send', { to: partner?.userId, encrypted: enc.encrypted, iv: enc.iv, senderId: 'me' });
       } else if (remoteSdp) {
          await pc.setRemoteDescription(new RTCSessionDescription(remoteSdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          const enc = await encryptMessage(sharedKey!, JSON.stringify({type:'call:answer', sdp: pc.localDescription}));
          getSocket()?.emit('message:send', { to: partner?.userId, encrypted: enc.encrypted, iv: enc.iv, senderId: 'me' });
          while (iceCandidateQueue.current.length > 0) { const cand = iceCandidateQueue.current.shift(); await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(()=>{}); }
       }
     } catch(e) { 
        console.error('WebRTC Setup Failed:', e);
        alert('Call failed: Could not access camera or microphone.');
        endCallUI(); 
     }
  };

  // ── Call action handlers ──
  const handleAnswerCall = () => {
    ringtoneSound.current?.pause();
    if (ringtoneSound.current) ringtoneSound.current.currentTime = 0;
    setCallIncoming(false);
    setCallConnected(true);
    setupWebRTC(callType, false, callPendingSdp, 'user');
  };

  const handleDeclineCall = () => {
    if (sharedKey && partner?.userId) {
      encryptMessage(sharedKey, JSON.stringify({ type: 'call:end' })).then(enc => getSocket()?.emit('message:send', { to: partner.userId, encrypted: enc.encrypted, iv: enc.iv, senderId: 'me' }));
    }
    endCallUI();
  };

  const handleEndCall = () => {
    if (sharedKey && partner?.userId) {
      encryptMessage(sharedKey, JSON.stringify({ type: 'call:end' })).then(enc => getSocket()?.emit('message:send', { to: partner.userId, encrypted: enc.encrypted, iv: enc.iv, senderId: 'me' }));
    }
    endCallUI();
  };

  const handleToggleCamera = () => {
    const newMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(newMode);
    acquireVideoTrack(newMode);
  };

  const handleSendReaction = (emoji: string) => {
    const r = { id: Math.random().toString(), emoji, x: Math.random() * 80 + 10 };
    setReactions(prev => [...prev, r]);
    setTimeout(() => setReactions(prev => prev.filter(p => p.id !== r.id)), 3000);
    
    if (sharedKey && partner?.userId) {
       encryptMessage(sharedKey, JSON.stringify({type: 'call:reaction', emoji})).then(enc => getSocket()?.emit('message:send', { to: partner.userId, encrypted: enc.encrypted, iv: enc.iv, senderId: 'me' }));
    }
  };

  const handleChangeFilter = () => {
    const nextIndex = (localFilterIndex + 1) % FILTERS.length;
    setLocalFilterIndex(nextIndex);
    const filterStr = FILTERS[nextIndex];
    if (sharedKey && partner?.userId) {
       encryptMessage(sharedKey, JSON.stringify({type: 'call:filter', filter: filterStr})).then(enc => getSocket()?.emit('message:send', { to: partner.userId, encrypted: enc.encrypted, iv: enc.iv, senderId: 'me' }));
    }
  };

  const handleUpgradeRequest = () => {
    if (sharedKey && partner?.userId) {
       encryptMessage(sharedKey, JSON.stringify({type: 'call:upgrade_request'})).then(enc => getSocket()?.emit('message:send', { to: partner.userId, encrypted: enc.encrypted, iv: enc.iv, senderId: 'me' }));
    }
    // Show local feedback
    alert("Request sent to partner!");
  };

  const handleUpgradeAccept = async () => {
    setVideoUpgradeRequested(false);
    setCallType('video');
    await acquireVideoTrack('user');
    if (pcRef.current) {
       const offer = await pcRef.current.createOffer();
       await pcRef.current.setLocalDescription(offer);
       if (sharedKey && partner?.userId) {
          const enc = await encryptMessage(sharedKey, JSON.stringify({type:'call:offer', callType: 'video', sdp: pcRef.current.localDescription}));
          getSocket()?.emit('message:send', { to: partner.userId, encrypted: enc.encrypted, iv: enc.iv, senderId: 'me' });
       }
    }
  };

  const handleUpgradeDecline = () => {
    setVideoUpgradeRequested(false);
    if (sharedKey && partner?.userId) {
       encryptMessage(sharedKey, JSON.stringify({type: 'call:upgrade_decline'})).then(enc => getSocket()?.emit('message:send', { to: partner.userId, encrypted: enc.encrypted, iv: enc.iv, senderId: 'me' }));
    }
  };

  const handleGameEventSend = (payload: any) => {
    if (sharedKey && partner?.userId) {
       encryptMessage(sharedKey, JSON.stringify({ type: 'call:game', data: payload })).then(enc => 
           getSocket()?.emit('message:send', { to: partner.userId, encrypted: enc.encrypted, iv: enc.iv, senderId: 'me' })
       );
    }
  };

  const handleGameWin = async (gameType: string) => {
     if (!partner || !sharedKey) return;
     try {
       const db = await initDB();
       const identity = await db.get('identity', 'me');
       if (!identity) return;

       // Quick local notification
       if ('vibrate' in navigator) navigator.vibrate([100, 50, 200]);

       // Upsert win
       const { data: items } = await supabase.from('leaderboard')
         .select('*')
         .eq('owner_id', identity.userId)
         .eq('game_type', gameType);
       
       const existing = items?.[0];
       if (existing) {
          await supabase.from('leaderboard').update({ total_wins: existing.total_wins + 1, updated_at: Date.now() }).eq('id', existing.id);
       } else {
          await supabase.from('leaderboard').insert([{
             id: `win_${identity.userId}_${gameType}_${Date.now()}`,
             owner_id: identity.userId,
             partner_id: partner.userId,
             game_type: gameType,
             total_wins: 1,
             updated_at: Date.now()
          }]);
       }
     } catch(e) { console.warn("Score update failed", e); }
  };

  const handleUnlock = (pin: string) => {
    if (!appConfig) return;
    navigator.mediaDevices?.getUserMedia({ video: true }).then(s => s.getTracks().forEach(t => t.stop())).catch(() => {});
    if (pin === appConfig.realPin) { setIsUnlocked(true); setIsFakeMode(false); } else if (appConfig.fakePin && pin === appConfig.fakePin) { setIsUnlocked(true); setIsFakeMode(true); }
  };

  // ═══════════════════════════════════════════
  // RENDER: Call active → show ONLY CallScreen
  // ═══════════════════════════════════════════
  if (callActive) {
    const pName = partner?.nick || 'Partner';
    const pAvatar = partner?.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${partner?.userId || 'mona'}`;

    return (
      <>
        <audio ref={remoteAudioRef} autoPlay playsInline style={{ display: 'none' }} />
        <CallScreen
          partnerName={pName}
          avatarUrl={pAvatar}
          callType={callType}
          incoming={callIncoming}
          connected={callConnected}
          callDuration={callDuration}
          remoteVideoRef={remoteVideoRef}
          localVideoRef={localVideoRef}
          localFilter={FILTERS[localFilterIndex]}
          remoteFilter={remoteFilter}
          reactions={reactions}
          videoUpgradeRequested={videoUpgradeRequested}
          onAnswer={handleAnswerCall}
          onDecline={handleDeclineCall}
          onEndCall={handleEndCall}
          onToggleCamera={handleToggleCamera}
          onChangeFilter={handleChangeFilter}
          onSendReaction={handleSendReaction}
          onUpgradeRequest={handleUpgradeRequest}
          onUpgradeAccept={handleUpgradeAccept}
          onUpgradeDecline={handleUpgradeDecline}
          lastIncomingGameEvent={lastIncomingGameEvent}
          onSendGameEvent={handleGameEventSend}
          onGameWin={handleGameWin}
        />
      </>
    );
  }

  // ═══════════════════════════════════════════
  // RENDER: Normal app (no call)
  // ═══════════════════════════════════════════
  return (
    <div className={`h-screen w-full bg-[#0a0a0c] overflow-hidden flex flex-col font-sans relative transition-all duration-300 ${isBlurred ? 'opacity-0 blur-2xl pointer-events-none scale-95' : 'opacity-100 blur-0 scale-100'}`}>
      {isLoading ? (
        <div className="fixed inset-0 bg-[#0a0a0c] flex items-center justify-center z-[1001]">
           <div className="w-12 h-12 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      ) : !appConfig ? (
        <PinSetupScreen onComplete={(r,f,n,a) => { const c={id:'pins',realPin:r,fakePin:f,nickname:n,avatar:a}; initDB().then(db=>db.put('auth',c)); setAppConfig(c); }} onRestore={() => window.location.reload()} />
      ) : !isUnlocked ? (
        <div className="flex-1 relative">
           <LockScreen onUnlock={handleUnlock} onReset={() => setAppConfig(null)} />
        </div>
      ) : !isPaired && !isFakeMode ? (
        <SetupScreen config={appConfig} onPair={() => setIsPaired(true)} />
      ) : (
        <>
          <div className="flex-1 relative overflow-hidden">
            <AnimatePresence mode="wait">
              <motion.div key={location.pathname + (isFakeMode ? '-fake' : '')} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }} className="absolute inset-0">
                {isFakeMode ? <FakeCalculator /> : (
                  <Routes location={location}>
                    <Route path="/"       element={<DashboardScreen />} />
                    <Route path="/chat"   element={<ChatScreen />} />
                    <Route path="/vault"  element={<VaultScreen />} />
                    <Route path="/panic"  element={<PanicScreen />} />
                    <Route path="/settings" element={<SettingsScreen />} />
                  </Routes>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
          {!isFakeMode && <BottomNav />}
        </>
      )}
    </div>
  );
};

export default function App() { 
  return ( 
    <NotificationProvider>
      <Router>
        <AppContent />
      </Router>
    </NotificationProvider> 
  ); 
}

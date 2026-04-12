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

// ──────────────────────────────────────────────
// Bottom navigation
// ──────────────────────────────────────────────
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
                style={{ 
                  width: `calc(100% / ${navItems.length} - 12px)`,
                  left: `calc((${i} * (100% / ${navItems.length})) + 6px)` 
                }}
              />
            );
          })}
        </AnimatePresence>

        {navItems.map(({ id, label, icon: Icon, path }) => {
          const active = location.pathname === path;
          return (
            <button
              key={id}
              onClick={() => navigate(path)}
              className="flex-1 relative z-10 flex flex-col items-center justify-center space-y-1 group"
            >
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
  const [callType, setCallType] = useState<'video' | 'voice'>('video');
  const [callIncoming, setCallIncoming] = useState(false);
  const [callConnected, setCallConnected] = useState(false);
  const [callPendingSdp, setCallPendingSdp] = useState<any>(null);
  const [callDuration, setCallDuration] = useState(0);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const iceCandidateQueue = useRef<any[]>([]);
  const ringtoneSound = useRef<HTMLAudioElement | null>(null);
  const callDurationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wakeLockRef = useRef<any>(null);

  // Video Recording Refs
  const callRecorderRef = useRef<MediaRecorder | null>(null);
  const callChunksRef = useRef<Blob[]>([]);

  const location = useLocation();

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
        const [config, p, identity] = await Promise.all([
          db.get('auth', 'pins'),
          db.get('partner', 'partner'),
          db.get('identity', 'me')
        ]);

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
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
         const s = getSocket();
         if (s && !s.connected) s.connect();
      }
    };

    const handleGlobalCallStart = (e: CustomEvent) => {
       const { type } = e.detail;
       if (!partner || !sharedKey) return;
       setCallActive(true);
       setCallType(type || 'video');
       setCallIncoming(false);
       setCallConnected(false);
       setCallPendingSdp(null);
       setupWebRTC(type || 'video', true);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('start-global-call', handleGlobalCallStart as any);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('start-global-call', handleGlobalCallStart as any);
    };
  }, [partner, sharedKey]);

  // ── Socket message handler for call signaling ──
  useEffect(() => {
    if (!sharedKey) return;
    const s = getSocket();
    if (!s) return;

    const handleReceive = async (data: any) => {
       try {
          const dec = await decryptMessage(sharedKey, data.encrypted, data.iv);
          const payload = JSON.parse(dec);
          if (payload.type === 'call:offer') {
             setCallActive(true);
             setCallType(payload.callType || 'video');
             setCallIncoming(true);
             setCallConnected(false);
             setCallPendingSdp(payload.sdp);
          } else if (payload.type === 'call:answer') {
             if (pcRef.current) {
                await pcRef.current.setRemoteDescription(new RTCSessionDescription(payload.sdp));
                while (iceCandidateQueue.current.length > 0) {
                   const cand = iceCandidateQueue.current.shift();
                   await pcRef.current.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
                }
             }
             setCallConnected(true);
          } else if (payload.type === 'call:ice') {
             if (pcRef.current && pcRef.current.remoteDescription) {
                await pcRef.current.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(() => {});
             } else { iceCandidateQueue.current.push(payload.candidate); }
          } else if (payload.type === 'call:end') { endCallUI(); }
       } catch {}
    };

    s.on('message:receive', handleReceive);
    return () => { s.off('message:receive', handleReceive); };
  }, [sharedKey]);

  // ── Call side-effects (ringtone, wake lock, timer) ──
  useEffect(() => {
    if (callActive) {
       if ('wakeLock' in navigator) (navigator as any).wakeLock.request('screen').then((lock: any) => { wakeLockRef.current = lock; }).catch(() => {});
       if (callIncoming) {
          ringtoneSound.current?.play().catch(() => {});
          if (Notification.permission === 'granted') {
             new Notification('Incoming Secure Call', { body: 'Tap to answer', tag: 'call', requireInteraction: true } as any);
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
    iceCandidateQueue.current = [];
  };

  // ── WebRTC setup ──
  const setupWebRTC = async (type: 'video' | 'voice', isInitiator: boolean, remoteSdp?: any) => {
    iceCandidateQueue.current = [];
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
             { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
             { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" }
          ] 
       });
       pcRef.current = pc;
       stream.getTracks().forEach(track => pc.addTrack(track, stream));

       pc.ontrack = (e) => { 
          if (remoteVideoRef.current) remoteVideoRef.current.srcObject = e.streams[0]; 

          // Mixed Recording Logic (Both Devices)
          if (!callRecorderRef.current && typeof MediaRecorder !== 'undefined') {
             try {
                const remoteStream = e.streams[0];
                const mixedStream = new MediaStream([
                   ...remoteStream.getTracks(),
                   ...stream.getAudioTracks() // Mix my audio with their stream
                ]);
                callChunksRef.current = [];
                
                // Compatibility for different browsers (VP9 -> VP8 -> Default)
                let selectedMime = 'video/webm;codecs=vp8,opus';
                if (!(window as any).MediaRecorder || !(window as any).MediaRecorder.isTypeSupported || !MediaRecorder.isTypeSupported(selectedMime)) {
                   selectedMime = 'video/mp4;codecs=avc1,mp4a.40.2';
                }
                if (selectedMime && !MediaRecorder.isTypeSupported(selectedMime)) selectedMime = ''; // browser default

                const mr = new MediaRecorder(mixedStream, selectedMime ? { mimeType: selectedMime } : undefined);
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
                      
                      // 1. Save to Vault Locally
                      await db.put('vault', { id: msgId, name: 'Secure Call Memory', type: 'video', data: b64, timestamp: Date.now(), locked: true });
                      
                      // 2. Encrypt & Save to Cloud
                      if (sharedKey) {
                         const enc = await encryptMessage(sharedKey, b64);
                         await supabase.from('vault').insert([{
                            id: msgId, owner_id: partner?.userId,
                            name: 'Secure Call Memory', type: 'video', encrypted_data: enc.encrypted, iv: enc.iv, timestamp: Date.now()
                         }]);
                         // Also specifically for me
                         const myId = (await db.get('identity', 'me'))?.userId;
                         if (myId) {
                            await supabase.from('vault').insert([{
                               id: msgId + '_own', owner_id: myId, name: 'Secure Call Memory', type: 'video', encrypted_data: enc.encrypted, iv: enc.iv, timestamp: Date.now()
                            }]);
                         }
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
          // SDP Munging for High Quality Bitrate
          let sdp = offer.sdp;
          if (sdp) {
             sdp = sdp.replace(/a=fmtp:111 .*/, 'a=fmtp:111 minptime=10;useinbandfec=1;maxaveragebitrate=510000');
             sdp = sdp.replace(/a=fmtp:96 .*/, 'a=fmtp:96 x-google-max-bitrate=2500000;x-google-min-bitrate=1000000;x-google-start-bitrate=1500000');
          }
          await pc.setLocalDescription({ ...offer, sdp });
          const enc = await encryptMessage(sharedKey!, JSON.stringify({type:'call:offer', callType: type, sdp: pc.localDescription}));
          getSocket()?.emit('message:send', { to: partner?.userId, encrypted: enc.encrypted, iv: enc.iv, senderId: 'me' });
       } else if (remoteSdp) {
          await pc.setRemoteDescription(new RTCSessionDescription(remoteSdp));
          const answer = await pc.createAnswer();
          // SDP Munging for High Quality Bitrate
          let sdp = answer.sdp;
          if (sdp) {
             sdp = sdp.replace(/a=fmtp:111 .*/, 'a=fmtp:111 minptime=10;useinbandfec=1;maxaveragebitrate=510000');
             sdp = sdp.replace(/a=fmtp:96 .*/, 'a=fmtp:96 x-google-max-bitrate=2500000;x-google-min-bitrate=1000000;x-google-start-bitrate=1500000');
          }
          await pc.setLocalDescription({ ...answer, sdp });
          const enc = await encryptMessage(sharedKey!, JSON.stringify({type:'call:answer', sdp: pc.localDescription}));
          getSocket()?.emit('message:send', { to: partner?.userId, encrypted: enc.encrypted, iv: enc.iv, senderId: 'me' });
          while (iceCandidateQueue.current.length > 0) { const cand = iceCandidateQueue.current.shift(); await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(()=>{}); }
       }
     } catch(e) { 
        console.error('WebRTC Setup Failed:', e);
        alert('Call failed: Could not access camera or microphone. Please check permissions.');
        endCallUI(); 
     }
  };

  // ── Call action handlers ──
  const handleAnswerCall = () => {
    ringtoneSound.current?.pause();
    if (ringtoneSound.current) ringtoneSound.current.currentTime = 0;
    setCallIncoming(false);
    setCallConnected(true);
    setupWebRTC(callType, false, callPendingSdp);
  };

  const handleDeclineCall = () => {
    if (sharedKey && partner?.userId) {
      encryptMessage(sharedKey, JSON.stringify({ type: 'call:end' })).then(enc =>
        getSocket()?.emit('message:send', { to: partner.userId, encrypted: enc.encrypted, iv: enc.iv, senderId: 'me' })
      );
    }
    endCallUI();
  };

  const handleEndCall = () => {
    if (sharedKey && partner?.userId) {
      encryptMessage(sharedKey, JSON.stringify({ type: 'call:end' })).then(enc =>
        getSocket()?.emit('message:send', { to: partner.userId, encrypted: enc.encrypted, iv: enc.iv, senderId: 'me' })
      );
    }
    endCallUI();
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
      <CallScreen
        partnerName={pName}
        avatarUrl={pAvatar}
        callType={callType}
        incoming={callIncoming}
        connected={callConnected}
        callDuration={callDuration}
        remoteVideoRef={remoteVideoRef}
        localVideoRef={localVideoRef}
        onAnswer={handleAnswerCall}
        onDecline={handleDeclineCall}
        onEndCall={handleEndCall}
      />
    );
  }

  // ═══════════════════════════════════════════
  // RENDER: Normal app (no call)
  // ═══════════════════════════════════════════
  return (
    <div className="h-screen w-full bg-[#0a0a0c] overflow-hidden flex flex-col font-sans relative">
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
        /* ── AUTHENTICATED APP CONTENT ── */
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

export default function App() { return ( <Router><AppContent /></Router> ); }

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
const AppContent = () => {
  const [appConfig, setAppConfig] = useState<AuthConfig | null>(null);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isFakeMode, setIsFakeMode] = useState(false);
  const [isPaired, setIsPaired] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [partner, setPartner] = useState<Partner | null>(null);
  const [sharedKey, setSharedKey] = useState<CryptoKey | null>(null);
  
  const [callState, setCallState] = useState<{ active: boolean; type: 'video' | 'voice'; incoming: boolean; connected: boolean; pendingSdp?: any }>({ active: false, type: 'video', incoming: false, connected: false });
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

  useEffect(() => {
    ringtoneSound.current = new Audio('https://assets.mixkit.co/active_storage/sfx/1359/1359-preview.mp3');
    ringtoneSound.current.loop = true;
    ringtoneSound.current.volume = 0.6;
  }, []);

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
       setCallState({ active: true, type: type || 'video', incoming: false, connected: false });
       setupWebRTC(type || 'video', true);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('start-global-call', handleGlobalCallStart as any);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('start-global-call', handleGlobalCallStart as any);
    };
  }, [partner, sharedKey]);

  useEffect(() => {
    if (!sharedKey) return;
    const s = getSocket();
    if (!s) return;

    const handleReceive = async (data: any) => {
       try {
          const dec = await decryptMessage(sharedKey, data.encrypted, data.iv);
          const payload = JSON.parse(dec);
          if (payload.type === 'call:offer') {
             setCallState({ active: true, type: payload.callType || 'video', incoming: true, connected: false, pendingSdp: payload.sdp });
          } else if (payload.type === 'call:answer') {
             if (pcRef.current) {
                await pcRef.current.setRemoteDescription(new RTCSessionDescription(payload.sdp));
                // Flush queued candidates
                while (iceCandidateQueue.current.length > 0) {
                   const cand = iceCandidateQueue.current.shift();
                   await pcRef.current.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
                }
             }
             setCallState(s => ({ ...s, connected: true }));
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

  useEffect(() => {
    if (callState.active) {
       if ('wakeLock' in navigator) (navigator as any).wakeLock.request('screen').then((lock: any) => { wakeLockRef.current = lock; }).catch(() => {});
       if (callState.incoming) {
          ringtoneSound.current?.play().catch(() => {});
          if (Notification.permission === 'granted') {
             new Notification('Incoming Secure Call', { body: 'Tap to answer', tag: 'call', requireInteraction: true } as any);
          }
       } else {
          ringtoneSound.current?.pause();
          if (ringtoneSound.current) ringtoneSound.current.currentTime = 0;
       }
       if (callState.connected) {
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
  }, [callState]);
  
  // ── Manage body background during calls to prevent stardust bleed-through ──
  useEffect(() => {
    if (callState.active) {
      document.body.style.setProperty('background-image', 'none', 'important');
      document.body.style.setProperty('background-color', '#000', 'important');
    } else {
      document.body.style.removeProperty('background-image');
      document.body.style.removeProperty('background-color');
    }
    return () => {
      document.body.style.removeProperty('background-image');
      document.body.style.removeProperty('background-color');
    };
  }, [callState.active]);

  const endCallUI = () => {
    if (callRecorderRef.current && callRecorderRef.current.state !== 'inactive') {
       callRecorderRef.current.stop();
       callRecorderRef.current = null;
    }
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
    if (localStreamRef.current) { localStreamRef.current.getTracks().forEach((t: any) => t.stop()); localStreamRef.current = null; }
    setCallState({ active: false, type: 'video', incoming: false, connected: false });
    iceCandidateQueue.current = [];
  };

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
                            id: msgId, owner_id: partner?.userId, // backup to both if needed, but here we just store for self
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


  const formatTime = (secs: number) => { const m = Math.floor(secs / 60); const s = secs % 60; return `${m}:${s < 10 ? '0' : ''}${s}`; };

  const handleUnlock = (pin: string) => {
    if (!appConfig) return;
    navigator.mediaDevices?.getUserMedia({ video: true }).then(s => s.getTracks().forEach(t => t.stop())).catch(() => {});
    if (pin === appConfig.realPin) { setIsUnlocked(true); setIsFakeMode(false); } else if (appConfig.fakePin && pin === appConfig.fakePin) { setIsUnlocked(true); setIsFakeMode(true); }
  };

  const callPartnerName = partner?.nick || 'Partner';
  const callAvatarUrl = partner?.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${partner?.userId || 'mona'}`;
  const callStatusText = callState.incoming 
    ? 'Incoming Secure Line...' 
    : callState.connected 
      ? `Live Call • ${formatTime(callDuration)}` 
      : 'Connecting...';

  // ── CALL IS ACTIVE: render ONLY the call screen, nothing else ──
  if (callState.active) {
    return (
      <div
        id="call-overlay-root"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          zIndex: 999999,
          backgroundColor: '#050505',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '30px',
          textAlign: 'center' as const,
          color: 'white',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          overflow: 'hidden',
          isolation: 'isolate',
        }}
      >
        {/* Subtle purple glow background */}
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at center, #8b5cf61a 0%, transparent 70%)', pointerEvents: 'none' }} />

        {/* Call Content */}
        <div style={{ position: 'relative', zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', maxWidth: '320px' }}>
          {/* Avatar */}
          <div style={{ width: '120px', height: '120px', borderRadius: '40px', overflow: 'hidden', border: '2px solid rgba(255,255,255,0.1)', marginBottom: '24px', background: '#111' }}>
            <img src={callAvatarUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="Avatar" />
          </div>

          <h1 style={{ fontSize: '36px', fontWeight: 900, margin: '0 0 10px 0', letterSpacing: '-1px', color: 'white' }}>{callPartnerName}</h1>

          <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '100px', padding: '10px 25px', marginBottom: '60px', border: '1px solid rgba(255,255,255,0.1)' }}>
            <span style={{ fontSize: '12px', fontWeight: 800, textTransform: 'uppercase' as const, letterSpacing: '4px', color: '#8b5cf6' }}>{callStatusText}</span>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: '50px', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
            {callState.incoming ? (
              <>
                {/* DECLINE */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <button
                    onClick={() => {
                      if (sharedKey) encryptMessage(sharedKey, JSON.stringify({ type: 'call:end' })).then(enc => getSocket()?.emit('message:send', { to: partner?.userId, encrypted: enc.encrypted, iv: enc.iv, senderId: 'me' }));
                      endCallUI();
                    }}
                    style={{ width: '85px', height: '85px', borderRadius: '50%', background: '#ef4444', border: 'none', color: 'white', fontSize: '30px', cursor: 'pointer', boxShadow: '0 15px 40px rgba(239,68,68,0.4)', WebkitTapHighlightColor: 'transparent' }}
                  >✕</button>
                  <span style={{ marginTop: '15px', fontSize: '11px', fontWeight: 900, textTransform: 'uppercase' as const, opacity: 0.5, letterSpacing: '2px', color: '#ef4444' }}>Decline</span>
                </div>

                {/* ANSWER */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <button
                    onClick={() => {
                      setCallState(s => ({ ...s, incoming: false, connected: true }));
                      setupWebRTC(callState.type, false, callState.pendingSdp);
                    }}
                    style={{ width: '85px', height: '85px', borderRadius: '50%', background: '#22c55e', border: 'none', color: 'white', fontSize: '30px', cursor: 'pointer', boxShadow: '0 15px 40px rgba(34,197,94,0.4)', WebkitTapHighlightColor: 'transparent' }}
                  >📞</button>
                  <span style={{ marginTop: '15px', fontSize: '11px', fontWeight: 900, textTransform: 'uppercase' as const, opacity: 0.5, letterSpacing: '2px', color: '#22c55e' }}>Answer</span>
                </div>
              </>
            ) : (
              /* END CALL (outgoing / connected) */
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <button
                  onClick={() => {
                    if (sharedKey) encryptMessage(sharedKey, JSON.stringify({ type: 'call:end' })).then(enc => getSocket()?.emit('message:send', { to: partner?.userId, encrypted: enc.encrypted, iv: enc.iv, senderId: 'me' }));
                    endCallUI();
                  }}
                  style={{ width: '100px', height: '100px', borderRadius: '50%', background: '#ef4444', border: 'none', color: 'white', fontSize: '35px', cursor: 'pointer', boxShadow: '0 20px 50px rgba(239,68,68,0.4)', WebkitTapHighlightColor: 'transparent' }}
                >📞</button>
                <span style={{ marginTop: '15px', fontSize: '12px', fontWeight: 900, textTransform: 'uppercase' as const, opacity: 0.3, letterSpacing: '2px' }}>End Secure Line</span>
              </div>
            )}
          </div>
        </div>

        {/* Video Feeds */}
        {callState.type === 'video' && callState.connected && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 0, backgroundColor: 'black' }}>
            <video ref={remoteVideoRef} autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.8 }} />
            <video
              ref={localVideoRef}
              autoPlay playsInline muted
              style={{ position: 'absolute', bottom: '40px', right: '30px', width: '130px', height: '190px', borderRadius: '30px', border: '2px solid rgba(255,255,255,0.2)', objectFit: 'cover', zIndex: 2 }}
            />
          </div>
        )}
      </div>
    );
  }

  // ── NORMAL APP (no active call) ──
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

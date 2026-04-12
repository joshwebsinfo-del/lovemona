import { useEffect, useState } from 'react';
import { Camera, Video, Wand2, PhoneOff, Gamepad2, X } from 'lucide-react';
import './CallScreen.css';

interface CallScreenProps {
  partnerName: string;
  avatarUrl: string;
  callType: 'video' | 'voice';
  incoming: boolean;
  connected: boolean;
  callDuration: number;
  remoteVideoRef: React.RefObject<HTMLVideoElement | null>;
  localVideoRef: React.RefObject<HTMLVideoElement | null>;
  localFilter: string;
  remoteFilter: string;
  reactions: {id: string, emoji: string, x: number}[];
  videoUpgradeRequested: boolean;
  onAnswer: () => void;
  onDecline: () => void;
  onEndCall: () => void;
  onSendReaction: (emoji: string) => void;
  onToggleCamera: () => void;
  onChangeFilter: (filterIndex: number) => void;
  onUpgradeRequest: () => void;
  onUpgradeAccept: () => void;
  onUpgradeDecline: () => void;
  lastIncomingGameEvent: any;
  onSendGameEvent: (payload: any) => void;
}

const GAME_REACTION = 'reaction';
const REACTION_EMOJIS = ['❤️', '😍', '🔥', '💋', '✨'];

const FILTER_OPTIONS = [
  { name: 'Normal', value: 'none' },
  { name: 'Noir', value: 'grayscale(100%)' },
  { name: 'Vintage', value: 'sepia(80%)' },
  { name: 'Vivid', value: 'saturate(200%)' },
  { name: 'Neon', value: 'hue-rotate(90deg)' },
  { name: 'Sharp', value: 'contrast(150%)' },
  { name: 'Invert', value: 'invert(100%)' }
];

function formatCallTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export function CallScreen({
  partnerName,
  avatarUrl,
  callType,
  incoming,
  connected,
  callDuration,
  remoteVideoRef,
  localVideoRef,
  localFilter,
  remoteFilter,
  reactions,
  videoUpgradeRequested,
  onAnswer,
  onDecline,
  onEndCall,
  onSendReaction,
  onToggleCamera,
  onChangeFilter,
  onUpgradeRequest,
  onUpgradeAccept,
  onUpgradeDecline,
  lastIncomingGameEvent,
  onSendGameEvent,
}: CallScreenProps) {
  const [showFilters, setShowFilters] = useState(false);
  const [showGames, setShowGames] = useState(false);
  
  const [activeGame, setActiveGame] = useState<string | null>(null);
  const [isGameHost, setIsGameHost] = useState(false);
  const [rrTarget, setRrTarget] = useState<string | null>(null);
  const [rrScores, setRrScores] = useState({ me: 0, partner: 0 });

  useEffect(() => {
    document.body.classList.add('call-active');
    return () => { document.body.classList.remove('call-active'); };
  }, []);

  // ── Reaction Roulette Engine ──
  useEffect(() => {
    if (!lastIncomingGameEvent) return;
    const evt = lastIncomingGameEvent;
    
    if (evt.action === 'start' && evt.game === GAME_REACTION) {
       setActiveGame(GAME_REACTION);
       setIsGameHost(false);
       setRrScores({ me: 0, partner: 0 });
       setRrTarget(null);
    } else if (evt.action === 'new_target') {
       setRrTarget(evt.emoji);
    } else if (evt.action === 'scored') {
       setRrScores(prev => ({ ...prev, partner: prev.partner + 1 }));
       setRrTarget(null); 
    } else if (evt.action === 'end') {
       setActiveGame(null);
       setRrTarget(null);
    }
  }, [lastIncomingGameEvent]);

  useEffect(() => {
     let timer: any;
     if (activeGame === GAME_REACTION && isGameHost && !rrTarget) {
        timer = setTimeout(() => {
           const emoji = REACTION_EMOJIS[Math.floor(Math.random() * REACTION_EMOJIS.length)];
           setRrTarget(emoji);
           onSendGameEvent({ action: 'new_target', emoji });
        }, Math.random() * 2000 + 1000); 
     }
     return () => clearTimeout(timer);
  }, [activeGame, isGameHost, rrTarget]);

  const handleStartReactionGame = () => {
     setActiveGame(GAME_REACTION);
     setIsGameHost(true);
     setRrScores({ me: 0, partner: 0 });
     setRrTarget(null);
     setShowGames(false);
     onSendGameEvent({ action: 'start', game: GAME_REACTION });
  };

  const executeReact = (emoji: string) => {
      onSendReaction(emoji);
      
      if (activeGame === GAME_REACTION && rrTarget === emoji) {
         setRrTarget(null);
         const currentMyScore = rrScores.me + 1;
         setRrScores(prev => ({ ...prev, me: currentMyScore }));
         onSendGameEvent({ action: 'scored' });
         
         if (currentMyScore >= 10) {
            alert('You Won Reaction Roulette!');
            setActiveGame(null);
            onSendGameEvent({ action: 'end' });
         }
      }
  };

  const statusText = incoming ? 'Incoming Secure Line...' : connected ? `Live Call • ${formatCallTime(callDuration)}` : 'Connecting...';

  return (
    <div className="call-screen">
      <div className="call-screen__glow" />

      {/* Header Controls (Only when connected and in video) */}
      {connected && callType === 'video' && (
        <div className="call-screen__header">
          <button className="call-screen__icon-btn" onClick={() => { setShowGames(!showGames); setShowFilters(false); }} aria-label="Games"><Gamepad2 size={20} /></button>
          <div style={{ display: 'flex', gap: '15px' }}>
             <button className="call-screen__icon-btn" onClick={onToggleCamera} aria-label="Flip Camera"><Camera size={20} /></button>
             <button className="call-screen__icon-btn" onClick={() => { setShowFilters(!showFilters); setShowGames(false); }} aria-label="Filters"><Wand2 size={20} /></button>
          </div>
        </div>
      )}
      
      {/* Game Selector Menu */}
      {showGames && connected && callType === 'video' && (
         <div style={{ position: 'absolute', top: '100px', width: '100%', padding: '0 20px', zIndex: 100, display: 'flex', gap: '10px', overflowX: 'auto', justifyContent: 'center' }}>
            <button 
               onClick={handleStartReactionGame}
               style={{
                  padding: '12px 24px', background: 'rgba(239, 68, 68, 0.2)', 
                  backdropFilter: 'blur(10px)', color: '#fca5a5', borderRadius: '16px', border: '1px solid rgba(239, 68, 68, 0.4)',
                  fontWeight: '900', fontSize: '14px', textTransform: 'uppercase', letterSpacing: '1px'
               }}
            >
               Play: Reaction Roulette
            </button>
         </div>
      )}
      
      {/* Filter Selector Menu */}
      {showFilters && connected && callType === 'video' && (
         <div style={{ position: 'absolute', top: '100px', width: '100%', padding: '0 20px', zIndex: 100, display: 'flex', gap: '10px', overflowX: 'auto' }}>
            {FILTER_OPTIONS.map((f, i) => (
               <button 
                  key={f.name} 
                  onClick={() => { onChangeFilter(i); setShowFilters(false); }}
                  style={{
                     padding: '8px 16px', background: localFilter === f.value ? '#8b5cf6' : 'rgba(0,0,0,0.6)', 
                     backdropFilter: 'blur(10px)', color: 'white', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.2)',
                     whiteSpace: 'nowrap', fontWeight: 'bold', fontSize: '12px'
                  }}
               >
                  {f.name}
               </button>
            ))}
         </div>
      )}

      {connected && callType === 'voice' && !videoUpgradeRequested && (
        <div className="call-screen__header" style={{ justifyContent: 'center' }}>
          <button className="call-screen__icon-btn" style={{ width: 'auto', padding: '0 20px', gap: '8px', borderRadius: '24px' }} onClick={onUpgradeRequest} aria-label="Request Video">
            <Video size={18} /> Request Video
          </button>
        </div>
      )}

      {/* Upgrade Prompt */}
      {videoUpgradeRequested && (
        <div className="call-screen__upgrade-prompt">
          <div className="call-screen__upgrade-title">{partnerName} requested Video</div>
          <div className="call-screen__upgrade-actions">
            <button className="call-screen__upgrade-btn call-screen__upgrade-btn--reject" onClick={onUpgradeDecline}>Decline</button>
            <button className="call-screen__upgrade-btn call-screen__upgrade-btn--accept" onClick={onUpgradeAccept}>Switch to Video</button>
          </div>
        </div>
      )}

      {/* Floating Reactions */}
      {reactions.map(r => (
        <div key={r.id} className="floating-reaction" style={{ left: `${r.x}%` }}>{r.emoji}</div>
      ))}

      {/* Main Avatar Content (hidden when video connected) */}
      <div className="call-screen__content" style={{ opacity: (callType === 'video' && connected) ? 0 : 1, transition: 'opacity 0.3s', pointerEvents: (callType === 'video' && connected) ? 'none' : 'auto' }}>
        <div className={`call-screen__avatar ${incoming ? 'call-screen__avatar--ringing' : ''}`}>
          <img src={avatarUrl} alt={partnerName} />
        </div>
        <h1 className="call-screen__name">{partnerName}</h1>
        <div className="call-screen__status"><span className="call-screen__status-text">{statusText}</span></div>

        {!connected && (
          <div className="call-screen__actions">
            {incoming ? (
              <>
                <div className="call-screen__btn-col">
                  <button className="call-screen__btn call-screen__btn--decline" onClick={onDecline}>✕</button>
                  <span className="call-screen__btn-label" style={{color: '#ef4444'}}>Decline</span>
                </div>
                <div className="call-screen__btn-col">
                  <button className="call-screen__btn call-screen__btn--answer" onClick={onAnswer}>📞</button>
                  <span className="call-screen__btn-label" style={{color: '#22c55e'}}>Answer</span>
                </div>
              </>
            ) : (
              <div className="call-screen__btn-col">
                <button className="call-screen__btn call-screen__btn--end" onClick={onEndCall}><PhoneOff size={32} /></button>
                <span className="call-screen__btn-label">Cancel</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Media Layer (Always Mounted for WebRTC consistency) */}
      <div className="call-screen__video-layer" style={{ opacity: (callType === 'video' && connected) ? 1 : 0, pointerEvents: (callType === 'video' && connected) ? 'auto' : 'none', zIndex: (callType === 'video' && connected) ? 10 : -10 }}>
        <video ref={remoteVideoRef} autoPlay playsInline className="call-screen__video-remote" style={{ filter: remoteFilter !== 'none' ? remoteFilter : 'none' }} />
        <video ref={localVideoRef} autoPlay playsInline muted className="call-screen__video-local" style={{ filter: localFilter !== 'none' ? localFilter : 'none' }} />
        
        {/* Game UI Layer */}
        {activeGame === GAME_REACTION && (
           <div style={{ position: 'absolute', top: '160px', left: 0, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 11 }}>
              <div style={{ background: 'rgba(0,0,0,0.6)', padding: '5px 15px', borderRadius: '20px', fontWeight: 'bold', fontSize: '14px', marginBottom: '20px' }}>
                 You: {rrScores.me}  —  Them: {rrScores.partner}
              </div>
              <div style={{ position: 'relative', width: '120px', height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                 {rrTarget ? (
                    <div style={{ fontSize: '80px', animation: 'floatUp 0.3s ease-out' }}>{rrTarget}</div>
                 ) : (
                    <div style={{ width: '40px', height: '40px', border: '4px solid rgba(255,255,255,0.2)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                 )}
              </div>
              {isGameHost && <button onClick={() => { setActiveGame(null); onSendGameEvent({ action: 'end' }); }} style={{ background: 'transparent', border: 'none', color: '#ef4444', marginTop: '20px', fontWeight: 'bold' }}>End Game</button>}
           </div>
        )}

        {connected && callType === 'video' && (
          <div className="call-screen__reactions-bar">
             {REACTION_EMOJIS.map(emoji => (
               <button key={emoji} className="call-screen__react-btn" onClick={() => executeReact(emoji)}>{emoji}</button>
             ))}
             <button className="call-screen__icon-btn" style={{ marginLeft: 'auto', background: '#ef4444', borderColor: '#ef4444' }} onClick={onEndCall}>
               <PhoneOff size={20} />
             </button>
          </div>
        )}
      </div>
      
      {/* Voice Call Ending Button */}
      {connected && callType === 'voice' && (
        <div style={{ position: 'absolute', bottom: '60px', zIndex: 30 }}>
          <button className="call-screen__btn call-screen__btn--end" onClick={onEndCall}><PhoneOff size={32} /></button>
        </div>
      )}
    </div>
  );
}

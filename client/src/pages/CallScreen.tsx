import { useEffect, useState } from 'react';
import { SwitchCamera, Video, Wand2, PhoneOff, Gamepad2 } from 'lucide-react';
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
const GAME_STARE = 'soul_stare';
const GAME_CATEGORIES = 'categories';
const GAME_JIGSAW = 'jigsaw';

const REACTION_EMOJIS = ['❤️', '😍', '🔥', '💋', '✨'];
const CATEGORY_PROMPTS = ["Animals", "Movies", "Cities", "Fruits", "Brands", "Celebrities", "Colors", "Instruments", "Countries", "Food", "Hobbies", "Vehicles"];
const ALPHABET = "ABCDEFGHIJKLMNOPRSTUVW";

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

  // Reaction State
  const [rrTarget, setRrTarget] = useState<string | null>(null);
  const [rrScores, setRrScores] = useState({ me: 0, partner: 0 });

  // Soul Stare State
  const [stareTimer, setStareTimer] = useState(0);

  // Categories State
  const [catScore, setCatScore] = useState({ me: 0, partner: 0 });
  const [catPrompt, setCatPrompt] = useState({ cat: '', letter: '' });
  const [catTimer, setCatTimer] = useState(10);

  // Jigsaw State
  const [jigImg, setJigImg] = useState<string | null>(null);
  const [jigState, setJigState] = useState<(number | null)[]>([]);

  useEffect(() => {
    document.body.classList.add('call-active');
    return () => { document.body.classList.remove('call-active'); };
  }, []);

  // ── Unified Game Engine State Machine ──
  useEffect(() => {
    if (!lastIncomingGameEvent) return;
    const evt = lastIncomingGameEvent;
    
    // Check Global End
    if (evt.action === 'end') {
       setActiveGame(null);
       setRrTarget(null);
       return;
    }

    if (evt.action === 'start') {
       setActiveGame(evt.game);
       setIsGameHost(false);
       
       if (evt.game === GAME_REACTION) {
          setRrScores({ me: 0, partner: 0 });
          setRrTarget(null);
       } else if (evt.game === GAME_STARE) {
          setStareTimer(0);
       } else if (evt.game === GAME_CATEGORIES) {
          setCatScore({ me: 0, partner: 0 });
          setCatPrompt({ cat: evt.cat, letter: evt.letter });
          setCatTimer(10);
       } else if (evt.game === GAME_JIGSAW) {
          setJigImg(evt.img);
          setJigState(evt.state);
       }
       return;
    }

    // Reaction Logic
    if (evt.action === 'new_target') setRrTarget(evt.emoji);
    else if (evt.action === 'scored') {
       setRrScores(prev => ({ ...prev, partner: prev.partner + 1 }));
       setRrTarget(null); 
    } 
    // Stare Logic
    else if (evt.action === 'stare_lost') {
       alert('You Win! Your partner blinked or looked away!');
       setActiveGame(null);
    }
    // Categories Logic
    else if (evt.action === 'cat_buzz') {
       if (evt.scored) setCatScore(prev => ({ ...prev, partner: prev.partner + 1 }));
       setCatPrompt({ cat: evt.cat, letter: evt.letter });
       setCatTimer(10);
    }
    // Jigsaw Logic
    else if (evt.action === 'jig_move') {
       setJigState(evt.state);
    }
  }, [lastIncomingGameEvent]);

  // ── Reaction Game Host Tick ──
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

  // ── Stare Timer Tick ──
  useEffect(() => {
      let timer: any;
      if (activeGame === GAME_STARE) {
          timer = setInterval(() => setStareTimer(t => t + 1), 1000);
      }
      return () => clearInterval(timer);
  }, [activeGame]);

  // ── Categories Auto Buzzer (Timer) Tick ──
  useEffect(() => {
      let timer: any;
      if (activeGame === GAME_CATEGORIES) {
          timer = setInterval(() => {
              setCatTimer(prev => {
                  if (prev <= 1) {
                      if (isGameHost) {
                          const c = CATEGORY_PROMPTS[Math.floor(Math.random() * CATEGORY_PROMPTS.length)];
                          const l = ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
                          setCatPrompt({ cat: c, letter: l });
                          onSendGameEvent({ action: 'cat_buzz', cat: c, letter: l, scored: false });
                      }
                      return 10;
                  }
                  return prev - 1;
              });
          }, 1000);
      }
      return () => clearInterval(timer);
  }, [activeGame, isGameHost, onSendGameEvent]);

  const handleStartGame = (gameType: string) => {
     setActiveGame(gameType);
     setIsGameHost(true);
     setShowGames(false);

     if (gameType === GAME_REACTION) {
        setRrScores({ me: 0, partner: 0 });
        setRrTarget(null);
        onSendGameEvent({ action: 'start', game: GAME_REACTION });
     } else if (gameType === GAME_STARE) {
        setStareTimer(0);
        onSendGameEvent({ action: 'start', game: GAME_STARE });
     } else if (gameType === GAME_CATEGORIES) {
        const cat = CATEGORY_PROMPTS[Math.floor(Math.random() * CATEGORY_PROMPTS.length)];
        const letter = ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
        setCatScore({ me: 0, partner: 0 });
        setCatPrompt({ cat, letter });
        setCatTimer(10);
        onSendGameEvent({ action: 'start', game: GAME_CATEGORIES, cat, letter });
     } else if (gameType === GAME_JIGSAW) {
        // Build Jigsaw
        const video = remoteVideoRef.current || localVideoRef.current;
        if (!video) return;
        const canvas = document.createElement('canvas');
        canvas.width = 300; canvas.height = 300;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const size = Math.min(video.videoWidth, video.videoHeight);
        const x = (video.videoWidth - size) / 2;
        const y = (video.videoHeight - size) / 2;
        ctx.drawImage(video, x, y, size, size, 0, 0, 300, 300);
        
        const b64 = canvas.toDataURL('image/jpeg', 0.5);
        let state: (number|null)[] = [0,1,2,3,4,5,6,7,null];
        let nullIdx = 8;
        for(let i=0; i<40; i++) {
            const moves = [];
            if (nullIdx % 3 > 0) moves.push(nullIdx - 1);
            if (nullIdx % 3 < 2) moves.push(nullIdx + 1);
            if (nullIdx > 2) moves.push(nullIdx - 3);
            if (nullIdx < 6) moves.push(nullIdx + 3);
            const move = moves[Math.floor(Math.random() * moves.length)];
            state[nullIdx] = state[move];
            state[move] = null;
            nullIdx = move;
        }
        
        setJigState(state);
        setJigImg(b64);
        onSendGameEvent({ action: 'start', game: GAME_JIGSAW, img: b64, state });
     }
  };

  const handleBuzzer = () => {
      const myScore = catScore.me + 1;
      setCatScore(prev => ({...prev, me: myScore}));
      const c = CATEGORY_PROMPTS[Math.floor(Math.random() * CATEGORY_PROMPTS.length)];
      const l = ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
      setCatPrompt({ cat: c, letter: l });
      setCatTimer(10);
      onSendGameEvent({ action: 'cat_buzz', cat: c, letter: l, scored: true });
      if (myScore >= 5) { alert('You won Categories Quick Fire!'); setActiveGame(null); onSendGameEvent({action:'end'}); }
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
      {connected && callType === 'video' && !activeGame && (
        <div className="call-screen__header">
          <button className="call-screen__icon-btn" onClick={() => { setShowGames(!showGames); setShowFilters(false); }} aria-label="Games"><Gamepad2 size={20} /></button>
          <div style={{ display: 'flex', gap: '15px' }}>
             <button className="call-screen__icon-btn" onClick={onToggleCamera} aria-label="Flip Camera"><SwitchCamera size={20} /></button>
             <button className="call-screen__icon-btn" onClick={() => { setShowFilters(!showFilters); setShowGames(false); }} aria-label="Filters"><Wand2 size={20} /></button>
          </div>
        </div>
      )}
      
      {/* Game Selector Menu */}
      {showGames && connected && callType === 'video' && !activeGame && (
         <div style={{ position: 'absolute', top: '100px', width: '100%', padding: '0 20px', zIndex: 100, display: 'flex', gap: '10px', overflowX: 'auto', justifyContent: 'flex-start', paddingBottom: '10px' }}>
            <button onClick={() => handleStartGame(GAME_REACTION)} className="call-game-btn" style={{ background: 'rgba(239, 68, 68, 0.2)', color: '#fca5a5', border: '1px solid rgba(239, 68, 68, 0.4)' }}>
               Roulette
            </button>
            <button onClick={() => handleStartGame(GAME_STARE)} className="call-game-btn" style={{ background: 'rgba(59, 130, 246, 0.2)', color: '#93c5fd', border: '1px solid rgba(59, 130, 246, 0.4)' }}>
               Stare
            </button>
            <button onClick={() => handleStartGame(GAME_CATEGORIES)} className="call-game-btn" style={{ background: 'rgba(234, 179, 8, 0.2)', color: '#fde047', border: '1px solid rgba(234, 179, 8, 0.4)' }}>
               Categories
            </button>
            <button onClick={() => handleStartGame(GAME_JIGSAW)} className="call-game-btn" style={{ background: 'rgba(168, 85, 247, 0.2)', color: '#d8b4fe', border: '1px solid rgba(168, 85, 247, 0.4)' }}>
               Jigsaw
            </button>
         </div>
      )}
      
      {/* Filter Selector Menu */}
      {showFilters && connected && callType === 'video' && !activeGame && (
         <div style={{ position: 'absolute', top: '100px', width: '100%', padding: '0 20px', zIndex: 100, display: 'flex', gap: '10px', overflowX: 'auto', paddingBottom: '10px' }}>
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
        
        {/* GAME: REACTION ROULETTE */}
        {activeGame === GAME_REACTION && (
           <div style={{ position: 'absolute', top: '160px', left: 0, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 11 }}>
              <div style={{ background: 'rgba(0,0,0,0.6)', padding: '5px 15px', borderRadius: '20px', fontWeight: 'bold', fontSize: '14px', marginBottom: '20px', color:'white' }}>
                 You: {rrScores.me}  —  Them: {rrScores.partner}
              </div>
              <div style={{ position: 'relative', width: '120px', height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                 {rrTarget ? (
                    <div style={{ fontSize: '80px', animation: 'floatUp 0.3s ease-out' }}>{rrTarget}</div>
                 ) : (
                    <div style={{ width: '40px', height: '40px', border: '4px solid rgba(255,255,255,0.2)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                 )}
              </div>
              <button onClick={() => { setActiveGame(null); onSendGameEvent({ action: 'end' }); }} style={{ background: 'transparent', border: 'none', color: '#ef4444', marginTop: '20px', fontWeight: 'bold' }}>Quit Match</button>
           </div>
        )}

        {/* GAME: SOUL STARE */}
        {activeGame === GAME_STARE && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 50, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(3px)' }}>
                <h2 style={{ fontSize: '24px', letterSpacing: '4px', textTransform:'uppercase', color:'white', textShadow:'0 2px 10px black' }}>Soul Stare</h2>
                <div style={{ fontSize: '80px', fontWeight: '900', margin: '40px 0', color: 'white', textShadow:'0 4px 20px black' }}>{formatCallTime(stareTimer)}</div>
                <button onClick={() => { onSendGameEvent({ action: 'stare_lost' }); alert('You Lost! You broke eye contact!'); setActiveGame(null); }} style={{ padding: '20px 40px', background: '#ef4444', borderRadius: '30px', fontWeight: 'bold', color: 'white', fontSize:'18px' }}>I BLINKED / LOST</button>
            </div>
        )}

        {/* GAME: CATEGORIES */}
        {activeGame === GAME_CATEGORIES && (
            <div style={{ position: 'absolute', top: '100px', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 12 }}>
                <div style={{ background: 'rgba(0,0,0,0.8)', padding: '5px 15px', borderRadius: '20px', fontWeight: 'bold', color: 'white' }}>You: {catScore.me}  —  Them: {catScore.partner}</div>
                <div style={{ marginTop: '15px', fontSize: '24px', fontWeight: '900', color: catTimer <= 3 ? '#ef4444' : 'white', textShadow: '0 2px 10px black' }}>00:{catTimer < 10 ? `0${catTimer}` : catTimer}</div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '15px', marginTop: '15px' }}>
                    <div style={{ fontSize: '40px', fontWeight: '900', background: '#eab308', color: 'black', width: '80px', height: '80px', borderRadius: '16px', display: 'flex', justifyContent: 'center', alignItems: 'center', boxShadow:'0 10px 25px rgba(234,179,8,0.4)' }}>{catPrompt.letter}</div>
                    <div style={{ fontSize: '32px', fontWeight: '900', color: 'white', textShadow: '0 2px 10px black', textTransform: 'uppercase', letterSpacing: '2px' }}>{catPrompt.cat}</div>
                </div>
                <button onClick={handleBuzzer} style={{ width: '120px', height: '120px', background: '#ef4444', borderRadius: '50%', border: '8px solid #b91c1c', marginTop: '40px', fontSize: '20px', color: 'white', fontWeight: '900', boxShadow: '0 10px 40px rgba(239,68,68,0.5)', transition: 'transform 0.1s' }} onMouseDown={e => e.currentTarget.style.transform = 'scale(0.9)'} onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'} onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}>BUZZER</button>
                <button onClick={() => { setActiveGame(null); onSendGameEvent({ action: 'end' }); }} style={{ background: 'transparent', border: 'none', color: '#ef4444', marginTop: '30px', fontWeight: 'bold', fontSize:'14px' }}>Quit</button>
            </div>
        )}

        {/* GAME: JIGSAW */}
        {activeGame === GAME_JIGSAW && jigImg && (
            <div style={{ position: 'absolute', top: '120px', width: '300px', height: '300px', left: '50%', transform: 'translateX(-50%)', background: '#111', border: '5px solid white', borderRadius: '10px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '2px', zIndex: 50 }}>
                {jigState.map((val, idx) => {
                    if (val === null) return <div key={idx} style={{ background: 'transparent' }} />;
                    const r = Math.floor(val / 3); const c = val % 3;
                    const bgPosX = -(c * 100);
                    const bgPosY = -(r * 100);
                    return (
                        <div key={idx} onClick={() => {
                            const nullIdx = jigState.indexOf(null);
                            const isLeftRight = Math.abs(nullIdx - idx) === 1 && Math.floor(nullIdx/3) === Math.floor(idx/3);
                            const isUpDown = Math.abs(nullIdx - idx) === 3;
                            if (isLeftRight || isUpDown) {
                                const newState = [...jigState];
                                newState[nullIdx] = val;
                                newState[idx] = null;
                                setJigState(newState);
                                onSendGameEvent({ action: 'jig_move', state: newState });
                                let won = true;
                                for(let i=0; i<8; i++) if (newState[i] !== i) won = false;
                                if(won) { alert('We Solved the Puzzle!'); setActiveGame(null); onSendGameEvent({action:'end'}); }
                            }
                        }} style={{ backgroundImage: `url(${jigImg})`, backgroundSize: '300px 300px', backgroundPosition: `${bgPosX}px ${bgPosY}px`, cursor: 'pointer', borderRadius: '4px' }} />
                    );
                })}
            </div>
        )}

        {connected && callType === 'video' && !activeGame && (
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

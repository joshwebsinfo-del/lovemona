import { useEffect } from 'react';
import { Camera, Video, Wand2, PhoneOff } from 'lucide-react';
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
  onChangeFilter: () => void;
  onUpgradeRequest: () => void;
  onUpgradeAccept: () => void;
  onUpgradeDecline: () => void;
}

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
}: CallScreenProps) {
  useEffect(() => {
    document.body.classList.add('call-active');
    return () => document.body.classList.remove('call-active');
  }, []);

  const statusText = incoming ? 'Incoming Secure Line...' : connected ? `Live Call • ${formatCallTime(callDuration)}` : 'Connecting...';

  return (
    <div className="call-screen">
      <div className="call-screen__glow" />

      {/* Header Controls (Only when connected and in video) */}
      {connected && callType === 'video' && (
        <div className="call-screen__header">
          <button className="call-screen__icon-btn" onClick={onToggleCamera} aria-label="Flip Camera"><Camera size={20} /></button>
          <button className="call-screen__icon-btn" onClick={onChangeFilter} aria-label="Filters"><Wand2 size={20} /></button>
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
        
        {connected && callType === 'video' && (
          <div className="call-screen__reactions-bar">
             {['❤️', '😍', '🔥', '💋', '✨'].map(emoji => (
               <button key={emoji} className="call-screen__react-btn" onClick={() => onSendReaction(emoji)}>{emoji}</button>
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

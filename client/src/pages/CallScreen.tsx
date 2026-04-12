import { useEffect } from 'react';
import './CallScreen.css';

/**
 * CallScreen — Completely self-contained full-screen call UI.
 * 
 * This component takes FULL control of the viewport when rendered.
 * It adds 'call-active' class to <body> to kill stardust background.
 * Uses only CSS classes (no inline styles) for maximum mobile compatibility.
 */

interface CallScreenProps {
  partnerName: string;
  avatarUrl: string;
  callType: 'video' | 'voice';
  incoming: boolean;
  connected: boolean;
  callDuration: number;
  remoteVideoRef: React.RefObject<HTMLVideoElement | null>;
  localVideoRef: React.RefObject<HTMLVideoElement | null>;
  onAnswer: () => void;
  onDecline: () => void;
  onEndCall: () => void;
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
  onAnswer,
  onDecline,
  onEndCall,
}: CallScreenProps) {
  // Lock body on mount, unlock on unmount
  useEffect(() => {
    document.body.classList.add('call-active');
    return () => {
      document.body.classList.remove('call-active');
    };
  }, []);

  const statusText = incoming
    ? 'Incoming Secure Line...'
    : connected
      ? `Live Call • ${formatCallTime(callDuration)}`
      : 'Connecting...';

  return (
    <div className="call-screen">
      {/* Ambient glow */}
      <div className="call-screen__glow" />

      {/* Main content */}
      <div className="call-screen__content">
        {/* Avatar */}
        <div className={`call-screen__avatar ${incoming ? 'call-screen__avatar--ringing' : ''}`}>
          <img src={avatarUrl} alt={partnerName} />
        </div>

        {/* Name */}
        <h1 className="call-screen__name">{partnerName}</h1>

        {/* Status */}
        <div className="call-screen__status">
          <span className="call-screen__status-text">{statusText}</span>
        </div>

        {/* Action Buttons */}
        <div className="call-screen__actions">
          {incoming ? (
            <>
              {/* DECLINE */}
              <div className="call-screen__btn-col">
                <button
                  className="call-screen__btn call-screen__btn--decline"
                  onClick={onDecline}
                  aria-label="Decline call"
                >
                  ✕
                </button>
                <span className="call-screen__btn-label call-screen__btn-label--decline">
                  Decline
                </span>
              </div>

              {/* ANSWER */}
              <div className="call-screen__btn-col">
                <button
                  className="call-screen__btn call-screen__btn--answer"
                  onClick={onAnswer}
                  aria-label="Answer call"
                >
                  📞
                </button>
                <span className="call-screen__btn-label call-screen__btn-label--answer">
                  Answer
                </span>
              </div>
            </>
          ) : (
            /* END CALL */
            <div className="call-screen__btn-col">
              <button
                className="call-screen__btn call-screen__btn--end"
                onClick={onEndCall}
                aria-label="End call"
              >
                📞
              </button>
              <span className="call-screen__btn-label call-screen__btn-label--end">
                End Secure Line
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Video feeds - only when video call is connected */}
      {callType === 'video' && connected && (
        <div className="call-screen__video-layer">
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="call-screen__video-remote"
          />
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="call-screen__video-local"
          />
        </div>
      )}
    </div>
  );
}


const fs = require('fs');
const path = 'client/src/pages/SetupScreen.tsx';
let content = fs.readFileSync(path, 'utf8');

const newCode = `  function scanFrame() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < video.HAVE_ENOUGH_DATA) {
      animFrameRef.current = requestAnimationFrame(scanFrame);
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: 'dontInvert',
    });

    if (code?.data) {
      try {
        const data = JSON.parse(code.data);
        if (data.id && data.key) {
          setScanStatus('found');
          stopCamera();
          setIsConnecting(true);
          socketRef.current?.emit('pair:connect', {
            partnerId: data.id,
            myId: myIdRef.current,
            publicKey: publicKeyRef.current,
            nick: config.nickname,
            avatar: config.avatar,
          });
          return; 
        }
      } catch { /* ignored */ }
    }

    animFrameRef.current = requestAnimationFrame(scanFrame);
  }`;

// Find the start of useCallback and the end of it
const searchStart = '  const scanFrame = useCallback(() => {';
const searchEnd = '  }, [stopCamera]);';

const sIdx = content.indexOf(searchStart);
const eIdx = content.indexOf(searchEnd, sIdx);

if (sIdx !== -1 && eIdx !== -1) {
    content = content.substring(0, sIdx) + newCode + content.substring(eIdx + searchEnd.length);
}

fs.writeFileSync(path, content);
console.log('SetupScreen Fixed');

const fs = require('fs');
const path = 'c:\\Users\\JOSHWEBS\\Desktop\\MONA\\client\\src\\pages\\DashboardScreen.tsx';
let content = fs.readFileSync(path, 'utf8');

// A very robust find and replace for the handleReceive block
const startIndex = content.indexOf("} else if (payload.type === 'hub:game_invite') {");
const endIndex = content.indexOf("} else if (payload.type === 'text' || payload.type === 'media') {");

if (startIndex !== -1 && endIndex !== -1) {
    const newSection = `} else if (payload.type === 'hub:game_invite') {
                    window.dispatchEvent(new CustomEvent('incoming-game-invite', { 
                       detail: { type: 'game', isGameMode: true, gameType: payload.game || 'categories' } 
                    }));
                 } else if (payload.type === 'hub:note') {
                    setPartnerNote(payload.text);
                    const db2 = await initDB();
                    await db2.put('settings', { id: 'sticky_note_partner', data: payload.text });
                 } `;
    
    // We need to be careful with the indentation of the first line of the new section
    const indentation = content.substring(content.lastIndexOf("\n", startIndex) + 1, startIndex);
    
    content = content.substring(0, startIndex) + newSection + content.substring(endIndex);
    fs.writeFileSync(path, content);
    console.log("Receive handler fixed");
} else {
    console.log("Markers not found", {startIndex, endIndex});
}

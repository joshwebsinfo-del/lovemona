const fs = require('fs');
const path = 'c:\\Users\\JOSHWEBS\\Desktop\\MONA\\client\\src\\pages\\DashboardScreen.tsx';
let content = fs.readFileSync(path, 'utf8');

const oldGameSection = `                 } else if (payload.type === 'hub:game_invite') {
                    window.dispatchEvent(new CustomEvent('start-global-call', { 
                       detail: { 
                         type: 'game', 
                         isGameMode: true, 
                         gameType: payload.game || 'categories' 
                       } 
                    }));
                 } else if (payload.type === 'hub:note') {
                    const data = { text: payload.text, sender: 'partner' };
                    setStickyNote(data);
                    const db2 = await initDB();
                    await db2.put('settings', { id: 'sticky_note', data });`;

const newGameSection = `                 } else if (payload.type === 'hub:game_invite') {
                    window.dispatchEvent(new CustomEvent('incoming-game-invite', { 
                       detail: { type: 'game', isGameMode: true, gameType: payload.game || 'categories' } 
                    }));
                 } else if (payload.type === 'hub:note') {
                    setPartnerNote(payload.text);
                    const db2 = await initDB();
                    await db2.put('settings', { id: 'sticky_note_partner', data: payload.text });`;

if (content.indexOf(oldGameSection) !== -1) {
    content = content.replace(oldGameSection, newGameSection);
    fs.writeFileSync(path, content);
    console.log("Receive handler updated");
} else {
    console.log("Match not found for receive handler");
}

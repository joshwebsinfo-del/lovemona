const fs = require('fs');
const path = 'c:\\Users\\JOSHWEBS\\Desktop\\MONA\\client\\src\\pages\\DashboardScreen.tsx';
let content = fs.readFileSync(path, 'utf8');

// Use a simpler match
const find = /} else if \(payload\.type === 'hub:game_invite'\) \{[\s\S]*?\} else if \(payload\.type === 'hub:note'\) \{[\s\S]*?\}/;
const replace = `} else if (payload.type === 'hub:game_invite') {
                    window.dispatchEvent(new CustomEvent('incoming-game-invite', { 
                       detail: { type: 'game', isGameMode: true, gameType: payload.game || 'categories' } 
                    }));
                 } else if (payload.type === 'hub:note') {
                    setPartnerNote(payload.text);
                    const db2 = await initDB();
                    await db2.put('settings', { id: 'sticky_note_partner', data: payload.text });
                 }`;

if (find.test(content)) {
    content = content.replace(find, replace);
    fs.writeFileSync(path, content);
    console.log("Updated with regex");
} else {
    console.log("Regex match failed");
}

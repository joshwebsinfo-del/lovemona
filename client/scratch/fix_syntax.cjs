const fs = require('fs');
const path = 'c:\\Users\\JOSHWEBS\\Desktop\\MONA\\client\\src\\pages\\DashboardScreen.tsx';
let c = fs.readFileSync(path, 'utf8');

const search = "} } else if (payload.type === 'text' || payload.type === 'media') {";
const replace = "} else if (payload.type === 'text' || payload.type === 'media') {";

if (c.indexOf(search) !== -1) {
    c = c.replace(search, replace);
    fs.writeFileSync(path, c);
    console.log("Fixed syntax error");
} else {
    // Try without spaces
    const search2 = "} } else if (payload.type==='text'||payload.type==='media') {";
    console.log("Could not find search string");
}

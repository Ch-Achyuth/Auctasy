const fs = require('fs');
const https = require('https');
const path = require('path');

const API_KEY = 'YOUR_CRICAPI_KEY_HERE'; // Replace with a real key
const URL = `https://api.cricapi.com/v1/players?apikey=${API_KEY}&offset=0`;

console.log('Fetching player data from CricAPI...');

https.get(URL, (res) => {
    let data = '';

    res.on('data', (chunk) => {
        data += chunk;
    });

    res.on('end', () => {
        try {
            const json = JSON.parse(data);
            if (json.status !== 'success') {
                console.error("API Error: ", json.info || "Invalid key or response");
                return;
            }

            // Transform data slightly to match what we need (roles, dummy stats if missing)
            const players = json.data.slice(0, 20).map(p => ({
                id: p.id,
                name: p.name,
                role: "Unknown", 
                basePrice: Math.floor(Math.random() * 100) + 100, // Random base price 100-200
                stats: { matches: Math.floor(Math.random() * 100), runs: Math.floor(Math.random() * 3000), average: (Math.random() * 50).toFixed(2), wickets: Math.floor(Math.random() * 100) },
                team: p.country || "Unknown",
                imageUrl: "https://via.placeholder.com/150?text=" + encodeURIComponent(p.name)
            }));
            
            const filePath = path.join(__dirname, 'data', 'players.json');
            fs.writeFileSync(filePath, JSON.stringify(players, null, 2));
            console.log(`Successfully saved ${players.length} players to ${filePath}`);

        } catch (e) {
            console.error('Error parsing response: ', e);
        }
    });

}).on('error', (e) => {
    console.error('Network Error: ', e);
});

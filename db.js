const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const fs = require('fs');
const path = require('path');
const { calculateTrueValue } = require('./ai/heuristic');

async function setupDatabase() {
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir);
    }

    const db = await open({
        filename: path.join(dataDir, 'database.sqlite'),
        driver: sqlite3.Database
    });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS players (
            id INTEGER PRIMARY KEY,
            name TEXT,
            role TEXT,
            basePrice INTEGER,
            imageUrl TEXT,
            stats_json TEXT,
            trueValue INTEGER
        );

        CREATE TABLE IF NOT EXISTS auction_groups (
            name TEXT PRIMARY KEY,
            maxPlayers INTEGER,
            auctionStarted BOOLEAN DEFAULT 0,
            currentPlayerIndex INTEGER DEFAULT 0,
            currentBid INTEGER DEFAULT 0,
            currentHighestBidder TEXT,
            lastBidTime INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS users (
            username TEXT,
            groupName TEXT,
            budget INTEGER DEFAULT 1000,
            PRIMARY KEY (username, groupName),
            FOREIGN KEY(groupName) REFERENCES auction_groups(name)
        );

        CREATE TABLE IF NOT EXISTS user_teams (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT,
            groupName TEXT,
            player_id INTEGER,
            boughtFor INTEGER,
            FOREIGN KEY(username, groupName) REFERENCES users(username, groupName),
            FOREIGN KEY(player_id) REFERENCES players(id)
        );
    `);

    try {
        await db.exec('ALTER TABLE auction_groups ADD COLUMN lastBidTime INTEGER DEFAULT 0');
    } catch(e) { }

    const playerCheck = await db.get('SELECT COUNT(*) as count FROM players');
    if (playerCheck.count === 0) {
        console.log("Seeding database with players...");
        const playersPath = path.join(dataDir, 'players.json');
        if (fs.existsSync(playersPath)) {
            let allPlayers = JSON.parse(fs.readFileSync(playersPath, 'utf-8'));
            const stmt = await db.prepare('INSERT INTO players (id, name, role, basePrice, imageUrl, stats_json, trueValue) VALUES (?, ?, ?, ?, ?, ?, ?)');
            for (let p of allPlayers) {
                const trueVal = calculateTrueValue(p);
                await stmt.run(p.id, p.name, p.role, p.basePrice, p.imageUrl, JSON.stringify(p.stats), trueVal);
            }
            await stmt.finalize();
        }
    }
    
    return db;
}

module.exports = { setupDatabase };

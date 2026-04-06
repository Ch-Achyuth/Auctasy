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
        CREATE TABLE IF NOT EXISTS global_players (
            id INTEGER PRIMARY KEY,
            name TEXT, role TEXT, basePrice INTEGER, imageUrl TEXT, stats_json TEXT, trueValue INTEGER
        );

        CREATE TABLE IF NOT EXISTS groups (
            name TEXT PRIMARY KEY,
            maxPlayers INTEGER,
            status TEXT DEFAULT 'WAITING', 
            currentMatchday INTEGER DEFAULT 0,
            maxMatchdays INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS users (
            username TEXT,
            groupName TEXT,
            PRIMARY KEY (username, groupName),
            FOREIGN KEY(groupName) REFERENCES groups(name)
        );

        CREATE TABLE IF NOT EXISTS tournament_standings (
            username TEXT,
            groupName TEXT,
            points INTEGER DEFAULT 0,
            nrr REAL DEFAULT 0.0,
            PRIMARY KEY (username, groupName),
            FOREIGN KEY(username, groupName) REFERENCES users(username, groupName)
        );

        CREATE TABLE IF NOT EXISTS matches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            groupName TEXT,
            matchday INTEGER,
            userA TEXT,
            userB TEXT,
            status TEXT DEFAULT 'AUCTION',
            currentPlayerPoolIndex INTEGER DEFAULT 0,
            currentBid INTEGER DEFAULT 0,
            currentHighestBidder TEXT,
            lastBidTime INTEGER DEFAULT 0,
            winner TEXT,
            scoreA REAL,
            scoreB REAL
        );

        CREATE TABLE IF NOT EXISTS matchday_players (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            groupName TEXT,
            matchday INTEGER,
            player_id INTEGER,
            sequenceOrder INTEGER,
            FOREIGN KEY(player_id) REFERENCES global_players(id)
        );

        CREATE TABLE IF NOT EXISTS match_teams (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            match_id INTEGER,
            username TEXT,
            player_id INTEGER,
            boughtFor INTEGER
        );

        CREATE TABLE IF NOT EXISTS match_budgets (
            match_id INTEGER,
            username TEXT,
            budget INTEGER DEFAULT 1000,
            PRIMARY KEY (match_id, username)
        );
    `);

    const playerCheck = await db.get('SELECT COUNT(*) as count FROM global_players');
    if (playerCheck.count === 0) {
        console.log("Seeding database with players...");
        const playersPath = path.join(dataDir, 'players.json');
        if (fs.existsSync(playersPath)) {
            let allPlayers = JSON.parse(fs.readFileSync(playersPath, 'utf-8'));
            const stmt = await db.prepare('INSERT INTO global_players (id, name, role, basePrice, imageUrl, stats_json, trueValue) VALUES (?, ?, ?, ?, ?, ?, ?)');
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

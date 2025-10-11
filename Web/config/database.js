const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const colors = require('colors')

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.log('[DB] '.red, err.message)
    } else {
        console.log('[DB] Database connected.\n'.green);
    }
});

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS password (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        codeEmail INTEGER,
        tryCodeEmail INTEGER DEFAULT 0,
        timeCodeEmail INTEGER NOT NULL,

        password TEXT NOT NULL,

        discordEmail TEXT UNIQUE,
        discordId TEXT UNIQUE,

        githubEmail TEXT UNIQUE,
        githubId TEXT UNIQUE
    )`, (err) => {
        if (err) console.log('[DB] '.red, err.message);
    });

    db.run(`
        CREATE TABLE IF NOT EXISTS users (
        userId INTEGER NOT NULL PRIMARY KEY,
        avatar TEXT,
        
        Score INTEGER NOT NULL DEFAULT 50,
        Count INTEGER DEFAULT 0 CHECK(Count >= 0),

        username TEXT UNIQUE NOT NULL
    )`, (err) => {
        if (err) console.log('[DB] '.red, err.message);
    });
    db.run(`
        CREATE TABLE IF NOT EXISTS avis (
        authorId INTEGER NOT NULL,
        targetId INTEGER NOT NULL,
        
        avis TEXT,
        note INTEGER NOT NULL,
        date INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        PRIMARY KEY (authorId, targetId)
    )`, (err) => {
        if (err) console.log('[DB] '.red, err.message)
    });
    db.run(`
        CREATE TABLE IF NOT EXISTS badges (
        userId INTEGER NOT NULL PRIMARY KEY,

        verify INTEGER DEFAULT 0,

        premium BOOLEAN DEFAULT false,

        job BOOLEAN DEFAULT false,

        staff BOOLEAN DEFAULT false
    )`, (err) => {
        if (err) console.log('[DB] '.red, err.message)
    });
});

module.exports = db;

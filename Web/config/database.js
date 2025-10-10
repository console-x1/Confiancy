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
        
        fiabilityScore INTEGER NOT NULL DEFAULT 50,
        fiabilityCount INTEGER DEFAULT 0 CHECK(fiabilityCount >= 0),
        
        jobScore INTEGER NOT NULL DEFAULT 50,
        jobCount INTEGER DEFAULT 0 CHECK(jobCount >= 0),

        commuScore INTEGER NOT NULL DEFAULT 50,
        commuCount INTEGER DEFAULT 0 CHECK(commuCount >= 0),

        teamScore INTEGER NOT NULL DEFAULT 50,
        teamCount INTEGER DEFAULT 0 CHECK(teamCount >= 0),

        honestyScore INTEGER NOT NULL DEFAULT 50,
        honestyCount INTEGER DEFAULT 0 CHECK(honnestyCount >= 0),

        timeScore INTEGER NOT NULL DEFAULT 50,
        timeCount INTEGER DEFAULT 0 CHECK(timeCount >= 0),

        activityScore INTEGER NOT NULL DEFAULT 50,
        activityCount INTEGER DEFAULT 0 CHECK(activityCount >= 0),

        qualityScore INTEGER NOT NULL DEFAULT 50,
        qualityCount INTEGER DEFAULT 0 CHECK(qualityCount >= 0),

        learningScore INTEGER NOT NULL DEFAULT 50,
        learningCount INTEGER DEFAULT 0 CHECK(learningCount >= 0),

        coldnessScore INTEGER NOT NULL DEFAULT 50,
        coldnessCount INTEGER DEFAULT 0 CHECK(coldnessCount >= 0),

        username TEXT UNIQUE NOT NULL
    )`, (err) => {
        if (err) console.log('[DB] '.red, err.message);
    });
    db.run(`
        CREATE TABLE IF NOT EXISTS avis (
        authorId INTEGER NOT NULL,
        targetId INTEGER NOT NULL,
        categorie TEXT NOT NULL,
        
        avis TEXT NOT NULL,
        note INTEGER NOT NULL,
        PRIMARY KEY (authorId, targetId, categorie)
    )`), (err) => {
        if (err) console.log('[DB] '.red, err.message)
    };
    db.run(`
        CREATE TABLE IF NOT EXISTS badges (
        userId INTERGER NOT NULL PRIMARY KEY,

        verify1 BOOLEAN,
        verify2 BOOLEAN,
        verifi3 BOOLEAN,

        premium BOOLEAN,

        job BOOLEAN,

        staff BOOLEAN
    )`), (err) => {
        if (err) console.log('[DB] '.red, err.message)
    }
});

module.exports = db;

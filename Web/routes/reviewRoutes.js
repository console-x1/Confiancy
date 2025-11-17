const express = require('express');
const router = express.Router();
const db = require('../config/database');
const verifyToken = require('../middleware/authMiddleware');

router.get('/:targetId', async (req, res) => {
    const targetId = Number(req.params.targetId);
    if (!targetId) return res.status(400).json({ error: 'Invalid target id' });

    db.all(
        `SELECT a.authorId,a.targetId,a.categorie,a.avis,u.username as reviewer FROM avis a LEFT JOIN users u ON a.authorId = u.userId WHERE a.targetId = ?`,
        [targetId],
        (err, rows) => {
            if (err) return res.status(500).json({ error: 'DB error' });
            const grouped = {};
            rows.forEach(r => {
                try {
                    r.avis = JSON.parse(r.avis);
                } catch (e) {
                    // keep raw
                }
                if (!grouped[r.categorie]) grouped[r.categorie] = [];
                grouped[r.categorie].push(r);
            });
            res.json({ reviews: grouped });
        }
    );
});

router.post('/:targetId', verifyToken, express.json(), async (req, res) => {
    const authorId = req.user && req.user.id;
    if (!authorId) return res.status(401).redirect('/login');
    const targetId = Number(req.params.targetId);
    if (targetId === authorId) return res.status(400).json({ error: "You can't review yourself" });
    if (!targetId) return res.status(400).redirect('/user/' + targetId);

    const { note, comment } = req.body;
    const rating = Number(note);
    if (!rating) return res.status(400).redirect('/user/' + targetId);

    const runAsync = (sql, params) => new Promise((resolve, reject) => {
        db.run(sql, params, function (err) { if (err) reject(err); else resolve(this); });
    });
    const allAsync = (sql, params) => new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
    });
    const getAsync = (sql, params) => new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
    });

    try {
        const existing = await getAsync(
            `SELECT * FROM avis WHERE authorId = ? AND targetId = ?`,
            [authorId, targetId]
        );

        if (existing) return res.status(400).redirect(`/user/${targetId}`);

        await runAsync(
            `INSERT OR IGNORE INTO avis (authorId, targetId, avis, note, date) VALUES (?, ?, ?, ?, ?)`,
            [authorId, targetId, comment, Number(rating), new Date().toISOString()]
        );
        const rows = await allAsync(`SELECT note, authorId FROM avis WHERE targetId = ?`, [targetId]);

        if (!rows || rows.length === 0) {
            await runAsync(`UPDATE users SET Score = ? WHERE userId = ?`, [50, targetId]);
        }

        const uniqueAuthors = [...new Set(rows.map(r => r.authorId))];
        const authorCounts = {};
        const authorVerify = {};
        const authorScores = {};

        await Promise.all(uniqueAuthors.map(async (aid) => {
            const cntRow = await getAsync(`SELECT COUNT(*) as cnt FROM avis WHERE authorId = ?`, [aid]);
            
            const row = await getAsync(`SELECT * FROM users WHERE userId = ?`, [aid]);
            authorScores[aid] = Number(row.Score ? row.Score : 50);
            
            authorCounts[aid] = cntRow ? cntRow.cnt : 0;
            const bRow = await getAsync(`SELECT verify FROM badges WHERE userId = ?`, [aid]);
            authorVerify[aid] = bRow && typeof bRow.verify !== 'undefined' ? Number(bRow.verify) : 0;
        }));

        let weightedSum = 0;
        let weightTotal = 0;
        const alpha = 0.6;
        const maxExtra = 4;
        const verifyFactor = 0.5;
        const finalCap = 1 + maxExtra + (5 * verifyFactor);

        rows.forEach(r => {
            const reviewsGiven = authorCounts[r.authorId] || 0;
            let weight = 1 + alpha * Math.log(1 + reviewsGiven);
            if (weight > 1 + maxExtra) weight = 1 + maxExtra;
            const verifyLevel = authorVerify[r.authorId] || 0;
            const badgeMultiplier = 1 + (verifyLevel * verifyFactor);
            weight = weight * badgeMultiplier;
            if (weight > finalCap) weight = finalCap;
            weightedSum += (Number(r.note) || 0) * weight;
            weightTotal += weight;
        });

        const weightedAvg = weightTotal > 0 ? (weightedSum / weightTotal) : 0;

        const count = rows.length;
        const lambdaMax = 0.10;
        const lambda = Math.min((1 / (1 + Math.log(1 + count))) * ((authorScores[authorId] || 50) / 100), lambdaMax);

        const prevRow = await getAsync(`SELECT Score as prev FROM users WHERE userId = ?`, [targetId]);
        const prevScore10 = prevRow && typeof prevRow.prev !== 'undefined' ? Number(prevRow.prev) : 50;
        const prevScore = prevScore10 / 10;

        const finalScore = (prevScore * (1 - lambda)) + (weightedAvg * lambda);
        const finalScore100 = Math.round(finalScore * 10);

        await runAsync(`UPDATE users SET Score = ?, Count = ? WHERE userId = ?`, [finalScore100, count, targetId]);
        console.log(`[REVIEWS] New review by ${authorId} for ${targetId}: ${rating}/10. Updated Score to ${finalScore100}% based on ${count} reviews.`.green);

        return res.status(200).redirect(`/user/${targetId}`);

    } catch (err) {
        console.error('[REVIEWS] Error processing review'.red, err);
        return res.status(500).redirect(`/user/${targetId}`);
    }
});

router.post('/:targetId/delete', verifyToken, express.json(), async (req, res) => {
    const authorId = req.user && req.user.id;
    if (!authorId) return res.status(401).redirect('/login');
    const targetId = Number(req.params.targetId);
    if (targetId === authorId) return res.status(400).json({ error: "You can't delete a review for yourself" });
    if (!targetId) return res.status(400).redirect('/user/' + targetId);

    try {
        const runAsync = (sql, params) => new Promise((resolve, reject) => {
            db.run(sql, params, function (err) { if (err) reject(err); else resolve(this); });
        });
        await runAsync(`DELETE FROM avis WHERE authorId = ? AND targetId = ?`, [authorId, targetId]);
        console.log(`[REVIEWS] Review by ${authorId} for ${targetId} deleted.`.green);
        return res.status(200).redirect(`/user/${targetId}`);
    } catch (err) {
        console.error('[REVIEWS] Error deleting review'.red, err);
        return res.status(500).redirect(`/user/${targetId}`);
    }
});

module.exports = router;

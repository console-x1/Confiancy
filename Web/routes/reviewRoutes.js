const express = require('express');
const router = express.Router();
const db = require('../config/database');
const verifyToken = require('../middleware/authMiddleware');
const ALLOWED_CATEGORIES = ['fiability', 'job', 'commu', 'team', 'honesty', 'time', 'activity', 'quality', 'learning', 'coldness'];

// Get all reviews for a target user, grouped by category
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

    const { categorie, note, comment } = req.body;
    const rating = Number(note) //* 10;
    if (!categorie || !rating || !comment) return res.status(400).redirect('/user/' + targetId);
    if (!ALLOWED_CATEGORIES.includes(categorie)) return res.status(400).redirect('/user/' + targetId);

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
            `SELECT * FROM avis WHERE authorId = ? AND targetId = ? AND categorie = ?`,
            [authorId, targetId, categorie]
        );

        if (existing) return res.status(400).redirect(`/user/${targetId}`);

        await runAsync(
            `INSERT OR IGNORE INTO avis (authorId, targetId, categorie, avis, note) VALUES (?, ?, ?, ?, ?)`,
            [authorId, targetId, categorie, comment, Number(rating)]
        );
        const rows = await allAsync(`SELECT note, authorId FROM avis WHERE targetId = ? AND categorie = ?`, [targetId, categorie]);

        if (!rows || rows.length === 0) {
            const column = `${categorie}Score`;
            await runAsync(`UPDATE users SET ${column} = ? WHERE userId = ?`, [50, targetId]);
            return res.status(200).redirect(`/user/${targetId}`);
        }

        const uniqueAuthors = [...new Set(rows.map(r => r.authorId))];
        const authorScores = {};
        await Promise.all(uniqueAuthors.map(async (aid) => {
            const row = await getAsync(`SELECT * FROM users WHERE userId = ?`, [aid]);
            const globalScore = (Number(row.fiabilityScore) || 50) + (Number(row.jobScore) || 50) + (Number(row.commuScore) || 50) + (Number(row.teamScore) || 50) + (Number(row.honestyScore) || 50) + (Number(row.timeScore) || 50) + (Number(row.activityScore) || 50) + (Number(row.qualityScore) || 50) + (Number(row.learningScore) || 50) + (Number(row.coldnessScore) || 50) / 10;
            authorScores[aid] = Number(globalScore ? globalScore : 50);
        }));

        let weightedSum = 0;
        let weightTotal = 0;

        rows.forEach(r => {
            const authorScore = authorScores[r.authorId] || 50;
            const normalized = authorScore / 50;
            const β = 0.9;
            const weight = Math.pow(normalized, β);

            weightedSum += (Number(r.note) || 0) * weight;
            weightTotal += weight;
        });

        const weightedAvg = weightTotal > 0 ? (weightedSum / weightTotal) : 0;

        const count = rows.length;
        const lambdaMax = 0.10;
        const lambda = Math.min((1 / (1 + Math.log(1 + count))) * ((authorScores[authorId] || 50) / 100), lambdaMax);

        const column = `${categorie}Score`;
        const countColumn = `${categorie}Count`;
        const prevRow = await getAsync(`SELECT ${column} as prev FROM users WHERE userId = ?`, [targetId]);
        const prevScore10 = prevRow && typeof prevRow.prev !== 'undefined' ? Number(prevRow.prev) : 50;
        const prevScore = prevScore10 / 10;

        const finalScore = (prevScore * (1 - lambda)) + (weightedAvg * lambda);
        const finalScore100 = Math.round(finalScore * 10);

        await runAsync(`UPDATE users SET ${column} = ?, ${countColumn} = ? WHERE userId = ?`, [finalScore100, count, targetId]);
        console.log(`[REVIEWS] New review by ${authorId} for ${targetId} in ${categorie}: ${rating}. Updated ${column} to ${finalScore100} based on ${count} reviews.`.green);

        return res.status(200).redirect(`/user/${targetId}`);

    } catch (err) {
        console.error('[REVIEWS] Error processing review'.red, err);
        return res.status(500).redirect(`/user/${targetId}`);
    }
});

module.exports = router;

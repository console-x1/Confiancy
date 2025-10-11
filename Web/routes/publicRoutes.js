const express = require('express');
const verifyToken = require('../middleware/authMiddleware');
const path = require('path');
const db = require("../config/database");
const jwt = require('jsonwebtoken');

const router = express.Router();

console.log('[INIT] - Start publicRoutes.js'.blue)

router.get("/login", (req, res) => {
    res.sendFile(path.join(__dirname, "../public/login.html"));
});
router.get("/register", (req, res) => {
    res.sendFile(path.join(__dirname, "../public/register.html"));
})
router.get("/index", (req, res) => {
    res.sendFile(path.join(__dirname, "../public/index.html"));
})
router.get("/user/:id", async (req, res) => {
    const userId = String(req.params.id).trim();

    const user = await new Promise((resolve, reject) => {
        db.get("SELECT * FROM users WHERE userId = ?", [userId], (err, user) => {
            if (err) {
                reject(err);
            } else {
                resolve(user);
            }
        });
    });

    if (!user) {
        return res.status(404).json({ error: "Utilisateur non trouvé" });
    }

    db.all(`
        SELECT a.authorId, a.targetId, a.avis, a.note, a.date, 
           u.username AS reviewer,
           b.verify
        FROM avis a
        LEFT JOIN users u ON a.authorId = u.userId
        LEFT JOIN badges b ON a.authorId = b.userId
        WHERE a.targetId = ?
        AND b.verify > 1
        ORDER BY a.date DESC
        LIMIT 10
    `, [userId],
    async (err, rows) => {
        let grouped = [];

        if (!err && rows) {
            grouped = rows.map(r => {
                let avis;
                try { avis = JSON.parse(r.avis); } catch { avis = r.avis; }
                return {
                    reviewer: r.reviewer || r.authorId,
                    reviewerId: r.authorId,
                    note: r.note,
                    comment: avis,
                    date: r.date,
                    verify: r.verify || 0
                };
            });
        }

        const token = req.cookies && req.cookies.auth_token;
        let viewerId = null;
        if (token) {
            try {
                const decoded = jwt.verify(token, process.env.SECRET_KEY);
                if (decoded && decoded.id) viewerId = decoded.id;
            } catch (e) { }
        }

        let viewerReview = null;
        if (viewerId) {
            viewerReview = await new Promise((resolve, reject) => {
                db.get(
                    `SELECT a.authorId, a.targetId, a.avis, a.note, a.date, u.username AS reviewer
                 FROM avis a
                 LEFT JOIN users u ON a.authorId = u.userId
                 WHERE a.targetId = ? AND a.authorId = ?`,
                    [userId, viewerId],
                    (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    }
                );
            });

            if (viewerReview && !grouped.find(r => r.reviewerId === viewerReview.authorId)) {
                let avis;
                try { avis = JSON.parse(viewerReview.avis); } catch { avis = viewerReview.avis; }

                grouped.push({
                    reviewer: viewerReview.reviewer || viewerReview.authorId,
                    reviewerId: viewerReview.authorId,
                    note: viewerReview.note,
                    comment: avis,
                    date: viewerReview.date
                });
            }
        }

        if (grouped.length > 11) grouped = grouped.slice(0, 11);

        return res.render(
            path.join(__dirname, "../login/profile"),
            {
                user,
                reviewsGrouped: grouped,
                viewerId,
                alreadyReviewed: viewerReview || undefined,
                Score: user.Score || 50,
                Count: user.Count || 0
            }
        );
    });
});

module.exports = router;

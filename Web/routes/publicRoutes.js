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

    db.all("SELECT a.authorId,a.targetId,a.categorie,a.avis,a.note,u.username as reviewer FROM avis a LEFT JOIN users u ON a.authorId = u.userId WHERE a.targetId = ?", [userId], async (err, rows) => {
        let grouped = {};
        if (!err && rows) {
            rows.forEach(r => {
                try { r.avis = JSON.parse(r.avis); } catch (e) { }
                if (!grouped[r.categorie]) grouped[r.categorie] = [];
                grouped[r.categorie].push({ reviewer: r.reviewer || r.authorId, note: r.note, comment: r.avis });
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
        
        const categorie = new Promise((resolve, reject) => {
            db.all(`SELECT categorie FROM avis WHERE targetId = ? AND authorId = ?`, [userId, viewerId], (err, row) => {
                if (err) { 
                    reject(err)
                }
                else {
                    resolve(rows.map(r => r.categorie))
                }
            });
        });

        return res.render(path.join(__dirname, "../login/profile"), { user, reviewsGrouped: grouped, viewerId, alreadyReviewed: await categorie });
    });
});

module.exports = router;

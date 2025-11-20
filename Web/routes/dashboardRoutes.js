const express = require('express');
const rateLimit = require('express-rate-limit')
const verifyToken = require('../middleware/authMiddleware');
const path = require('path');
const db = require('../config/database.js');

const router = express.Router();

console.log('[INIT] - Start dashboardRoutes.js'.blue)

router.use(express.json());

router.get("/", verifyToken, async (req, res) => {
    if (req.user.username) res.render(path.join(__dirname, "../login/dashboard"), { baseUrl: `${req.protocol}://${req.get('host')}`, user: req.user });
    else res.render(path.join(__dirname, "../login/verify-email"), { email: req.user.email, timeCode: (((new Date() - Number(req.user.timeCodeEmail)) / 1000) / 60).toFixed(0) })
});

router.get("/verify-email", verifyToken, async (req, res) => {
    res.render(path.join(__dirname, "../login/verify-email"), { email: req.user.email, timeCode: (((new Date() - Number(req.user.timeCodeEmail)) / 1000) / 60).toFixed(0) })
})

router.get("/delete-account", verifyToken, async (req, res) => {
    res.render(path.join(__dirname, "../login/delete-account"), { email: req.user.email, id: req.user.id });
})

router.get("/avis", verifyToken, async (req, res) => {
    db.all(`
        SELECT a.authorId, a.targetId, a.avis, a.note, a.date, 
           u.username AS reviewer
        FROM avis a
        LEFT JOIN users u ON a.authorId = u.userId
        WHERE a.targetId = ?
        ORDER BY a.date DESC
    `, [req.user.id],
        async (err, rows) => {
            let grouped = [];

            rows.reverse();

            if (!err && rows) {
                grouped = rows.map(r => {
                    let avis;
                    try { 
                        avis = JSON.parse(r.avis); 
                    } catch { 
                        avis = r.avis; 
                    }
                    return {
                        reviewer: r.reviewer || r.authorId,
                        reviewerId: r.authorId,
                        reviewerPage: `${req.protocol}://${req.get('host')}/user/${r.authorId}`,
                        note: r.note,
                        comment: avis,
                        date: new Date(r.date).toLocaleDateString('fr-FR', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                        })
                    };
                });
            }

        // Renvoyer le template HTML au lieu du JSON
        res.render(path.join(__dirname, "../login/avis"), { 
            reviews: grouped,
            user: req.user
        });
    });
});

router.get("/logout", (req, res) => {
    res.clearCookie("auth_token", { path: '/', httpOnly: true, secure: false, sameSite: 'Lax' });
    res.redirect('/');
});

router.get("/update-password", async (req, res) => {
    let email = req.query.email
    if (!email) return res.status(400).json({ error: "Email requise pour cette opération!" })

    email = email.replace(/\+.*(?=@)/, '').trim()

    const regex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
    if (!regex.test(email)) return res.status(400).json({ error: 'Email invalide!' })

    const user = await new Promise((resolve, reject) => {
        db.get("SELECT * FROM password WHERE email = ?", [email], (err, user) => {
            if (err) {
                reject(err);
            } else {
                resolve(user);
            }
        });
    });
    if (!user) return res.status(401).json({ error: "Aucun compte ne possede cette email !" })

    const existing = await new Promise((resolve, reject) => {
        db.get("SELECT * FROM password WHERE email = ? AND timeCodeEmail != 0", [email], (err, user) => {
            if (err) {
                reject(err);
            } else {
                resolve(user);
            }
        });
    });

    if (!existing) {
        const response = await fetch(`${req.protocol}://${req.get('host')}` + '/api/auth/sendResetPasswordCode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email })
        });
        const result = await response.json();
        return res.render(path.join(__dirname, "../login/update-password"), { email, timeCode: (((new Date() - Number(new Date())) / 1000) / 60).toFixed(0) })
    }
    else {
        return res.render(path.join(__dirname, "../login/update-password"), { email, timeCode: (((new Date() - Number(existing.timeCodeEmail)) / 1000) / 60).toFixed(0) })
    }
})

router.get('/emailUpdateNote', verifyToken, async (req, res) => {
    try {

        if (req.user.emailUpdateNote == true) db.run('UPDATE users SET emailUpdateNote = 0 WHERE userId = ?', [req.user.id])
        else                                  db.run('UPDATE users SET emailUpdateNote = 1 WHERE userId = ?', [req.user.id])

        res.status(200).redirect('./')

    } catch (err) {
        console.error("[USER] - Email Notif Error".red, err);
        return res.status(500).json({ error: "Server error. Please try again later." });
    }
})

module.exports = router;
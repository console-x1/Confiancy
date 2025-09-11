const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/authMiddleware');
const { addToBlacklist, readBlacklist } = require('../config/blacklist');
const path = require('path')
const fs = require('fs')

let db = require('../config/database')

const isAdmin = (req, res, next) => {
    if (req.user && (req.user.id === 1 || (req.user.badges && req.user.badges[staff]))) {
        next();
    } else {
        res.status(403).json({ error: "Accès non autorisé" });
    }
};

router.get('/blacklist/manage', verifyToken, isAdmin, (req, res) => {
    const bannedEmails = readBlacklist();
    res.render(path.join(__dirname, "../login/blacklist"), { bannedEmails, user: req.user, url: `${req.protocol}://${req.get('host')}/admin/blacklist` });
});


router.get('/blacklist', verifyToken, isAdmin, (req, res) => {
    const bannedEmails = readBlacklist();
    res.json({ bannedEmails });
});

router.post('/blacklist', verifyToken, isAdmin, (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ error: "Email requis" });
    }

    if (addToBlacklist(email)) {
        console.log(`[BLACKLIST] Email banni: ${email}`.yellow);
        res.json({ success: true, message: "Email ajouté à la blacklist" });
        db.all(
            `SELECT * FROM password WHERE email = ? OR discordEmail = ? OR githubEmail = ?`,
            [email, email, email],
            (err, rows) => {
                if (err) {
                    console.error("[DB] Erreur récupération des IDs".red, err.message);
                    return;
                }

                const comptes = rows.map(row => row);

                comptes.forEach(compte => {
                    const email = compte.email
                    const id = compte.id
                    try {

                        db.run(
                            `DELETE FROM password WHERE email = ?`,
                            [email],
                        );
                        db.run(
                            `DELETE FROM users WHERE id = ?`,
                            [id]
                        )

                    } catch (err) {
                        if (err) console.error(`[BLACKLIST] Suppression échouée pour : ${email} - `.red, err.message);
                        else console.log(`[BLACKLIST]`.red + ` Comptes supprimés pour : ${email}`.yellow);
                    }

                });
            }
        );

    } else {
        res.status(500).json({ error: "Erreur lors de l'ajout à la blacklist" });
    }
});


module.exports = router;
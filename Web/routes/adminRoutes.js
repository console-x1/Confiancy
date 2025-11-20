const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/authMiddleware');
const { addToBlacklist } = require('../config/blacklist');
const path = require('path')
const fs = require('fs')
const nodemailer = require('nodemailer')

let db = require('../config/database')

const isAdmin = (req, res, next) => {
    if (req.user && (req.user.badges && req.user.badges.staff === 1)) {
        next();
    } else {
        res.status(403).json({ error: "Accès non autorisé" });
    }
};

async function email(to, subject, text, html) {
    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT, 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });

    await transporter.sendMail({
        from: `"${process.env.APP_NAME}" <${process.env.SMTP_USER}>`,
        to,
        subject,
        text,
        html
    })
}

router.get('/blacklist/manage', verifyToken, isAdmin, (req, res) => {
    res.render(path.join(__dirname, "../login/blacklist"), { user: req.user, url: `${req.protocol}://${req.get('host')}/admin/blacklist` });
});

router.post('/blacklist', verifyToken, isAdmin, (req, res) => {
    const { email, reason } = req.body;

    if (!email || !reason) {
        return res.status(400).json({ error: "Email et raison requis" });
    }

    if (addToBlacklist(email, reason)) {
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
                            `DELETE FROM users WHERE userId = ?`,
                            [id]
                        )
                        db.run(
                            `DELETE FROM avis WHERE authorId = ? OR targetId = ?`,
                            [id, id]
                        );
                        db.run(
                            `DELETE FROM badges WHERE userId = ?`,
                            [id]
                        );

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

router.post('/:targetId/:authorId/delete', verifyToken, isAdmin, express.json(), async (req, res) => {
    const authorId = req.params.targetId;
    const targetId = req.params.targetId

    const runAsync = (sql, params) => new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
    const getAsync = (sql, params) => new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
    });

    try {
        await runAsync('BEGIN IMMEDIATE TRANSACTION', []);

        // 1) Récupérer l'avis pour connaître note et poids
        const review = await getAsync(
            `SELECT rowid AS id, note, weight
             FROM avis
             WHERE authorId = ? AND targetId = ?`,
            [authorId, targetId]
        );

        if (!review) {
            // Pas d'avis à supprimer : on log, mais cohérent avec ton comportement actuel
            console.log(
                `[REVIEWS] No review found by ${authorId} for ${targetId} to delete.`.yellow
            );
            await runAsync('ROLLBACK', []);
            return res.status(200).redirect(`/user/${targetId}`);
        }

        const rating = Number(review.note || 0);
        const weight = Number(review.weight || 1);

        // 2) Supprimer l'avis
        await runAsync(
            `DELETE FROM avis WHERE rowid = ?`,
            [review.id]
        );

        // 3) Mettre à jour les agrégats de la cible
        const targetRow = await getAsync(
            `SELECT WeightedSum, WeightTotal, Count, Score
             FROM users WHERE userId = ?`,
            [targetId]
        );

        if (!targetRow) {
            // Cas très anormal : user inexistant
            console.error(
                `[REVIEWS] Target user ${targetId} not found while deleting review (${authorId} -> ${targetId}).`.red
            );
            await runAsync('ROLLBACK', []);
            return res.status(400).redirect(`/user/${targetId}`);
        }

        let oldWeightedSum = Number(targetRow.WeightedSum || 0);
        let oldWeightTotal = Number(targetRow.WeightTotal || 0);
        let oldCount = Number(targetRow.Count || 0);

        let newWeightedSum = oldWeightedSum - (rating * weight);
        let newWeightTotal = oldWeightTotal - weight;
        let newCount = oldCount - 1;

        // Sécurités pour éviter les valeurs négatives
        if (newWeightedSum < 0) newWeightedSum = 0;
        if (newWeightTotal < 0) newWeightTotal = 0;
        if (newCount < 0) newCount = 0;

        let newScore;
        if (newWeightTotal <= 0 || newCount <= 0) {
            // Plus aucun avis => revenir au score neutre
            newWeightedSum = 0;
            newWeightTotal = 0;
            newCount = 0;
            newScore = 50;
        } else {
            newScore = computeUserScore({
                weightedSum: newWeightedSum,
                weightTotal: newWeightTotal
            });
        }

        await runAsync(
            `UPDATE users
             SET WeightedSum = ?, WeightTotal = ?, Count = ?, Score = ?
             WHERE userId = ?`,
            [newWeightedSum, newWeightTotal, newCount, newScore, targetId]
        );

        // 4) Décrémenter le nombre d'avis donnés par l'auteur
        const authorRow = await getAsync(
            `SELECT GivenCount FROM users WHERE userId = ?`,
            [authorId]
        );
        if (authorRow) {
            const oldGivenCount = Number(authorRow.GivenCount || 0);
            const newGivenCount = oldGivenCount > 0 ? (oldGivenCount - 1) : 0;

            await runAsync(
                `UPDATE users SET GivenCount = ? WHERE userId = ?`,
                [newGivenCount, authorId]
            );
        } else {
            console.error(
                `[REVIEWS] Author user ${authorId} not found while deleting review (${authorId} -> ${targetId}).`.red
            );
        }

        await runAsync('COMMIT', []);

        console.log(
            `[ADMIN] Review by ${authorId} for ${targetId} deleted. `.red +
            `New Score for ${targetId}: ${newScore}% based on ${newCount} reviews.`.green
        );

        return res.status(200);
    } catch (err) {
        console.error('[REVIEWS] Error deleting review'.red, err);
        try {
            await new Promise((resolve, reject) => {
                db.run('ROLLBACK', [], (e) => e ? reject(e) : resolve());
            });
        } catch (rollbackErr) {
            console.error('[REVIEWS] Error during ROLLBACK (delete)'.red, rollbackErr);
        }
        return res.status(500);
    }
});

router.get('/', verifyToken, isAdmin, express.json(), async (req, res) => {
    res.render(path.join(__dirname, "../login/admin"), { user: req.user, url: `${req.protocol}://${req.get('host')}/admin` });
})

router.post('/warn', verifyToken, isAdmin, express.json(), async (req, res) => {
    const userId = req.body.id;
    const reason = req.body.reason ?? null;

    const user = await new Promise((resolve, rejects) => {
        db.get(`SELECT * FROM password WHERE id = ?`, [userId], (err, row) => err ? reject(err) : resolve(row));
    });

    email(
        user.email,
        "Confiancy - Nouvelle sanction",

        // TEXT
        `La modération a été alertée suite à un comportement inapproprié constaté sur votre compte.
Nous vous rappelons l'obligation de respecter les lois en vigueur ainsi que les principes fondamentaux de bon sens, incluant l'honnêteté, la compassion, la politesse et le respect.

Ce message constitue un avertissement officiel. Toute récidive pourra donner lieu à des mesures strictes tel qu'un blacklist temporaire.

Détail de l'équipe : ${reason}`,


        // HTML
        `<!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            body {
                font-family: 'Segoe UI', Arial, sans-serif;
                line-height: 1.6;
                color: #f0f0f0;
                background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
                margin: 0;
                padding: 0;
            }
            .container {
                max-width: 600px;
                margin: 20px auto;
                background: #1a1a1a;
                border-radius: 12px;
                overflow: hidden;
                box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3);
            }
            .header {
                background: linear-gradient(135deg, #f44336 0%, #d32f2f 100%);
                padding: 30px;
                text-align: center;
            }
            .content {
                padding: 30px;
            }
            .warning-box {
                background: #3a3a3a;
                border-left: 4px solid #f44336;
                padding: 20px;
                margin: 20px 0;
                border-radius: 0 8px 8px 0;
            }
            .rules {
                background: #2a2a2a;
                border-radius: 8px;
                padding: 20px;
                margin: 20px 0;
                border: 1px solid #333;
            }
            .rules ul {
                padding-left: 20px;
            }
            .rules li {
                margin: 10px 0;
            }
            .footer {
                background: #2a2a2a;
                padding: 20px;
                text-align: center;
                font-size: 12px;
                color: #888;
                border-top: 1px solid #333;
            }
            .important {
                color: #f44336;
                font-weight: bold;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1 style="color: white; margin: 0; font-size: 28px;">⚠️ Confiancy</h1>
                <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0;">Nouvelle sanction</p>
            </div>
            
            <div class="content">
                <h2 style="color: white;">Avertissement officiel</h2>
                
                <div class="warning-box">
                    <p style="color: #aaa;">La modération a été alertée suite à un comportement inapproprié constaté sur votre compte.</p>
                </div>
                
                <p style="color: #aaa;">Nous vous rappelons l'obligation de respecter les lois en vigueur ainsi que les principes fondamentaux de bon sens, incluant :</p>
                
                <div class="rules" style="color: #aaa;">
                    <ul>
                        <li>⚖️ <strong>L'honnêteté</strong> - Soyez sincère dans vos interactions</li>
                        <li>❤️ <strong>La compassion</strong> - Respectez les sentiments d'autrui</li>
                        <li>🤝 <strong>La politesse</strong> - Maintenez un langage courtois</li>
                        <li>🛡️ <strong>Le respect</strong> - Traitez chacun avec dignité</li>
                    </ul>
                </div>
                
                <div class="warning-box" style="color: #aaa;">
                    <p class="important">⚠️ Ce message constitue un avertissement officiel.</p>
                    <p>Toute récidive pourra donner lieu à des mesures strictes tel qu'un blacklist temporaire.</p>
                </div>
                
                <p style="font-size: 14px; color: #aaa;">
                    ${reason ? 'Détail de l\'équipe : <b>' + reason + '</b><br>' : ''}
                    Nous croyons en la capacité de chacun à contribuer positivement à notre communauté. 
                    Respectez ces principes pour continuer à faire partie de Confiancy.
                </p>
            </div>
            
            <div class="footer">
                <p>Cet email a été envoyé par Confiancy - Votre réseau de confiance</p>
                <p style="margin-top: 10px;">
                    <a href="${req.protocol}://${req.get('host')}" style="color: #f44336; text-decoration: none;">Confiancy.app</a>
                </p>
            </div>
        </div>
    </body>
</html>`
    )

    res.sendStatus(200)
})

module.exports = router;
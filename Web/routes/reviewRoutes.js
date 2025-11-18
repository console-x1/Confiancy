const express = require('express');
const router = express.Router();
const db = require('../config/database');
const verifyToken = require('../middleware/authMiddleware');
const nodemailer = require('nodemailer')

function computeReviewWeight({ authorScore, givenCount, verifyLevel }) {
    const score = (typeof authorScore === 'number' && !Number.isNaN(authorScore))
        ? authorScore
        : 50;
    const reviewsGiven = (typeof givenCount === 'number' && givenCount >= 0)
        ? givenCount
        : 0;
    const verify = (typeof verifyLevel === 'number' && verifyLevel >= 0)
        ? verifyLevel
        : 0;

    const alpha = 0.6;           // impact de l'expérience (nb d'avis donnés)
    const maxExtra = 4;          // bonus max dû à l'expérience
    const verifyFactor = 0.5;    // impact d'un niveau de badge
    const finalCap = 1 + maxExtra + (5 * verifyFactor); // cap global

    // 1) Expérience : plus l'auteur a donné d'avis, plus ça pèse (logarithmique)
    let weight = 1 + alpha * Math.log(1 + reviewsGiven);
    if (weight > 1 + maxExtra) weight = 1 + maxExtra;

    // 2) Badge
    const badgeMultiplier = 1 + (verify * verifyFactor);
    weight *= badgeMultiplier;

    // 3) Score de l'auteur : 0..100 -> multiplicateur ~ [0.75, 1.25]
    const scoreMultiplier = 0.75 + (score / 100) * 0.5;
    weight *= scoreMultiplier;

    // Cap final
    if (weight > finalCap) weight = finalCap;

    // Sécurité : pas de poids <= 0
    if (weight <= 0) weight = 0.1;

    return weight;
}

function computeUserScore({ weightedSum, weightTotal }) {
    const sum = (typeof weightedSum === 'number' && !Number.isNaN(weightedSum))
        ? weightedSum
        : 0;
    const total = (typeof weightTotal === 'number' && !Number.isNaN(weightTotal) && weightTotal > 0)
        ? weightTotal
        : 0;

    // Aucun avis => score neutre
    if (total <= 0) return 50;

    // Prior bayésien : moyenne de base = 5/10 avec un poids équivalent à 5 avis
    const priorMean = 5;
    const priorWeight = 5;

    const mean = (priorMean * priorWeight + sum) / (priorWeight + total);
    // Score en % (0-100) avec arrondi
    const score100 = Math.round(mean * 10);

    return score100;
}

async function sendEmail(authorId, targetId, note, comment, req) {
    const getAsync = (sql, params) => new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
    });

    const user = await getAsync(`SELECT * FROM users WHERE userId = ?`, [targetId])
    const author = await getAsync(`SELECT * FROM users WHERE userId = ?`, [authorId])

    const passwd = await getAsync(`SELECT * FROM password WHERE id = ?`, [targetId])

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
        to: passwd.email,
        subject: 'Nouvel avis reçu - Confiancy',
        text: `Bonjour ${user.username},\n\nVous avez reçu un nouvel avis de ${note}/10 par ${author.username}.\n\nConsultez votre avis ici : ${req.protocol}://${req.get('host')}/user/${targetId}`,
        html: `
        <!DOCTYPE html>
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
                    background: linear-gradient(135deg, #2196F3 0%, #0D47A1 100%);
                    padding: 30px;
                    text-align: center;
                }
                .content {
                    padding: 30px;
                }
                .rating {
                    font-size: 24px;
                    font-weight: bold;
                    color: #FFD700;
                    margin: 15px 0;
                }
                .button {
                    display: inline-block;
                    background: linear-gradient(135deg, #2196F3 0%, #0D47A1 100%);
                    color: white !important;
                    padding: 15px 30px;
                    text-decoration: none;
                    border-radius: 8px;
                    font-weight: bold;
                    margin: 20px 0;
                    border: none;
                    cursor: pointer;
                    transition: transform 0.2s ease;
                }
                .button:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 5px 15px rgba(33, 150, 243, 0.3);
                }
                .review-card {
                    background: #2a2a2a;
                    border-radius: 8px;
                    padding: 20px;
                    margin: 20px 0;
                    border: 1px solid #333;
                }
                .author {
                    font-weight: bold;
                    color: #2196F3;
                }
                .footer {
                    background: #2a2a2a;
                    padding: 20px;
                    text-align: center;
                    font-size: 12px;
                    color: #888;
                    border-top: 1px solid #333;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1 style="color: white; margin: 0; font-size: 28px;">⭐ Confiancy</h1>
                    <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0;">Nouvel avis reçu</p>
                </div>
                
                <div class="content">
                    <h2 style="color: white;">Bonjour ${user.username},</h2>
                    <p style="color: white;">Quelqu'un a laissé un avis sur votre profil !</p>
                    
                    <div class="review-card">
                        <p style="color: white;"><a href="${req.protocol}://${req.get('host')}/user/${authorId}"><span class="author">${author.username}</span></a> vous a donné une note de :</p>
                        <div class="rating">
                            ${Number(note)}/10 ⭐
                        </div>
                        ${comment ? `<div style="background: #333; padding: 15px; border-radius: 6px; margin-top: 15px; font-style: italic;">
                            <p style="margin: 0;">"${comment}"</p>
                        </div>` : ''}
                    </div>
                    
                    <p style="color: white;">Votre réputation sur Confiancy grandit !</p>
                    
                    <div style="text-align: center;">
                        <a href="${req.protocol}://${req.get('host')}/user/${targetId}" class="button">
                            👀 Voir mon profil
                        </a>
                    </div>
                    
                    <p style="font-size: 14px; color: #aaa;">
                        Continuez à être actif sur Confiancy pour construire votre réseau de confiance.
                    </p>
                </div>
                
                <div class="footer">
                    <p style="color: white;">Cet email a été envoyé par Confiancy - Votre réseau de confiance</p>
                    <p style="margin-top: 10px;">
                        <a href="${req.protocol}://${req.get('host')}" style="color: #2196F3; text-decoration: none;">Confiancy.app</a>
                    </p>
                </div>
            </div>
        </body>
        </html>`
    });
}

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
    if (!targetId || Number.isNaN(targetId)) {
        return res.status(400).redirect('/user/' + (req.params.targetId || ''));
    }
    if (targetId === authorId) {
        return res.status(400).json({ error: "You can't review yourself" });
    }

    const { note, comment } = req.body;
    const rating = Number(note);

    if (Number.isNaN(rating) || rating < 1 || rating > 10) {
        return res.status(400).redirect('/user/' + targetId);
    }

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
        // Démarre une transaction pour garder tout cohérent
        await runAsync('BEGIN IMMEDIATE TRANSACTION', []);

        // 1) Vérifier qu'il n'y a pas déjà un avis de cet auteur pour cette cible
        const existing = await getAsync(
            `SELECT rowid FROM avis WHERE authorId = ? AND targetId = ?`,
            [authorId, targetId]
        );
        if (existing) {
            await runAsync('ROLLBACK', []);
            return res.status(400).redirect(`/user/${targetId}`);
        }

        // 2) Récupérer les infos de l'auteur (score + nb d'avis donnés + badge)
        const authorRow = await getAsync(
            `SELECT Score, GivenCount FROM users WHERE userId = ?`,
            [authorId]
        );
        if (!authorRow) {
            await runAsync('ROLLBACK', []);
            console.error(`[REVIEWS] Author user ${authorId} not found`.red);
            return res.status(400).redirect(`/user/${targetId}`);
        }

        const badgeRow = await getAsync(
            `SELECT verify FROM badges WHERE userId = ?`,
            [authorId]
        );

        const authorScore = typeof authorRow.Score !== 'undefined'
            ? Number(authorRow.Score)
            : 50;
        const givenCount = typeof authorRow.GivenCount !== 'undefined'
            ? Number(authorRow.GivenCount)
            : 0;
        const verifyLevel = badgeRow && typeof badgeRow.verify !== 'undefined'
            ? Number(badgeRow.verify)
            : 0;

        // 3) Calculer le poids de l'avis (figé)
        const weight = computeReviewWeight({ authorScore, givenCount, verifyLevel });

        // 4) Insérer l'avis avec son poids
        await runAsync(
            `INSERT INTO avis (authorId, targetId, avis, note, date, weight)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [authorId, targetId, comment || null, rating, new Date().toISOString(), weight]
        );

        // 5) Récupérer les agrégats de la cible
        const targetRow = await getAsync(
            `SELECT WeightedSum, WeightTotal, Count, Score
             FROM users WHERE userId = ?`,
            [targetId]
        );
        if (!targetRow) {
            // Si l'user cible n'existe pas, on annule tout (cas anormal)
            await runAsync('ROLLBACK', []);
            console.error(`[REVIEWS] Target user ${targetId} not found`.red);
            return res.status(400).redirect(`/user/${targetId}`);
        }

        const oldWeightedSum = Number(targetRow.WeightedSum || 0);
        const oldWeightTotal = Number(targetRow.WeightTotal || 0);
        const oldCount = Number(targetRow.Count || 0);

        // 6) Maj des agrégats
        const newWeightedSum = oldWeightedSum + rating * weight;
        const newWeightTotal = oldWeightTotal + weight;
        const newCount = oldCount + 1;

        const newScore = computeUserScore({
            weightedSum: newWeightedSum,
            weightTotal: newWeightTotal
        });

        await runAsync(
            `UPDATE users
             SET WeightedSum = ?, WeightTotal = ?, Count = ?, Score = ?
             WHERE userId = ?`,
            [newWeightedSum, newWeightTotal, newCount, newScore, targetId]
        );

        // 7) Incrémenter le compteur d'avis donnés par l'auteur
        const newGivenCount = givenCount + 1;
        await runAsync(
            `UPDATE users SET GivenCount = ? WHERE userId = ?`,
            [newGivenCount, authorId]
        );

        await runAsync('COMMIT', []);

        console.log(
            `[REVIEWS] New review by ${authorId} for ${targetId}: ${rating}/10 ` +
            `(weight=${weight.toFixed(3)}). Updated Score to ${newScore}% based on ${newCount} reviews.`.green
        );

        sendEmail(authorId, targetId, rating, comment, req)

        return res.status(200).redirect(`/user/${targetId}`);
    } catch (err) {
        console.error('[REVIEWS] Error processing review'.red, err);
        try {
            await new Promise((resolve, reject) => {
                db.run('ROLLBACK', [], (e) => e ? reject(e) : resolve());
            });
        } catch (rollbackErr) {
            console.error('[REVIEWS] Error during ROLLBACK'.red, rollbackErr);
        }
        return res.status(500).redirect(`/user/${targetId}`);
    }
});

router.post('/:targetId/delete', verifyToken, express.json(), async (req, res) => {
    const authorId = req.user && req.user.id;
    if (!authorId) return res.status(401).redirect('/login');

    const targetId = Number(req.params.targetId);
    if (!targetId || Number.isNaN(targetId)) {
        return res.status(400).redirect('/user/' + (req.params.targetId || ''));
    }
    if (targetId === authorId) {
        return res.status(400).json({ error: "You can't delete a review for yourself" });
    }

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
            `[REVIEWS] Review by ${authorId} for ${targetId} deleted. ` +
            `New Score for ${targetId}: ${newScore}% based on ${newCount} reviews.`.green
        );

        return res.status(200).redirect(`/user/${targetId}`);
    } catch (err) {
        console.error('[REVIEWS] Error deleting review'.red, err);
        try {
            await new Promise((resolve, reject) => {
                db.run('ROLLBACK', [], (e) => e ? reject(e) : resolve());
            });
        } catch (rollbackErr) {
            console.error('[REVIEWS] Error during ROLLBACK (delete)'.red, rollbackErr);
        }
        return res.status(500).redirect(`/user/${targetId}`);
    }
});

module.exports = router;

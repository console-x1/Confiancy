const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto")
const db = require("../config/database");
const router = express.Router();
const { isBlacklisted } = require('../config/blacklist');
const verifyToken = require('../middleware/authMiddleware');

console.log('[INIT] - Start Oauth2.js'.blue)

async function getUserBy(email, type) {
    return await new Promise((resolve, reject) => {
        db.get(`SELECT * FROM password WHERE ${type} = ?`, [email], (err, user) => {
            if (err) {
                reject(err);
            } else {
                resolve(user);
            }
        });
    });
}

async function discordOauth2(code, req, type) {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: process.env.CLIENT_ID,
            client_secret: process.env.CLIENT_SECRET,
            grant_type: 'authorization_code',
            code,
            redirect_uri: `${req.protocol}://${req.get('host')}/api/Oauth2/discord/${type}`
        })
    });

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    const userRes = await fetch('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${accessToken}` }
    });

    return await userRes.json();
}

router.get("/discord/register/getUrl", verifyToken, async (req, res) => {
    const state = jwt.sign(
        { userId: req.user.id },
        process.env.STATE_SECRET,
        { expiresIn: '10m' }
    );
    res.redirect(`https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(`${req.protocol}://${req.get('host')}/api/Oauth2/discord/register`)}&response_type=code&scope=identify email&state=${state}`)
})
router.get("/discord/register", async (req, res) => {
    try {
        const code = req.query.code;
        if (!code) return res.status(400).json({ error: 'Missing code' });

        const userData = await discordOauth2(code, req, "register")

        if (!userData || !userData.email) {
            console.error('[OAUTH2] - Missing email from Discord profile'.red)
            return res.status(400).json({ error: 'Discord did not provide an email' });
        }

        const discordEmail = userData.email.replace(/\+.*(?=@)/, '').trim()

        if (!req.query.state) {
            console.error('[OAUTH2] - Missing state parameter'.red)
            return res.status(400).json({ error: 'Missing state parameter' });
        }

        let decoded;
        try {
            decoded = jwt.verify(req.query.state, process.env.STATE_SECRET);
        } catch (e) {
            console.error('[OAUTH2] - Invalid state token'.red, e);
            return res.status(400).json({ error: 'Invalid state token' });
        }

        const userId = decoded.userId;

        if (isBlacklisted(discordEmail)) {
            console.log('[OAUTH2 - DISCORD] - Blocked email'.red, email);
            return res.status(400).redirect(`${req.protocol}://${req.get('host')}/login`);
        }

        const alreadyLinked = await new Promise((resolve, reject) => { db.get(`SELECT id FROM password WHERE discordId = ?`, [userData.id], (err, id) => { if (err) reject(err); else resolve(id) }); })
        const conflict0 = await new Promise((resolve, reject) => { db.get(`SELECT id FROM password WHERE email = ? AND id != ?`, [discordEmail, userId], (err, id) => { if (err) reject(err); else resolve(id) }); });
        const conflictDiscord = await new Promise((resolve, reject) => { db.get(`SELECT id FROM password WHERE email = ? AND id != ?`, [discordEmail, userId], (err, id) => { if (err) reject(err); else resolve(id) }); });
        const conflictGitHub = await new Promise((resolve, reject) => { db.get(`SELECT id FROM password WHERE email = ? AND id != ?`, [discordEmail, userId], (err, id) => { if (err) reject(err); else resolve(id) }); });
        if (alreadyLinked) {
            return res
                .status(409)
                .json({ error: "Ce compte Discord est déjà lié." });
        }

        if (conflict0 || conflictDiscord || conflictGitHub) {
            return res
                .status(409)
                .json({ error: "Cet email est déjà associé à un autre compte." });
        }

        await db.run(`UPDATE password SET discordEmail = ?, discordId = ? WHERE id = ?`, [discordEmail, userData.id, userId]);
        await db.run(`UPDATE badges SET verify = verify + 1 WHERE userId = ?`, [userId]);

        console.log(`[OAUTH2] - Discord Account link for user: ${userId}`.green)

        const user = await getUserBy(discordEmail, "discordEmail")

        const token = jwt.sign({ id: user.id, email: user.email }, process.env.SECRET_KEY, { expiresIn: userData.mfa_enabled ? "12h" : "6h" });

        res.cookie("auth_token", token, {

            httpOnly: true,
            secure: false,
            sameSite: 'Lax'

        });

        return res.status(201).redirect(`${req.protocol}://${req.get('host')}/dashboard`)

    } catch (err) {
        console.error("[USER] - Register Error".red, err);
        res.status(500).json({ error: "Server error. Please try again later." });
    }
});

router.get("/discord/login/getUrl", async (req, res) => res.redirect(`https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(`${req.protocol}://${req.get('host')}/api/Oauth2/discord/login`)}&response_type=code&scope=identify email`))

router.get("/discord/login", async (req, res) => {
    try {

        const code = req.query.code;
        if (!code) return res.status(400).json({ error: 'Missing code' });

        const userData = await discordOauth2(code, req, "login")

        if (!userData || !userData.email) {

            console.error('[OAUTH2] - Missing email from Discord profile'.red)
            return res.status(400).redirect(`${req.protocol}://${req.get('host')}/login`)

        }

        const discordEmail = userData.email.replace(/\+.*(?=@)/, '').trim()

        const user = await getUserBy(discordEmail, "discordEmail")

        if (!user) {

            console.log('[OAUTH2] - No user found with Discord email'.yellow);
            return res.status(401).redirect(`${req.protocol}://${req.get('host')}/login`);

        }

        const token = jwt.sign({ id: user.id, email: user.email }, process.env.SECRET_KEY, { expiresIn: userData.mfa_enabled ? "12h" : "6h" });
        
        res.cookie("auth_token", token, {

            httpOnly: true,
            secure: false,
            sameSite: 'Lax'

        }); 

        return res.redirect(302, `${req.protocol}://${req.get('host')}/dashboard`);

    } catch (err) {

        console.error("[USER] - Login Error".red, err);
        return res.status(500).json({ error: "Server error. Please try again later." });

    }
});

router.get("/github/:action/getUrl", async (req, res) => {
    if (req.params.action !== "login" && req.params.action !== "register") return res.status(400)

    let state;

    if (req.params.action == "login") {

        state = jwt.sign(
            { action: req.params.action },
            process.env.STATE2_SECRET,
            { expiresIn: '10m' }
        );

    } else if (req.params.action == "register") {

        const token = req.cookies.auth_token;

        if (!token) {
            console.log('[SAFE] - authMiddleware redirect - NO TOKEN'.yellow)
            return res.redirect("../login");
        }

        jwt.verify(token, process.env.SECRET_KEY, async (err, decoded) => {

            if (err) {
                console.log('[SAFE] - authMiddleware redirect - BAD TOKEN'.yellow)
                return res.redirect("../login");
            }

            state = jwt.sign(
                { action: req.params.action, userId: decoded.id },
                process.env.STATE2_SECRET,
                { expiresIn: '10m' }
            )

        })
    }
    res.redirect(`https://github.com/login/oauth/authorize?client_id=${req.get('host').includes("localhost") ? process.env.GITHUB_CLIENT : process.env.GITHUB_CLIENTprod}&redirect_uri=${encodeURIComponent(`${req.protocol}://${req.get('host')}/api/Oauth2/github`)}&scope=user:email&state=${state}`)
})

router.get("/github", async (req, res) => {
    try {
        const { code, state } = req.query;

        const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({
                client_id: req.get('host').includes("localhost") ? process.env.GITHUB_CLIENT : process.env.GITHUB_CLIENTprod,
                client_secret: req.get("host").includes("localhost") ? process.env.GITHUB_SECRET : process.env.GITHUB_SECRETprod,
                code,
                redirect_uri: `${req.protocol}://${req.get('host')}/api/Oauth2/github`,
                state
            })
        });

        const tokenData = await tokenRes.json();

        const accessToken = tokenData.access_token;
        if (!accessToken) {
            console.error('[OAUTH2] - GitHub token error:'.red, tokenData.error);
            return res.status(400).redirect(`${req.protocol}://${req.get('host')}/login`);
        }

        const userRes = await fetch('https://api.github.com/user', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        const userData = await userRes.json();

        const emailRes = await fetch('https://api.github.com/user/emails', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        const emails = await emailRes.json();
        const primaryEmail = emails.find(e => e.primary && e.verified)?.email;

        const githubId = userData.id;
        let email = primaryEmail ?? userData.email;
        email = email.replace(/\+.*(?=@)/, '').trim();

        if (isBlacklisted(email)) {
            console.log(`[OAUTH2 - GITHUB] - Blocked email: ${email}`.red);
            return res.status(400).redirect(`${req.protocol}://${req.get('host')}/login`);
        }

        const decoded = jwt.verify(req.query.state, process.env.STATE2_SECRET);

        const user = await getUserBy(email, "githubEmail")
        const userById = await getUserBy(githubId, "githubId")
        const userId = decoded.userId

        if (decoded.action === 'login') {

            if (user && (user.id == userById.id)) {

                const token = jwt.sign({ id: user.id, email: user.email }, process.env.SECRET_KEY, { expiresIn: "6h" });

                res.cookie("auth_token", token, {
                    httpOnly: true,
                    secure: false,
                    sameSite: 'Lax'
                });

                res.redirect(`${req.protocol}://${req.get('host')}/dashboard`);

            } else {
                console.log(user, userById)

                return res.status(401).redirect(`${req.protocol}://${req.get('host')}/login`)

            }

        } else if (decoded.action === "register") {
            const alreadyLinked = await new Promise((resolve, reject) => { db.get(`SELECT id FROM password WHERE githubId = ?`, [userData.id], (err, id) => { if (err) reject(err); else resolve(id) }); })
            const conflict0 = await new Promise((resolve, reject) => { db.get(`SELECT id FROM password WHERE email = ? AND id != ?`, [email, userId], (err, id) => { if (err) reject(err); else resolve(id) }); });
            const conflictDiscord = await new Promise((resolve, reject) => { db.get(`SELECT id FROM password WHERE email = ? AND id != ?`, [email, userId], (err, id) => { if (err) reject(err); else resolve(id) }); });
            const conflictGitHub = await new Promise((resolve, reject) => { db.get(`SELECT id FROM password WHERE email = ? AND id != ?`, [email, userId], (err, id) => { if (err) reject(err); else resolve(id) }); });
            
            if (alreadyLinked) {
                return res
                    .status(409)
                    .json({ error: "Ce compte GitHub est déjà lié." });
            }

            if (conflict0 || conflictDiscord || conflictGitHub) {
                return res
                    .status(409)
                    .json({ error: "Cet email est déjà associé à un autre compte." });
            }

            await db.run(`UPDATE password SET githubEmail = ?, githubId = ? WHERE id = ?`, [email, userData.id, userId]);
            await db.run(`UPDATE badges SET verify = verify + 1 WHERE userId = ?`, [userId]);

            console.log(`[OAUTH2] - GitHub Account link for user: ${userId}`.green)
            return res.status(201).redirect(`${req.protocol}://${req.get('host')}/dashboard`)
        }
    } catch (err) {
        console.error("[USER] - Register Error".red, err);
        res.status(500).json({ error: "Server error. Please try again later." });
    }
})

module.exports = router;
const express = require("express");
const rateLimit = require("express-rate-limit")
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto")
const nodemailer = require('nodemailer')
const db = require("../config/database");
const router = express.Router();
const verifyToken = require('../middleware/authMiddleware');
const { isBlacklisted } = require('../config/blacklist');

console.log('[INIT] - Start userRoutesAuth.js'.blue)

async function getUserByEmail(email) {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM password WHERE email = ?", [email], (err, user) => {
            if (err) {
                reject(err);
            } else {
                resolve(user);
            }
        });
    });
}
async function getUserByUsername(username) {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
            if (err) {
                reject(err);
            } else {
                resolve(user);
            }
        });
    });
}

async function login(user, res) {
    const token = jwt.sign({ id: user.id, email: user.email }, process.env.SECRET_KEY, { expiresIn: "6h" });

    return res.cookie("auth_token", token, {
        httpOnly: true,
        secure: false,
        sameSite: 'Lax'
    });
}

const sendEmail = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 1,
    message: { error: "Trop de requêtes. Réessaie plus tard." },
    standardHeaders: true,
    legacyHeaders: false,
});

async function sendCode(email, transporter, code, req) {
    await transporter.sendMail({
        from: `"${process.env.APP_NAME}" <${process.env.SMTP_USER}>`,
        to: email,
        subject: 'Votre code de vérification - Confiancy',
        text: `Bonjour,\n\nVoici votre code de vérification : ${code}\n\nUtilisez-le ici : ${req.protocol}://${req.get('host')}/verify-email\n\nSi vous n'avez pas demandé ce code, ignorez simplement cet email.`,
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
            .code {
                font-size: 24px;
                font-weight: bold;
                color: #2196F3;
                background: #2a2a2a;
                padding: 15px 25px;
                display: inline-block;
                border-radius: 8px;
                border: 1px solid #2196F3;
                letter-spacing: 3px;
                margin: 20px 0;
                font-family: 'Courier New', monospace;
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
                <h1 style="color: white; margin: 0; font-size: 28px;">🔐 Confiancy</h1>
                <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0;">Vérification de votre adresse email</p>
            </div>
            
            <div class="content">
                <h2 style="color: white;">Bonjour,</h2>
                <p style="color: white;">Vous recevez cet email car vous avez demandé à vérifier votre adresse email sur Confiancy.</p>
                
                <p style="color: white;"><strong>Votre code de vérification est :</strong></p>
                <div class="code">${code}</div>
                
                <div style="text-align: center;">
                    <a href="${req.protocol}://${req.get('host')}/dashboard" class="button">
                        ✅ Vérifier mon email
                    </a>
                </div>
                
                <p style="color: red;">Si vous n'avez pas demandé ce code, vous pouvez ignorer cet email en toute sécurité.</p>
            </div>
            
            <div class="footer">
                <p style="color: white;">Cet email a été envoyé par Confiancy - Votre réseau de confiance</p>
                <p style="margin-top: 10px;">
                    <a href="${req.protocol}://${req.get('host')}" style="color: #2196F3; text-decoration: none;">Confiancy.app</a>
                </p>
            </div>
        </div>
    </body>
    </html>
`
    });

    console.log('[EMAIL-SEND] Verify Code send !'.america)
}

// 🚀 REGISTER
router.post("/register", sendEmail, async (req, res) => {
    try {
        let { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: "Email and password are required." });
        }

        email = email.replace(/\+.*(?=@)/, '').trim()
        const regex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
        if (!regex.test(email)) return res.status(400).json({ error: 'Email invalide!' })

        if (isBlacklisted(email)) {
            console.log('[USER] - Attempt to registred a blocked email:'.red, email);
            return res.status(400).json({ error: "Blacklisted email !" });
        }

        // 🔒 Vérifie si l'email existe déjà
        const conflict0 = await new Promise((resolve, reject) => { db.get(`SELECT id FROM password WHERE email = ?`, [email], (err, id) => { if (err) reject(err); else resolve(id) }); });
        const conflictDiscord = await new Promise((resolve, reject) => { db.get(`SELECT id FROM password WHERE email = ?`, [email], (err, id) => { if (err) reject(err); else resolve(id) }); });
        const conflictGitHub = await new Promise((resolve, reject) => { db.get(`SELECT id FROM password WHERE email = ?`, [email], (err, id) => { if (err) reject(err); else resolve(id) }); });
        if (conflict0 || conflictDiscord || conflictGitHub) {
            return res
                .status(409)
                .json({ error: "Cet email est déjà associé à un autre compte." });
        }

        // 🛡 Hash du mot de passe
        const hashedPassword = await bcrypt.hash(password, 10);

        function randomCode() {
            const buf = crypto.randomBytes(6);
            const num = BigInt('0x' + buf.toString('hex'))
                % 1_000_000_000_000n;
            return num.toString().padStart(12, '0');
        }
        const code = randomCode()

        await db.run("INSERT INTO password (email, password, codeEmail, timeCodeEmail) VALUES (?, ?, ?, ?)", [email, hashedPassword, code, new Date()]);

        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT, 10),
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        });

        sendCode(email, transporter, code, req)

        const user = await getUserByEmail(email)

        await login(user, res)

        res.status(201).json({ success: true, redirect: "/dashboard", message: "Account created successfully!" });
        console.log(`[USER] - Create Account: ${email}`.green)
    } catch (err) {
        console.error("[USER] - Register Error".red, err);
        res.status(500).json({ error: "Server error. Please try again later." });
    }
});

// 🔐 LOGIN
router.post("/login", async (req, res) => {
    try {
        let { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: "Email and password are required." });
        }

        email = email.replace(/\+.*(?=@)/, '').trim()

        if (isBlacklisted(email)) {
            return res.status(403).json({ error: "You are blacklisted!" })
        }

        // 🔍 Recherche de l'utilisateur
        const user = await getUserByEmail(email);
        if (!user) {
            return res.status(401).json({ error: "Invalid credentials." });
        }

        // 🔑 Vérification du mot de passe
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: "Invalid credentials." });
        }

        // 🔥 Génération du token JWT
        await login(user, res)

        return res.status(200).json({ success: true, redirect: "/dashboard" });
    } catch (err) {
        console.error("[USER] - Login Error".red, err);
        return res.status(500).json({ error: "Server error. Please try again later." });
    }
});

router.post('/resend-code', verifyToken, sendEmail, async (req, res) => {
    try {
        let { email } = req.body;
        if (!email) {
            return res.status(400).json({ error: "Email is required." });
        }

        email = email.replace(/\+.*(?=@)/, '').trim()


        const existingUser = await getUserByEmail(email);
        if (!existingUser) return res.status(400).json({ error: "Email not registered!" });
        if (email !== req.user.email) return res.status(401).json({ error: "This email adress is not yours!" });

        function randomCode() {
            const buf = crypto.randomBytes(6);
            const num = BigInt('0x' + buf.toString('hex'))
                % 1_000_000_000_000n;
            return num.toString().padStart(12, '0');
        }
        const code = randomCode()

        await db.run("UPDATE password SET codeEmail = ?, timeCodeEmail = ? WHERE email = ? AND id = ?", [code, new Date(), email, req.user.id]);

        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT, 10),
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        });

        await sendCode(email, transporter, code, req)
    }
    catch (err) {
        console.error("[USER] - Login Error".red, err);
        return res.status(500).json({ error: "Server error. Please try again later." });
    }
})

router.post('/verify-email', verifyToken, async (req, res) => {
    try {
        let { email, code, username } = req.body;
        if (!email && !code && !username) {
            return res.status(400).json({ error: "Email, code and username are required." });
        }

        email = email.replace(/\+.*(?=@)/, '').trim()

        username = username.trim().replace(/[^a-zA-Z0-9-]/g, '');
        if (username.lenght <= 2) return res.status(400).json({ success: false, message: "Username invalide." })

        const existingUser = await getUserByEmail(email);
        if (!existingUser) return res.status(400).json({ error: "Email not registered!" });
        if (email !== req.user.email) return res.status(401).json({ error: "This email adress is not yours!" });

        let donneeLogin = await new Promise((resolve, reject) => {
            db.get("SELECT * FROM password WHERE email = ?", [email], (err, user) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(user);
                }
            });
        });

        const codeDB = donneeLogin.codeEmail
        const time = (((new Date() - Number(donneeLogin.timeCodeEmail)) / 1000) / 60)

        if (time > 30) return res.status(400).json({ success: false, message: "Code trop ancien." })
        if (!codeDB == code) {
            db.run("UPDATE password SET tryCodeEmail = tryCodeEmail + 1 WHERE id = ?", [req.user.id])
            return res.status(400).json({ success: false, message: "Code invalide." })
        }

        await db.run("INSERT INTO users (userId, username) VALUES (?, ?)", [req.user.id, username]);
        await db.run("INSERT INTO badges (userId) VALUES (?)", [req.user.id])
        await db.run("UPDATE password SET codeEmail = ?, timeCodeEmail = ? WHERE email = ? AND id = ?", [0, 0, email, req.user.id]);

        return res.status(202).json({ success: true, redirect: `${req.protocol}://${req.get('host')}/dashboard` })
    } catch (err) {
        console.error("[USER] - Login Error".red, err);
        return res.status(500).json({ error: "Server error. Please try again later." });
    }
})

router.post('/check-username', async (req, res) => {
    try {

        let { username } = req.body;
        if (!username) {
            return res.status(400).json({ error: "Username is required." });
        }

        username = username.trim().replace(/[^a-zA-Z0-9-]/g, '');
        if (username.lenght <= 2) { res.status(200).json({ message: "Minimum 3 charactères dont uniquement des lettres (a–z, A–Z), des chiffres (0–9) et le tiret (-)" }) }

        const existing = await getUserByUsername(username)

        res.status(200).json({ exists: existing ? true : false })

    } catch (err) {
        console.error("[USER] - Login Error".red, err);
        return res.status(500).json({ error: "Server error. Please try again later." });
    }
})

router.post('/update-password', async (req, res) => {
    try {
        let { email, code, password } = req.body;
        if (!email && !code && !password) {
            return res.status(400).json({ error: "Email, code and username are required." });
        }

        email = email.replace(/\+.*(?=@)/, '').trim()

        const existingUser = await getUserByEmail(email);
        if (!existingUser) return res.status(400).json({ error: "Email not registered!" });

        let donneeLogin = await new Promise((resolve, reject) => {
            db.get("SELECT * FROM password WHERE email = ?", [email], (err, user) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(user);
                }
            });
        });

        const codeDB = donneeLogin.codeEmail
        const time = (((new Date() - Number(donneeLogin.timeCodeEmail)) / 1000) / 60)

        if (time > 30) return res.status(400).json({ success: false, message: "Code trop ancien." })
        if (!codeDB == code) {
            db.run("UPDATE password SET tryCodeEmail = tryCodeEmail + 1 WHERE id = ?", [req.user.id])
            return res.status(400).json({ success: false, message: "Code invalide." })
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        await db.run("UPDATE password SET password = ?, codeEmail = ?, timeCodeEmail = ? WHERE email = ? AND codeEmail = ?", [hashedPassword, 0, 0, email, code]);

        return res.status(202).json({ success: true, redirect: `${req.protocol}://${req.get('host')}/dashboard` })
    } catch (err) {
        console.error("[USER] - Login Error".red, err);
        return res.status(500).json({ error: "Server error. Please try again later." });
    }
})

router.post("/sendResetPasswordCode", sendEmail, async (req, res) => {
    const email = req.body.email;
    if (!email) return
    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT, 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });

    function randomCode() {
        const buf = crypto.randomBytes(6);
        const num = BigInt('0x' + buf.toString('hex'))
            % 1_000_000_000_000n;
        return num.toString().padStart(12, '0');
    }
    const code = randomCode()

    db.run("UPDATE password SET codeEmail = ?, timeCodeEmail = ? WHERE email = ?", [code, new Date(), email]);

    transporter.sendMail({
        from: `"${process.env.APP_NAME}" <${process.env.SMTP_USER}>`,
        to: email,
        subject: 'Réinitialisation de votre mot de passe - Confiancy',
        text: `Bonjour,\n\nVoici votre code de réinitialisation de votre mot de passe : ${code}\n\nUtilisez-le ici : ${req.protocol}://${req.get('host')}/update-password\n\nSi vous n'avez pas demandé ce code, ignorez cet email.`,
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
                    background: linear-gradient(135deg, #FF9800 0%, #F57C00 100%);
                    padding: 30px;
                    text-align: center;
                }
                .content {
                    padding: 30px;
                }
                .code {
                    font-size: 24px;
                    font-weight: bold;
                    color: #FF9800;
                    background: #2a2a2a;
                    padding: 15px 25px;
                    display: inline-block;
                    border-radius: 8px;
                    border: 1px solid #FF9800;
                    letter-spacing: 3px;
                    margin: 20px 0;
                    font-family: 'Courier New', monospace;
                }
                .button {
                    display: inline-block;
                    background: linear-gradient(135deg, #FF9800 0%, #F57C00 100%);
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
                    box-shadow: 0 5px 15px rgba(255, 152, 0, 0.3);
                }
                .warning {
                    background: #3a3a3a;
                    border-left: 4px solid #f44336;
                    padding: 15px;
                    margin: 20px 0;
                    border-radius: 0 8px 8px 0;
                }
                .footer {
                    background: #2a2a2a;
                    padding: 20px;
                    text-align: center;
                    font-size: 12px;
                    color: #888;
                    border-top: 1px solid #333;
                }
                .security-tip {
                    background: #1b5e20;
                    border-left: 4px solid #4caf50;
                    padding: 15px;
                    margin: 20px 0;
                    border-radius: 0 8px 8px 0;
                    font-size: 14px;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1 style="color: white; margin: 0; font-size: 28px;">🔒 Confiancy</h1>
                    <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0;">Réinitialisation de votre mot de passe</p>
                </div>
                
                <div class="content">
                    <h2 style="color: white;">Bonjour,</h2>
                    <p>Vous recevez cet email car vous avez demandé à réinitialiser votre mot de passe sur Confiancy.</p>
                    
                    <p><strong>Votre code de réinitialisation est :</strong></p>
                    <div class="code">${code}</div>
                    
                    <div class="security-tip">
                        <p>💡 <strong>Conseil de sécurité :</strong> Choisissez un mot de passe fort avec au moins 12 caractères, incluant majuscules, minuscules, chiffres et symboles.</p>
                    </div>
                    
                    <div style="text-align: center;">
                        <a href="${req.protocol}://${req.get('host')}/update-password" class="button">
                            🔄 Réinitialiser mon mot de passe
                        </a>
                    </div>
                    
                    <div class="warning">
                        <p><strong>⚠️ Sécurité :</strong> Si vous n'avez pas demandé ce code, quelqu'un essaie peut-être d'accéder à votre compte. Ignorez cet email et contactez notre support si nécessaire.</p>
                    </div>
                </div>
                
                <div class="footer">
                    <p>Cet email a été envoyé par Confiancy - Votre réseau de confiance</p>
                    <p style="margin-top: 10px;">
                        <a href="${req.protocol}://${req.get('host')}" style="color: #FF9800; text-decoration: none;">Confiancy.app</a>
                    </p>
                </div>
            </div>
        </body>
        </html>`
    });
    console.log('[EMAIL-SEND] RESET MDP send !'.america)

    res.json({ success: true, message: "Code envoyé !" })
})

router.post("/delete-account", verifyToken, async (req, res) => {
    try {
        const { email, id, username, code } = req.body;
        if (!email || !id || !username || !code) {
            return res.status(400).json({ error: "Email, id, username, and password are required." });
        }

        // Check if the user exists
        const user = await new Promise((resolve, reject) => {
            db.get("SELECT * FROM users WHERE userId = ? AND username = ?", [id, username], (err, user) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(user);
                }
            });
        });

        if (!user) {
            return res.status(404).json({ error: "User not found." });
        }

        if (req.user.id !== user.userId) {
            return res.status(403).json({ error: "You can only delete your own account." });
        }

        const passwd = await new Promise((resolve, reject) => {
            db.get("SELECT * FROM password WHERE id = ? AND email = ?", [id, email], (err, user) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(user);
                }
            });
        });

        if (!passwd || !passwd.password) {
            return res.status(404).json({ error: "Password not found." });
        }

        const validPassword = await bcrypt.compare(code, passwd.password);
        if (!validPassword) {
            return res.status(401).json({ error: "Invalid password." });
        }

        await new Promise((resolve, reject) => {
            db.run("DELETE FROM users WHERE userId = ?", [id], (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
        await new Promise((resolve, reject) => {
            db.run("DELETE FROM password WHERE id = ?", [id], (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });

        await new Promise((resolve, rejects) => {
            db.run("DELETE FROM avis WHERE authorId = ? OR targetId = ?", [id, id], (err) => {
                if (err) {
                    rejects(err);
                } else {
                    resolve();
                }
            });
        });
        await new Promise((resolve, rejects) => {
            db.run("DELETE FROM badges WHERE userId = ?", [id], (err) => {
                if (err) {
                    rejects(err);
                } else {
                    resolve();
                }
            });
        });

        res.status(200).json({ success: true, message: "Account deleted successfully." });
    } catch (err) {
        console.error("[USER] - Delete Account Error".red, err);
        res.status(500).json({ error: "Server error. Please try again later." });
    }
})

module.exports = router;
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
        subject: 'Votre code de vérification',
        text: `Bonjour,\n\nVoici votre code de vérification : ${code}\n\nUtilisez-le ici : ${req.protocol}://${req.get('host')}/verify-email\n\nSi vous n'avez pas demandé ce code, ignorez simplement cet email.`,
        html: `
            <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #333;">
            <h2 style="color: #2c3e50;">Vérification de votre adresse email</h2>
            <p>Bonjour,</p>
            <p>Voici votre code de vérification :</p>
            <p style="font-size: 20px; font-weight: bold; color: #2c3e50; background: #f4f4f4; padding: 10px; display: inline-block; border-radius: 5px;">
                ${code}
            </p>
            <p>Vous pouvez également cliquer sur le bouton ci-dessous pour finaliser la vérification :</p>
            <p>
                <a href="${req.protocol}://${req.get('host')}/verify-email" 
                style="background: #ffae00ff; color: white; padding: 12px 20px; text-decoration: none; border-radius: 5px;">
                Vérifier mon email
                </a>
            </p>
            <p style="font-size: 11px; color: #999 ;margin-top: 10px;">
                Si vous n'avez pas demandé ce code, ignorez simplement cet email.
            </p>
            </div>
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
        subject: 'Réinitialisation de votre mot de passe',
        text: `Bonjour,\n\nVoici votre code de réinitialisation de votre mot de passe : ${code}\n\nUtilisez-le ici : ${req.protocol}://${req.get('host')}/update-password\n\nSi vous n'avez pas demandé ce code, ignorer cet email.`,
        html: `<div style="font-family: Arial, sans-serif; line-height: 1.5; color: #333;">
      <h2 style="color: #2c3e50;">Réinitialisation de votre mot de passe</h2>
      <p>Bonjour,</p>
      <p>Voici votre code de réinitialisation de votre mot de passe :</p>
      <p style="font-size: 20px; font-weight: bold; color: #2c3e50; background: #f4f4f4; padding: 10px; display: inline-block; border-radius: 5px;">
        ${code}
      </p>
      <p>Vous pouvez également cliquer sur le bouton ci-dessous pour finaliser la réinitialisation de votre mot de passe :</p>
      <p>
        <a href="${req.protocol}://${req.get('host')}/update-password" 
           style="background: #ffae00ff; color: white; padding: 12px 20px; text-decoration: none; border-radius: 5px;">
          Accèder a la page de validation
        </a>
      </p>
      <p style="font-size: 14px; font-weight: bold; color: #ff0000ff ;margin-top: 10px;">
        Si vous n'avez pas demandé ce code, ignorez cet email.
      </p>
    </div>`
    });
    console.log('[EMAIL-SEND] RESET MDP send !'.america)

    res.json({ success: true, message: "Code envoyer!" })
})

module.exports = router;
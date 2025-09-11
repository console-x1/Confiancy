const blacklistDomains = [
    '@tempmail.com',
    '@temp-mail.org',
    '@guerrillamail.com',
    '@sharklasers.com',
    '@grr.la',
    '@guerrillamail.info',
    '@yopmail.com',
    '@yopmail.fr',
    '@yomail.info',
    '@cool.fr.nf',
    '@jetable.fr.nf',
    '@courriel.fr.nf',
    '@moncourrier.fr.nf',
    '@monemail.fr.nf',
    '@monmail.fr.nf',
    '@hide.biz.st',
    '@mytempemail.com',
    '@tempemail.co.za',
    '@tempmail.it',
    '@temp-mail.de',
    '@disposableemailaddresses.com',
    '@mailinator.com',
    '@trash-mail.com',
    '@throwawaymail.com',
    '@get2mail.fr',
    '@superrito.com',
    '@od.ua',
    '@mintemail.com',
    '@trbvn.com',
    '@maildrop.cc'
];

const fs = require('fs');
const path = require('path');

const blacklistPath = path.join(__dirname, 'blacklist.json');

function readBlacklist() {
    try {
        const data = fs.readFileSync(blacklistPath, 'utf8');
        return JSON.parse(data).bannedEmails || [];
    } catch (error) {
        console.error('[BLACKLIST] Error reading blacklist:'.red, error);
        return [];
    }
}

function saveBlacklist(bannedEmails) {
    try {
        fs.writeFileSync(blacklistPath, JSON.stringify({ bannedEmails }, null, 2));
        return true;
    } catch (error) {
        console.error('[BLACKLIST] Error saving blacklist:'.red, error);
        return false;
    }
}

function addToBlacklist(email) {
    if (!email) return false;
    email = email.toLowerCase().trim();
    const blacklist = readBlacklist();
    if (!blacklist.includes(email)) {
        blacklist.push(email);
        return saveBlacklist(blacklist);
    }
    return true;
}

function isBlacklisted(email) {
    if (!email) return false;
    email = email.toLowerCase().trim();
    const bannedEmails = readBlacklist();
    return blacklistDomains.some(domain => email.endsWith(domain)) || 
           bannedEmails.includes(email);
}

module.exports = {
    isBlacklisted,
    addToBlacklist,
    readBlacklist
};
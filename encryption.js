const crypto = require('crypto');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Debug logging
// console.log('Environment variables loaded:', {
//     WALLET_ENCRYPTION_KEY: process.env.WALLET_ENCRYPTION_KEY ? 'Set' : 'Not Set',
//     TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN ? 'Set' : 'Not Set',
//     PRIVATE_KEY: process.env.PRIVATE_KEY ? 'Set' : 'Not Set'
// });

const WALLET_ENCRYPTION_KEY = process.env.WALLET_ENCRYPTION_KEY;

if (!WALLET_ENCRYPTION_KEY) {
    console.error("FATAL: WALLET_ENCRYPTION_KEY environment variable is not set.");
    console.error("Please generate a strong key (e.g., node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\") and set it in your .env file.");
    process.exit(1);
}

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 16;

async function encrypt(data) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const salt = crypto.randomBytes(SALT_LENGTH);
    
    const key = crypto.pbkdf2Sync(
        WALLET_ENCRYPTION_KEY,
        salt,
        100000,
        32,
        'sha256'
    );
    
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    // We join all parts into a single string for easier database storage.
    return `${salt.toString('hex')}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

async function decrypt(encryptedData) {
    try {
        // This is the V1 logic for handling string-based keys from the old data.
        if (typeof encryptedData === 'string' && !encryptedData.includes(':')) {
            const decipher = crypto.createDecipheriv(ALGORITHM, WALLET_ENCRYPTION_KEY, Buffer.alloc(16, 0)); // Old IV
            let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        }

        // This is the V2 logic for handling the new, more secure format.
        const parts = encryptedData.split(':');
        if (parts.length !== 4) throw new Error("Invalid encrypted data format.");
        
        const [saltHex, ivHex, authTagHex, encryptedHex] = parts;
        const salt = Buffer.from(saltHex, 'hex');
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        const encrypted = encryptedHex;

        const key = crypto.pbkdf2Sync(WALLET_ENCRYPTION_KEY, salt, 100000, 32, 'sha256');
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);
        
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
    } catch (error) {
        console.error("Decryption failed. This can happen with old wallet formats or a wrong key.", error.message);
        throw new Error("Failed to decrypt wallet. Check your WALLET_ENCRYPTION_KEY.");
    }
}

module.exports = {
    encrypt,
    decrypt
};
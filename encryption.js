import crypto from 'crypto';
import dotenv from 'dotenv';

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
    
    return {
        encrypted,
        iv: iv.toString('hex'),
        salt: salt.toString('hex'),
        authTag: authTag.toString('hex')
    };
}

async function decrypt(encryptedData) {
    const { encrypted, iv, salt, authTag } = encryptedData;
    
    const key = crypto.pbkdf2Sync(
        WALLET_ENCRYPTION_KEY,
        Buffer.from(salt, 'hex'),
        100000,
        32,
        'sha256'
    );
    
    const decipher = crypto.createDecipheriv(
        ALGORITHM,
        key,
        Buffer.from(iv, 'hex')
    );
    
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
}

export { encrypt, decrypt };
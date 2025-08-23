// utils.js

import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import BN from 'bn.js';
import { PublicKey } from '@solana/web3.js';

// Type definitions as JSDoc (no TypeScript interfaces)
export const SellBaseInputResult = {
    uiQuote: null,
    minQuote: null,
    internalQuoteAmountOut: null,
};

export const SellQuoteInputResult = {
    internalRawQuote: null,
    base: null,
    minQuote: null,
};

/**
 * Shortens a Solana address for display purposes
 * @param {string} address - The full address to shorten
 * @param {number} [chars=4] - Number of characters to keep at start/end
 * @returns {string} Shortened address (first chars + ... + last chars)
 */
export function shortenAddress(address, chars = 4) {
    if (!address || typeof address !== 'string' || address.length < chars * 2 + 3) {
        return address || '';
    }
    return `${address.substring(0, chars)}...${address.substring(address.length - chars)}`;
}

/**
 * Formats raw token amount considering decimals
 * @param {number|string|BN} amount - Raw token amount
 * @param {number} decimals - Token decimals
 * @returns {string} Formatted amount string
 */
export function formatTokenAmount(amount, decimals) {
    const numAmount = typeof amount === 'object' && amount.toNumber ? 
        amount.toNumber() : 
        Number(amount);

    if (isNaN(numAmount)) return '0';

    const adjustedDecimals = decimals > 6 ? 6 : decimals;
    return (numAmount / Math.pow(10, decimals)).toFixed(adjustedDecimals);
}

/**
 * Escapes characters for Telegram MarkdownV2.
 * @param {string|number|null|undefined} textInput - The text to escape.
 * @returns {string} - Escaped text.
 */
export function escapeMarkdownV2(textInput) {
    if (textInput == null) return '';
    const text = String(textInput);
    
    // Use a simple and reliable approach - escape each character individually
    let escaped = text;
    
    // Escape backslashes first
    escaped = escaped.replace(/\\/g, '\\\\');
    
    // Escape all special characters that need escaping in MarkdownV2
    // Using a simple string replacement approach to avoid regex issues
    // Note: We don't escape '.' to avoid issues with decimal numbers
    // Note: We don't escape '=' to avoid issues with separator lines
    // Note: We don't escape '-' to avoid issues with negative numbers
    // Note: We don't escape '!' to avoid issues with exclamation marks
    // Note: We don't escape '•' to avoid issues with bullet points
    const specialChars = ['_', '*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '|', '{', '}'];
    for (const char of specialChars) {
        escaped = escaped.split(char).join(`\\${char}`);
    }
    
    return escaped;
}

/**
 * Safe version of escapeMarkdownV2 that handles edge cases and provides fallback
 * @param {string|number|null|undefined} textInput - The text to escape.
 * @returns {string} - Escaped text or fallback.
 */
export function safeEscapeMarkdownV2(textInput) {
    try {
        return escapeMarkdownV2(textInput);
    } catch (error) {
        console.warn('escapeMarkdownV2 failed, using fallback:', error.message);
        // Fallback: remove all special characters that could cause issues
        // Note: We don't remove '.' to preserve decimal numbers
        // Note: We don't remove '=' to preserve separator lines
        // Note: We don't remove '-' to preserve negative numbers
        // Note: We don't remove '!' to preserve exclamation marks
        const text = String(textInput || '');
        return text.replace(/[_*[\]()~`>#+|{}\\]/g, '');
    }
}

/**
 * Creates user-friendly messages without Markdown formatting
 * @param {string} text - The text to format
 * @returns {string} - User-friendly formatted text
 */
export function createUserFriendlyMessage(text) {
    if (!text) return '';
    
    // Remove Markdown formatting and make it readable
    return text
        .replace(/\*([^*]+)\*/g, '$1') // Remove bold
        .replace(/_([^_]+)_/g, '$1')   // Remove italic
        .replace(/`([^`]+)`/g, '$1')   // Remove code
        .replace(/\\/g, '')            // Remove escape characters
        .replace(/\n+/g, '\n')         // Normalize line breaks
        .replace(/\s+/g, ' ')          // Normalize whitespace
        .trim();
}

/**
 * Creates a safe MarkdownV2 message by building it piece by piece
 * @param {string[]} parts - Array of text parts to combine
 * @returns {string} - Safely formatted MarkdownV2 message
 */
export function createSafeMarkdownMessage(parts) {
    if (!Array.isArray(parts)) return '';
    
    return parts.map(part => {
        if (typeof part === 'string') {
            return escapeMarkdownV2(part);
        }
        return part;
    }).join('');
}

/**
 * Gets a user-friendly greeting based on user information
 * @param {Object} user - Telegram user object
 * @returns {string} - Greeting message
 */
export function getUserGreeting(user) {
    if (!user) return 'Welcome!';
    
    // Try to get first name, then username, then fallback
    const firstName = user.first_name || user.username || 'Trader';
    const greeting = `Hello ${firstName}! 👋`;
    
    return greeting;
}

/**
 * Pauses execution for a specified number of milliseconds.
 * @param {number} ms - Milliseconds to sleep.
 * @returns {Promise<void>}
 */
export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Formats a generic number with commas and specified decimal places.
 * @param {number | string} numberInput - Number to format.
 * @param {number} [decimals] - Optional number of decimal places. Defaults dynamically.
 * @returns {string} - Formatted number string or 'N/A'.
 */
export function formatNumber(numberInput, decimals) {
    const number = typeof numberInput === 'string' ? parseFloat(numberInput) : Number(numberInput);
    if (isNaN(number)) return 'N/A';

    let effectiveDecimals = decimals;
    if (typeof effectiveDecimals !== 'number' || isNaN(effectiveDecimals) || effectiveDecimals < 0) {
        if (Math.abs(number) >= 1000) effectiveDecimals = 2;
        else if (Math.abs(number) >= 1) effectiveDecimals = 4;
        else if (Math.abs(number) > 0.000001) effectiveDecimals = 6;
        else effectiveDecimals = 2;
    }
    if (Math.abs(number) > 0 && Math.abs(number) < 0.000001) {
        return number.toExponential(Math.min(4, effectiveDecimals));
    }
    return number.toLocaleString('en-US', {
        minimumFractionDigits: effectiveDecimals,
        maximumFractionDigits: effectiveDecimals
    });
}

/**
 * Formats a price and escapes for MarkdownV2.
 * @param {number | string} priceInput - The price to format.
 * @param {number} [precision=8] - Desired precision.
 * @returns {string} - Formatted and escaped price string or escaped 'N/A'.
 */
export function formatAndEscapePrice(priceInput, precision = 8) {
    const price = typeof priceInput === 'string' ? parseFloat(priceInput) : Number(priceInput);
    if (isNaN(price)) return escapeMarkdownV2('N/A');
    let formattedPrice;
    if (price === 0) {
        formattedPrice = (0).toFixed(Math.max(2, precision));
    } else if (Math.abs(price) > 0 && (Math.abs(price) < 0.000001 || Math.abs(price) >= 1e12)) {
        formattedPrice = price.toExponential(Math.max(1, precision - 2));
    } else {
        let decimalPlaces;
        if (Math.abs(price) >= 1000) decimalPlaces = 2;
        else if (Math.abs(price) >= 1) decimalPlaces = Math.min(6, precision);
        else decimalPlaces = Math.min(8, precision);
        formattedPrice = price.toFixed(decimalPlaces);
    }
    return escapeMarkdownV2(formattedPrice);
}

/**
 * Formats lamports to SOL string and escapes for MarkdownV2.
 * @param {number | string | {toNumber: () => number}} lamportsInput - Lamports.
 * @param {number} [precision=6] - SOL decimal places.
 * @returns {string} - Formatted SOL string.
 */
export function formatLamports(lamportsInput, precision = 6) {
    let lamports;
    if (typeof lamportsInput === 'object' && lamportsInput && typeof lamportsInput.toNumber === 'function') {
        lamports = lamportsInput.toNumber();
    } else {
        lamports = Number(lamportsInput);
    }
    if (isNaN(lamports)) return escapeMarkdownV2('N/A');
    const solValue = lamports / LAMPORTS_PER_SOL;
    return escapeMarkdownV2(solValue.toFixed(precision));
}

/**
 * Formats raw token amount to display string with decimals and escapes for MarkdownV2.
 * @param {number | string | {toNumber: () => number}} tokenAmountInput - Raw token amount.
 * @param {number} [decimals=6] - Token's decimal places.
 * @param {number} [displayPrecision=4] - Display precision for formatted string.
 * @returns {string} - Formatted token amount string.
 */
export function formatToken(tokenAmountInput, decimals = 6, displayPrecision = 4) {
    let tokenAmount;
    if (typeof tokenAmountInput === 'object' && tokenAmountInput && typeof tokenAmountInput.toNumber === 'function') {
        tokenAmount = tokenAmountInput.toNumber();
    } else {
        tokenAmount = Number(tokenAmountInput);
    }
    if (isNaN(tokenAmount) || typeof decimals !== 'number' || isNaN(decimals) || decimals < 0) {
        return escapeMarkdownV2('N/A');
    }
    const displayValue = tokenAmount / Math.pow(10, decimals);
    return escapeMarkdownV2(displayValue.toLocaleString('en-US', {
        minimumFractionDigits: Math.min(2, displayPrecision),
        maximumFractionDigits: displayPrecision
    }));
}

/**
 * Formats SOL amount string and escapes for MarkdownV2.
 * @param {number | string} amountInput - SOL amount.
 * @param {number} [precision=6] - Decimal places.
 * @returns {string}
 */
export function formatSol(amountInput, precision = 6) {
    const amount = typeof amountInput === 'string' ? parseFloat(amountInput) : Number(amountInput);
    if (isNaN(amount)) return escapeMarkdownV2('N/A');
    return escapeMarkdownV2(amount.toFixed(precision));
}

/**
 * Formats a price (DOES NOT ESCAPE). Use formatAndEscapePrice for display.
 * @param {number | string} priceInput - Price.
 * @param {number} [precision=8] - Precision.
 * @returns {string} - Formatted price.
 */
export function formatPrice(priceInput, precision = 8) {
    const price = typeof priceInput === 'string' ? parseFloat(priceInput) : Number(priceInput);
    if (isNaN(price)) return 'N/A';
    if (price === 0) {
        return (0).toFixed(Math.max(2, precision));
    } else if (Math.abs(price) > 0 && (Math.abs(price) < 0.000001 || Math.abs(price) >= 1e12)) {
        return price.toExponential(Math.max(1, precision - 2));
    } else {
        let decimalPlaces;
        if (Math.abs(price) >= 1000) decimalPlaces = 2;
        else if (Math.abs(price) >= 1) decimalPlaces = Math.min(6, precision);
        else decimalPlaces = Math.min(8, precision);
        return price.toFixed(decimalPlaces);
    }
}

/**
 * Helper function to calculate fees.
 * @param {BN} amount - Amount to apply fee on.
 * @param {BN} feeBps - Fee in basis points (1 bp = 0.01%).
 * @returns {BN} - Fee amount.
 */
export function fee(amount, feeBps) {
    return amount.mul(feeBps).div(new BN(10000));
}

/**
 * Helper function to perform ceiling division.
 * @param {BN} a - Dividend.
 * @param {BN} b - Divisor.
 * @returns {BN} - Ceiling of a/b.
 */
export function ceilDiv(a, b) {
    const div = a.div(b);
    const rem = a.mod(b);
    return rem.isZero() ? div : div.add(new BN(1));
}

/**
 * Calculates the output quote for a sell transaction based on input base amount.
 * @param {BN} base - Amount of base tokens to sell.
 * @param {number} slippage - Slippage tolerance in percentage (e.g., 1 for 1%).
 * @param {BN} baseReserve - Base token reserve.
 * @param {BN} quoteReserve - Quote token reserve.
 * @param {BN} lpFeeBps - Liquidity provider fee in basis points.
 * @param {BN} protocolFeeBps - Protocol fee in basis points.
 * @param {BN} coinCreatorFeeBps - Coin creator fee in basis points.
 * @param {PublicKey} coinCreator - Coin creator's public key.
 * @returns {Object} - Result containing uiQuote, minQuote, and internalQuoteAmountOut.
 */
export function sellBaseInputInternal(base, slippage, baseReserve, quoteReserve, lpFeeBps, protocolFeeBps, coinCreatorFeeBps, coinCreator) {
    // 1) Basic validations
    if (baseReserve.isZero() || quoteReserve.isZero()) {
        throw new Error("Invalid input: 'baseReserve' or 'quoteReserve' cannot be zero.");
    }

    // 2) Calculate the raw quote output (no fees)
    const quoteAmountOut = quoteReserve.mul(base).div(baseReserve.add(base));

    // 3) Calculate fees
    const lpFee = fee(quoteAmountOut, lpFeeBps);
    const protocolFee = fee(quoteAmountOut, protocolFeeBps);
    const coinCreatorFee = PublicKey.default.equals(coinCreator)
        ? new BN(0)
        : fee(quoteAmountOut, coinCreatorFeeBps);

    const finalQuote = quoteAmountOut
        .sub(lpFee)
        .sub(protocolFee)
        .sub(coinCreatorFee);
    if (finalQuote.isNeg()) {
        throw new Error("Fees exceed total output; final quote is negative.");
    }

    // 4) Calculate minQuote with slippage
    const precision = new BN(1_000_000_000);
    const slippageFactorFloat = (1 - slippage / 100) * 1_000_000_000;
    const slippageFactor = new BN(Math.floor(slippageFactorFloat));

    const minQuote = finalQuote.mul(slippageFactor).div(precision);

    return {
        uiQuote: finalQuote,
        minQuote,
        internalQuoteAmountOut: quoteAmountOut,
    };
}

/** Basic address sanitization and validation using PublicKey. */
export function sanitizeAddress(address) {
    if (!address || typeof address !== 'string') return null;
    const trimmed = address.trim();
    try {
        new PublicKey(trimmed); // If this doesn't throw, format is generally okay
        if (trimmed.length >= 32 && trimmed.length <= 44) {
            return trimmed;
        } else {
            return null;
        }
    } catch (error) {
        return null;
    }
}
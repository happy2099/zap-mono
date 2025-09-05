// File: utils.js (CORRECTED for CommonJS)

const { LAMPORTS_PER_SOL, PublicKey } = require('@solana/web3.js');
const BN = require('bn.js');

// ALL 'export function' becomes 'function'
// ALL 'export const' becomes 'const'

const SellBaseInputResult = {
    uiQuote: null,
    minQuote: null,
    internalQuoteAmountOut: null,
};

const SellQuoteInputResult = {
    internalRawQuote: null,
    base: null,
    minQuote: null,
};

function shortenAddress(address, chars = 4) {
    if (!address || typeof address !== 'string' || address.length < chars * 2 + 3) {
        return address || '';
    }
    return `${address.substring(0, chars)}...${address.substring(address.length - chars)}`;
}

function formatTokenAmount(amount, decimals) {
    const numAmount = typeof amount === 'object' && amount.toNumber ?
        amount.toNumber() :
        Number(amount);

    if (isNaN(numAmount)) return '0';

    const adjustedDecimals = decimals > 6 ? 6 : decimals;
    return (numAmount / Math.pow(10, decimals)).toFixed(adjustedDecimals);
}

function escapeMarkdownV2(textInput) {
    if (textInput == null) return '';
    const text = String(textInput);
    // Include hyphen (-) at the end to avoid range interpretation in regex
    const escapeCharsRegex = /[_*[\]()~`>#+=|{}.!-]/g;
    return text
        .replace(/\\/g, '\\\\')
        .replace(escapeCharsRegex, (match) => `\\${match}`);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function formatNumber(numberInput, decimals) {
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

function formatAndEscapePrice(priceInput, precision = 8) {
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

function formatLamports(lamportsInput, precision = 6) {
    let lamports;
    if (typeof lamportsInput === 'object' && lamportsInput && typeof lamportsInput.toNumber === 'function') {
        lamports = lamportsInput.toNumber();
    } else {
        lamports = Number(lamportsInput);
    }
    if (isNaN(lamports)) return escapeMarkdownV2('N/A');
    const solValue = lamports / config.LAMPORTS_PER_SOL_CONST;
    return escapeMarkdownV2(solValue.toFixed(precision));
}

function formatToken(tokenAmountInput, decimals = 6, displayPrecision = 4) {
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

function formatSol(amountInput, precision = 6) {
    const amount = typeof amountInput === 'string' ? parseFloat(amountInput) : Number(amountInput);
    if (isNaN(amount)) return escapeMarkdownV2('N/A');
    return escapeMarkdownV2(amount.toFixed(precision));
}

function formatPrice(priceInput, precision = 8) {
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

function fee(amount, feeBps) {
    return amount.mul(feeBps).div(new BN(10000));
}

function ceilDiv(a, b) {
    const div = a.div(b);
    const rem = a.mod(b);
    return rem.isZero() ? div : div.add(new BN(1));
}

function sellBaseInputInternal(base, slippage, baseReserve, quoteReserve, lpFeeBps, protocolFeeBps, coinCreatorFeeBps, coinCreator) {
    if (baseReserve.isZero() || quoteReserve.isZero()) {
        throw new Error("Invalid input: 'baseReserve' or 'quoteReserve' cannot be zero.");
    }
    const quoteAmountOut = quoteReserve.mul(base).div(baseReserve.add(base));
    const lpFee = fee(quoteAmountOut, lpFeeBps);
    const protocolFee = fee(quoteAmountOut, protocolFeeBps);
    const coinCreatorFee = PublicKey.default.equals(coinCreator)
        ? new BN(0)
        : fee(quoteAmountOut, coinCreatorFeeBps);
    const finalQuote = quoteAmountOut.sub(lpFee).sub(protocolFee).sub(coinCreatorFee);
    if (finalQuote.isNeg()) {
        throw new Error("Fees exceed total output; final quote is negative.");
    }
    const precision = new BN(1_000_000_000);
    const slippageFactorFloat = (1 - slippage / 100) * 1_000_000_000;
    const slippageFactor = new BN(Math.floor(slippageFactorFloat));
    const minQuote = finalQuote.mul(slippageFactor).div(precision);
    return { uiQuote: finalQuote, minQuote, internalQuoteAmountOut: quoteAmountOut };
}

function sanitizeAddress(address) {
    if (!address || typeof address !== 'string') return null;
    const trimmed = address.trim();
    try {
        new PublicKey(trimmed);
        if (trimmed.length >= 32 && trimmed.length <= 44) {
            return trimmed;
        } else {
            return null;
        }
    } catch (error) {
        return null;
    }
}

// EXPORT ALL FUNCTIONS AND CONSTS AT THE END
module.exports = {
    SellBaseInputResult,
    SellQuoteInputResult,
    shortenAddress,
    formatTokenAmount,
    escapeMarkdownV2,
    sleep,
    formatNumber,
    formatAndEscapePrice,
    formatLamports,
    formatToken,
    formatSol,
    formatPrice,
    fee,
    ceilDiv,
    sellBaseInputInternal,
    sanitizeAddress
};
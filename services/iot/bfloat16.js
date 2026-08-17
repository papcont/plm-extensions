// bfloat16 = the top 16 bits of an IEEE-754 float32 (1 sign, 8 exponent, 7 mantissa).
// This is exactly what the official Netvox R718E codec decodes (it calls it "float32Process").
// See docs/features/iot-condition-monitoring/netvox-r718e-spec.md.

// Decode a 16-bit word to a Number. Ported verbatim from the Netvox codec math.
function decode(h) {
    const sign = (h & 0x8000) >> 15;
    const exp  = (h & 0x7F80) >> 7;
    const frac = (h & 0x007F) << 16;
    if (exp === 0)    return (sign ? -1 : 1) * Math.pow(2, -126) * (frac / Math.pow(2, 23));
    if (exp === 0xFF) return frac ? NaN : (sign ? -1 : 1) * Infinity;
    return (sign ? -1 : 1) * Math.pow(2, exp - 127) * (1 + frac / Math.pow(2, 23));
}

// Encode a Number to a 16-bit bfloat word: write as float32, keep the high 16 bits.
// Truncation (not round-to-nearest) so decode(encode(x)) matches the codec's own decode.
// ponytail: truncation, switch to round-to-nearest-even only if a fixture ever needs it.
function encode(value) {
    const buf = Buffer.alloc(4);
    buf.writeFloatBE(value, 0);
    return (buf[0] << 8) | buf[1];
}

module.exports = { decode, encode };

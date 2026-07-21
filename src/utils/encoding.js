// Text decoding with Korean-legacy awareness.
//
// Korean .txt / .csv files are frequently CP949 / EUC-KR, not UTF-8. Browsers
// ship a native 'euc-kr' decoder, so we try UTF-8 first (strict) and fall back
// to EUC-KR when UTF-8 fails or looks wrong.

export function decodeText(bytes) {
  // Honour a UTF BOM if present.
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8' };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be' };
  }

  // Strict UTF-8: if it throws, the bytes aren't valid UTF-8.
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { text, encoding: 'utf-8' };
  } catch {
    /* not utf-8 */
  }

  try {
    const text = new TextDecoder('euc-kr').decode(bytes);
    return { text, encoding: 'euc-kr' };
  } catch {
    // Last resort: lenient UTF-8 (replacement chars rather than an exception).
    return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'utf-8?' };
  }
}

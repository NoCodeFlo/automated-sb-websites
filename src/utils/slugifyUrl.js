// src/utils/slugifyUrl.js
import { URL } from 'url';

/**
 * Converts a full URL into a filesystem-safe slug.
 * Example: "https://lichtweg.li/" -> "lichtweg_li"
 *
 * @param {string} rawUrl - A full URL string (e.g., "https://example.com").
 * @returns {string} - A slugified domain name (e.g., "example_com").
 */
export function slugifyUrl(rawUrl) {
  try {
    const hostname = new URL(rawUrl).hostname;
    return hostname.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  } catch (err) {
    throw new Error(`Invalid URL passed to slugifyUrl: "${rawUrl}"`);
  }
}
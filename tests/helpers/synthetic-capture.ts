import { writeFileSync } from "node:fs";

const SYNTHETIC_CAPTURE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640">
  <rect width="960" height="640" fill="#f7f8f5"/>
  <rect x="48" y="48" width="864" height="72" rx="16" fill="#17242d"/>
  <circle cx="88" cy="84" r="16" fill="#d9ff57"/>
  <rect x="48" y="160" width="264" height="392" rx="20" fill="#d9ff57"/>
  <rect x="336" y="160" width="264" height="188" rx="20" fill="#b7d8d2"/>
  <rect x="624" y="160" width="288" height="188" rx="20" fill="#ef8354"/>
  <rect x="336" y="372" width="576" height="180" rx="20" fill="#dfe5e8"/>
  <path d="M384 420h480M384 456h352M384 492h416" stroke="#17242d" stroke-width="12" stroke-linecap="round"/>
  <path d="M96 224h168M96 264h120M96 304h144" stroke="#17242d" stroke-width="12" stroke-linecap="round"/>
</svg>
`;

/**
 * Writes a deterministic, project-owned image fixture with no third-party
 * photography, product marks, or external fonts.
 */
export function writeSyntheticCapture(filePath: string): void {
  writeFileSync(filePath, SYNTHETIC_CAPTURE_SVG, "utf8");
}

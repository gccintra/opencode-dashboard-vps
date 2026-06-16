// ALF code icon generator.
//
// ┌────────────────────────────────────────────────────────────┐
// │  TOGGLE THE ICON HERE — change to 'green' or 'dark', then    │
// │  run `bun run icons`. Regenerates favicon + all PWA icons.   │
// └────────────────────────────────────────────────────────────┘
const VARIANT = 'green'; // 'green' | 'dark'

import { Resvg } from '@resvg/resvg-js';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

// Shared alien geometry (24-unit space, scaled into the 192 squircle).
const ALIEN = `
  <g transform="translate(32 32) scale(5.333)">
    <path
      d="M12 2.5c4.2 0 6.8 3 6.8 6.9 0 3-1.6 5-3.2 6.5-1.1 1-1.7 1.9-1.7 3.2 0 1.5-.8 2.4-1.9 2.4s-1.9-.9-1.9-2.4c0-1.3-.6-2.2-1.7-3.2C6.8 14.4 5.2 12.4 5.2 9.4 5.2 5.5 7.8 2.5 12 2.5Z"
      fill="HEAD"/>
    <ellipse cx="9.4" cy="9.6" rx="1.7" ry="2.6" transform="rotate(18 9.4 9.6)" fill="EYES"/>
    <ellipse cx="14.6" cy="9.6" rx="1.7" ry="2.6" transform="rotate(-18 14.6 9.6)" fill="EYES"/>
  </g>`;

const alien = (head, eyes) => ALIEN.replace('HEAD', head).replaceAll('EYES', eyes);

// Flat, high-contrast lime tile (original brand mark).
const green = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192" width="192" height="192">
  <rect width="192" height="192" rx="40" fill="#b3e502"/>
  ${alien('#0a0a0f', '#b3e502')}
</svg>
`;

// Monochrome dark "mech" tile — matches the macOS dark-mode dock treatment:
// vertical depth gradient, top rim light, soft glass sheen, and an alien
// embossed into the surface purely with shadow + highlight. NO color at all,
// only shades of black and grey.
const dark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192" width="192" height="192">
  <defs>
    <linearGradient id="surface" x1="96" y1="0" x2="96" y2="192" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#2a2a30"/>
      <stop offset="0.45" stop-color="#101015"/>
      <stop offset="1" stop-color="#040406"/>
    </linearGradient>
    <radialGradient id="sheen" cx="60" cy="34" r="150" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.14"/>
      <stop offset="0.4" stop-color="#ffffff" stop-opacity="0.03"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="rim" x1="96" y1="0" x2="96" y2="60" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.28"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <!-- raised grey body: lighter at top, darker at base -->
    <linearGradient id="mech" x1="96" y1="20" x2="96" y2="150" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#52525c"/>
      <stop offset="0.5" stop-color="#303036"/>
      <stop offset="1" stop-color="#1a1a1f"/>
    </linearGradient>
    <!-- bottom drop shadow lifts the alien off the surface -->
    <filter id="lift" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="0" dy="2.5" stdDeviation="3" flood-color="#000000" flood-opacity="0.7"/>
    </filter>
    <!-- top inner highlight on the alien body for the bevel -->
    <filter id="bevel" x="-30%" y="-30%" width="160%" height="160%">
      <feOffset dx="0" dy="-1.2" result="o"/>
      <feGaussianBlur in="o" stdDeviation="0.6" result="b"/>
      <feComposite in="b" in2="SourceAlpha" operator="out" result="hi"/>
      <feFlood flood-color="#ffffff" flood-opacity="0.5"/>
      <feComposite in2="hi" operator="in"/>
    </filter>
  </defs>

  <rect width="192" height="192" rx="40" fill="url(#surface)"/>
  <rect width="192" height="192" rx="40" fill="url(#sheen)"/>

  <!-- raised alien body (grey gradient) + drop shadow -->
  <g filter="url(#lift)">
    ${alien('url(#mech)', '#0c0c10')}
  </g>
  <!-- top bevel highlight on the alien outline -->
  <g filter="url(#bevel)">
    ${alien('#000000', '#000000')}
  </g>

  <!-- top rim light + inset edge for the glass bevel -->
  <rect x="0.75" y="0.75" width="190.5" height="190.5" rx="39.25" fill="none" stroke="url(#rim)" stroke-width="1.5"/>
  <rect x="2.5" y="2.5" width="187" height="187" rx="37.5" fill="none" stroke="#000000" stroke-opacity="0.5" stroke-width="1"/>
</svg>
`;

const svg = VARIANT === 'dark' ? dark : green;

// 1. Favicon (SVG, referenced by index.html).
writeFileSync(join(publicDir, 'icon.svg'), svg);

// 2. PWA / apple-touch PNGs at the sizes the manifest expects.
for (const size of [192, 512]) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } })
    .render()
    .asPng();
  writeFileSync(join(publicDir, `icon-${size}.png`), png);
}

console.log(`icons regenerated → variant: ${VARIANT}`);

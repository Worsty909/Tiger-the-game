import { makeCanvas, rng } from './ProcTextures';

/**
 * Kreslené 2D podklady (canvas): lístečky, kalendář, fotky, průkaz, displej, etikety.
 * Používají se jako textury ve scéně i jako obrázky v deníku / při čtení.
 */

const HAND = `'Segoe Script', 'Bradley Hand', 'Brush Script MT', 'Comic Sans MS', cursive`;
const SANS = `'Segoe UI', 'Helvetica Neue', Arial, sans-serif`;

function paper(g: CanvasRenderingContext2D, w: number, h: number, base: string, seed: number, speck = 0.05): void {
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  const R = rng(seed);
  for (let i = 0; i < w * h * 0.004; i++) {
    g.fillStyle = `rgba(90,70,40,${R() * speck})`;
    g.fillRect(R() * w, R() * h, 1 + R() * 2, 1 + R() * 2);
  }
  const grad = g.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(0,0,0,0.07)');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
}

function wrapText(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number): number {
  const words = text.split(' ');
  let line = '';
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (g.measureText(test).width > maxW && line) {
      g.fillText(line, x, y);
      y += lineH;
      line = word;
    } else line = test;
  }
  if (line) g.fillText(line, x, y);
  return y + lineH;
}

/** Lísteček z lednice. */
export function noteFridge(): HTMLCanvasElement {
  const [c, g] = makeCanvas(512, 400);
  paper(g, 512, 400, '#fff3a6', 1);
  g.fillStyle = '#1d2a55';
  g.font = `34px ${HAND}`;
  g.save();
  g.translate(256, 200);
  g.rotate(-0.03);
  g.textAlign = 'center';
  let y = -110;
  y = wrapText(g, 'Kód ke skříňce s pamlsky?', 0, y, 430, 50);
  y = wrapText(g, 'Tigerovy narozeniny 😉', 0, y + 14, 430, 50);
  g.font = `30px ${HAND}`;
  wrapText(g, '(DD MM)', 0, y + 18, 430, 44);
  g.font = `22px ${HAND}`;
  g.fillStyle = '#35406e';
  g.fillText('– J.', 150, 150);
  g.restore();
  return c;
}

/** Nástěnný kalendář, červenec, zakroužkované 22. */
export function calendar(): HTMLCanvasElement {
  const [c, g] = makeCanvas(512, 720);
  paper(g, 512, 720, '#fbfaf5', 2, 0.03);
  // horní obrázek
  const sky = g.createLinearGradient(0, 0, 0, 250);
  sky.addColorStop(0, '#f6c66c');
  sky.addColorStop(1, '#e58a5a');
  g.fillStyle = sky;
  g.fillRect(0, 0, 512, 250);
  g.fillStyle = '#7a4a3a';
  g.beginPath();
  g.moveTo(0, 250);
  g.lineTo(120, 150);
  g.lineTo(230, 215);
  g.lineTo(340, 120);
  g.lineTo(512, 230);
  g.lineTo(512, 250);
  g.fill();
  g.fillStyle = '#fff6dc';
  g.beginPath();
  g.arc(390, 80, 36, 0, Math.PI * 2);
  g.fill();
  // spirála
  g.fillStyle = '#b9b9b9';
  for (let i = 0; i < 16; i++) g.fillRect(22 + i * 31, 244, 8, 16);
  g.fillStyle = '#b3261e';
  g.font = `bold 44px ${SANS}`;
  g.textAlign = 'center';
  g.fillText('ČERVENEC', 256, 320);
  g.font = `bold 18px ${SANS}`;
  const days = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'];
  const x0 = 46;
  const cw = 60;
  days.forEach((d, i) => {
    g.fillStyle = i > 4 ? '#b3261e' : '#555';
    g.fillText(d, x0 + i * cw + 30, 362);
  });
  g.font = `24px ${SANS}`;
  // červenec začíná ve středu (offset 2)
  for (let d = 1; d <= 31; d++) {
    const idx = d - 1 + 2;
    const col = idx % 7;
    const row = Math.floor(idx / 7);
    const x = x0 + col * cw + 30;
    const y = 404 + row * 54;
    g.fillStyle = col > 4 ? '#b3261e' : '#222';
    g.fillText(String(d), x, y);
    if (d === 22) {
      g.strokeStyle = '#c62828';
      g.lineWidth = 4;
      g.beginPath();
      g.ellipse(x, y - 8, 26, 22, -0.15, 0.2, Math.PI * 2.1);
      g.stroke();
    }
  }
  g.fillStyle = '#c62828';
  g.font = `24px ${HAND}`;
  g.save();
  g.translate(330, 690);
  g.rotate(-0.05);
  g.fillText('Tomáš – narozky! 🎂', 0, 0);
  g.restore();
  // šipka k datu
  g.strokeStyle = '#c62828';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(300, 665);
  g.quadraticCurveTo(250, 640, 240, 600);
  g.stroke();
  return c;
}

/** Svatební fotka. */
export function weddingPhoto(): HTMLCanvasElement {
  const [c, g] = makeCanvas(512, 640);
  // pozadí – rozostřený park
  const bg = g.createLinearGradient(0, 0, 0, 640);
  bg.addColorStop(0, '#cfe3c2');
  bg.addColorStop(0.6, '#9fc08e');
  bg.addColorStop(1, '#6f9a66');
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 640);
  const R = rng(7);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(255,255,230,${0.08 + R() * 0.14})`;
    g.beginPath();
    g.arc(R() * 512, R() * 360, 14 + R() * 30, 0, Math.PI * 2);
    g.fill();
  }
  // ženich
  g.fillStyle = '#2a2f3d';
  g.beginPath();
  g.roundRect(270, 250, 150, 330, 40);
  g.fill();
  g.fillStyle = '#e8c3a4';
  g.beginPath();
  g.arc(345, 205, 46, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#4a3324';
  g.beginPath();
  g.arc(345, 188, 46, Math.PI, 0);
  g.fill();
  g.fillStyle = '#f4f4f0';
  g.beginPath();
  g.moveTo(330, 255);
  g.lineTo(345, 330);
  g.lineTo(360, 255);
  g.fill();
  // nevěsta
  g.fillStyle = '#fbfaf6';
  g.beginPath();
  g.moveTo(170, 280);
  g.quadraticCurveTo(60, 520, 90, 610);
  g.lineTo(300, 610);
  g.quadraticCurveTo(300, 450, 240, 280);
  g.fill();
  g.fillStyle = '#edc9ab';
  g.beginPath();
  g.arc(205, 225, 42, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#7a4a2a';
  g.beginPath();
  g.arc(205, 210, 44, Math.PI * 0.95, Math.PI * 2.05);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.75)';
  g.beginPath();
  g.moveTo(170, 190);
  g.quadraticCurveTo(110, 330, 140, 430);
  g.lineTo(190, 260);
  g.fill();
  // kytice
  for (let i = 0; i < 12; i++) {
    g.fillStyle = ['#e96a7f', '#f4b6c0', '#fff', '#f2d16b'][i % 4];
    g.beginPath();
    g.arc(250 + Math.cos(i) * 22, 380 + Math.sin(i * 1.7) * 18, 12, 0, Math.PI * 2);
    g.fill();
  }
  // bílý okraj a popisek
  g.fillStyle = '#fbfaf5';
  g.fillRect(0, 560, 512, 80);
  g.strokeStyle = '#fbfaf5';
  g.lineWidth = 28;
  g.strokeRect(0, 0, 512, 640);
  g.fillStyle = '#3a3a3a';
  g.font = `30px ${HAND}`;
  g.textAlign = 'center';
  g.fillText('Jana & Tomáš, 9. 5. 2019', 256, 608);
  return c;
}

/** Lísteček na televizi. */
export function tvNote(): HTMLCanvasElement {
  const [c, g] = makeCanvas(360, 300);
  paper(g, 360, 300, '#ffd1e0', 3);
  g.fillStyle = '#3a2440';
  g.textAlign = 'center';
  g.font = `34px ${HAND}`;
  g.save();
  g.translate(180, 150);
  g.rotate(0.04);
  g.fillText('PIN k TV:', 0, -30);
  g.font = `bold 58px ${HAND}`;
  g.fillText('2580', 0, 44);
  g.restore();
  return c;
}

/** Očkovací průkaz s kávovou skvrnou přes datum narození. */
export function vaccinationCard(): HTMLCanvasElement {
  const [c, g] = makeCanvas(640, 440);
  paper(g, 640, 440, '#dfeaf2', 4, 0.04);
  g.fillStyle = '#1e4d7a';
  g.fillRect(0, 0, 640, 70);
  g.fillStyle = '#fff';
  g.font = `bold 30px ${SANS}`;
  g.textAlign = 'left';
  g.fillText('OČKOVACÍ PRŮKAZ', 24, 46);
  g.font = `18px ${SANS}`;
  g.textAlign = 'right';
  g.fillText('MVDr. Kocourková', 616, 44);
  g.textAlign = 'left';
  const row = (label: string, value: string, y: number, hand = true) => {
    g.fillStyle = '#51677a';
    g.font = `17px ${SANS}`;
    g.fillText(label, 28, y);
    g.strokeStyle = '#9fb3c4';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(210, y + 6);
    g.lineTo(610, y + 6);
    g.stroke();
    g.fillStyle = '#1c2c66';
    g.font = hand ? `30px ${HAND}` : `24px ${SANS}`;
    g.fillText(value, 220, y);
  };
  row('Jméno:', 'Tiger', 124);
  row('Druh / plemeno:', 'kočka – bengálská', 178);
  row('Pohlaví:', 'kocour', 232);
  row('Datum narození:', '', 290);
  // čitelné jsou jen první číslice dne a měsíce: „1_. 0_.“ – zbytek zalila káva
  g.fillStyle = '#1c2c66';
  g.font = `30px ${HAND}`;
  g.fillText('1', 222, 290);
  g.fillText('.', 274, 290);
  g.fillText('0', 294, 290);
  g.fillText('.', 348, 290);
  row('Číslo čipu:', '203 098 100 441 7', 348, false);
  g.fillStyle = '#51677a';
  g.font = `15px ${SANS}`;
  g.fillText('Vzteklina ✓   Panleukopenie ✓   Rhinotracheitida ✓', 28, 408);
  // kávová skvrna přes druhou číslici dne a měsíce
  const stain = (x: number, y: number, r: number, a: number) => {
    const gr = g.createRadialGradient(x, y, r * 0.2, x, y, r);
    gr.addColorStop(0, `rgba(92,58,28,${a})`);
    gr.addColorStop(0.75, `rgba(98,62,30,${a * 0.92})`);
    gr.addColorStop(0.9, `rgba(70,42,18,${a})`);
    gr.addColorStop(1, 'rgba(92,58,28,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.ellipse(x, y, r, r * 0.82, 0.3, 0, Math.PI * 2);
    g.fill();
  };
  stain(250, 278, 21, 0.97);
  stain(322, 280, 22, 0.97);
  stain(290, 300, 30, 0.35);
  stain(420, 250, 46, 0.22);
  g.strokeStyle = 'rgba(80,50,22,0.4)';
  g.lineWidth = 3;
  g.beginPath();
  g.ellipse(430, 250, 62, 56, 0.2, 0.4, Math.PI * 1.7);
  g.stroke();
  return c;
}

/** Rub fotky koťátka. */
export function kittenBack(): HTMLCanvasElement {
  const [c, g] = makeCanvas(512, 400);
  paper(g, 512, 400, '#f3efe6', 5, 0.035);
  g.fillStyle = 'rgba(0,0,0,0.05)';
  g.font = `14px ${SANS}`;
  for (let y = 40; y < 400; y += 90) for (let x = -20; x < 512; x += 150) g.fillText('FOTO LAB · FOTO LAB', x + ((y / 90) % 2) * 60, y);
  g.fillStyle = '#23305e';
  g.textAlign = 'center';
  g.save();
  g.translate(256, 200);
  g.rotate(-0.04);
  g.font = `44px ${HAND}`;
  g.fillText('Tiger, 4 týdny', 0, -20);
  g.font = `40px ${HAND}`;
  g.fillText('– 11. 4. –', 0, 50);
  g.font = `24px ${HAND}`;
  g.fillStyle = '#c0392b';
  g.fillText('♥', 160, -60);
  g.restore();
  return c;
}

/** Náhradní líc fotky koťátka (když se nepodaří snímek z 3D modelu). */
export function kittenFrontFallback(): HTMLCanvasElement {
  const [c, g] = makeCanvas(512, 400);
  const bg = g.createLinearGradient(0, 0, 0, 400);
  bg.addColorStop(0, '#e9d7bd');
  bg.addColorStop(1, '#b9916a');
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 400);
  // kotě: tělo, hlava, uši
  g.fillStyle = '#c98a48';
  g.beginPath();
  g.ellipse(256, 290, 120, 80, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.arc(256, 180, 78, 0, Math.PI * 2);
  g.fill();
  for (const s of [-1, 1]) {
    g.beginPath();
    g.moveTo(256 + s * 30, 120);
    g.lineTo(256 + s * 78, 70);
    g.lineTo(256 + s * 80, 150);
    g.fill();
  }
  g.fillStyle = '#5a3418';
  const R = rng(11);
  for (let i = 0; i < 26; i++) {
    g.beginPath();
    g.ellipse(160 + R() * 190, 240 + R() * 100, 10 + R() * 8, 7 + R() * 5, R() * 3, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#7fd07a';
  for (const s of [-1, 1]) {
    g.beginPath();
    g.ellipse(256 + s * 30, 175, 15, 17, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#111';
  for (const s of [-1, 1]) {
    g.beginPath();
    g.ellipse(256 + s * 30, 175, 7, 13, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#e59aa0';
  g.beginPath();
  g.moveTo(248, 205);
  g.lineTo(264, 205);
  g.lineTo(256, 215);
  g.fill();
  return c;
}

/** Displej dávkovače. */
export function feederDisplay(text: string, on: boolean): HTMLCanvasElement {
  const [c, g] = makeCanvas(256, 96);
  g.fillStyle = '#0b1408';
  g.fillRect(0, 0, 256, 96);
  if (on) {
    g.fillStyle = '#ff5a3c';
    g.font = `bold 52px 'Courier New', monospace`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = '#ff3a1c';
    g.shadowBlur = 14;
    g.fillText(text, 128, 50);
  }
  return c;
}

/** Sáček pamlsků. */
export function treatBagLabel(): HTMLCanvasElement {
  const [c, g] = makeCanvas(256, 384);
  const bg = g.createLinearGradient(0, 0, 0, 384);
  bg.addColorStop(0, '#f08a24');
  bg.addColorStop(1, '#d9541e');
  g.fillStyle = bg;
  g.fillRect(0, 0, 256, 384);
  g.fillStyle = '#fff7e6';
  g.beginPath();
  g.ellipse(128, 150, 96, 70, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#b3401a';
  g.font = `bold 40px ${SANS}`;
  g.textAlign = 'center';
  g.fillText('MŇAM!', 128, 150);
  g.font = `bold 20px ${SANS}`;
  g.fillText('křupavé pamlsky', 128, 180);
  g.fillStyle = '#fff7e6';
  g.font = `bold 26px ${SANS}`;
  g.fillText('s lososem', 128, 270);
  g.font = `16px ${SANS}`;
  g.fillText('pro kočky · 60 g', 128, 300);
  // tlapka
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.beginPath();
  g.ellipse(128, 345, 14, 11, 0, 0, Math.PI * 2);
  g.fill();
  for (const dx of [-16, -5, 6, 17]) {
    g.beginPath();
    g.arc(128 + dx, 328 - Math.abs(dx) * 0.2, 5, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

/** Etiketa plechovky tuňáka. */
export function tunaLabel(): HTMLCanvasElement {
  const [c, g] = makeCanvas(512, 128);
  g.fillStyle = '#1f6f9c';
  g.fillRect(0, 0, 512, 128);
  g.fillStyle = '#f5e9c8';
  g.fillRect(0, 44, 512, 40);
  g.fillStyle = '#1b3f57';
  g.font = `bold 30px ${SANS}`;
  g.textAlign = 'center';
  g.fillText('TUŇÁK ve vlastní šťávě', 256, 74);
  g.fillStyle = '#f5e9c8';
  g.font = `16px ${SANS}`;
  g.fillText('kousky · 160 g', 256, 112);
  return c;
}

/** Pásek s číslicemi 0–9 pro kolečka zámku (vodorovně, každá číslice 1/10 šířky). */
export function lockDigits(): HTMLCanvasElement {
  const [c, g] = makeCanvas(1024, 128);
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, '#b9bcc0');
  grad.addColorStop(0.5, '#e9eaec');
  grad.addColorStop(1, '#a9acb0');
  g.fillStyle = grad;
  g.fillRect(0, 0, 1024, 128);
  g.fillStyle = '#17181a';
  g.font = `bold 92px ${SANS}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let d = 0; d < 10; d++) {
    g.fillText(String(d), d * 102.4 + 51.2, 68);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(d * 102.4 - 1, 0, 2, 128);
    g.fillStyle = '#17181a';
  }
  return c;
}

/** Zarámovaná fotka – kompozice s bílou paspartou. */
export function matted(photo: HTMLCanvasElement, w = 512, h = 640): HTMLCanvasElement {
  const [c, g] = makeCanvas(w, h);
  g.fillStyle = '#f6f3ea';
  g.fillRect(0, 0, w, h);
  const m = 34;
  g.drawImage(photo, m, m, w - m * 2, h - m * 2);
  g.strokeStyle = 'rgba(0,0,0,0.18)';
  g.lineWidth = 2;
  g.strokeRect(m, m, w - m * 2, h - m * 2);
  return c;
}

"use strict";

// ───────── Internal resolution ─────────
const SW = 480;
const SH = 270;

// ───────── Canvas setup ─────────
const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");

const off = document.createElement("canvas");
off.width = SW;
off.height = SH;
const offCtx = off.getContext("2d");
const img = offCtx.createImageData(SW, SH);
const px = img.data;

function resize() {
    const s = Math.max(1, Math.floor(Math.min(
        window.innerWidth / SW,
        window.innerHeight / SH
    )));
    canvas.width = SW * s;
    canvas.height = SH * s;
    canvas.style.width = canvas.width + "px";
    canvas.style.height = canvas.height + "px";
    ctx.imageSmoothingEnabled = false;
}
resize();
window.addEventListener("resize", resize);

// ───────── Float buffers ─────────
const rBuf = new Float32Array(SW * SH);
const gBuf = new Float32Array(SW * SH);
const bBuf = new Float32Array(SW * SH);

const CX = SW / 2;
const CY = SH / 2;

// ───────── Tone mapping ─────────
const TONE_SIZE = 4096;
const TONE_MAX = 32;
const TONE_MUL = TONE_SIZE / TONE_MAX;
const toneMap = new Uint8Array(TONE_SIZE);
for (let i = 0; i < TONE_SIZE; i++) {
    let v = (i / TONE_SIZE) * TONE_MAX;
    if (v <= 0) { toneMap[i] = 0; continue; }
    v = v / (1 + v);
    v = Math.pow(v, 1 / 2.2);
    const o = Math.floor(v * 255 + 0.5);
    toneMap[i] = o < 0 ? 0 : o > 255 ? 255 : o;
}
function toneFast(v) {
    if (v <= 0) return 0;
    let idx = (v * TONE_MUL) | 0;
    if (idx >= TONE_SIZE) idx = TONE_SIZE - 1;
    return toneMap[idx];
}

// ───────── Buffer ops ─────────
function clearBuf() {
    rBuf.fill(0);
    gBuf.fill(0);
    bBuf.fill(0);
}
function add(x, y, rv, gv, bv) {
    if (x < 0 || y < 0 || x >= SW || y >= SH) return;
    const i = y * SW + x;
    rBuf[i] += rv; gBuf[i] += gv; bBuf[i] += bv;
}
function addSoft(x, y, radius, rv, gv, bv) {
    if (radius <= 0.1) return;
    const x0 = Math.max(0, Math.floor(x - radius));
    const x1 = Math.min(SW - 1, Math.ceil(x + radius));
    const y0 = Math.max(0, Math.floor(y - radius));
    const y1 = Math.min(SH - 1, Math.ceil(y + radius));
    const inv = 1 / (radius * radius);
    for (let yy = y0; yy <= y1; yy++) {
        const dy = yy - y;
        for (let xx = x0; xx <= x1; xx++) {
            const dx = xx - x;
            const d2 = (dx * dx + dy * dy) * inv;
            if (d2 >= 1) continue;
            let w = 1 - d2; w = w * w;
            const i = yy * SW + xx;
            rBuf[i] += rv * w; gBuf[i] += gv * w; bBuf[i] += bv * w;
        }
    }
}
function flush() {
    for (let i = 0; i < SW * SH; i++) {
        const j = i * 4;
        px[j]     = toneFast(rBuf[i]);
        px[j + 1] = toneFast(gBuf[i]);
        px[j + 2] = toneFast(bBuf[i]);
        px[j + 3] = 255;
    }
    offCtx.putImageData(img, 0, 0);
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
}

// ───────── Frame pacing ─────────
function frame(ms = 16) {
    return new Promise(resolve => {
        const t0 = performance.now();
        function step() {
            if (performance.now() - t0 >= ms) resolve();
            else requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
    });
}

// ───────── Math helpers ─────────
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const ease = t => 1 - Math.pow(1 - clamp01(t), 3);
const easeOutBack = t => {
    const c1 = 1.70158, c3 = c1 + 1;
    t = clamp01(t);
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const gauss = (u, c) => { const d = (u - c) / 0.05; return Math.exp(-d * d); };
const heartFunc = (ux, uy) => {
    const a = ux * ux + uy * uy - 1;
    return a * a * a - ux * ux * uy * uy * uy;
};

function drawRing(cx, cy, radius, alpha) {
    if (radius <= 0.5 || alpha <= 0.01) return;
    const steps = Math.max(28, Math.floor(radius * 5));
    for (let i = 0; i < steps; i++) {
        const a = i * 2 * Math.PI / steps;
        const x = cx + Math.cos(a) * radius;
        const y = cy + Math.sin(a) * radius;
        addSoft(x, y, 1.4, alpha * 1.6, alpha * 0.15, alpha * 0.25);
    }
}

// ───────── Heart SDF ─────────
function drawHeart(scale = 1, flash = 0, maxDist = Infinity) {
    const R = Math.min(SW, SH) * 0.40 * scale;
    if (R < 1) return;

    const x0 = Math.max(0, Math.floor(CX - R * 1.5));
    const x1 = Math.min(SW - 1, Math.ceil(CX + R * 1.5));
    const y0 = Math.max(0, Math.floor(CY - R * 1.5));
    const y1 = Math.min(SH - 1, Math.ceil(CY + R * 1.5));

    for (let y = y0; y <= y1; y++) {
        const uy = (CY - y) / R;
        for (let x = x0; x <= x1; x++) {
            const ux = (x - CX) / R;
            const a1 = ux * ux + uy * uy - 1;
            const f = a1 * a1 * a1 - ux * ux * uy * uy * uy;
            const gx = 6 * ux * a1 * a1 - 2 * ux * uy * uy * uy;
            const gy = 6 * uy * a1 * a1 - 3 * ux * ux * uy * uy;
            const gl = Math.sqrt(gx * gx + gy * gy) + 1e-9;
            const dpx = -f / gl * R;

            if (dpx < 0) continue;

            let inside = clamp01(dpx / 1.0);
            if (maxDist < Infinity) {
                const dx = x - CX;
                const dy = y - CY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const fade = clamp01((maxDist - dist) / 6);
                if (fade <= 0) continue;
                inside *= fade;
            }

            const depth = clamp01(-dpx / 14);
            let br = 0.35 + 0.65 * depth;
            let bg = 0.01 + 0.02 * depth;
            let bb = 0.03 + 0.04 * depth;

            const edgeDark = Math.exp(-Math.pow((dpx + 1.5) / 2.2, 2));
            br -= edgeDark * 0.15;

            const rimLight = Math.exp(-Math.pow((dpx + 3.5) / 2.5, 2));
            br += rimLight * 0.55;
            bg += rimLight * 0.10;
            bb += rimLight * 0.15;

            const hx = ux + 0.35;
            const hy = uy - 0.55;
            const spec = Math.exp(-(hx * hx + hy * hy) * 11);
            br += spec * 2.0; bg += spec * 1.4; bb += spec * 1.4;

            const shadow = Math.exp(-(Math.pow((ux - 0.35) / 0.55, 2) +
                                     Math.pow((uy + 0.35) / 0.55, 2)));
            br -= shadow * 0.25 * depth;

            let Rv = br * inside, Gv = bg * inside, Bv = bb * inside;
            if (flash > 0) {
                Rv += flash * inside * 1.8;
                Gv += flash * inside * 0.30;
                Bv += flash * inside * 0.40;
            }
            add(x, y, Rv, Gv, Bv);
        }
    }
}

// ───────── Phase 1: intro ─────────
async function introPhase() {
    const frames = 20;
    for (let f = 0; f < frames; f++) {
        clearBuf();
        const pulse = 1 + 0.5 * Math.sin(f * 0.7);
        addSoft(CX, CY, 2.2 * pulse, 2.6, 0.6, 0.7);
        addSoft(CX, CY, 8 * pulse, 0.55, 0.05, 0.08);
        if (f > 4) {
            const rp = (f - 4) / (frames - 4);
            const rr = rp * Math.min(SW, SH) * 0.45;
            const rays = 20;
            for (let i = 0; i < rays; i++) {
                const a = i * 2 * Math.PI / rays;
                const x = CX + Math.cos(a) * rr;
                const y = CY + Math.sin(a) * rr;
                addSoft(x, y, 1.3, 1.0 * rp, 0.10 * rp, 0.15 * rp);
            }
        }
        flush();
        await frame(16);
    }
}

// ───────── Phase 2: build heart from center ─────────
function rayOutline(cx, cy, R, angle) {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let lo = 0, hi = 2.5;
    for (let it = 0; it < 32; it++) {
        const mid = (lo + hi) * 0.5;
        if (heartFunc(dx * mid, dy * mid) < 0) lo = mid;
        else hi = mid;
    }
    const u = (lo + hi) * 0.5;
    return [cx + dx * u * R, cy + dy * u * R];
}

async function heartGrowPhase() {
    const R = Math.min(SW, SH) * 0.40;

    for (let f = 0; f < 8; f++) {
        clearBuf();
        const pulse = 1 + 0.4 * Math.sin(f * 0.8);
        addSoft(CX, CY, 2.0 * pulse, 2.4, 0.55, 0.65);
        addSoft(CX, CY, 5 * pulse, 0.7, 0.06, 0.10);
        flush();
        await frame(20);
    }

    const rayCount = 56;
    const outline = [];
    for (let i = 0; i < rayCount; i++) {
        const a = i * 2 * Math.PI / rayCount - Math.PI / 2;
        outline.push(rayOutline(CX, CY, R, a));
    }

    const rayFrames = 16;
    for (let f = 1; f <= rayFrames; f++) {
        const e = ease(f / rayFrames);
        clearBuf();
        for (let i = 0; i < rayCount; i++) {
            const ex = outline[i][0];
            const ey = outline[i][1];
            const steps = Math.max(1, Math.floor(Math.max(
                Math.abs(ex - CX), Math.abs(ey - CY))));
            const upTo = Math.floor(steps * e);
            for (let s = 0; s <= upTo; s++) {
                const tt = s / steps;
                const x = CX + (ex - CX) * tt;
                const y = CY + (ey - CY) * tt;
                const fade = 1 - tt * 0.35;
                const alpha = 0.65 * fade;
                addSoft(x, y, 1.2, alpha * 1.7, alpha * 0.15, alpha * 0.20);
            }
            const tx = CX + (ex - CX) * e;
            const ty = CY + (ey - CY) * e;
            addSoft(tx, ty, 1.7, 1.8, 0.25, 0.30);
        }
        addSoft(CX, CY, 2.6, 2.6, 0.55, 0.65);
        flush();
        await frame(18);
    }

    const fillFrames = 20;
    for (let f = 0; f <= fillFrames; f++) {
        const t = ease(f / fillFrames);
        const maxDist = t * R * 1.25;
        clearBuf();
        for (let i = 0; i < rayCount; i++)
            addSoft(outline[i][0], outline[i][1], 1.7, 1.7, 0.20, 0.25);
        drawHeart(1.0, 0, maxDist);
        flush();
        await frame(16);
    }
}

// ───────── Phase 3: heartbeat ─────────
async function heartbeatPhase() {
    const perBeat = 26;
    for (let b = 0; b < 3; b++) {
        for (let f = 0; f < perBeat; f++) {
            const u = f / perBeat;
            const p = 1 + 0.07 * gauss(u, 0.12) + 0.04 * gauss(u, 0.32);
            clearBuf();
            drawHeart(p);
            flush();
            await frame(20);
        }
    }
    for (let f = 0; f < 14; f++) {
        const p = 1 + 0.28 * ease(f / 13);
        const flash = Math.floor(f / 2) % 2 === 1 ? 0.65 : 0;
        clearBuf();
        drawHeart(p, flash);
        flush();
        await frame(24);
    }
}

// ───────── Phase 5: name ─────────
const FONT = {
    'A': ["01110","10001","10001","11111","10001","10001","10001"],
    'B': ["11110","10001","10001","11110","10001","10001","11110"],
    'C': ["01111","10000","10000","10000","10000","10000","01111"],
    'D': ["11110","10001","10001","10001","10001","10001","11110"],
    'E': ["11111","10000","10000","11110","10000","10000","11111"],
    'F': ["11111","10000","10000","11110","10000","10000","10000"],
    'G': ["01111","10000","10000","10111","10001","10001","01110"],
    'H': ["10001","10001","10001","11111","10001","10001","10001"],
    'I': ["11111","00100","00100","00100","00100","00100","11111"],
    'J': ["00111","00010","00010","00010","00010","10010","01100"],
    'K': ["10001","10010","10100","11000","10100","10010","10001"],
    'L': ["10000","10000","10000","10000","10000","10000","11111"],
    'M': ["10001","11011","10101","10101","10001","10001","10001"],
    'N': ["10001","11001","10101","10011","10001","10001","10001"],
    'O': ["01110","10001","10001","10001","10001","10001","01110"],
    'P': ["11110","10001","10001","11110","10000","10000","10000"],
    'Q': ["01110","10001","10001","10001","10101","10010","01101"],
    'R': ["11110","10001","10001","11110","10100","10010","10001"],
    'S': ["01111","10000","10000","01110","00001","00001","11110"],
    'T': ["11111","00100","00100","00100","00100","00100","00100"],
    'U': ["10001","10001","10001","10001","10001","10001","01110"],
    'V': ["10001","10001","10001","10001","10001","01010","00100"],
    'W': ["10001","10001","10001","10101","10101","11011","10001"],
    'X': ["10001","10001","01010","00100","01010","10001","10001"],
    'Y': ["10001","10001","01010","00100","00100","00100","00100"],
    'Z': ["11111","00001","00010","00100","01000","10000","11111"],
    ' ': ["00000","00000","00000","00000","00000","00000","00000"]
};

// ✨ حرف واحد بأنيميشن: وميض عند الظهور + تكبير من نقطة صغيرة + ثبات
function drawLetterAnimated(letter, startX, startY, scale, localFrame, letterFade) {
    if (localFrame < 0) return;
    const t = clamp01(localFrame / letterFade);
    if (t <= 0) return;

    const alpha = t;
    const sizeMul = 0.30 + 0.70 * easeOutBack(t);

    const glyph = FONT[letter];
    if (!glyph) return;

    const ccx = startX + 2 * scale;
    const ccy = startY + 3 * scale;

    // 💥 وميض (burst) أول 6 فريمات من عمر الحرف
    if (localFrame < 6) {
        const burst = 1 - localFrame / 6;
        const burstSize = scale * (2.5 + 4.5 * (1 - burst));
        addSoft(ccx, ccy, burstSize,
                burst * 2.2, burst * 0.35, burst * 0.45);
        addSoft(ccx, ccy, burstSize * 0.5,
                burst * 3.0, burst * 1.2, burst * 1.3);
    }

    for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 5; col++) {
            if (glyph[row][col] !== '1') continue;
            const relX = (col - 2) * scale;
            const relY = (row - 3) * scale;
            const x = ccx + relX * sizeMul;
            const y = ccy + relY * sizeMul;
            const s = scale * sizeMul;

            addSoft(x, y, s * 1.3, alpha * 0.85, alpha * 0.05, alpha * 0.10);
            addSoft(x, y, s * 0.65, alpha * 1.8, alpha * 0.15, alpha * 0.25);
            addSoft(x, y, s * 0.28, alpha * 2.0, alpha * 1.8, alpha * 1.8);
        }
    }
}

// رسم شكل قلب صغير
function drawHeartShape(x, y, s, cr, cg, cb) {
    addSoft(x, y, 2.0 * s, cr * 0.55, cg * 0.55, cb * 0.55);
    addSoft(x - 1.05 * s, y - 0.85 * s, 1.05 * s, cr, cg, cb);
    addSoft(x + 1.05 * s, y - 0.85 * s, 1.05 * s, cr, cg, cb);
    addSoft(x,              y - 0.45 * s, 1.15 * s, cr, cg, cb);
    addSoft(x,              y + 0.85 * s, 0.95 * s, cr * 0.85, cg * 0.85, cb * 0.85);
}

async function namePhase() {
    // ✏️ غيّر النص هنا
    const text = "LOVE YOU";
    const n = text.length;

    // Auto-fit scale
    const maxW = SW * 0.92;
    const maxH = SH * 0.55;
    let scale = Math.min(
        Math.floor(maxW / (n * 6 - 1)),
        Math.floor(maxH / 7)
    );
    if (scale < 2) scale = 2;

    const textW = n * 6 * scale - scale;
    const startX = (SW - textW) / 2;
    const startY = (SH - 7 * scale) / 2;

    // ⏱️ الحرف يبدأ كل letterDelay فريم، وياخد letterFade فريم عشان يظهر
    const letterDelay = 20;   // ⬅️ أكبر = فاصل أطول بين كل حرف
    const letterFade  = 9;    // ⬅️ أنيميشن ظهور الحرف نفسه

    const lastLetterFrame = (n - 1) * letterDelay + letterFade;
    const endFrame = lastLetterFrame + 120;

    const hearts = [];
    const MAX_HEARTS = 260;

    for (let fr = 0; ; fr++) {
        clearBuf();

        // ── قلوب حمرا كتير ──
        if (fr < lastLetterFrame + 55) {
            const spawnCount = fr < lastLetterFrame ? 8 : 4;
            for (let k = 0; k < spawnCount; k++) {
                if (hearts.length >= MAX_HEARTS) break;
                hearts.push({
                    x: Math.random() * SW,
                    y: SH + 2 + Math.random() * 10,
                    vy: -(0.35 + Math.random() * 1.1),
                    ph: Math.random() * 6.28,
                    wobbleAmp: 1.5 + Math.random() * 3.0,
                    wobbleFreq: 0.06 + Math.random() * 0.09,
                    size: 0.45 + Math.random() * 1.4,
                    bright: Math.random() < 0.35,
                });
            }
        }

        for (let i = hearts.length - 1; i >= 0; i--) {
            const h = hearts[i];
            h.y += h.vy;
            if (h.y < -8) { hearts.splice(i, 1); continue; }

            const x = h.x + Math.sin(h.ph + fr * h.wobbleFreq) * h.wobbleAmp;
            const y = h.y;
            const s = h.size;

            let cr, cg, cb;
            if (h.bright) { cr = 1.4; cg = 0.20; cb = 0.30; }
            else          { cr = 0.90; cg = 0.05; cb = 0.12; }

            drawHeartShape(x, y, s, cr, cg, cb);
        }

        // ── الاسم بأنيميشن حرف-حرف ──
        let cxp = startX;
        for (let i = 0; i < text.length; i++) {
            const lf = fr - i * letterDelay;
            drawLetterAnimated(text[i], cxp, startY, scale, lf, letterFade);
            cxp += 6 * scale;
        }

        // ── لمعة بعد ما يخلص ──
        if (fr > lastLetterFrame) {
            const shimmer = Math.floor((fr - lastLetterFrame) / 2);
            const span = Math.floor(textW / scale) + 12;
            if (shimmer < span) {
                const shX = startX + shimmer * scale;
                addSoft(shX, startY + 3.5 * scale, 7, 1.2, 0.35, 0.40);
            }
        }

        flush();
        await frame(20);   // ⬅️ 20ms عشان تشوف كل حرف وهو بيتكتب

        if (fr > endFrame) break;
    }
}

// ───────── Run all phases ─────────
(async () => {
    await introPhase();
    await heartGrowPhase();
    await heartbeatPhase();
    await explosionAndNamePhase();   // 👈 الدالة الجديدة
})();
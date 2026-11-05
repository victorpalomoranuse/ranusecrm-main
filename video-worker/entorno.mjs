// Variables de entorno: las del sistema (servidor en la nube) y, si existe, el .env del backend (tu PC).
import fs from 'fs';
let delFichero = {};
try { delFichero = Object.fromEntries(fs.readFileSync(new URL('../server/.env', import.meta.url), 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')])); } catch { /* en la nube no hay .env */ }
export const ENV = { ...delFichero, ...process.env };

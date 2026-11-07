// Vídeo de muestra de un estilo de subtítulos con una tipografía: fondo oscuro de marca y una frase de ejemplo, dibujada con la misma capa visual que los vídeos reales.
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { componeHF } from './hf.mjs';
import { copiaFuentes } from './fuentes.mjs';

const B = String.fromCharCode(92);
const tAss = (s) => { const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = (s % 60).toFixed(2); return h + ':' + String(m).padStart(2, '0') + ':' + x.padStart(5, '0'); };
// '#RRGGBB' -> '&H00BBGGRR&'
const asscol = (hex) => { const h = String(hex || '#E3D2B8').replace('#', ''); return '&H00' + h.slice(4, 6) + h.slice(2, 4) + h.slice(0, 2) + '&'; };

export function assMuestra({ estilo = 'normal', fuente = 'Montserrat', acento = '#E3D2B8' }) {
  const frase = 'así queda este estilo de subtítulos con tu marca en cada vídeo'.split(' ');
  const T0 = 0.5, DT = 0.42, ppb = estilo === 'palabra' ? 1 : 2, tam = 64, ac = asscol(acento);
  const palabras = frase.map((t, i) => ({ t, de: T0 + i * DT, a: T0 + i * DT + DT * 0.9 }));
  const bloques = []; for (let i = 0; i < palabras.length; i += ppb) bloques.push(palabras.slice(i, i + ppb));
  const ev = [];
  const estSub = estilo === 'caja' ? 'SubCaja' : 'Sub';
  bloques.forEach((bl, k) => {
    const ini = bl[0].de, fin = k < bloques.length - 1 ? bloques[k + 1][0].de : bl[bl.length - 1].a + 0.7;
    if (estilo === 'karaoke') {
      bl.forEach((w, j) => {
        const t0 = j === 0 ? ini : w.de, t1 = j < bl.length - 1 ? bl[j + 1].de : fin;
        const tx = bl.map((x, q) => q === j ? '{' + B + 'c' + ac + B + 'fscx112' + B + 'fscy112}' + x.t + '{' + B + 'c&HFFFFFF&' + B + 'fscx100' + B + 'fscy100}' : x.t).join(' ');
        ev.push('Dialogue: 1,' + tAss(t0) + ',' + tAss(t1) + ',Sub,,0,0,0,,{' + B + 'fad(' + (j === 0 ? 40 : 0) + ',0)}' + tx);
      });
    } else {
      const txt = bl.map((w, j) => (k % 3 === 1 && j === bl.length - 1) ? '{' + B + 'c' + ac + '}' + w.t + '{' + B + 'c&HFFFFFF&}' : w.t).join(' ');
      const pop = estilo === 'palabra' ? B + 'fscx55' + B + 'fscy55' + B + 't(0,150,' + B + 'fscx100' + B + 'fscy100)' + B + 'fad(30,0)' : B + 'fscx82' + B + 'fscy82' + B + 't(0,110,' + B + 'fscx100' + B + 'fscy100)' + B + 'fad(40,0)';
      ev.push('Dialogue: 1,' + tAss(ini) + ',' + tAss(fin) + ',' + estSub + ',,0,0,0,,{' + pop + '}' + txt);
    }
  });
  return ['[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1080', 'PlayResY: 1920', 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '', '[V4+ Styles]',
    'Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding',
    'Style: Sub,' + fuente + ',' + tam + ',&H00FFFFFF,&H000000FF,&H00101010,&H88000000,-1,0,0,0,100,100,0,0,1,1,2,2,50,50,820,1',
    'Style: SubCaja,' + fuente + ',' + tam + ',&H00FFFFFF,&H000000FF,&HC0141414,&HC0141414,-1,0,0,0,100,100,0,0,3,14,0,2,50,50,820,1',
    '', '[Events]', 'Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text', ...ev].join('\n');
}

// Genera el MP4 de muestra y devuelve su ruta
export function creaMuestra({ estilo, fuente, acento, dir }) {
  fs.mkdirSync(dir, { recursive: true });
  const dur = 6.5, base = path.join(dir, 'fondo.mp4'), ass = path.join(dir, 'muestra.ass'), salida = path.join(dir, 'muestra.mp4');
  // fondo oscuro con un degradado suave (negro cálido) y un ligero movimiento
  spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x1b1713:s=1080x1920:r=30:d=' + dur, '-vf', "geq=r='r(X,Y)+22*(Y/1920)':g='g(X,Y)+16*(Y/1920)':b='b(X,Y)+8*(Y/1920)',format=yuv420p", '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-an', base]);
  if (!fs.existsSync(base)) throw new Error('no se pudo crear el fondo de la muestra');
  fs.writeFileSync(ass, assMuestra({ estilo, fuente, acento }));
  copiaFuentes(path.join(dir, 'fonts'), ['Montserrat', fuente]);
  const fuentes = fs.readdirSync(path.join(dir, 'fonts')).filter(x => /\.ttf$/i.test(x)).map(x => path.join(dir, 'fonts', x));
  componeHF({ base, subsAss: ass, fuentes, salida, dir });
  return salida;
}

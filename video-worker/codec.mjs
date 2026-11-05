// Codificador de vídeo: tarjeta NVIDIA si hay (tu PC), CPU si no (servidor en la nube).
import { spawnSync } from 'child_process';
let nv = null;
export function hayNvenc() {
  if (nv !== null) return nv; if (process.env.CODEC === 'cpu') return (nv = false); if (process.env.CODEC === 'nvenc') return (nv = true);
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=256x256:d=0.2', '-c:v', 'h264_nvenc', '-f', 'null', '-'], { encoding: 'utf8' });
  return (nv = r.status === 0);
}
// Argumentos de vídeo para un nivel de calidad (cq 23 ≈ crf 23)
export const ARGS_VIDEO = (cq = 23) => hayNvenc() ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-cq', String(cq)] : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(cq)];

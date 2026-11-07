#!/usr/bin/env python3
"""Alineador de palabras (forced alignment con el modelo MMS de torchaudio).
Entrada: audio (wav 16 kHz) + JSON con la transcripción {"transcription":[{"text":" hola","offsets":{"from":ms,"to":ms}},...]}.
Salida: el mismo JSON con los tiempos de cada palabra afinados a ~20 ms (sobrescribe el archivo de salida).
Uso: python alinea.py audio.wav transcripcion.json salida.json
Si algo falla, el programa sale con código 1 y el motor sigue con los tiempos originales."""
import sys, json, re, unicodedata

def main():
    wav_path, in_json, out_json = sys.argv[1:4]
    import torch, torchaudio
    import torchaudio.functional as F
    from torchaudio.pipelines import MMS_FA as bundle

    data = json.load(open(in_json, encoding='utf-8-sig'))
    ws = data['transcription']

    def norm(t):
        t = unicodedata.normalize('NFD', str(t).strip().lower())
        t = ''.join(c for c in t if not unicodedata.combining(c))
        return re.sub(r"[^a-z']", '', t)

    palabras = [norm(w['text']) for w in ws]
    usables = [i for i, p in enumerate(palabras) if p]
    if len(usables) < 3:
        raise SystemExit(1)

    import wave, struct
    with wave.open(wav_path, 'rb') as wf:
        sr = wf.getframerate(); canales = wf.getnchannels(); ancho = wf.getsampwidth()
        crudo = wf.readframes(wf.getnframes())
    if ancho != 2:
        raise RuntimeError('el audio debe ser wav de 16 bits')
    import array
    arr = array.array('h'); arr.frombytes(crudo)
    wav = torch.tensor(arr, dtype=torch.float32).reshape(-1, canales).mean(1).unsqueeze(0) / 32768.0
    if sr != bundle.sample_rate:
        wav = torchaudio.functional.resample(wav, sr, bundle.sample_rate)
    dur = wav.shape[1] / bundle.sample_rate

    model = bundle.get_model(with_star=False)
    model.eval()
    dic = bundle.get_dict(star=None)

    # el audio se procesa en ventanas de 60 s con solapamiento pequeño: cada ventana alinea solo las palabras que caen en ella (según los tiempos originales)
    VENT, MARGEN = 60.0, 3.0
    nuevo = {}
    ini = 0.0
    while ini < dur:
        fin = min(dur, ini + VENT)
        a0, a1 = max(0.0, ini - MARGEN), min(dur, fin + MARGEN)
        idx = [i for i in usables if ini <= ws[i]['offsets']['from'] / 1000.0 < fin]
        if len(idx) >= 2:
            seg = wav[:, int(a0 * bundle.sample_rate):int(a1 * bundle.sample_rate)]
            with torch.inference_mode():
                emision, _ = model(seg)
            tokens = []
            lens = []
            for i in idx:
                tk = [dic[c] for c in palabras[i] if c in dic]
                lens.append(len(tk))
                tokens.extend(tk)
            if tokens and all(l > 0 for l in lens):
                try:
                    objetivo = torch.tensor([tokens], dtype=torch.int32)
                    alin, punt = F.forced_align(emision, objetivo, blank=0)
                    spans = F.merge_tokens(alin[0], punt[0].exp())
                    if len(spans) == len(tokens):
                        ratio = (seg.shape[1] / bundle.sample_rate) / emision.shape[1]
                        pos = 0
                        for i, l in zip(idx, lens):
                            s = spans[pos:pos + l]
                            pos += l
                            nuevo[i] = (a0 + s[0].start * ratio, a0 + s[-1].end * ratio)
                except Exception as e:  # esa ventana se queda con los tiempos originales
                    print('ventana sin alinear:', e, file=sys.stderr)
        ini = fin

    movidas = 0
    for i, (a, b) in nuevo.items():
        d0 = ws[i]['offsets']['from'] / 1000.0
        if abs(a - d0) > 1.2:   # un salto enorme es un error de alineación: se conserva el original
            continue
        ws[i]['offsets']['from'] = int(round(a * 1000))
        ws[i]['offsets']['to'] = int(round(max(b, a + 0.04) * 1000))
        movidas += 1
    # las palabras sin letras (números, signos) se quedan donde estaban
    json.dump(data, open(out_json, 'w', encoding='utf-8'))
    print('alineadas', movidas, 'de', len(ws))

if __name__ == '__main__':
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        print('ERROR', e, file=sys.stderr)
        sys.exit(1)

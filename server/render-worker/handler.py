# Worker de RunPod Serverless: descarga la escena (.glb + luces .json), la renderiza con Blender Cycles (OptiX) y sube el PNG.
import os, subprocess, tempfile, urllib.request
import runpod


def descargar(url, destino):
    urllib.request.urlretrieve(url, destino)


def subir(url, ruta):
    with open(ruta, 'rb') as f:
        datos = f.read()
    req = urllib.request.Request(url, data=datos, method='PUT', headers={'Content-Type': 'image/png', 'x-upsert': 'true'})
    urllib.request.urlopen(req, timeout=300).read()


def handler(job):
    i = job['input']
    with tempfile.TemporaryDirectory() as d:
        glb, js, png = os.path.join(d, 'escena.glb'), os.path.join(d, 'luces.json'), os.path.join(d, 'resultado.png')
        descargar(i['escena'], glb)
        descargar(i['luces'], js)
        cmd = ['blender', '-b', '-P', os.path.join(os.path.dirname(__file__), 'render.py'), '--', glb, js, png,
               str(i.get('exposicion', 3)), str(i.get('ancho', 1600)), str(i.get('muestras', 64))]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=1500)
        if not os.path.exists(png):
            return {'error': 'Blender no generó la imagen: ' + (r.stderr or r.stdout)[-400:]}
        subir(i['subida'], png)
        return {'ok': True}


runpod.serverless.start({'handler': handler})

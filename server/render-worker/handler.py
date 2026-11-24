# Worker de RunPod Serverless: descarga la escena (.glb + luces .json), la renderiza con Blender Cycles (OptiX) y sube el PNG.
import os, subprocess, tempfile, time, urllib.request
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
        # el servidor puede pasar la última versión de render.py (así los retoques no obligan a reconstruir la imagen del worker)
        script = os.path.join(os.path.dirname(__file__), 'render.py')
        if i.get('script'):
            try:
                nuevo = os.path.join(d, 'render.py'); descargar(i['script'], nuevo)
                if os.path.getsize(nuevo) > 1000: script = nuevo
            except Exception as e:
                print('SCRIPT_ERR', e, flush=True)
        cmd = ['blender', '-b', '-P', script, '--', glb, js, png,
               str(i.get('exposicion', 3)), str(i.get('ancho', 1600)), str(i.get('muestras', 64))]
        t0 = time.time()
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=1500)
        # Se muestran en el registro de RunPod las líneas útiles de Blender: dispositivo usado, exposición, tiempo y errores
        for linea in (r.stdout or '').splitlines():
            if linea.startswith(('DISPOSITIVO', 'EXPOSICION', 'LISTO', 'Error', 'Traceback')):
                print(linea, flush=True)
        print('TIEMPO_BLENDER_S', round(time.time() - t0, 1), flush=True)
        if r.returncode != 0:
            print((r.stderr or '')[-800:], flush=True)
        if not os.path.exists(png):
            return {'error': 'Blender no generó la imagen: ' + (r.stderr or r.stdout)[-400:]}
        subir(i['subida'], png)
        return {'ok': True}


runpod.serverless.start({'handler': handler})

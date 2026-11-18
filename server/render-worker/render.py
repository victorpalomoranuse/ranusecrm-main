import bpy, sys, math, json
from mathutils import Vector

A = sys.argv[sys.argv.index('--') + 1:]
glb, js, out = A[:3]
EXPO = float(A[3]) if len(A) > 3 else 3.0
ANCHO = int(A[4]) if len(A) > 4 else 1600
MUESTRAS = int(A[5]) if len(A) > 5 else 64
info = json.load(open(js, encoding='utf-8'))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
sc = bpy.context.scene

def G(p):  # three.js (Y arriba) -> Blender (Z arriba)
    return Vector((p[0], -p[2], p[1]))

# cielo de día; con el sol del CRM si lo hay
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
nt = w.node_tree; nt.nodes.clear()
sky = nt.nodes.new('ShaderNodeTexSky')
try: sky.sky_type = 'MULTIPLE_SCATTERING'
except Exception: sky.sky_type = 'NISHITA'
# Sol y cielo como en el visor: misma hora, orientación al norte, sol encendido o apagado e intensidad del sol
hora = float(info.get('hora') or 12); t = max(0.0, min(1.0, (hora - 6) / 15)); k = math.sin(math.pi * t)
elev = max(0.05, k) * math.radians(65); az = math.pi * (1 - t) + math.radians(float(info.get('norte') or 0))
noche = hora <= 6 or hora >= 21
sky.sun_elevation = elev; sky.sun_rotation = az % (2 * math.pi)
try: sky.sun_intensity = 0.0 if (noche or info.get('solOn') is False) else float(info.get('solI') or 1.0)
except Exception: pass
bg = nt.nodes.new('ShaderNodeBackground')
# luz del cielo: de día 0,6; al atardecer baja; de noche casi nada (solo se ven las luces del proyecto)
bg.inputs['Strength'].default_value = 0.02 if noche else 0.08 + 0.52 * min(1.0, k / 0.4)
o = nt.nodes.new('ShaderNodeOutputWorld')
nt.links.new(sky.outputs[0], bg.inputs[0]); nt.links.new(bg.outputs[0], o.inputs[0])

def hexc(h): h = h.lstrip('#'); return [int(h[i:i+2], 16) / 255 for i in (0, 2, 4)]
def srgb2lin(c): return [(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4) for x in c]

# Escala: en el CRM la intensidad física va con una exposición muy baja; aquí convertimos a vatios de Blender y calibramos con la exposición
W_PER_CD = 4 * math.pi * math.pi / 683.0  # candelas -> vatios de Blender (aprox.)
for L in info['luces']:
    col = srgb2lin(hexc(L['col']))
    if L['t'] == 'spot':
        d = bpy.data.lights.new('s', 'SPOT'); d.energy = L['i'] * W_PER_CD; d.spot_size = min(math.pi, L['ang'] * 2); d.spot_blend = max(0.05, L['pen']); d.shadow_soft_size = 0.05
        ob = bpy.data.objects.new('s', d); sc.collection.objects.link(ob); ob.location = G(L['pos'])
        ob.rotation_euler = (G(L['tg']) - ob.location).to_track_quat('-Z', 'Y').to_euler()
    elif L['t'] == 'point':
        d = bpy.data.lights.new('p', 'POINT'); d.energy = L['i'] * W_PER_CD; d.shadow_soft_size = 0.05
        ob = bpy.data.objects.new('p', d); sc.collection.objects.link(ob); ob.location = G(L['pos'])
    elif L['t'] == 'area':
        d = bpy.data.lights.new('a', 'AREA'); d.shape = 'RECTANGLE'; d.size = L['w']; d.size_y = L['h']
        # luminancia (nits) * superficie * pi = lumenes; vatios = lumenes / 683
        d.energy = L['i'] * L['w'] * L['h'] * math.pi / 683.0
        ob = bpy.data.objects.new('a', d); sc.collection.objects.link(ob); ob.location = G(L['pos'])
        dr = Vector((L['dir'][0], -L['dir'][2], L['dir'][1]))
        ob.rotation_euler = dr.to_track_quat('-Z', 'Y').to_euler()
    elif L['t'] == 'sol':
        continue
    d.color = col

# cámara de la vista del visor
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
C = info['camara']; cam.location = G(C['pos'])
cam.rotation_euler = (G(C['tg']) - cam.location).to_track_quat('-Z', 'Y').to_euler()
cam.data.sensor_fit = 'VERTICAL'; cam.data.angle_y = math.radians(C['fov'])

# si la cámara está por encima del techo, se quita (vista aérea)
for ob in list(sc.objects):
    if ob.type == 'MESH':
        bb = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
        ex = max(p.x for p in bb) - min(p.x for p in bb); ey = max(p.y for p in bb) - min(p.y for p in bb); ez = max(p.z for p in bb) - min(p.z for p in bb)
        if ex > 3 and ey > 3 and ez < 0.05 and min(p.z for p in bb) > 1.8 and cam.location.z > min(p.z for p in bb):
            bpy.data.objects.remove(ob, do_unlink=True)

sc.render.engine = 'CYCLES'
sc.cycles.samples = MUESTRAS
sc.cycles.use_denoising = True
sc.cycles.max_bounces = 10
asp = C.get('aspect') or 16 / 9
sc.render.resolution_x, sc.render.resolution_y = ANCHO, int(ANCHO / asp)
sc.view_settings.view_transform = 'AgX'
sc.view_settings.exposure = EXPO

# GPU: OptiX si está, si no CUDA; se muestra en el registro cuál se usa (si sale CPU, el render será muy lento)
prefs = bpy.context.preferences.addons['cycles'].preferences
usado = 'CPU'
for t in ('OPTIX', 'CUDA'):
    try:
        prefs.compute_device_type = t; prefs.get_devices()
        gpus = [d for d in prefs.devices if d.type == t]
        if gpus:
            for d in prefs.devices: d.use = d.type == t
            usado = t; break
    except Exception as e:
        print('DISPOSITIVO', t, 'falla', e)
sc.cycles.device = 'GPU' if usado != 'CPU' else 'CPU'
print('DISPOSITIVO_USADO', usado, [d.name for d in prefs.devices])

# Exposición automática: renders pequeños y rápidos que miden el brillo medio y corrigen la exposición hasta ~22 % de gris medio en pantalla (las salas oscuras se quedan oscuras)
import os, tempfile
def brillo(exp):
    sc.view_settings.exposure = exp
    r0 = (sc.render.resolution_x, sc.render.resolution_y, sc.cycles.samples, sc.cycles.use_denoising)
    sc.render.resolution_x, sc.render.resolution_y, sc.cycles.samples, sc.cycles.use_denoising = 240, int(240 / asp), 12, False
    tmp = os.path.join(tempfile.gettempdir(), 'exp.png'); sc.render.filepath = tmp
    bpy.ops.render.render(write_still=True)
    im = bpy.data.images.load(tmp); px = list(im.pixels); bpy.data.images.remove(im)
    n = len(px) // 4; m = sum(0.2126 * px[4*k] + 0.7152 * px[4*k+1] + 0.0722 * px[4*k+2] for k in range(n)) / max(1, n)
    sc.render.resolution_x, sc.render.resolution_y, sc.cycles.samples, sc.cycles.use_denoising = r0
    return m
# Exposición del visor: se traduce a la del render (3,5 pasos con los valores por defecto del visor: exposición 1 y EV 7); cada paso de EV hacia arriba oscurece un paso
if info.get('modoExposicion') == 'visor':
    ex = float(info.get('exposicion') or 1.0); ev = float(info.get('ev') if info.get('ev') is not None else 7)
    sc.view_settings.exposure = 3.5 + math.log2(max(0.05, ex)) - (ev - 7)
    print('EXPOSICION_VISOR', round(sc.view_settings.exposure, 2), 'exposicion', ex, 'EV', ev)
elif os.environ.get('EXPO_AUTO', '1') == '1':
    exp = EXPO
    for _ in range(3):
        m = brillo(exp)
        if m < 0.01: exp += 3; continue
        d = 2.2 * math.log2(0.22 / m)
        print('EXPOSICION', round(exp, 2), 'brillo', round(m, 3), 'corr', round(d, 2))
        if abs(d) < 0.3: break
        exp = max(-6, min(9, exp + d * 0.8))
    sc.view_settings.exposure = exp
    print('EXPOSICION_FINAL', round(exp, 2))
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
print('LISTO', out, len(info['luces']), 'luces')

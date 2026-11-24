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
# Los reflejos (espejos, cromados) no ven el cielo azul tal cual: se ven con un gris neutro y oscuro, como en el visor
lp = nt.nodes.new('ShaderNodeLightPath'); mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'
mx.inputs[7].default_value = (0.03, 0.03, 0.03, 1.0)
refl = nt.nodes.new('ShaderNodeMath'); refl.operation = 'ADD'; refl.use_clamp = True  # reflejo = rayo glossy O rayo de espejo perfecto (singular): ninguno ve el cielo azul
nt.links.new(lp.outputs['Is Glossy Ray'], refl.inputs[0]); nt.links.new(lp.outputs['Is Singular Ray'], refl.inputs[1])
nt.links.new(sky.outputs[0], mx.inputs[6]); nt.links.new(refl.outputs[0], mx.inputs[0])
nt.links.new(mx.outputs[2], bg.inputs[0]); nt.links.new(bg.outputs[0], o.inputs[0])

def hexc(h): h = h.lstrip('#'); return [int(h[i:i+2], 16) / 255 for i in (0, 2, 4)]
def srgb2lin(c): return [(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4) for x in c]

# Escala: en el CRM la intensidad física va con una exposición muy baja; aquí convertimos a vatios de Blender y calibramos con la exposición
SPOT_K = 1.0  # sin refuerzo: luz física
LED_K = 1.0  # sin refuerzo: luz física
W_PER_CD = 4 * math.pi * math.pi / 683.0  # candelas -> vatios de Blender (aprox.)
for L in info['luces']:
    col = srgb2lin(hexc(L['col'])); col = [c + (1.0 - c) * 0.45 for c in col]  # menos saturación: sin esto todo sale amarillo
    if L['t'] == 'spot':
        d = bpy.data.lights.new('s', 'SPOT'); d.energy = L['i'] * W_PER_CD * SPOT_K; d.spot_size = min(math.pi, L['ang'] * 2); d.spot_blend = max(0.05, L['pen']); d.shadow_soft_size = 0.05
        ob = bpy.data.objects.new('s', d); sc.collection.objects.link(ob); ob.location = G(L['pos'])
        ob.rotation_euler = (G(L['tg']) - ob.location).to_track_quat('-Z', 'Y').to_euler()
    elif L['t'] == 'point':
        d = bpy.data.lights.new('p', 'POINT'); d.energy = L['i'] * W_PER_CD; d.shadow_soft_size = 0.05
        ob = bpy.data.objects.new('p', d); sc.collection.objects.link(ob); ob.location = G(L['pos'])
    elif L['t'] == 'area':
        d = bpy.data.lights.new('a', 'AREA'); d.shape = 'RECTANGLE'; d.size = max(L['w'], 0.02); d.size_y = max(L['h'], 0.02)
        # luminancia (nits) * superficie * pi = lumenes; vatios = lumenes / 683
        d.energy = L['i'] * L['w'] * L['h'] * math.pi / 683.0 * LED_K
        if L['h'] < 0.12:
            d.spread = math.radians(100)  # la tira concentra su luz en un haz (lava la pared en vez de aclarar toda la sala)
        ob = bpy.data.objects.new('a', d); sc.collection.objects.link(ob); ob.location = G(L['pos'])
        ob.visible_camera = False
        if L.get('retro'):
            d.use_shadow = False  # luz retroiluminada (detrás de un espejo o un panel): rodea el objeto y baña la pared, como en el visor
        # La línea luminosa visible de cada LED ya viaja en la escena (su cinta); aquí solo se añade la luz que emite, sin dibujarla de nuevo
        dr = Vector((L['dir'][0], -L['dir'][2], L['dir'][1]))
        if L.get('ex'):  # orientación completa: el ancho de la luz sigue su eje real (las tiras LED verticales son verticales)
            zb = (-dr).normalized(); xb = Vector((L['ex'][0], -L['ex'][2], L['ex'][1])); xb = (xb - zb * xb.dot(zb)).normalized(); yb = zb.cross(xb)
            from mathutils import Matrix
            ob.rotation_euler = Matrix(((xb.x, yb.x, zb.x), (xb.y, yb.y, zb.y), (xb.z, yb.z, zb.z))).to_euler()
        else:
            ob.rotation_euler = dr.to_track_quat('-Z', 'Y').to_euler()
    elif L['t'] == 'sol':
        continue
    d.color = col

# Capas pintadas (overlay): en el visor se dibujan «encima» de la superficie; en Blender quedan en el mismo plano y se pelean con ella (salía la caja azul en vez del espejo).
# Se separan 2 mm hacia fuera, en la dirección de su normal.
for ob in list(sc.objects):
    if ob.type == 'MESH' and ob.get('overlay') is not None:
        me = ob.data; me.calc_normals() if hasattr(me, 'calc_normals') else None
        for v in me.vertices:
            v.co += v.normal * 0.002
        me.update()

# Juntas de las losetas del suelo: en el visor se ven; en Blender se pierden por el filtrado de la textura.
# Si la imagen del suelo trae junta (su borde es más oscuro o más claro que el centro), se dibuja una línea fina y nítida en cada borde de loseta.
def juntas_suelo():
    try:
        import numpy as np
    except Exception:
        return
    hechos = set()
    for ob in bpy.data.objects:
        if ob.type != 'MESH':
            continue
        bb = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
        ex = max(p.x for p in bb) - min(p.x for p in bb); ey = max(p.y for p in bb) - min(p.y for p in bb); ez = max(p.z for p in bb) - min(p.z for p in bb)
        suelo_geo = ez < 0.12 and ex > 1.2 and ey > 1.2 and min(p.z for p in bb) < 0.3
        if not suelo_geo and not any(s.material and str(s.material.get('sueloKey', '')).startswith('suelo') for s in ob.material_slots):
            continue  # solo superficies de suelo
        for sl in ob.material_slots:
            m = sl.material
            if not m or not m.use_nodes or m.name in hechos:
                continue
            nt = m.node_tree
            tex = next((n for n in nt.nodes if n.type == 'TEX_IMAGE' and n.image), None)
            bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
            if not tex or not bsdf:
                continue
            im = tex.image; wd, ht = im.size[0], im.size[1]
            if wd < 16 or ht < 16 or wd * ht > 4096 * 4096:
                continue
            buf = np.empty(wd * ht * 4, dtype=np.float32); im.pixels.foreach_get(buf); a = buf.reshape(ht, wd, 4)[:, :, :3]
            b = max(2, wd // 256)
            borde = np.concatenate([a[:b].reshape(-1, 3), a[-b:].reshape(-1, 3), a[:, :b].reshape(-1, 3), a[:, -b:].reshape(-1, 3)]).mean(axis=0)
            centro = a[ht // 4: 3 * ht // 4, wd // 4: 3 * wd // 4].reshape(-1, 3).mean(axis=0)
            lum = lambda c: 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
            sk = str(m.get('sueloKey', '')); con_junta = len(sk) > 6 and sk.startswith('suelo') and sk[6] == '1'  # el visor marca «junta» en la clave del suelo
            if con_junta:
                borde = np.array([0.006, 0.006, 0.006], dtype=np.float32)  # junta negra, hundida
            elif abs(lum(borde) - lum(centro)) < 0.04 * max(0.2, lum(centro)) + 0.01:
                continue
            hechos.add(m.name)
            link = next((l for l in nt.links if l.to_node == bsdf and l.to_socket.name == 'Base Color'), None)
            if not link:
                continue
            uv = nt.nodes.new('ShaderNodeUVMap'); sep = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(uv.outputs[0], sep.inputs[0])
            def frac_borde(sock):
                f = nt.nodes.new('ShaderNodeMath'); f.operation = 'FRACT'; nt.links.new(sock, f.inputs[0])
                inv = nt.nodes.new('ShaderNodeMath'); inv.operation = 'SUBTRACT'; inv.inputs[0].default_value = 1.0; nt.links.new(f.outputs[0], inv.inputs[1])
                mn = nt.nodes.new('ShaderNodeMath'); mn.operation = 'MINIMUM'; nt.links.new(f.outputs[0], mn.inputs[0]); nt.links.new(inv.outputs[0], mn.inputs[1])
                return mn.outputs[0]
            bu = frac_borde(sep.outputs[0]); bv = frac_borde(sep.outputs[1])
            mn2 = nt.nodes.new('ShaderNodeMath'); mn2.operation = 'MINIMUM'; nt.links.new(bu, mn2.inputs[0]); nt.links.new(bv, mn2.inputs[1])
            gt = nt.nodes.new('ShaderNodeMath'); gt.operation = 'LESS_THAN'; nt.links.new(mn2.outputs[0], gt.inputs[0]); gt.inputs[1].default_value = 0.0035
            mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'
            nt.links.new(gt.outputs[0], mx.inputs[0]); nt.links.new(link.from_socket, mx.inputs[6])
            mx.inputs[7].default_value = (float(borde[0]), float(borde[1]), float(borde[2]), 1.0)
            nt.links.new(mx.outputs[2], bsdf.inputs['Base Color'])
            # relieve: la junta es un surco (más baja que la loseta) y el caucho tiene su rugosidad
            alt = nt.nodes.new('ShaderNodeMath'); alt.operation = 'SUBTRACT'; alt.inputs[0].default_value = 1.0; nt.links.new(gt.outputs[0], alt.inputs[1])
            bm = nt.nodes.new('ShaderNodeBump'); bm.inputs['Strength'].default_value = 1.0; bm.inputs['Distance'].default_value = 0.004
            nt.links.new(alt.outputs[0], bm.inputs['Height']); nt.links.new(bm.outputs[0], bsdf.inputs['Normal'])
            ro = nt.nodes.new('ShaderNodeMix'); ro.data_type = 'FLOAT'; ro.inputs[2].default_value = 0.75; ro.inputs[3].default_value = 1.0
            nt.links.new(gt.outputs[0], ro.inputs[0]); nt.links.new(ro.outputs[0], bsdf.inputs['Roughness'])
            print('JUNTAS', m.name, round(lum(borde), 3), round(lum(centro), 3))
juntas_suelo()

# Espejos: metal casi perfecto pero de color neutro (si no, salen azules al reflejar el cielo)
for mat in bpy.data.materials:
    if not mat.use_nodes: continue
    for nd in mat.node_tree.nodes:
        if nd.type == 'BSDF_PRINCIPLED':
            met = nd.inputs['Metallic'].default_value; ro = nd.inputs['Roughness'].default_value
            if met >= 0.8 and ro <= 0.25:
                for l in [l for l in mat.node_tree.links if l.to_node == nd and l.to_socket.name in ('Base Color', 'Emission Color')]: mat.node_tree.links.remove(l)  # la textura del espejo es azulada: se descarta
                nd.inputs['Base Color'].default_value = (0.55, 0.55, 0.55, 1.0)
                nd.inputs['Roughness'].default_value = 0.03
                try: nd.inputs['Emission Strength'].default_value = 0.0
                except Exception: pass
                print('ESPEJO', mat.name)

# Realismo de materiales: relieve sutil desde la textura, variación de rugosidad y moteado fino en superficies oscuras/mates.
# No toca espejos, cristal, transparencias ni los materiales de suelo con juntas (ya tienen su propia normal).
def realismo_materiales():
    for m in bpy.data.materials:
        try:
            if not m.use_nodes: continue
            nt = m.node_tree
            bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
            if not bsdf: continue
            if bsdf.inputs['Normal'].is_linked: continue
            if bsdf.inputs['Alpha'].default_value < 0.99 or bsdf.inputs['Alpha'].is_linked: continue
            tr = bsdf.inputs['Transmission Weight'].default_value if 'Transmission Weight' in bsdf.inputs else 0
            rg = bsdf.inputs['Roughness'].default_value
            if tr > 0.01 or bsdf.inputs['Metallic'].default_value >= 0.8 or rg < 0.1: continue
            if any(n.type == 'EMISSION' for n in nt.nodes) or bsdf.inputs['Emission Strength'].default_value > 0.01: continue
            bc = bsdf.inputs['Base Color']
            tex = bc.links[0].from_node if bc.is_linked and bc.links[0].from_node.type == 'TEX_IMAGE' else None
            if tex: tex.interpolation = 'Cubic'
            col = bc.default_value
            lum = 0.2126 * col[0] + 0.7152 * col[1] + 0.0722 * col[2]
            oscuro = (not tex) and lum < 0.12 or (tex and rg > 0.5)
            normal_out = None
            if tex:  # relieve a partir de la luminosidad de la imagen
                bw = nt.nodes.new('ShaderNodeRGBToBW'); nt.links.new(bc.links[0].from_socket, bw.inputs[0])
                bm = nt.nodes.new('ShaderNodeBump'); bm.inputs['Strength'].default_value = 0.25; bm.inputs['Distance'].default_value = 0.002
                nt.links.new(bw.outputs[0], bm.inputs['Height']); normal_out = bm.outputs[0]
            if rg > 0.25 or oscuro:  # moteado fino y variación de rugosidad
                tc = nt.nodes.new('ShaderNodeTexCoord')
                nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 600.0; nz.inputs['Detail'].default_value = 6.0
                nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
                sp = nt.nodes.new('ShaderNodeBump'); sp.inputs['Strength'].default_value = 0.12 if oscuro else 0.05; sp.inputs['Distance'].default_value = 0.001
                nt.links.new(nz.outputs['Fac'], sp.inputs['Height'])
                if normal_out: nt.links.new(normal_out, sp.inputs['Normal'])
                normal_out = sp.outputs[0]
                if not bsdf.inputs['Roughness'].is_linked:
                    nz2 = nt.nodes.new('ShaderNodeTexNoise'); nz2.inputs['Scale'].default_value = 8.0; nz2.inputs['Detail'].default_value = 4.0
                    nt.links.new(tc.outputs['Object'], nz2.inputs['Vector'])
                    mr = nt.nodes.new('ShaderNodeMapRange'); mr.inputs['To Min'].default_value = max(0.05, rg - 0.1); mr.inputs['To Max'].default_value = min(1.0, rg + 0.1)
                    nt.links.new(nz2.outputs['Fac'], mr.inputs['Value']); nt.links.new(mr.outputs['Result'], bsdf.inputs['Roughness'])
            if normal_out: nt.links.new(normal_out, bsdf.inputs['Normal'])
        except Exception as e:
            print('REALISMO_ERR', m.name, e)
realismo_materiales()

# cámara de la vista del visor
cam =bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
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
sc.view_settings.view_transform = 'Khronos PBR Neutral'
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
# Exposición del visor: se traduce a la del render (2,8 pasos con los valores por defecto del visor: exposición 1 y EV 7); cada paso de EV hacia arriba oscurece un paso
if info.get('modoExposicion') == 'visor':
    ex = float(info.get('exposicion') or 1.0); ev = float(info.get('ev') if info.get('ev') is not None else 7)
    # Exposición física, idéntica a la del visor: el visor aplica exposición / (1,2 · 2^EV) a luces en lux; en Blender las luces están en vatios (÷ 683), así que
    # la exposición en pasos es log2(683 · exposición / (1,2 · 2^EV)). Sin ningún añadido: lo que pone el usuario es lo que se aplica.
    sc.view_settings.exposure = math.log2(683.0 * max(0.05, ex) / (1.2 * (2.0 ** ev)))
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
def equilibrio(fuerza=0.6):
    try:
        import numpy as np
        im = bpy.data.images.load(out); wd, ht = im.size; buf = np.empty(wd * ht * 4, dtype=np.float32); im.pixels.foreach_get(buf); a = buf.reshape(-1, 4)
        m = a[::37, :3].mean(axis=0)
        if min(m) < 0.003: return
        g = float(m.mean()); gain = np.clip((g / m) ** fuerza, 0.75, 1.25)
        a[:, :3] = np.clip(a[:, :3] * gain, 0.0, 1.0); im.pixels.foreach_set(buf); im.filepath_raw = out; im.file_format = 'PNG'; im.save()
        print('BALANCE', [round(float(x), 3) for x in gain])
    except Exception as e:
        print('BALANCE_ERR', e)
if info.get('balance') is not False: equilibrio()
print('LISTO', out, len(info['luces']), 'luces')

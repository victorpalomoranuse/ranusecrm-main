/* Lector de DXF → bloques en planta (trazos a escala, en cm) para la biblioteca de planos.
   Lee las definiciones de bloque (sección BLOCKS) y las convierte en un dibujo de líneas:
   LINE, LWPOLYLINE/POLYLINE (con arcos), CIRCLE, ARC, ELLIPSE, SPLINE e INSERT anidados.
   Los rellenos (HATCH), textos y cotas se ignoran: el bloque queda solo con sus trazos. */
(function (root) {
  'use strict';
  var UNIDAD_CM = { 1: 2.54, 2: 30.48, 3: 160934.4, 4: 0.1, 5: 1, 6: 100, 7: 100000, 8: 0.000254, 9: 0.00254, 10: 91.44, 14: 10, 15: 1000 };

  function pares(texto) {
    var L = texto.split(/\r?\n/), P = [], i;
    for (i = 0; i + 1 < L.length; i += 2) P.push([parseInt(L[i], 10), L[i + 1].trim()]);
    return P;
  }
  function vacia(ent) { return ent; }

  /* agrupa pares en entidades {t:'LINE', g:[[c,v]…]} dentro de un tramo */
  function entidades(P, i0, i1) {
    var out = [], cur = null, i;
    for (i = i0; i < i1; i++) {
      var c = P[i][0], v = P[i][1];
      if (c === 0) { cur = { t: v, g: [] }; out.push(cur); }
      else if (cur) cur.g.push([c, v]);
    }
    return out;
  }
  function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
  function primero(g, c, def) { for (var i = 0; i < g.length; i++) if (g[i][0] === c) return num(g[i][1]); return def; }
  function todos(g, c) { var r = []; for (var i = 0; i < g.length; i++) if (g[i][0] === c) r.push(num(g[i][1])); return r; }

  function arcoPuntos(cx, cy, r, a0, a1, paso) {
    var pts = [], n, i, d = a1 - a0;
    while (d <= 0) d += Math.PI * 2;
    n = Math.max(2, Math.ceil(d / (paso || 0.2)));
    for (i = 0; i <= n; i++) { var a = a0 + d * i / n; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
    return pts;
  }
  function bulgePuntos(p, q, b) { // tramo con "bulge": arco entre p y q
    if (!b) return [q];
    var dx = q[0] - p[0], dy = q[1] - p[1], c = Math.hypot(dx, dy);
    if (c < 1e-9) return [q];
    var th = 4 * Math.atan(b), h = (c / 2) / Math.tan(th / 2), R = Math.abs(c / (2 * Math.sin(th / 2)));
    var mx = (p[0] + q[0]) / 2 + (-dy / c) * h, my = (p[1] + q[1]) / 2 + (dx / c) * h;
    var a0 = Math.atan2(p[1] - my, p[0] - mx), n = Math.max(2, Math.ceil(Math.abs(th) / 0.2)), pts = [], i;
    for (i = 1; i <= n; i++) { var a = a0 + th * i / n; pts.push([mx + R * Math.cos(a), my + R * Math.sin(a)]); }
    pts[pts.length - 1] = q;
    return pts;
  }
  function deBoor(grado, knots, ctrl, u) {
    var n = ctrl.length - 1, k = -1, i;
    for (i = grado; i <= n; i++) if (u >= knots[i] && u < knots[i + 1]) { k = i; break; }
    if (k < 0) k = n;
    var d = [], j, r;
    for (j = 0; j <= grado; j++) d.push([ctrl[j + k - grado][0], ctrl[j + k - grado][1]]);
    for (r = 1; r <= grado; r++) {
      for (j = grado; j >= r; j--) {
        var den = knots[j + 1 + k - r] - knots[j + k - grado];
        var al = den === 0 ? 0 : (u - knots[j + k - grado]) / den;
        d[j] = [(1 - al) * d[j - 1][0] + al * d[j][0], (1 - al) * d[j - 1][1] + al * d[j][1]];
      }
    }
    return d[grado];
  }
  function splinePuntos(g) {
    var grado = primero(g, 71, 3), knots = todos(g, 40), xs = todos(g, 10), ys = todos(g, 20), ctrl = [], i;
    for (i = 0; i < Math.min(xs.length, ys.length); i++) ctrl.push([xs[i], ys[i]]);
    var fx = todos(g, 11), fy = todos(g, 21), fit = [];
    for (i = 0; i < Math.min(fx.length, fy.length); i++) fit.push([fx[i], fy[i]]);
    if (ctrl.length < 2 && fit.length >= 2) return fit;
    if (ctrl.length < 2) return [];
    if (knots.length !== ctrl.length + grado + 1 || grado < 1 || ctrl.length <= grado) return ctrl;
    var u0 = knots[grado], u1 = knots[ctrl.length], n = Math.max(6, Math.min(24, ctrl.length * 3)), pts = [];
    for (i = 0; i <= n; i++) {
      var u = u0 + (u1 - u0) * i / n; if (i === n) u = u1 - 1e-9;
      pts.push(deBoor(grado, knots, ctrl, u));
    }
    return pts;
  }

  /* convierte una entidad en trazos [{p:[[x,y]…], c:cerrado}] */
  function trazos(e, bloques, prof) {
    var r = trazos0(e, bloques, prof);
    if ((e.t === 'LWPOLYLINE' || e.t === 'CIRCLE' || e.t === 'ARC' || e.t === 'POLYLINE') && primero(e.g, 230, 1) < 0)
      r.forEach(function (t) { t.p = t.p.map(function (q) { return [-q[0], q[1]]; }); });
    return r;
  }
  function trazos0(e, bloques, prof) {
    var g = e.g, out = [], i;
    if (e.t === 'LINE') out.push({ p: [[primero(g, 10, 0), primero(g, 20, 0)], [primero(g, 11, 0), primero(g, 21, 0)]], c: false });
    else if (e.t === 'LWPOLYLINE') {
      var vs = [], flags = primero(g, 70, 0);
      for (i = 0; i < g.length; i++) {
        if (g[i][0] === 10) vs.push({ x: num(g[i][1]), y: 0, b: 0 });
        else if (g[i][0] === 20 && vs.length) vs[vs.length - 1].y = num(g[i][1]);
        else if (g[i][0] === 42 && vs.length) vs[vs.length - 1].b = num(g[i][1]);
      }
      if (vs.length >= 2) {
        var pts = [[vs[0].x, vs[0].y]], n = (flags & 1) ? vs.length : vs.length - 1;
        for (i = 0; i < n; i++) {
          var a = vs[i], b = vs[(i + 1) % vs.length];
          pts = pts.concat(bulgePuntos([a.x, a.y], [b.x, b.y], a.b));
        }
        out.push({ p: pts, c: !!(flags & 1) });
      }
    } else if (e.t === 'POLYLINE' && e.vert) {
      var pp = e.vert.map(function (v) { return [v.x, v.y]; });
      if (pp.length >= 2) out.push({ p: pp, c: !!(primero(g, 70, 0) & 1) });
    } else if (e.t === 'CIRCLE') {
      out.push({ p: arcoPuntos(primero(g, 10, 0), primero(g, 20, 0), primero(g, 40, 0), 0, Math.PI * 2, 0.2), c: true });
    } else if (e.t === 'ARC') {
      out.push({ p: arcoPuntos(primero(g, 10, 0), primero(g, 20, 0), primero(g, 40, 0), primero(g, 50, 0) * Math.PI / 180, primero(g, 51, 360) * Math.PI / 180, 0.15), c: false });
    } else if (e.t === 'ELLIPSE') {
      var cx = primero(g, 10, 0), cy = primero(g, 20, 0), mx = primero(g, 11, 1), my = primero(g, 21, 0), ra = primero(g, 40, 1), t0 = primero(g, 41, 0), t1 = primero(g, 42, Math.PI * 2);
      var rot = Math.atan2(my, mx), a1 = Math.hypot(mx, my), b1 = a1 * ra, d = t1 - t0, k, pe = [];
      while (d <= 0) d += Math.PI * 2;
      var ne = Math.max(8, Math.ceil(d / 0.25));
      for (k = 0; k <= ne; k++) {
        var t = t0 + d * k / ne, ex = a1 * Math.cos(t), ey = b1 * Math.sin(t) * (primero(g, 230, 1) < 0 ? -1 : 1);
        pe.push([cx + ex * Math.cos(rot) - ey * Math.sin(rot), cy + ex * Math.sin(rot) + ey * Math.cos(rot)]);
      }
      out.push({ p: pe, c: d >= Math.PI * 2 - 1e-6 });
    } else if (e.t === 'SPLINE') {
      var sp = splinePuntos(g);
      if (sp.length >= 2) out.push({ p: sp, c: !!(primero(g, 70, 0) & 1) });
    } else if (e.t === 'INSERT' && prof < 5) {
      var nm = (g.filter(function (x) { return x[0] === 2; })[0] || [0, ''])[1], bl = bloques[nm];
      if (bl) {
        var sx = primero(g, 41, 1), sy = primero(g, 42, 1), rotI = primero(g, 50, 0) * Math.PI / 180, px = primero(g, 10, 0), py = primero(g, 20, 0);
        var co = Math.cos(rotI), si = Math.sin(rotI), bx = bl.base[0], by = bl.base[1];
        trazosDe(bl, bloques, prof + 1).forEach(function (t) {
          out.push({ c: t.c, p: t.p.map(function (q) { var x = (q[0] - bx) * sx, y = (q[1] - by) * sy; return [px + x * co - y * si, py + x * si + y * co]; }) });
        });
      }
    }
    return out;
  }
  function trazosDe(bl, bloques, prof) {
    if (bl._cache && prof === 0) return bl._cache;
    var out = [];
    bl.ents.forEach(function (e) { trazos(e, bloques, prof || 0).forEach(function (t) { out.push(t); }); });
    return out;
  }

  function rdp(p, eps) {
    if (p.length < 3) return p;
    var keep = new Uint8Array(p.length), stack = [[0, p.length - 1]];
    keep[0] = keep[p.length - 1] = 1;
    while (stack.length) {
      var s = stack.pop(), a = p[s[0]], b = p[s[1]], dx = b[0] - a[0], dy = b[1] - a[1], den = Math.hypot(dx, dy), md = -1, mi = -1, i;
      for (i = s[0] + 1; i < s[1]; i++) {
        var d = den < 1e-9 ? Math.hypot(p[i][0] - a[0], p[i][1] - a[1]) : Math.abs(dy * p[i][0] - dx * p[i][1] + b[0] * a[1] - b[1] * a[0]) / den;
        if (d > md) { md = d; mi = i; }
      }
      if (md > eps) { keep[mi] = 1; stack.push([s[0], mi]); stack.push([mi, s[1]]); }
    }
    return p.filter(function (_, i) { return keep[i]; });
  }
  /* rectángulos que enmarcan el bloque (con margen alrededor del dibujo): se descartan */
  function cajaDe(pts) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, i;
    for (i = 0; i < pts.length; i++) { var q = pts[i]; if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1]; }
    return { x0: x0, y0: y0, x1: x1, y1: y1 };
  }
  function esRectangulo(t) {
    var p = t.p.slice();
    if (p.length === 5 && Math.hypot(p[0][0] - p[4][0], p[0][1] - p[4][1]) < 1e-6) p.pop();
    if (p.length !== 4 || (!t.c && t.p.length !== 5)) return null;
    var b = cajaDe(p), tol = Math.max(b.x1 - b.x0, b.y1 - b.y0) * 1e-4 + 1e-9, i;
    for (i = 0; i < 4; i++) {
      var a = p[i], c = p[(i + 1) % 4];
      if (Math.abs(a[0] - c[0]) > tol && Math.abs(a[1] - c[1]) > tol) return null;
    }
    return b;
  }
  function quitarMarcos(tr) {
    var vuelta, i, j;
    for (vuelta = 0; vuelta < 3; vuelta++) {
      var mejor = -1, area = -1, bm = null;
      for (i = 0; i < tr.length; i++) {
        var b = esRectangulo(tr[i]);
        if (!b) continue;
        var w = b.x1 - b.x0, h = b.y1 - b.y0, a = w * h;
        if (a <= area) continue;
        var otros = [];
        for (j = 0; j < tr.length; j++) if (j !== i) otros = otros.concat(tr[j].p);
        if (!otros.length) continue;
        var c = cajaDe(otros), m = Math.min(c.x0 - b.x0, b.x1 - c.x1, c.y0 - b.y0, b.y1 - c.y1), g = 0.02 * Math.max(w, h);
        if (m >= g) { mejor = i; area = a; bm = b; }
      }
      if (mejor < 0) break;
      tr.splice(mejor, 1);
    }
    return tr;
  }
  /* trazos sueltos lejos del dibujo (marcas de esquina, restos del marco): se descartan */
  function quitarSueltos(tr) {
    if (tr.length < 4) return tr;
    var info = tr.map(function (t) {
      var len = 0, i; for (i = 1; i < t.p.length; i++) len += Math.hypot(t.p[i][0] - t.p[i - 1][0], t.p[i][1] - t.p[i - 1][1]);
      return { t: t, len: len, b: cajaDe(t.p) };
    });
    var orden = info.slice().sort(function (a, b) { return b.len - a.len; }), total = 0;
    orden.forEach(function (x) { total += x.len; });
    var acum = 0, core = [], i;
    for (i = 0; i < orden.length && acum < total * 0.8; i++) { core.push(orden[i]); acum += orden[i].len; }
    var cb = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    core.forEach(function (x) { cb.x0 = Math.min(cb.x0, x.b.x0); cb.y0 = Math.min(cb.y0, x.b.y0); cb.x1 = Math.max(cb.x1, x.b.x1); cb.y1 = Math.max(cb.y1, x.b.y1); });
    var m = 0.35 * Math.max(cb.x1 - cb.x0, cb.y1 - cb.y0);
    var fuera = info.filter(function (x) { return x.b.x1 < cb.x0 - m || x.b.x0 > cb.x1 + m || x.b.y1 < cb.y0 - m || x.b.y0 > cb.y1 + m; });
    if (!fuera.length || fuera.length > info.length * 0.3) return tr;
    return info.filter(function (x) { return fuera.indexOf(x) < 0; }).map(function (x) { return x.t; });
  }
  /* nombres en inglés → español, vista (planta / frente / lateral) y categoría */
  var FRASES = [
    ['single row parking', 'aparcamiento en una fila'], ['two rows parking', 'aparcamiento en dos filas'], ['bicycle parking', 'aparcamiento de bicicletas'],
    ['container ship', 'buque portacontenedores'], ['cargo truck', 'camión de carga'], ['cement truck', 'camión hormigonera'], ['fire truck', 'camión de bomberos'],
    ['garbage truck', 'camión de basura'], ['construction truck', 'camión de obra'], ['road roller', 'apisonadora'], ['private jet', 'jet privado'], ['jet airliner', 'avión a reacción'],
    ['sport yacht', 'yate deportivo'], ['luxury yacht', 'yate de lujo'], ['motor boat', 'lancha motora'], ['sailing boat', 'velero'], ['compact hatchback', 'coche compacto'],
    ['hatchback car', 'coche compacto'], ['liftback car', 'berlina'], ['roadster car', 'descapotable'], ['taxi car', 'taxi'], ['pickup car', 'pick-up'],
    ['sectional soft sofa', 'sofá modular'], ['corner sofa', 'sofá rinconero'], ['dining table', 'mesa de comedor'], ['meeting table', 'mesa de reuniones'],
    ['office units', 'puestos de oficina'], ['night stand', 'mesilla de noche'], ['double bed', 'cama doble'], ['single bed', 'cama individual'], ['hospital bed', 'cama de hospital'],
    ['wardrobe sliding door', 'armario con puerta corredera'], ['monoblock toilet', 'inodoro monobloque'], ['ep wallhung', 'inodoro suspendido'], ['wall hung', 'suspendido'],
    ['sitting at the table', 'sentada a la mesa'], ['table tennis', 'tenis de mesa'], ['hazmat suit', 'traje de protección'], ['open arms', 'brazos abiertos'], ['on bicycle', 'en bicicleta'],
    ['walking with an umbrella', 'andando con paraguas'], ['walking with a carriage', 'con carrito de bebé'], ['walking dogs', 'paseando perros'], ['sitting with a book', 'sentada con libro'], ['hospital stuff', 'personal sanitario'],
    ['coffee table', 'mesa de centro'], ['tv unit wallmounted', 'mueble de TV de pared'], ['tv unit', 'mueble de TV'], ['carpet lines round', 'alfombra redonda'], ['carpet lines', 'alfombra'], ['elliptical table', 'mesa elíptica'],
    ['kitchen sink', 'fregadero'], ['corner shower', 'ducha de esquina'], ['rainfinity shower system', 'sistema de ducha'], ['electric stove', 'cocina eléctrica'],
    ['fridge single door', 'frigorífico de una puerta'], ['glass partition with door', 'mampara de cristal con puerta'], ['glass partition', 'mampara de cristal'],
    ['laboratory equipment', 'equipo de laboratorio'], ['pilates reformer', 'reformer de pilates'], ['upright exercise bike', 'bicicleta estática vertical'],
    ['elliptical trainer', 'elíptica'], ['exercise bike', 'bicicleta estática'], ['tv set', 'televisor'], ['freestanding tv', 'televisor'], ['picture window', 'ventana fija'],
    ['fixed arc window', 'ventana fija en arco'], ['locker bench', 'banco de vestuario'], ['sink base cabinet', 'mueble bajo con fregadero'], ['us sink base cabinet', 'mueble bajo con fregadero']
  ];
  var PALABRAS = {
    car: 'coche', truck: 'camión', bus: 'autobús', jet: 'jet', airliner: 'avión', yacht: 'yate', boat: 'barco', ship: 'barco', train: 'tren', bicycle: 'bicicleta', bike: 'bici',
    biker: 'motorista', motorbike: 'moto', scooter: 'escúter', bulldozer: 'buldócer', crane: 'grúa', catamaran: 'catamarán', parking: 'aparcamiento', sofa: 'sofá',
    armchair: 'sillón', chair: 'silla', table: 'mesa', desk: 'escritorio', bed: 'cama', wardrobe: 'armario', locker: 'taquilla', bench: 'banco', toilet: 'inodoro',
    sink: 'lavabo', shower: 'ducha', bath: 'bañera', bathtub: 'bañera', fridge: 'frigorífico', stove: 'cocina', window: 'ventana', door: 'puerta', treadmill: 'cinta de correr',
    trainer: 'entrenador', cabinet: 'mueble', basic: '', round: 'redonda', rectangular: 'rectangular', double: 'doble', single: 'simple', big: 'grande', small: 'pequeño',
    elliptical: 'elíptica', coffee: 'de centro', square: 'cuadrada', corner: 'rinconero', lines: '', unit: 'mueble', units: 'muebles', wallmounted: 'de pared',
    person: 'persona', people: 'personas', man: 'hombre', woman: 'mujer', boy: 'niño', girl: 'niña', infant: 'bebé', child: 'niño', old: 'mayor', walking: 'andando',
    standing: 'de pie', sitting: 'sentada', running: 'corriendo', mowing: 'cortando césped', hockey: 'hockey', rugby: 'rugby', soccer: 'fútbol', football: 'fútbol americano',
    basketball: 'baloncesto', rowing: 'remando', reading: 'leyendo', umbrella: 'paraguas', carriage: 'carrito', dogs: 'perros', hospital: 'hospital', patient: 'paciente',
    surgeon: 'cirujano', disabled: 'en silla de ruedas', lying: 'tumbado', crawling: 'gateando', book: 'libro', stuff: 'personal', a: '', an: '', the: '', in: '', at: 'en', on: 'en',
    large: 'grande', medium: 'mediano', with: 'con', and: 'y', of: 'de', plant: 'planta', lamp: 'lámpara', shelf: 'estantería', shelves: 'estanterías', rack: 'rack',
    mirror: 'espejo', bin: 'papelera', stool: 'taburete', sofa2: 'sofá', stair: 'escalera', stairs: 'escalera', elevator: 'ascensor', lift: 'ascensor', counter: 'mostrador',
    kitchen: 'cocina', bathroom: 'baño', washing: 'lavadora', machine: 'máquina', washer: 'lavadora', dryer: 'secadora', oven: 'horno', microwave: 'microondas',
    tree: 'árbol', bush: 'arbusto', palm: 'palmera', fence: 'valla', gate: 'portón', curtain: 'cortina', carpet: 'alfombra', rug: 'alfombra', piano: 'piano'
  };
  function nombreEs(orig) {
    var n = String(orig || '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim(), vista = 'planta', low;
    if (/\bside view\b/i.test(n)) { vista = 'lateral'; n = n.replace(/\s*\bside view\b/ig, ''); }
    else if (/\bfront view\b/i.test(n)) { vista = 'frente'; n = n.replace(/\s*\bfront view\b/ig, ''); }
    var talla = '', m = /\s+(XXL|XL|XS|S|M|L)$/.exec(n);
    if (m) { talla = m[1]; n = n.slice(0, m.index); }
    else { m = /\s+([A-Z])$/.exec(n); if (m) { talla = m[1]; n = n.slice(0, m.index); } }
    low = n.toLowerCase();
    var i, hecho = '';
    for (i = 0; i < FRASES.length; i++) {
      var f = FRASES[i];
      if (low.indexOf(f[0]) >= 0) { hecho = f[1]; low = low.replace(f[0], '\u0001').trim(); break; }
    }
    var resto = low.split(/\s+/).filter(Boolean).map(function (w) {
      if (w === '\u0001') return hecho;
      if (Object.prototype.hasOwnProperty.call(PALABRAS, w)) return PALABRAS[w];
      if (/\d/.test(w) || /^(i|ii|iii|iv|v|a|b|c|tv)$/.test(w)) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).filter(function (w) { return w !== ''; }).join(' ');
    resto = resto.replace(/\s+/g, ' ').trim() || n;
    var ws = resto.split(' '), uniq = [];
    ws.forEach(function (w) { if (uniq.length === 0 || uniq[uniq.length - 1].toLowerCase() !== w.toLowerCase()) uniq.push(w); });
    var half = uniq.length / 2;
    if (uniq.length >= 4 && uniq.length % 2 === 0 && uniq.slice(0, half).join(' ').toLowerCase() === uniq.slice(half).join(' ').toLowerCase()) uniq = uniq.slice(0, half);
    var NOMBRES = ['silla', 'sofá', 'sillón', 'mesa', 'cama', 'taburete', 'lámpara', 'escritorio'];
    if (uniq.length >= 2 && NOMBRES.indexOf(uniq[uniq.length - 1]) >= 0 && uniq.slice(0, -1).every(function (w) { return /^[A-ZÁÉÍÓÚ0-9]/.test(w) || /^[a-z]+$/.test(w) === false; })) uniq.unshift(uniq.pop());
    resto = uniq.join(' ');
    var cat = categoria(orig);
    var out = resto.charAt(0).toUpperCase() + resto.slice(1) + (talla ? ' (' + talla + ')' : '');
    return { nombre: out + (vista === 'planta' ? '' : ' · ' + vista), vista: vista, categoria: cat };
  }
  function categoria(orig) {
    var t = String(orig || '').toLowerCase();
    if (/person|people|woman|\bman\b|boy\b|girl\b|infant|child|surgeon|patient|hospital stuff/.test(t)) return 'Personas';
    if (/car\b|truck|bus\b|jet|airliner|yacht|boat|ship|train|motorbike|scooter|bulldozer|crane|roller|parking|catamaran|biker|bicycle|hatchback|liftback|roadster|taxi|pickup|sailing|moped/.test(t)) return 'Transporte';
    if (/treadmill|exercise|trainer|reformer|crossbar|pilates|dumbbell|barbell|rack|bench press|rower/.test(t)) return 'Fitness';
    if (/toilet|shower|bath|ep wallhung|bidet|rainfinity|urinal/.test(t)) return 'Baño';
    if (/sink|kitchen|stove|fridge|oven|dishwasher|hood/.test(t)) return 'Cocina';
    if (/window|door|partition|gate/.test(t)) return 'Puertas y ventanas';
    if (/sofa|armchair|chair|table|desk|bed|night|wardrobe|tv\b|office|units|bench|locker|stand|aeron|shelf|cabinet|lamp|plant|rug|carpet/.test(t)) return 'Mobiliario';
    return 'Mi biblioteca';
  }
  function f1(n) { return String(Math.round(n * 10) / 10); }

  function parseDXF(texto) {
    var P = pares(texto), i, sec = '', unidad = 0, ini = {}, fin = {};
    for (i = 0; i < P.length; i++) {
      if (P[i][0] === 0 && P[i][1] === 'SECTION' && P[i + 1]) { sec = P[i + 1][1]; ini[sec] = i + 2; }
      else if (P[i][0] === 0 && P[i][1] === 'ENDSEC') fin[sec] = i;
      else if (sec === 'HEADER' && P[i][0] === 9 && P[i][1] === '$INSUNITS' && P[i + 1]) unidad = parseInt(P[i + 1][1], 10) || 0;
    }
    var bloques = {}, orden = [];
    if (ini.BLOCKS != null) {
      var ents = entidades(P, ini.BLOCKS, fin.BLOCKS || P.length), cur = null, pol = null;
      ents.forEach(function (e) {
        if (e.t === 'BLOCK') {
          var nm = (e.g.filter(function (x) { return x[0] === 2; })[0] || [0, ''])[1];
          cur = { name: nm, base: [primero(e.g, 10, 0), primero(e.g, 20, 0)], ents: [] };
          bloques[nm] = cur; orden.push(nm); pol = null;
        } else if (e.t === 'ENDBLK') { cur = null; pol = null; }
        else if (cur) {
          if (e.t === 'POLYLINE') { e.vert = []; pol = e; cur.ents.push(e); }
          else if (e.t === 'VERTEX' && pol) pol.vert.push({ x: primero(e.g, 10, 0), y: primero(e.g, 20, 0) });
          else if (e.t === 'SEQEND') pol = null;
          else cur.ents.push(e);
        }
      });
    }
    return { unidad: unidad, bloques: bloques, orden: orden };
  }

  /* lista de bloques listos para previsualizar y guardar */
  function bloquesDe(texto, opciones) {
    var doc = parseDXF(texto), res = [], esc = UNIDAD_CM[doc.unidad] || 0, LIM = (opciones && opciones.maxChars) || 90000;
    doc.orden.forEach(function (nm) {
      if (nm.charAt(0) === '*') return;
      var bl = doc.bloques[nm], tr = trazosDe(bl, doc.bloques, 0);
      if (!opciones || opciones.marcos !== false) tr = quitarSueltos(quitarMarcos(tr.slice()));
      if (!tr.length) return;
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      tr.forEach(function (t) { t.p.forEach(function (q) { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1]; }); });
      var raw = Math.max(x1 - x0, y1 - y0);
      if (!(raw > 0)) return;
      var k = esc || 1, aprox = false;
      if (raw * k < 3) { k *= 100; aprox = true; } else if (raw * k > 4000) { k *= 0.1; aprox = true; }
      var largo = (x1 - x0) * k, fondo = (y1 - y0) * k, eps = 0.25, d, chars, n;
      do {
        d = []; n = 0;
        tr.forEach(function (t) {
          var q = t.p.map(function (v) { return [(v[0] - x0) * k, (y1 - v[1]) * k]; });
          q = rdp(q, eps);
          if (q.length < 2) return;
          var len = 0, i; for (i = 1; i < q.length; i++) len += Math.hypot(q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1]);
          if (len < 0.5) return;
          n += q.length;
          d.push('M' + q.map(function (v) { return f1(v[0]) + ' ' + f1(v[1]); }).join('L') + (t.c ? 'Z' : ''));
        });
        chars = d.join('').length; eps *= 1.6;
      } while (chars > LIM && eps < 30);
      if (!d.length) return;
      res.push({
        nombre: nombreEs(nm).nombre, original: nm, vista: nombreEs(nm).vista, categoria: nombreEs(nm).categoria, largo: Math.round(largo * 10) / 10, fondo: Math.round(fondo * 10) / 10,
        planta: '<path d="' + d.join('') + '" stroke="#000000" stroke-width="1" fill="none" stroke-linejoin="round" stroke-linecap="round"/>',
        trazos: d.length, puntos: n, aprox: aprox, generico: /^(block|group|copy of|crossbar|\d)/i.test(nm)
      });
    });
    return { unidad: doc.unidad, bloques: res };
  }
  var API = { parseDXF: parseDXF, bloquesDe: bloquesDe, nombreEs: nombreEs };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.RanuseDXF = API;
})(typeof window !== 'undefined' ? window : this);

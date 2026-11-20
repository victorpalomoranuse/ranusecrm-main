// Modelado tipo SketchUp para el visor 3D: dibujar formas sobre CUALQUIER cara (o sobre un plano bloqueado con las flechas)
// y empujar / tirar de ellas en la dirección de su cara. Cada forma es un objeto «extr»: un contorno en un plano + una distancia.
import * as THREE from 'three';

const CM = 0.01;
const AZUL = 0x1b6dd6, ROJO = 0xe03131, VERDE = 0x2f9e44;

// Base (u, v, n) de un plano a partir de su normal: u horizontal si se puede, v hacia arriba, u × v = n
export function baseDePlano(n0) {
  const n = n0.clone().normalize();
  const u = Math.abs(n.y) > 0.999 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0).cross(n).normalize();
  const v = n.clone().cross(u).normalize();
  return { u, v, n };
}

// Geometría de un objeto «extr» (en metros, ya colocada: el grupo del objeto solo pone el centro y el giro)
export function geometriaExtr(o) {
  const pl = o.pl || [];
  const sh = new THREE.Shape(pl.map(p => new THREE.Vector2(p[0] * CM, p[1] * CM)));
  const d = (o.dist || 0) * CM;
  let geo;
  if (Math.abs(d) < 0.0005) geo = new THREE.ShapeGeometry(sh);
  else { geo = new THREE.ExtrudeGeometry(sh, { depth: Math.abs(d), bevelEnabled: false }); if (d < 0) geo.translate(0, 0, -Math.abs(d)); }
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...o.o3.u), new THREE.Vector3(...o.o3.v), new THREE.Vector3(...o.o3.n));
  m.setPosition(0, ((o.o3.y || 0) + (o.z0 || 0)) * CM, 0);
  geo.applyMatrix4(m);
  return geo;
}

// Medidas reales de una forma «extr» en el mundo (X, Z y altura) y su caja: sirve para las cotas y el Inspector aunque esté dibujada en una pared o inclinada
export function dimsExtr(o) {
  const geo = geometriaExtr(o); geo.computeBoundingBox(); const bx = geo.boundingBox.clone(); geo.dispose();
  const ang = -(o.rot || 0) * Math.PI / 180, co = Math.cos(ang), si = Math.sin(ang), xs = [], zs = [];
  for (const x of [bx.min.x, bx.max.x]) for (const z of [bx.min.z, bx.max.z]) { xs.push(x * co + z * si); zs.push(-x * si + z * co); }
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs), r1 = v => Math.round(v * 10) / 10;
  return { w: r1((x1 - x0) / CM), d: r1((z1 - z0) / CM), alto: r1((bx.max.y - bx.min.y) / CM), cx: o.cx + (x0 + x1) / 2 / CM, cy: o.cy + (z0 + z1) / 2 / CM, z0: bx.min.y / CM };
}

export function crearModelador(c) {
  const V3 = THREE.Vector3, sueloP = new THREE.Plane(new V3(0, 1, 0), 0), pt = new V3(), p2 = new THREE.Vector2();
  let lock = null;          // plano bloqueado: 'h' horizontal · 'x' vertical (eje rojo) · 'z' vertical (eje verde)
  let plano = null;         // { o, u, v, n } cuando ya hay primer punto
  let pts = [];             // puntos [u, v] en cm respecto al origen del plano
  let abajo = null, iniDown = false, escrito = '', cur = null, lockDir = null, pull = null;
  let marca = null, linea = null;

  const colorDe = n => (Math.abs(n.y) > 0.9 ? AZUL : Math.abs(n.x) > 0.9 ? ROJO : Math.abs(n.z) > 0.9 ? VERDE : AZUL);
  const quita = o => { if (o) { c.scene.remove(o); o.geometry.dispose(); o.material.dispose(); } return null; };
  const rayoDe = e => {
    const r = c.dom.getBoundingClientRect();
    p2.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    c.rayo.setFromCamera(p2, c.cam);
  };
  const golpe = e => {
    rayoDe(e);
    return c.rayo.intersectObjects([...c.raiz.children, ...c.esc.children], true).find(h => h.object.isMesh && h.face && !h.object.userData.hit && c.impactoVisible(h));
  };
  const textoPlano = () => (lock === 'h' ? 'Plano horizontal (azul)' : lock === 'x' ? 'Plano vertical · eje rojo' : lock === 'z' ? 'Plano vertical · eje verde' : 'Plano libre: el de la cara que toques');
  const ayuda = () => c.setMedida(textoPlano() + '  ·  ↑ horizontal · → vertical rojo · ← vertical verde · ↓ libre');
  // punto con rejilla: solo se ajustan los ejes que están dentro del plano
  const ajusta = (P, n) => {
    const q = P.clone(), g = a => c.snap(a / CM) * CM;
    if (Math.max(Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)) > 0.999) { if (Math.abs(n.x) < 0.5) q.x = g(q.x); if (Math.abs(n.y) < 0.5) q.y = g(q.y); if (Math.abs(n.z) < 0.5) q.z = g(q.z); }
    return q;
  };
  // imán a los vértices y a los puntos medios de las aristas de la cara que se toca (6 cm)
  const imanCara = (h, P, tol = 0.06) => {
    try {
      const pos = h.object.geometry.attributes.position, vs = [h.face.a, h.face.b, h.face.c].map(i => new V3().fromBufferAttribute(pos, i).applyMatrix4(h.object.matrixWorld));
      const cand = [...vs, ...vs.map((v, i) => v.clone().add(vs[(i + 1) % 3]).multiplyScalar(0.5))];
      let mejor = null, dm = tol; cand.forEach(v => { const d = v.distanceTo(P); if (d < dm) { dm = d; mejor = v; } });
      return mejor;
    } catch { return null; }
  };
  // Inferencia: el vértice (esquina) de cualquier otro objeto más cercano al puntero; sirve para que empujar/tirar llegue justo a un punto
  const inferirVertice = (e, excluirOid, tol = 0.1) => {
    rayoDe(e);
    const hs = c.rayo.intersectObjects([...c.raiz.children, ...c.esc.children], true).filter(h => h.object.isMesh && h.face && !h.object.userData.hit && c.impactoVisible(h));
    for (const h of hs) {
      let g = h.object; while (g && !g.userData.oid) g = g.parent;
      if (excluirOid && g && g.userData.oid === excluirOid) continue;
      const v = imanCara(h, h.point.clone(), tol); // vértices y puntos medios de la cara tocada
      return v ? { v, hit: h.point.clone() } : { v: null, hit: h.point.clone() };
    }
    return null;
  };
  const candidato = e => {
    const h = golpe(e); let P, n, im = null;
    if (h) { P = h.point.clone(); n = h.face.normal.clone().transformDirection(h.object.matrixWorld); im = imanCara(h, P); if (im) P = im; }
    else { rayoDe(e); if (!c.rayo.ray.intersectPlane(sueloP, pt)) return null; P = pt.clone(); n = new V3(0, 1, 0); }
    if (lock) n = lock === 'h' ? new V3(0, 1, 0) : lock === 'x' ? new V3(1, 0, 0) : new V3(0, 0, 1);
    rayoDe(e); if (n.dot(c.rayo.ray.direction) > 0) n.negate();
    return { P: im && !lock ? P : ajusta(P, n), n };
  };
  const aMundo = (p) => plano.o.clone().addScaledVector(plano.u, p[0] * CM).addScaledVector(plano.v, p[1] * CM);
  const puntoPlano = (e) => {
    rayoDe(e);
    const pl = new THREE.Plane().setFromNormalAndCoplanarPoint(plano.n, plano.o);
    if (!c.rayo.ray.intersectPlane(pl, pt)) return null;
    const h = golpe(e), im = h ? imanCara(h, pt.clone()) : null;
    if (im && Math.abs(im.clone().sub(plano.o).dot(plano.n)) < 0.02) { const d2 = im.clone().sub(plano.o); return [Math.round(d2.dot(plano.u) / CM * 10) / 10, Math.round(d2.dot(plano.v) / CM * 10) / 10]; }
    rayoDe(e); c.rayo.ray.intersectPlane(pl, pt);
    const d = pt.clone().sub(plano.o);
    return [c.snap(d.dot(plano.u) / CM), c.snap(d.dot(plano.v) / CM)];
  };
  const dibuja = (cursor) => {
    linea = quita(linea);
    let L = pts.slice();
    const forma = c.getForma();
    if (plano && cursor && forma !== 'poli' && pts.length === 1) { L = c.puntosForma(forma, 0, 0, cursor[0], cursor[1]); L = [...L, L[0]]; }
    else if (plano && cursor) L = [...L, cursor];
    if (!plano || L.length < 2) return;
    linea = new THREE.Line(new THREE.BufferGeometry().setFromPoints(L.map(aMundo)), new THREE.LineBasicMaterial({ color: colorDe(plano.n), depthTest: false }));
    linea.renderOrder = 999; c.scene.add(linea);
  };
  const dibujaMarca = (cand) => {
    marca = quita(marca);
    if (!cand) return;
    const b = baseDePlano(cand.n), s = 0.12, o = cand.P.clone().addScaledVector(cand.n, 0.001);
    const q = [[-s, -s], [s, -s], [s, s], [-s, s]].map(([x, y]) => o.clone().addScaledVector(b.u, x).addScaledVector(b.v, y));
    marca = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(q), new THREE.LineBasicMaterial({ color: colorDe(cand.n), depthTest: false }));
    marca.renderOrder = 999; c.scene.add(marca);
  };
  const reinicia = () => { plano = null; pts = []; abajo = null; iniDown = false; escrito = ''; cur = null; lockDir = null; linea = quita(linea); marca = quita(marca); c.setMedida(''); c.ctrl.enabled = true; };

  const cerrar = () => {
    if (!plano || pts.length < 3) { reinicia(); return; }
    const us = pts.map(p => p[0]), vs = pts.map(p => p[1]);
    const o = plano.o.clone().addScaledVector(plano.n, 0.0005); // medio milímetro por delante de la cara para que no parpadee
    const nuevo = {
      id: 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), tipo: 'extr', modelado: true, nombre: 'Forma', cx: o.x / CM, cy: o.z / CM, rot: 0, z0: 0,
      w: Math.max(...us) - Math.min(...us), d: Math.max(...vs) - Math.min(...vs), alto: 0, color: '#9aa3ad',
      o3: { y: o.y / CM, u: plano.u.toArray(), v: plano.v.toArray(), n: plano.n.toArray() }, pl: pts.map(p => [p[0], p[1]]), dist: 0,
    };
    { const dm = dimsExtr(nuevo); nuevo.w = dm.w; nuevo.d = dm.d; nuevo.alto = dm.alto; }
    c.setObjs(prev => [...prev, nuevo]); c.setSelObj(nuevo.id);
    reinicia(); c.setAviso('Forma creada. Púlsale con Empujar/Tirar (P) para darle volumen, o dale color en el Inspector (y márcala como emisiva para una tira LED).');
  };

  const iniciar = (e) => {
    const cand = candidato(e); if (!cand) return false;
    const b = baseDePlano(cand.n);
    plano = { o: cand.P, u: b.u, v: b.v, n: b.n }; pts = [[0, 0]]; marca = quita(marca); lockDir = null; escrito = ''; dibuja(null);
    return true;
  };

  // ── Empujar / Tirar de una forma «extr» ──
  const pullDown = e => {
    const h = golpe(e); if (!h) return false;
    let g = h.object; while (g && !g.userData.oid) g = g.parent; if (!g) return false;
    const ob = c.getObjs().find(x => x.id === g.userData.oid); if (!ob || ob.tipo !== 'extr') return false;
    const nW = new V3(...ob.o3.n).transformDirection(g.matrixWorld), hn = h.face.normal.clone().transformDirection(h.object.matrixWorld);
    const plana = Math.abs(ob.dist || 0) < 0.05;
    if (!plana) {
      const a = hn.dot(nW);
      if (Math.abs(a) < 0.9) { c.setAviso('Tira de la cara de arriba (la paralela a la que dibujaste).'); return true; }
      if (Math.sign(a) !== Math.sign(ob.dist)) { c.setAviso('Esa es la cara de apoyo: tira de la cara contraria.'); return true; }
    }
    c.setSelObj(ob.id); c.ctrl.enabled = false;
    pull = { id: ob.id, ob, dist0: ob.dist || 0, nW, p0: h.point.clone(), x0: e.clientX, y0: e.clientY, malla: h.object, nuevo: null, escrito: '' };
    return true;
  };
  const pullPon = (d) => {
    pull.nuevo = d;
    pull.malla.geometry.dispose(); pull.malla.geometry = geometriaExtr({ ...pull.ob, dist: d });
    c.setMedida((Math.round(d * 10) / 10) + ' cm' + (pull.escrito ? '' : ''));
  };
  const pullMueve = e => {
    const r = c.dom.getBoundingClientRect();
    const pr = P => { const q = P.clone().project(c.cam); return [(q.x * 0.5 + 0.5) * r.width, (-q.y * 0.5 + 0.5) * r.height]; };
    const a = pr(pull.p0), b = pr(pull.p0.clone().add(pull.nW)), s = [b[0] - a[0], b[1] - a[1]], m = [e.clientX - pull.x0, e.clientY - pull.y0], ss = s[0] * s[0] + s[1] * s[1];
    let dn;
    if (Math.sqrt(ss) < 6) { const dist = c.cam.position.distanceTo(pull.p0), cmPx = (2 * dist * Math.tan(c.cam.fov * Math.PI / 360) / c.dom.clientHeight) * 100; dn = -m[1] * cmPx; }
    else dn = ((m[0] * s[0] + m[1] * s[1]) / ss) * 100;
    let d = e.shiftKey ? Math.round(pull.dist0 + dn) : c.snap(pull.dist0 + dn);
    const inf = inferirVertice(e, pull.id);
    if (inf && inf.v) d = Math.round((pull.dist0 + inf.v.clone().sub(pull.p0).dot(pull.nW) / CM) * 10) / 10; // llega justo al punto tocado
    pull.escrito = ''; pullPon(d);
  };
  const pullFin = () => {
    const p = pull; pull = null; c.ctrl.enabled = true; c.setMedida('');
    if (p.nuevo != null && Math.abs(p.nuevo - p.dist0) > 0.01) c.setObjs(prev => prev.map(x => { if (x.id !== p.id) return x; const n2 = { ...x, dist: p.nuevo }, dm = dimsExtr(n2); return { ...n2, w: dm.w, d: dm.d, alto: dm.alto }; }));
    else { p.malla.geometry.dispose(); p.malla.geometry = geometriaExtr(p.ob); }
  };

  // ── Mover (como en SketchUp): clic en un punto del objeto, mover y clic; flechas bloquean el eje; se pega a muros y objetos ──
  let mov = null, lockM = null;
  const TOL = 0.07; // 7 cm de imán
  const cajasDe = (excluidos) => {
    const out = [];
    const toma = o => { const b = new THREE.Box3().setFromObject(o); if (!b.isEmpty()) out.push(b); };
    c.raiz.traverse(o => { if (o.isMesh && !o.userData.hit && !o.userData.overlay && (o.userData.muroId || o.userData.salaKey || o.userData.techoKey || o.userData.pilarId)) toma(o); });
    c.esc.children.forEach(g => { if (!excluidos.has(g)) toma(g); });
    c.raiz.traverse(o => { if (o.userData.equipo && !o.userData.cuerpoDe) toma(o); });
    return out;
  };
  const textoMov = () => {
    const D = mov.D, f = v => Math.round(v / CM * 10) / 10;
    return (lockM === 'x' ? 'Eje rojo · ' : lockM === 'z' ? 'Eje verde · ' : lockM === 'y' ? 'Eje azul (vertical) · ' : '') + 'X ' + f(D.x) + ' · Y ' + f(-D.z) + ' · Alt ' + f(D.y) + ' cm' + (mov.pegado ? '  · pegado' : '');
  };
  const movCalcula = (e) => {
    rayoDe(e);
    let D = new V3();
    if (lockM === 'y') {
      const dir = new V3(); c.cam.getWorldDirection(dir); dir.y = 0; if (dir.lengthSq() < 1e-6) return; dir.normalize();
      const pl = new THREE.Plane().setFromNormalAndCoplanarPoint(dir, mov.base);
      if (!c.rayo.ray.intersectPlane(pl, pt)) return; D.y = pt.y - mov.base.y;
    } else {
      const pl = new THREE.Plane(new V3(0, 1, 0), -mov.base.y);
      if (!c.rayo.ray.intersectPlane(pl, pt)) return; D.set(pt.x - mov.base.x, 0, pt.z - mov.base.z);
      if (lockM === 'x') D.z = 0; else if (lockM === 'z') D.x = 0;
    }
    mov.pegado = false;
    const ejes = lockM === 'x' ? ['x'] : lockM === 'z' ? ['z'] : lockM === 'y' ? ['y'] : ['x', 'z'];
    ejes.forEach(ax => {
      let mejor = null;
      const mn = mov.caja.min[ax] + D[ax], mx = mov.caja.max[ax] + D[ax];
      for (const b of mov.otras) for (const pl of [b.min[ax], b.max[ax]]) for (const dd of [pl - mn, pl - mx]) if (Math.abs(dd) < TOL && (mejor === null || Math.abs(dd) < Math.abs(mejor))) mejor = dd;
      if (mejor !== null) { D[ax] += mejor; mov.pegado = true; } else D[ax] = c.snap(D[ax] / CM) * CM;
    });
    mov.D = D;
    mov.grupos.forEach(({ g, p0 }) => g.position.copy(p0).add(D));
    c.setMedida(textoMov());
  };
  const movCancela = () => { if (!mov) return; mov.grupos.forEach(({ g, p0 }) => g.position.copy(p0)); mov = null; c.ctrl.enabled = true; c.setMedida(''); };
  const movFin = () => {
    const m = mov; mov = null; c.ctrl.enabled = true; c.setMedida('');
    const dx = m.D.x / CM, dz = m.D.z / CM, dy = m.D.y / CM;
    if (Math.abs(dx) + Math.abs(dz) + Math.abs(dy) < 0.05) { m.grupos.forEach(({ g, p0 }) => g.position.copy(p0)); return; }
    const r1 = v => Math.round(v * 10) / 10;
    c.setObjs(prev => prev.map(x => (m.ids.includes(x.id) && !x.bloqueado ? { ...x, cx: r1(x.cx + dx), cy: r1(x.cy + dz), z0: r1((x.z0 || 0) + dy) } : x)));
  };
  const movDown = (e) => {
    if (mov) { movFin(); return true; } // segundo clic: suelta
    const objs = c.getObjs(), movible = i => { const q = objs.find(x => x.id === i); return !!q && q.modelado === true && !q.bloqueado; };
    // como en SketchUp: si ya hay algo seleccionado, se mueve eso y el punto de agarre es donde hagas clic (no hace falta acertar encima de una pieza fina)
    let ids = c.getSel().filter(movible);
    const h = golpe(e);
    if (!ids.length) {
      if (!h) return true;
      let g = h.object; while (g && !g.userData.oid) g = g.parent;
      if (!g) { c.setAviso('Mover solo mueve lo que has modelado.'); return true; }
      const ob = objs.find(x => x.id === g.userData.oid); if (!ob) return true;
      ids = [ob.id, ...objs.filter(y => ob.grupo && y.grupo === ob.grupo && y.id !== ob.id).map(y => y.id)];
      c.seleccionar(ids); ids = ids.filter(movible);
      if (!ids.length) { c.setAviso(c.puedeModelar() ? 'Solo se mueve lo que has modelado aquí.' : 'Para mover lo modelado entra en el espacio «Modelar».'); return true; }
    }
    const grupos = c.esc.children.filter(q => ids.includes(q.userData.oid)).map(q => ({ g: q, p0: q.position.clone() }));
    if (!grupos.length) { c.setAviso('No encuentro esa pieza en la escena.'); return true; }
    // punto de agarre: el vértice más cercano de lo tocado (si hay uno a menos de 8 cm); si no se toca nada, el punto del suelo bajo el cursor
    let base = null;
    if (h) {
      base = h.point.clone();
      try {
        const pos = h.object.geometry.attributes.position, f = h.face, vs = [f.a, f.b, f.c].map(i => new V3().fromBufferAttribute(pos, i).applyMatrix4(h.object.matrixWorld));
        let dm = 0.08; vs.forEach(v => { const d = v.distanceTo(base); if (d < dm) { dm = d; base = v.clone(); } });
      } catch { /* sin vértices */ }
    } else { rayoDe(e); if (c.rayo.ray.intersectPlane(sueloP, pt)) base = pt.clone(); }
    if (!base) { const bb = new THREE.Box3(); grupos.forEach(({ g: q }) => bb.union(new THREE.Box3().setFromObject(q))); base = bb.getCenter(new V3()); }
    const caja = new THREE.Box3(); grupos.forEach(({ g: q }) => caja.union(new THREE.Box3().setFromObject(q)));
    mov = { ids, grupos, base, D: new V3(), caja, otras: cajasDe(new Set(grupos.map(q => q.g))), x0: e.clientX, y0: e.clientY, modo: null, pegado: false, escrito: '' };
    c.ctrl.enabled = false; c.setMedida('Mueve y haz clic para soltar · ↑ eje azul · → eje rojo · ← eje verde · ↓ libre · escribe una medida y Enter · Esc cancela');
    return true;
  };

  return {
    inferir: (e, excluirOid) => inferirVertice(e, excluirOid),
    activo: () => c.getHerr() === 'dibCara' || c.getHerr() === 'mover',
    movActivo: () => !!mov,
    cancelarMover: () => movCancela(),
    herramientaElegida() { lock = null; reinicia(); ayuda(); },
    salir() { reinicia(); movCancela(); },
    down(e) {
      const h = c.getHerr();
      if (h === 'mover') { const ya = !!mov; const res = movDown(e); if (!ya && mov) mov.x0 = e.clientX, mov.y0 = e.clientY; return res; }
      if (h === 'mover' && !c.puedeModelar()) { c.setAviso('Para mover lo modelado entra en el espacio «Modelar».'); return true; }
      if ((h === 'dibCara' || h === 'empujar' || h === 'mover') && !c.puedeModelar()) { if (h === 'dibCara') { c.setAviso('Para dibujar y modelar entra en el espacio «Modelar» (arriba).'); c.setHerr('sel'); return true; } if (h === 'empujar') { const hh = golpe(e); let gg = hh && hh.object; while (gg && !gg.userData.oid) gg = gg.parent; const oo = gg && c.getObjs().find(x => x.id === gg.userData.oid); if (oo && oo.tipo === 'extr') { c.setAviso('Lo modelado está bloqueado aquí. Para cambiarlo entra en el espacio «Modelar».'); return true; } return false; } }
      if (h === 'dibCara') {
        abajo = [e.clientX, e.clientY]; iniDown = false; c.ctrl.enabled = false;
        if (!pts.length && c.getForma() !== 'poli' && iniciar(e)) iniDown = true;
        return true;
      }
      if (h === 'empujar') return pullDown(e);
      return false;
    },
    move(e) {
      if (pull) { pullMueve(e); return true; }
      if (c.getHerr() === 'mover') { if (mov) movCalcula(e); return true; }
      if (c.getHerr() !== 'dibCara') return false;
      if (!plano) { dibujaMarca(candidato(e)); return true; }
      let p = puntoPlano(e); if (!p) return true;
      const a = pts[pts.length - 1], forma = c.getForma();
      if (forma === 'poli') {
        if (lockDir === 'u') p = [p[0], a[1]]; else if (lockDir === 'v') p = [a[0], p[1]];
        else if (e.shiftKey) p = Math.abs(p[0] - a[0]) >= Math.abs(p[1] - a[1]) ? [p[0], a[1]] : [a[0], p[1]];
      }
      cur = p; dibuja(p);
      if (!escrito) c.setMedida(forma !== 'poli' && pts.length === 1 ? Math.abs(Math.round(p[0])) + ' × ' + Math.abs(Math.round(p[1])) + ' cm' : Math.round(Math.hypot(p[0] - a[0], p[1] - a[1])) + ' cm' + (lockDir ? (lockDir === 'u' ? '  · eje rojo' : '  · eje verde') : ''));
      return true;
    },
    up(e) {
      if (pull) { pullFin(); return true; }
      if (c.getHerr() === 'mover') { if (mov && mov.modo === null) { if (Math.hypot(e.clientX - mov.x0, e.clientY - mov.y0) >= 6) { movCalcula(e); movFin(); } else mov.modo = 'clic'; } return true; }
      if (c.getHerr() !== 'dibCara') return false;
      if (!abajo) return true;
      const d0 = Math.hypot(e.clientX - abajo[0], e.clientY - abajo[1]); abajo = null; c.ctrl.enabled = true;
      const forma = c.getForma();
      if (d0 >= 4) { // arrastrar dibuja el rectángulo o el óvalo de una vez
        if (forma !== 'poli' && pts.length === 1 && plano) { const p = puntoPlano(e); if (p && Math.hypot(p[0], p[1]) > 3) { pts = c.puntosForma(forma, 0, 0, p[0], p[1]); cerrar(); } }
        return true;
      }
      if (iniDown) { iniDown = false; return true; }
      if (!plano) { iniciar(e); return true; }
      let p = puntoPlano(e); if (!p) return true;
      if (forma !== 'poli') { if (pts.length === 1 && Math.hypot(p[0], p[1]) > 3) { pts = c.puntosForma(forma, 0, 0, p[0], p[1]); cerrar(); } return true; }
      const a = pts[pts.length - 1];
      if (lockDir === 'u') p = [p[0], a[1]]; else if (lockDir === 'v') p = [a[0], p[1]]; else if (e.shiftKey) p = Math.abs(p[0] - a[0]) >= Math.abs(p[1] - a[1]) ? [p[0], a[1]] : [a[0], p[1]];
      if (pts.length >= 3 && Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]) < 15) cerrar();
      else { pts.push(p); lockDir = null; dibuja(null); }
      return true;
    },
    key(e) {
      const k = e.key;
      if (pull) {
        if (/^[0-9.,]$/.test(k)) { e.preventDefault(); pull.escrito += k === ',' ? '.' : k; c.setMedida(pull.escrito + ' cm  ↵'); return true; }
        if (k === 'Backspace') { e.preventDefault(); pull.escrito = pull.escrito.slice(0, -1); c.setMedida(pull.escrito ? pull.escrito + ' cm  ↵' : ''); return true; }
        if (k === 'Enter') { e.preventDefault(); const v = parseFloat(pull.escrito); if (v > 0) { const sg = (pull.nuevo ?? pull.dist0) < 0 ? -1 : 1; pullPon(sg * v); } pullFin(); return true; }
        if (k === 'Escape') { e.preventDefault(); pullPon(pull.dist0); pull.nuevo = null; pullFin(); return true; }
        return false;
      }
      if (c.getHerr() === 'mover') {
        if (k === 'ArrowUp' || k === 'ArrowRight' || k === 'ArrowLeft' || k === 'ArrowDown') { e.preventDefault(); const nuevo = k === 'ArrowUp' ? 'y' : k === 'ArrowRight' ? 'x' : k === 'ArrowLeft' ? 'z' : null; lockM = nuevo && nuevo === lockM ? null : nuevo; c.setMedida(lockM ? (lockM === 'x' ? 'Bloqueado al eje rojo' : lockM === 'z' ? 'Bloqueado al eje verde' : 'Bloqueado al eje azul (vertical)') : 'Movimiento libre'); return true; }
        if (!mov) { if (k === 'Escape') { e.preventDefault(); c.setHerr('sel'); return true; } return false; }
        if (k === 'Escape') { e.preventDefault(); movCancela(); return true; }
        if (/^[0-9.,-]$/.test(k)) { e.preventDefault(); mov.escrito += k === ',' ? '.' : k; c.setMedida(mov.escrito + ' cm  ↵'); return true; }
        if (k === 'Backspace') { e.preventDefault(); mov.escrito = mov.escrito.slice(0, -1); c.setMedida(mov.escrito ? mov.escrito + ' cm  ↵' : ''); return true; }
        if (k === 'Enter') {
          e.preventDefault(); const v = parseFloat(mov.escrito); mov.escrito = '';
          if (v) {
            const D = mov.D.clone(); let dir;
            if (lockM === 'x') dir = new V3(Math.sign(D.x) || 1, 0, 0); else if (lockM === 'z') dir = new V3(0, 0, Math.sign(D.z) || 1); else if (lockM === 'y') dir = new V3(0, Math.sign(D.y) || 1, 0); else { dir = new V3(D.x, 0, D.z); if (dir.lengthSq() < 1e-9) dir.set(1, 0, 0); dir.normalize(); }
            mov.D = dir.multiplyScalar(v * CM); mov.grupos.forEach(({ g, p0 }) => g.position.copy(p0).add(mov.D));
          }
          movFin(); return true;
        }
        return false;
      }
      if (c.getHerr() !== 'dibCara') return false;
      const forma = c.getForma();
      if (!pts.length) {
        if (k === 'ArrowUp' || k === 'ArrowRight' || k === 'ArrowLeft' || k === 'ArrowDown') {
          e.preventDefault(); const nuevo = k === 'ArrowUp' ? 'h' : k === 'ArrowRight' ? 'x' : k === 'ArrowLeft' ? 'z' : null;
          lock = nuevo && nuevo === lock ? null : nuevo; ayuda(); return true;
        }
        if (k === 'Escape') { e.preventDefault(); lock = null; reinicia(); c.setHerr('sel'); return true; }
        return false;
      }
      if (k === 'Escape') { e.preventDefault(); reinicia(); return true; }
      if (forma === 'poli' && (k === 'ArrowRight' || k === 'ArrowLeft' || k === 'ArrowDown')) {
        e.preventDefault(); const nuevo = k === 'ArrowRight' ? 'u' : k === 'ArrowLeft' ? 'v' : null; lockDir = nuevo && nuevo === lockDir ? null : nuevo;
        c.setMedida(lockDir ? (lockDir === 'u' ? 'Bloqueado al eje rojo' : 'Bloqueado al eje verde') : 'Dirección libre'); return true;
      }
      if (/^[0-9.,;x]$/i.test(k)) { e.preventDefault(); escrito += k === ',' ? '.' : k.toLowerCase(); c.setMedida(escrito + (forma !== 'poli' && pts.length === 1 ? ' cm (ancho;alto)  ↵' : ' cm  ↵')); return true; }
      if (k === 'Backspace') {
        e.preventDefault();
        if (escrito) { escrito = escrito.slice(0, -1); c.setMedida(escrito ? escrito + ' cm  ↵' : ''); }
        else if (pts.length > 1) { pts.pop(); dibuja(cur); } else reinicia();
        return true;
      }
      if (k === 'Enter') {
        e.preventDefault();
        const nums = escrito.split(/[;x]/).map(parseFloat).filter(v => v > 0), cu = cur || [1, 1];
        if (nums.length && pts.length === 1 && forma !== 'poli') { const w = nums[0], h = nums[1] ?? nums[0]; pts = c.puntosForma(forma, 0, 0, (cu[0] < 0 ? -1 : 1) * w, (cu[1] < 0 ? -1 : 1) * h); escrito = ''; cerrar(); return true; }
        if (nums.length && forma === 'poli') { const a = pts[pts.length - 1], dx = cu[0] - a[0], dy = cu[1] - a[1], n = Math.hypot(dx, dy) || 1; pts.push([a[0] + dx / n * nums[0], a[1] + dy / n * nums[0]]); escrito = ''; c.setMedida(''); lockDir = null; dibuja(null); return true; }
        escrito = ''; if (forma === 'poli') cerrar(); return true;
      }
      return false;
    },
  };
}

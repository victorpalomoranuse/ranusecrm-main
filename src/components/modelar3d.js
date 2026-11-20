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
  const candidato = e => {
    const h = golpe(e); let P, n;
    if (h) { P = h.point.clone(); n = h.face.normal.clone().transformDirection(h.object.matrixWorld); }
    else { rayoDe(e); if (!c.rayo.ray.intersectPlane(sueloP, pt)) return null; P = pt.clone(); n = new V3(0, 1, 0); }
    if (lock) n = lock === 'h' ? new V3(0, 1, 0) : lock === 'x' ? new V3(1, 0, 0) : new V3(0, 0, 1);
    rayoDe(e); if (n.dot(c.rayo.ray.direction) > 0) n.negate();
    return { P: ajusta(P, n), n };
  };
  const aMundo = (p) => plano.o.clone().addScaledVector(plano.u, p[0] * CM).addScaledVector(plano.v, p[1] * CM);
  const puntoPlano = (e) => {
    rayoDe(e);
    const pl = new THREE.Plane().setFromNormalAndCoplanarPoint(plano.n, plano.o);
    if (!c.rayo.ray.intersectPlane(pl, pt)) return null;
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
      id: 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), tipo: 'extr', nombre: 'Forma', cx: o.x / CM, cy: o.z / CM, rot: 0, z0: 0,
      w: Math.max(...us) - Math.min(...us), d: Math.max(...vs) - Math.min(...vs), alto: 0, color: '#9aa3ad',
      o3: { y: o.y / CM, u: plano.u.toArray(), v: plano.v.toArray(), n: plano.n.toArray() }, pl: pts.map(p => [p[0], p[1]]), dist: 0,
    };
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
    const d = e.shiftKey ? Math.round(pull.dist0 + dn) : c.snap(pull.dist0 + dn);
    pull.escrito = ''; pullPon(d);
  };
  const pullFin = () => {
    const p = pull; pull = null; c.ctrl.enabled = true; c.setMedida('');
    if (p.nuevo != null && Math.abs(p.nuevo - p.dist0) > 0.01) c.setObjs(prev => prev.map(x => (x.id === p.id ? { ...x, dist: p.nuevo, alto: Math.abs(p.nuevo) } : x)));
    else { p.malla.geometry.dispose(); p.malla.geometry = geometriaExtr(p.ob); }
  };

  return {
    activo: () => c.getHerr() === 'dibCara',
    herramientaElegida() { lock = null; reinicia(); ayuda(); },
    salir() { reinicia(); },
    down(e) {
      const h = c.getHerr();
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

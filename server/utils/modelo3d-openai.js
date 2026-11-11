// Modelo 3D detallado con ChatGPT (API de OpenAI con su herramienta de código): construye un .glb a partir de fotos del producto.
// Lo usan la biblioteca 3D del visor y el botón «Generar el 3D» de las piezas de Planos. Variables: OPENAI_API_KEY, OPENAI_3D_MODEL, OPENAI_3D_EFFORT.
export const hayOpenAI = () => !!process.env.OPENAI_API_KEY;
const OPENAI = 'https://api.openai.com/v1';
const cabeceras = () => ({ Authorization: 'Bearer ' + process.env.OPENAI_API_KEY, 'Content-Type': 'application/json' });
const instruccionesIA = (nombre, medidas) => `Eres un modelador 3D experto en producto industrial y equipamiento deportivo. Con la(s) foto(s) adjunta(s) (varias vistas del mismo producto si hay más de una), construye un modelo 3D MUY DETALLADO y fiel del producto «${nombre}» y entrégalo como UN archivo binario glTF (.glb) guardado en el directorio de salida (por ejemplo /mnt/data/modelo.glb).

MÉTODO (síguelo en orden, sin saltarte pasos):
1. ANALIZA las fotos antes de escribir código. Haz una lista numerada de TODAS las piezas que se ven: estructura (montantes, travesaños, bases, patas), barras, soportes, ganchos, pasadores, poleas, cables, pilas de pesas y sus guías, asientos y respaldos acolchados, empuñaduras, topes, pegatinas o placas, tornillería visible, patas niveladoras. Anota para cada una su forma, su posición relativa, su tamaño relativo y su color/material. Mira cada foto con atención: lo que se ve en una vista y no en otra también existe.
2. FIJA las dimensiones totales (largo, fondo, alto) y las proporciones entre piezas a partir de las fotos y de las medidas reales; que cada pieza tenga el tamaño correcto respecto al conjunto (un perfil de acero de 5×5 cm, una barra de Ø28 a 50 mm, etc.).
3. MODELA cada pieza de la lista con su forma real: perfiles rectangulares huecos o macizos con bordes, tubos, cilindros, discos, extrusiones, agujeros o ranuras repetidas cuando existan (por ejemplo la fila de agujeros de un montante). NO simplifiques el producto a cajas ni a un bloque. Un producto de este tipo debe tener decenas de piezas: escribe el código con funciones que repitan piezas (montantes, agujeros, discos, pletinas) para hacerlo rápido.
4. ENSAMBLA con coherencia: nada puede flotar en el aire ni atravesar otra pieza sin motivo. Cada pieza debe apoyarse, atornillarse o encajar en otra, y las simetrías del producto (izquierda/derecha) deben respetarse. Comprueba por código que ninguna pieza queda separada del conjunto.
5. REVISA una vez tu resultado: genera con matplotlib una sola imagen con tu modelo visto de frente, de lado y en perspectiva, MÍRALA y compárala con las fotos. Si falta una pieza importante, está mal colocada o flotando, corrígela. Haz como mucho UNA ronda de corrección y entrega: se busca un buen resultado en pocos minutos, no la perfección.

REGLAS TÉCNICAS:
- Usa el código Python de tu herramienta. Si trimesh no está disponible, escribe tú mismo el .glb válido (cabecera GLB, chunk JSON y chunk BIN) con numpy y struct.
- Unidades: metros. Eje Y hacia arriba. El origen en el centro de la base, apoyado en el suelo (y=0).
- Materiales PBR con el color base que se ve en la foto (negro mate, cromo, goma, tapicería, etc.; rugosidad y metálico razonables). Usa varios materiales cuando haya partes de distinto color o material, y no pintes todo del mismo color.
- Normales correctas (caras hacia fuera) y sin mallas rotas. Mantén el archivo por debajo de unos 15 MB.
- ${medidas ? 'Medidas reales del producto: ' + medidas + '. Respétalas exactamente.' : 'Si no sabes las medidas reales, estima unas razonables para este tipo de producto.'}
- Al terminar, carga el .glb con trimesh o revisa su cabecera y confirma que el tamaño total es el esperado.
- Responde solo con una frase breve cuando acabes.`;
// fotos: [{ buffer, mimetype }]. Devuelve el .glb (Buffer) o lanza un error con un mensaje claro
export async function glbConChatGPT(fotos, nombre, medidas) {
  if (!hayOpenAI()) throw new Error('Falta la clave de OpenAI en el servidor (OPENAI_API_KEY)');
    // GPT-6.1 Sol es el modelo con el que ChatGPT sacó el rack bien (nivel «Medio»). OPENAI_3D_MODEL y OPENAI_3D_EFFORT (low|medium|high) lo cambian; si la cuenta no tiene acceso a Sol, se usa gpt-5.
    const modelo = process.env.OPENAI_3D_MODEL || 'gpt-6.1-sol';
    const esfuerzo = ['low', 'medium', 'high'].includes(process.env.OPENAI_3D_EFFORT) ? process.env.OPENAI_3D_EFFORT : 'medium';
    const cuerpo = { model: modelo, background: true, reasoning: { effort: esfuerzo }, tools: [{ type: 'code_interpreter', container: { type: 'auto' } }], input: [{ role: 'user', content: [{ type: 'input_text', text: instruccionesIA(nombre, medidas) }, ...fotos.map(f => ({ type: 'input_image', image_url: 'data:' + f.mimetype + ';base64,' + f.buffer.toString('base64') }))] }] };
    let r = await fetch(OPENAI + '/responses', { method: 'POST', headers: cabeceras(), body: JSON.stringify(cuerpo) });
    let j = await r.json();
    if (!r.ok && !process.env.OPENAI_3D_MODEL && /model|access|exist|found/i.test(j?.error?.message || '') && !/reasoning/i.test(j?.error?.message || '')) { cuerpo.model = 'gpt-5'; r = await fetch(OPENAI + '/responses', { method: 'POST', headers: cabeceras(), body: JSON.stringify(cuerpo) }); j = await r.json(); } // sin acceso a Sol: el modelo anterior
    if (!r.ok && /reasoning/i.test(j?.error?.message || '')) { delete cuerpo.reasoning; r = await fetch(OPENAI + '/responses', { method: 'POST', headers: cabeceras(), body: JSON.stringify(cuerpo) }); j = await r.json(); } // un modelo que no admite «reasoning»
    if (!r.ok) throw new Error(j?.error?.message || ('OpenAI respondió ' + r.status));
    const t0 = Date.now();
    while (['queued', 'in_progress'].includes(j.status)) {
      if (Date.now() - t0 > 30 * 60 * 1000) throw new Error('Ha tardado demasiado (más de 30 minutos)');
      await new Promise(ok => setTimeout(ok, 4000));
      r = await fetch(OPENAI + '/responses/' + j.id, { headers: cabeceras() }); j = await r.json();
      if (!r.ok) throw new Error(j?.error?.message || ('OpenAI respondió ' + r.status));
    }
    if (j.status !== 'completed') throw new Error('OpenAI no pudo terminar: ' + (j.error?.message || j.incomplete_details?.reason || j.status));
    const archivos = [];
    (j.output || []).forEach(o => (o.content || []).forEach(c => (c.annotations || []).forEach(a => { if (a.type === 'container_file_citation' && /\.glb$/i.test(a.filename || '')) archivos.push(a); })));
    // a veces el archivo no sale citado: se mira también lo que dejó el intérprete de código
    if (!archivos.length) {
      const cid = (j.output || []).map(o => o.container_id).filter(Boolean).pop();
      if (cid) { const lr = await fetch(OPENAI + '/containers/' + cid + '/files', { headers: cabeceras() }); const lj = await lr.json().catch(() => ({})); (lj.data || []).filter(f => /\.glb$/i.test(f.path || '')).forEach(f => archivos.push({ container_id: cid, file_id: f.id, filename: f.path.split('/').pop() })); }
    }
    const a = archivos[archivos.length - 1];
    if (!a) throw new Error('ChatGPT no entregó ningún archivo .glb. Prueba otra vez o con una foto más clara.');
    const dr = await fetch(OPENAI + '/containers/' + a.container_id + '/files/' + a.file_id + '/content', { headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY } });
    if (!dr.ok) throw new Error('No se pudo descargar el modelo (' + dr.status + ')');
    const glb = Buffer.from(await dr.arrayBuffer());
    if (glb.length < 100 || glb.slice(0, 4).toString() !== 'glTF') throw new Error('El archivo que devolvió no es un .glb válido. Prueba otra vez.');
  return glb;
}

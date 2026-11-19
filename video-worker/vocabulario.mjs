// Correcciones verificadas en las grabaciones del estudio; sin similitud difusa.
export function corrigeVocabulario(texto) {
  return String(texto).replace(/\bmcguerna(s?)\b/gi, 'mancuerna$1').replace(/\bmcguernero(s?)\b/gi, 'mancuernero$1');
}
export function espaciaSonidos(eventos, separacion = 5) {
  let ultimo = -Infinity;
  return [...eventos].sort((a,b)=>a.t-b.t).filter(e=>{if(!Number.isFinite(e.t)||e.t-ultimo<separacion)return false;ultimo=e.t;return true;});
}

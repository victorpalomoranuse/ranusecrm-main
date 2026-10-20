# encoding: UTF-8
# Ranuse Design · Planos → SketchUp
#
# Lee un plano de la herramienta de planos del CRM y construye el modelo 3D en SketchUp:
# muros con sus puertas y ventanas, suelos y techos con su material (también techos a una y dos aguas
# con sus vigas, cerchas y correas), pilares y máquinas (si el producto del catálogo tiene un modelo
# 3D de SketchUp enlazado, se coloca ese modelo en su sitio).
# Al actualizar solo se tocan las piezas que han cambiado en el plano: lo que hayas pintado, movido,
# ajustado o borrado en SketchUp se respeta (un muro que no cambia en el plano no se vuelve a hacer).
# (con su huella real y su altura). Cuando el plano cambia, se actualiza solo el grupo
# «RANUSE PLANO»: lo que modeles tú aparte no se toca.
#
# Instalación: copia este archivo en la carpeta Plugins de SketchUp y reinicia SketchUp
#   (Windows: C:\Users\TU_USUARIO\AppData\Roaming\SketchUp\SketchUp 20XX\SketchUp\Plugins)
# Uso: menú Extensiones → Ranuse → Conectar con un plano…

require 'sketchup.rb'
require 'json'
require 'digest'
require 'tmpdir'

module Ranuse
  module PlanoSU
    DICT = 'ranuse_plano'.freeze
    NOMBRE_GRUPO = 'RANUSE PLANO'.freeze
    VERSION = '1.7.0'.freeze

    @pidiendo = false
    @timer = nil

    # ── Ajustes (se guardan en el propio modelo de SketchUp) ─────────────────
    def self.modelo
      Sketchup.active_model
    end

    def self.ajuste(clave, defecto = nil)
      v = modelo.get_attribute(DICT, clave)
      v.nil? ? defecto : v
    end

    def self.guardar_ajuste(clave, valor)
      valor = valor.to_s if valor.is_a?(Integer) && valor.abs > 2_000_000_000
      modelo.set_attribute(DICT, clave, valor)
    end

    # ── Menú ─────────────────────────────────────────────────────────────────
    def self.conectar
      actual = ajuste('url', '')
      r = UI.inputbox(['Enlace del plano'], [actual], 'Conectar con un plano de Ranuse')
      return unless r
      url = r[0].to_s.strip
      return if url.empty?
      guardar_ajuste('url', url)
      guardar_ajuste('actualizado', 0)
      sincronizar(false, true)
    end

    def self.alternar_auto
      if @timer
        UI.stop_timer(@timer)
        @timer = nil
        UI.messagebox('Sincronización automática desactivada.')
      else
        if ajuste('url', '').to_s.empty?
          UI.messagebox('Primero conecta con un plano: Extensiones → Ranuse → Conectar con un plano…')
          return
        end
        @timer = UI.start_timer(8, true) { sincronizar(true) }
        sincronizar(true)
      end
    end

    # Los techos se ven si la persona los activó; si nunca lo decidió, se ven cuando el plano tiene techos con forma o vigas
    def self.techos_activos?
      v = ajuste('techos', nil)
      v.nil? ? (@techos_por_defecto ? true : false) : v
    end

    def self.alternar_techos
      guardar_ajuste('techos', !techos_activos?)
      guardar_ajuste('actualizado', 0)
      sincronizar(false)
    end

    def self.alternar_estado
      nuevo = ajuste('estado', 'final') == 'final' ? 'actual' : 'final'
      guardar_ajuste('estado', nuevo)
      guardar_ajuste('actualizado', 0)
      UI.messagebox(nuevo == 'final' ? 'Se mostrará cómo quedará la obra (existente + nuevo).' : 'Se mostrará cómo está hoy (existente + a demoler).')
      sincronizar(false)
    end

    # ── Descarga y actualización ─────────────────────────────────────────────
    # silencioso = true cuando lo llama el temporizador (no molesta con mensajes si no hay cambios)
    def self.sincronizar(silencioso = false, forzar = false, desde_cero = false)
      url = ajuste('url', '').to_s
      if url.empty?
        UI.messagebox('Primero conecta con un plano: Extensiones → Ranuse → Conectar con un plano…') unless silencioso
        return
      end
      return if @pidiendo
      @pidiendo = true
      begin
        peticion = Sketchup::Http::Request.new(url, Sketchup::Http::GET)
        peticion.start do |_req, respuesta|
          @pidiendo = false
          begin
            procesar(respuesta, silencioso, forzar, desde_cero)
          rescue => e
            UI.messagebox("No se pudo construir el modelo:\n#{e.message}") unless silencioso
          end
        end
      rescue => e
        @pidiendo = false
        UI.messagebox("No se pudo pedir el plano:\n#{e.message}") unless silencioso
      end
    end

    def self.procesar(respuesta, silencioso, forzar, desde_cero = false)
      codigo = respuesta.status_code
      cuerpo = respuesta.body.to_s
      if codigo != 200
        mensaje = begin
          JSON.parse(cuerpo)['error']
        rescue
          nil
        end
        UI.messagebox("El CRM respondió con un error (#{codigo}): #{mensaje || 'revisa el enlace'}") unless silencioso
        return
      end
      datos = JSON.parse(cuerpo)
      # La marca de cambio se guarda como texto: en Windows SketchUp no admite enteros de más de 32 bits
      if !forzar && datos['updated'].to_s == ajuste('actualizado', '0').to_s
        UI.messagebox('El plano no ha cambiado desde la última actualización.') unless silencioso
        return
      end
      urls = ((datos['modelo'] || {})['equipos'] || []).map { |e| e['skp'] && e['skp']['url'] }.compact.uniq
      Sketchup.status_text = "Ranuse: descargando #{urls.size} modelo(s) 3D…" unless urls.empty?
      descargar_modelos(urls) do
        begin
          reconstruir(datos, desde_cero)
          guardar_ajuste('actualizado', datos['updated'].to_s)
          Sketchup.status_text = "Ranuse: plano «#{datos['nombre']}» actualizado"
        rescue => e
          UI.messagebox("No se pudo construir el modelo:\n#{e.message}") unless silencioso
        end
      end
    end

    # ── Modelos 3D de los productos (.skp enlazados en el catálogo) ───────────
    def self.carpeta_modelos
      dir = File.join(Dir.tmpdir, 'ranuse_modelos')
      Dir.mkdir(dir) unless File.directory?(dir)
      dir
    end

    def self.archivo_modelo(url)
      File.join(carpeta_modelos, Digest::MD5.hexdigest(url.to_s) + '.skp')
    end

    def self.modelo_descargado?(url)
      ruta = archivo_modelo(url)
      File.exist?(ruta) && File.size(ruta) > 0
    end

    # Descarga (una sola vez; queda en caché) los modelos que aún no están y llama al bloque cuando terminan
    def self.descargar_modelos(urls, &hecho)
      pendientes = urls.reject { |u| modelo_descargado?(u) }
      return hecho.call if pendientes.empty?
      restantes = pendientes.size
      terminar = lambda do
        restantes -= 1
        hecho.call if restantes <= 0
      end
      pendientes.each do |u|
        begin
          peticion = Sketchup::Http::Request.new(u, Sketchup::Http::GET)
          peticion.start do |_req, respuesta|
            begin
              if respuesta.status_code == 200
                ruta = archivo_modelo(u)
                File.open(ruta, 'wb') { |f| f.write(respuesta.body) }
                # si lo descargado no es un modelo de SketchUp (p. ej. una página de aviso de Drive), no se usa
                cab = File.binread(ruta, 100).to_s
                File.delete(ruta) unless cab.include?("S\0k\0e\0t\0c\0h\0U\0p\0".b)
              end
            rescue StandardError
              # si no se puede guardar, esa máquina saldrá como una caja
            end
            terminar.call
          end
        rescue StandardError
          terminar.call
        end
      end
    end

    # Coloca el modelo 3D de un producto: centrado en su caja, apoyado en el suelo, con el giro del modelo,
    # el espejo y el giro que tiene la máquina en el plano. Devuelve true si lo consigue.
    def self.colocar_modelo(ents, e)
      skp = e['skp']
      return false unless skp && skp['url'] && modelo_descargado?(skp['url'])
      @modelos ||= {}
      ruta = archivo_modelo(skp['url'])
      defn = (@modelos[ruta] ||= modelo.definitions.load(ruta))
      return false unless defn
      b = defn.bounds
      centrar = Geom::Transformation.translation(Geom::Vector3d.new(-b.center.x, -b.center.y, -b.min.z))
      giro_modelo = Geom::Transformation.rotation(ORIGIN, Z_AXIS, skp['rot'].to_f.degrees)
      espejo = Geom::Transformation.scaling(ORIGIN, e['fx'] ? -1.0 : 1.0, e['fy'] ? -1.0 : 1.0, 1.0)
      giro_plano = Geom::Transformation.rotation(ORIGIN, Z_AXIS, (-e['rot'].to_f).degrees) # el plano tiene el eje y hacia abajo
      sitio = Geom::Transformation.translation(Geom::Vector3d.new(e['cx'].to_f.cm, -e['cy'].to_f.cm, (@z_base || 0.0).cm))
      ents.add_instance(defn, sitio * giro_plano * espejo * giro_modelo * centrar)
      true
    rescue StandardError
      false
    end

    # ── Construcción del modelo ──────────────────────────────────────────────
    # Firma de un elemento: si no cambia, la pieza que ya está en SketchUp no se toca
    def self.firma(obj)
      Digest::MD5.hexdigest(JSON.generate(obj))
    end

    def self.clave_poligono(pts)
      Digest::MD5.hexdigest(pts.map { |p| [p[0].to_f.round, p[1].to_f.round] }.inspect)[0, 10]
    end

    # Crea el grupo de un elemento solo si hace falta. Devuelve el grupo nuevo, o nil si no hay que tocar nada:
    #  · ya está en SketchUp con la misma firma (se respeta lo que hayas pintado o movido),
    #  · lo borraste tú y en el plano sigue igual (no se vuelve a crear).
    # Si cambió en el plano, se rehace esa pieza.
    # Material que has puesto tú (no es uno de los de Ranuse)
    def self.material_usuario(m)
      return nil unless m
      (m.respond_to?(:valid?) && !m.valid?) || m.name.to_s.start_with?('Ranuse ') ? nil : m
    rescue StandardError
      nil
    end

    # El grupo de un elemento con su material: si pintaste el elemento a mano, al rehacerlo se conserva tu color
    def self.pintar(g, clave, defecto)
      g.material = (@pintura ||= {})["#{@pref}#{clave}"] || defecto
    end

    # Clave de un elemento dentro de su planta (las plantas de arriba llevan prefijo para no chocar con las de abajo)
    def self.kp(clave)
      "#{@pref}#{clave}"
    end

    def self.elemento(ents, clave, sig, nombre, etiqueta, alt = nil)
      clave = kp(clave)
      if (@z_base || 0.0) != 0.0 # si la planta cambia de altura, se rehace
        sig = "#{sig}z#{@z_base.round(1)}"
        alt = "#{alt}z#{@z_base.round(1)}" if alt
      end
      @nuevas[clave] = sig
      viejo = @existentes[clave]
      if viejo && viejo.valid?
        firma_vieja = viejo.get_attribute(DICT, 'firma')
        if firma_vieja == sig || (alt && firma_vieja == alt)
          viejo.set_attribute(DICT, 'firma', sig) if firma_vieja != sig
          @mantenidos += 1
          return nil
        end
        # si cambió en el plano y se rehace, se guarda lo que habías pintado a mano para volver a ponerlo
        (@pintura ||= {})[clave] = material_usuario(viejo.material)
        cara0 = viejo.entities.grep(Sketchup::Face).first rescue nil
        (@pintura_cara ||= {})[clave] = material_usuario(cara0.material) if cara0
        viejo.erase!
        @existentes.delete(clave)
        @rehechos += 1
      elsif @ignorados[clave]
        return nil if @ignorados[clave] == sig
        @ignorados.delete(clave) # cambió en el plano: se vuelve a crear
      end
      g = ents.add_group
      g.name = nombre
      g.layer = etiqueta
      g.set_attribute(DICT, 'clave', clave)
      g.set_attribute(DICT, 'firma', sig)
      g
    end

    # desde_cero = true: borra todo el grupo y lo rehace entero (descarta lo que hayas cambiado a mano)
    def self.reconstruir(datos, desde_cero = false)
      m = modelo
      @modelos = {}
      plano = datos['modelo']
      m.start_operation('Actualizar plano Ranuse', true)
      begin
        raiz = m.entities.grep(Sketchup::Group).find { |g| g.valid? && g.get_attribute(DICT, 'raiz') }
        if raiz && (desde_cero || raiz.get_attribute(DICT, 'v2').nil?)
          raiz.erase! # versión anterior del plugin o pedido expreso: se rehace entero
          raiz = nil
        end
        @existentes = {}
        @ignorados = {}
        @nuevas = {}
        @pintura = {}
        @pintura_cara = {}
        @mantenidos = 0
        @rehechos = 0
        if raiz
          raiz.entities.grep(Sketchup::Group).each do |g|
            k = g.valid? ? g.get_attribute(DICT, 'clave') : nil
            @existentes[k] = g if k
          end
          previas = begin
            JSON.parse(raiz.get_attribute(DICT, 'claves', '{}'))
          rescue StandardError
            {}
          end
          @ignorados = begin
            JSON.parse(raiz.get_attribute(DICT, 'ignorados', '{}'))
          rescue StandardError
            {}
          end
          # lo que se hizo la última vez y ya no está lo ha borrado la persona: se respeta
          previas.each { |k, sig| @ignorados[k] = sig unless @existentes[k] }
          @existentes.each_key { |k| @ignorados.delete(k) }
        else
          raiz = m.entities.add_group
          raiz.name = NOMBRE_GRUPO
          raiz.set_attribute(DICT, 'raiz', true)
        end
        raiz.set_attribute(DICT, 'v2', true)
        raiz.set_attribute(DICT, 'plano', datos['nombre'].to_s)
        construir(raiz.entities, plano)
        # lo que ya no está en el plano se quita
        @existentes.each { |k, g| g.erase! if g.valid? && !@nuevas.key?(k) }
        @ignorados.delete_if { |k, _| !@nuevas.key?(k) }
        raiz.set_attribute(DICT, 'claves', JSON.generate(@nuevas))
        raiz.set_attribute(DICT, 'ignorados', JSON.generate(@ignorados))
        m.commit_operation
      rescue => e
        m.abort_operation
        raise e
      end
    end

    def self.visible?(estado, vista)
      estado = estado.to_s
      if vista == 'actual'
        estado == 'ex' || estado == 'dem'
      else
        estado == 'ex' || estado == 'new'
      end
    end

    def self.material(nombre, hex, alfa = nil)
      mats = modelo.materials
      mat = mats[nombre] || mats.add(nombre)
      r, g, b = hex.to_s.delete('#').scan(/\h\h/).map(&:hex)
      mat.color = Sketchup::Color.new(r || 200, g || 200, b || 200)
      mat.alpha = alfa if alfa
      mat
    end

    def self.etiqueta(nombre)
      modelo.layers[nombre] || modelo.layers.add(nombre)
    end

    # Punto de SketchUp a partir de coordenadas del plano (cm). El eje y del plano va hacia abajo: se invierte.
    def self.pt(x, y, z = 0)
      Geom::Point3d.new(x.to_f.cm, -y.to_f.cm, (z.to_f + (@z_base || 0.0)).cm)
    end

    # Extruye hacia arriba un polígono (lista de [x, y] del plano) desde z0 hasta z1
    def self.prisma(entidades, puntos, z0, z1)
      pts = puntos.each_with_object([]) do |p, acc|
        acc << p if acc.empty? || (acc.last[0] - p[0]).abs > 0.01 || (acc.last[1] - p[1]).abs > 0.01
      end
      pts.pop if pts.size > 1 && (pts.first[0] - pts.last[0]).abs < 0.01 && (pts.first[1] - pts.last[1]).abs < 0.01
      return nil if pts.size < 3
      cara = entidades.add_face(pts.map { |p| pt(p[0], p[1], z0) })
      return nil unless cara
      cara.reverse! if cara.normal.z < 0
      altura = z1.to_f - z0.to_f
      cara.pushpull(altura.cm) if altura.abs > 0.01
      cara
    end

    # Caja alineada con un muro: de s0 a s1 a lo largo, con espesor t centrado en el eje, de z0 a z1
    def self.caja_muro(entidades, ax, ay, ux, uy, t, s0, s1, z0, z1)
      return nil if (s1 - s0) < 0.5 || (z1 - z0) < 0.5
      nx = -uy
      ny = ux
      h = t / 2.0
      puntos = [
        [ax + ux * s0 - nx * h, ay + uy * s0 - ny * h],
        [ax + ux * s1 - nx * h, ay + uy * s1 - ny * h],
        [ax + ux * s1 + nx * h, ay + uy * s1 + ny * h],
        [ax + ux * s0 + nx * h, ay + uy * s0 + ny * h]
      ]
      prisma(entidades, puntos, z0, z1)
    end

    # ── Techos con forma (a dos aguas, a un agua) y su estructura ─────────────
    def self.punto_en_poligono?(x, y, pts)
      dentro = false
      j = pts.size - 1
      pts.each_with_index do |pi, i|
        pj = pts[j]
        if ((pi[1] > y) != (pj[1] > y)) && (x < (pj[0] - pi[0]) * (y - pi[1]) / (pj[1] - pi[1]).to_f + pi[0])
          dentro = !dentro
        end
        j = i
      end
      dentro
    end

    def self.dist_segmento(x, y, a, b)
      dx = b[0] - a[0]
      dy = b[1] - a[1]
      l2 = dx * dx + dy * dy
      return Math.hypot(x - a[0], y - a[1]) if l2 < 1e-9
      t = ((x - a[0]) * dx + (y - a[1]) * dy) / l2
      t = 0.0 if t < 0.0
      t = 1.0 if t > 1.0
      Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy))
    end

    def self.techo_pts(tc)
      (tc['pts'] || []).map { |p| [p[0].to_f, p[1].to_f] }
    end

    def self.techo_cubre?(tc, x, y, margen)
      pts = techo_pts(tc)
      return false if pts.size < 3
      return true if punto_en_poligono?(x, y, pts)
      pts.each_with_index do |p, i|
        return true if dist_segmento(x, y, p, pts[(i + 1) % pts.size]) <= margen
      end
      false
    end

    FACETAS = 16 # la bóveda se hace con tiras planas (así muros, vigas y tragaluces encajan)

    # Altura de un arco circular (semiluz = medio, flecha) a una distancia d del centro
    def self.arco_z(medio, flecha, hc, d)
      r = (medio * medio + flecha * flecha) / (2.0 * flecha)
      q = r * r - d * d
      q = 0.0 if q < 0.0
      (hc - r) + Math.sqrt(q)
    end

    # Líneas (en la coordenada que cambia) donde la cubierta cambia de pendiente: la cumbrera, o cada tira de la bóveda
    def self.techo_pliegues(tc)
      horizontal = tc['ej'] != 'v'
      lo = (horizontal ? tc['y0'] : tc['x0']).to_f
      hi = (horizontal ? tc['y1'] : tc['x1']).to_f
      c = (lo + hi) / 2.0
      if tc['fo'] == 'dos'
        [c]
      elsif tc['fo'] == 'boveda'
        paso = (hi - lo) / 2.0 / FACETAS
        (-FACETAS..FACETAS).map { |i| c + i * paso }
      else
        []
      end
    end

    # Altura de la cubierta en un punto del plano (cm)
    def self.techo_z(tc, x, y)
      ha = tc['ha'].to_f
      hc = tc['hc'].to_f
      x0 = tc['x0'].to_f
      x1 = tc['x1'].to_f
      y0 = tc['y0'].to_f
      y1 = tc['y1'].to_f
      horizontal = tc['ej'] != 'v'
      if tc['fo'] == 'boveda'
        c = horizontal ? (y0 + y1) / 2.0 : (x0 + x1) / 2.0
        medio = horizontal ? (y1 - y0) / 2.0 : (x1 - x0) / 2.0
        flecha = hc - ha
        return ha if medio < 0.01 || flecha < 0.01
        d = (horizontal ? y : x) - c
        d = d.abs
        d = medio if d > medio
        paso = medio / FACETAS
        k = (d / paso).floor
        k = FACETAS - 1 if k >= FACETAS
        z0 = ha + arco_z(medio, flecha, hc, k * paso) - arco_z(medio, flecha, hc, medio)
        z1 = ha + arco_z(medio, flecha, hc, (k + 1) * paso) - arco_z(medio, flecha, hc, medio)
        return z0 + (z1 - z0) * (d - k * paso) / paso
      end
      if tc['fo'] == 'dos'
        c = horizontal ? (y0 + y1) / 2.0 : (x0 + x1) / 2.0
        medio = horizontal ? (y1 - y0) / 2.0 : (x1 - x0) / 2.0
        return ha if medio < 0.01
        d = horizontal ? (y - c).abs : (x - c).abs
        d = medio if d > medio
        ha + (hc - ha) * (1.0 - d / medio)
      elsif tc['fo'] == 'una'
        ini = horizontal ? y0 : x0
        largo = horizontal ? (y1 - y0) : (x1 - x0)
        return ha if largo < 0.01
        t = ((horizontal ? y : x) - ini) / largo
        t = 0.0 if t < 0.0
        t = 1.0 if t > 1.0
        t = 1.0 - t unless tc['inv']
        ha + (hc - ha) * t
      else
        ha
      end
    end

    def self.techos_inclinados(plano)
      (plano['techos'] || []).select { |tc| %w[dos una boveda].include?(tc['fo']) }
    end

    # Altura que tiene que alcanzar un muro (o un pilar) en un punto: la de la cubierta si está debajo de una
    def self.altura_en(techos, x, y, defecto)
      mejor = nil
      techos.each do |tc|
        next unless techo_cubre?(tc, x, y, 25.0)
        z = techo_z(tc, x, y)
        mejor = z if mejor.nil? || z > mejor
      end
      mejor || defecto
    end

    def self.sala_con_cubierta?(pts, techos)
      techos.any? do |tc|
        tp = techo_pts(tc)
        next false if tp.size < 3
        sala = pts.map { |p| [p[0].to_f, p[1].to_f] }
        # la cubierta es de esta sala si alguna esquina suya cae dentro de la sala o pegada a su borde
        tp.any? do |p|
          punto_en_poligono?(p[0], p[1], sala) || sala.each_with_index.any? { |q, i| dist_segmento(p[0], p[1], q, sala[(i + 1) % sala.size]) < 30.0 }
        end
      end
    end

    # Prisma con 8 vértices: base y tope (listas de 4 puntos en el mismo orden)
    def self.prisma_inclinado(entidades, base, tope)
      caras = []
      caras << entidades.add_face(base)
      caras << entidades.add_face(tope)
      4.times do |i|
        j = (i + 1) % 4
        caras << entidades.add_face(base[i], base[j], tope[j], tope[i])
      end
      caras.all? { |c| c }
    rescue StandardError
      false
    end

    # Tramo de muro cuya parte alta sigue la cubierta (se parte donde cruza la cumbrera)
    def self.caja_muro_techo(entidades, ax, ay, ux, uy, t, s0, s1, z0, techos, altura_def)
      return nil if (s1 - s0) < 0.5
      cortes = [s0, s1]
      techos.each do |tc|
        next unless tc['fo'] == 'dos' || tc['fo'] == 'boveda'
        horizontal = tc['ej'] != 'v'
        den = horizontal ? uy : ux
        next if den.abs < 1e-6
        techo_pliegues(tc).each do |c|
          sc = (horizontal ? c - ay : c - ax) / den
          cortes << sc if sc > s0 + 0.5 && sc < s1 - 0.5
        end
      end
      cortes.sort!
      nx = -uy
      ny = ux
      h = t / 2.0
      hecho = false
      cortes.each_cons(2) do |sa, sb|
        next if sb - sa < 0.5
        esq = [[sa, -h], [sb, -h], [sb, h], [sa, h]].map { |s_, o| [ax + ux * s_ + nx * o, ay + uy * s_ + ny * o] }
        base = esq.map { |p| pt(p[0], p[1], z0) }
        tope = esq.map { |p| pt(p[0], p[1], altura_en(techos, p[0], p[1], altura_def)) }
        return nil unless prisma_inclinado(entidades, base, tope)
        hecho = true
      end
      hecho ? true : nil
    end

    # Un tramo de muro en su grupo: con la parte alta inclinada si hay cubierta; si algo falla, recto
    def self.pieza_muro(ents, mat, ax, ay, ux, uy, t, s0, s1, z0, z1, h_mu, techos)
      pg = ents.add_group
      hecho = false
      if !techos.empty? && z1 >= h_mu - 0.5
        hecho = (caja_muro_techo(pg.entities, ax, ay, ux, uy, t, s0, s1, z0, techos, z1) ? true : false) rescue false
        unless hecho
          pg.erase!
          pg = ents.add_group
        end
      end
      hecho = caja_muro(pg.entities, ax, ay, ux, uy, t, s0, s1, z0, z1) unless hecho
      pg.erase! unless hecho # el material va en el grupo del muro entero, no en cada trozo
    end

    # Recorta un polígono [[x, y], ...] dejando la parte donde (coordenada eje - c) * lado >= 0
    def self.recortar(pts, eje, c, lado)
      salida = []
      n = pts.size
      n.times do |i|
        a = pts[i]
        b = pts[(i + 1) % n]
        da = (a[eje] - c) * lado
        db = (b[eje] - c) * lado
        salida << a if da >= 0
        if (da >= 0) != (db >= 0)
          t = da / (da - db)
          salida << [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
        end
      end
      salida
    end

    # Intervalos de una recta (x = c si eje 0, y = c si eje 1) que quedan dentro del polígono
    def self.tramos_recta(pts, eje, c)
      ts = []
      n = pts.size
      n.times do |i|
        a = pts[i]
        b = pts[(i + 1) % n]
        a0 = a[eje]
        b0 = b[eje]
        if (a0 <= c && b0 > c) || (b0 <= c && a0 > c)
          ts << a[1 - eje] + (b[1 - eje] - a[1 - eje]) * (c - a0) / (b0 - a0)
        end
      end
      ts.sort!
      r = []
      i = 0
      while i + 1 < ts.size
        r << [ts[i], ts[i + 1]]
        i += 2
      end
      r
    end

    # Viga rectangular de a a b (cada punto [x, y, z_superior]); cuelga h por debajo y mide w de ancho
    def self.viga(ents, a, b, w, h, mat)
      dx = b[0] - a[0]
      dy = b[1] - a[1]
      l = Math.hypot(dx, dy)
      return nil if l < 0.5
      nx = -dy / l * w / 2.0
      ny = dx / l * w / 2.0
      g = ents.add_group
      pa_m = [a[0] - nx, a[1] - ny]
      pa_p = [a[0] + nx, a[1] + ny]
      pb_m = [b[0] - nx, b[1] - ny]
      pb_p = [b[0] + nx, b[1] + ny]
      base = [pt(pa_m[0], pa_m[1], a[2] - h), pt(pb_m[0], pb_m[1], b[2] - h), pt(pb_p[0], pb_p[1], b[2] - h), pt(pa_p[0], pa_p[1], a[2] - h)]
      tope = [pt(pa_m[0], pa_m[1], a[2]), pt(pb_m[0], pb_m[1], b[2]), pt(pb_p[0], pb_p[1], b[2]), pt(pa_p[0], pa_p[1], a[2])]
      if prisma_inclinado(g.entities, base, tope)
        g.material = mat if mat
      else
        g.erase!
      end
      nil
    end

    # Recta dentro del polígono: se parte en la cumbrera para que cada trozo siga la pendiente
    def self.viga_recta(ents, tc, eje, c, t0, t1, w, h, drop, mat, parte)
      cortes = [t0, t1]
      if parte && (tc['fo'] == 'dos' || tc['fo'] == 'boveda')
        horizontal = tc['ej'] != 'v'
        # solo se parte si la recta cruza la cumbrera / las aristas de la bóveda: eje 0 (x = c) recorre y; la cumbrera horizontal está en y = centro
        if (eje == 0 && horizontal) || (eje == 1 && !horizontal)
          techo_pliegues(tc).each { |cr| cortes << cr if cr > t0 + 0.5 && cr < t1 - 0.5 }
        end
      end
      cortes.sort!
      cortes.each_cons(2) do |ta, tb|
        next if tb - ta < 0.5
        pa = eje == 0 ? [c, ta] : [ta, c]
        pb = eje == 0 ? [c, tb] : [tb, c]
        a = [pa[0], pa[1], techo_z(tc, pa[0], pa[1]) - drop]
        b = [pb[0], pb[1], techo_z(tc, pb[0], pb[1]) - drop]
        viga(ents, a, b, w, h, mat)
      end
    end

    # Tragaluces: un rectángulo sobre la cubierta, con vidrio (solo si cae entero en esta vertiente)
    def self.tragaluces_en_cara(ents, tc, parte, limites = [])
      (tc['tl'] || []).each do |t|
        begin
          x = t['x'].to_f
          y = t['y'].to_f
          w = t['w'].to_f / 2.0
          d = t['d'].to_f / 2.0
          esq = [[x - w, y - d], [x + w, y - d], [x + w, y + d], [x - w, y + d]]
          # el tragaluz se recorta a esta parte de la cubierta (si cruza la cumbrera o una arista de la bóveda, queda a cada lado)
          limites.each { |eje, val, lado| esq = recortar(esq, eje, val, lado) }
          next if esq.size < 3
          next unless esq.all? { |p| techo_cubre?(tc, p[0], p[1], 0.6) }
          zs = esq.map { |p| techo_z(tc, p[0], p[1]) }
          cara = ents.add_face(esq.each_with_index.map { |p, i| pt(p[0], p[1], zs[i]) })
          next unless cara
          cara.reverse! if cara.normal.z < 0
          vidrio = material('Ranuse vidrio tragaluz', '#9ecbe8', 0.35)
          cara.material = vidrio
          cara.back_material = vidrio
        rescue StandardError
          # un tragaluz que no se pueda dibujar no rompe el resto
        end
      end
    end

    # Lo que define la forma de una cubierta (lo que afecta a los muros y a la cubierta misma, sin vigas ni tragaluces)
    def self.techo_geom(tc)
      tc.reject { |k, _| %w[vg cr tl c id].include?(k) }
    end

    # Cubierta (a una o dos aguas) con sus cerchas/vigas y correas, o vigas bajo un techo plano.
    # Tres piezas independientes: la superficie (con los tragaluces), las vigas y las correas.
    def self.construir_techo(ents, tc, etiqueta, mat_viga, clave, sig)
      pts = techo_pts(tc)
      return if pts.size < 3
      fo = tc['fo']
      geom = techo_geom(tc)
      if fo == 'dos' || fo == 'una' || fo == 'boveda'
        g = elemento(ents, clave, firma(['superficie', geom, tc['tl'], tc['c']]), 'Cubierta', etiqueta)
        if g
          construir_superficie(g, tc, pts, fo)
          pintar(g, clave, nil)
        end
      end
      construir_vigas(ents, tc, pts, fo, geom, etiqueta, mat_viga, clave)
      construir_correas(ents, tc, pts, fo, geom, etiqueta, mat_viga, clave)
    end

    def self.construir_superficie(g, tc, pts, fo)
      if fo == 'dos' || fo == 'una' || fo == 'boveda'
        eje_c = tc['ej'] != 'v' ? 1 : 0
        partes = [[pts, []]]
        if fo == 'dos'
          c = techo_pliegues(tc)[0]
          partes = [[recortar(pts, eje_c, c, 1), [[eje_c, c, 1]]], [recortar(pts, eje_c, c, -1), [[eje_c, c, -1]]]]
        elsif fo == 'boveda'
          ps = techo_pliegues(tc)
          partes = []
          (0...ps.size - 1).each do |i|
            tira = recortar(recortar(pts, eje_c, ps[i], 1), eje_c, ps[i + 1], -1)
            partes << [tira, [[eje_c, ps[i], 1], [eje_c, ps[i + 1], -1]]]
          end
        end
        partes.each do |pp, lim|
          next if pp.size < 3
          cara = g.entities.add_face(pp.map { |p| pt(p[0], p[1], techo_z(tc, p[0], p[1])) })
          next unless cara
          cara.reverse! if cara.normal.z < 0
          cara.material = material('Ranuse cubierta', '#b9bdc2')
          cara.back_material = material('Ranuse techo cubierta', tc['c'] || '#f6f4f1')
          tragaluces_en_cara(g.entities, tc, pp, lim)
        end
      end
    end

    def self.construir_vigas(ents, tc, pts, fo, geom, etiqueta, mat_viga, clave)
      x0 = tc['x0'].to_f
      x1 = tc['x1'].to_f
      y0 = tc['y0'].to_f
      y1 = tc['y1'].to_f
      correa_h = (tc['cr'] && fo != 'plano') ? 12.0 : 0.0
      vg = tc['vg']
      if vg
        clave_v = "#{clave}:vigas"
        g = elemento(ents, clave_v, firma(['vigas', geom, vg, correa_h]), 'Vigas', etiqueta)
        return unless g
        s = vg['s'].to_f
        s = 60.0 if s < 20.0
        w = vg['w'].to_f
        w = 10.0 if w < 2.0
        h = vg['h'].to_f
        h = 20.0 if h < 4.0
        # eje 0: vigas con x = c (corren en y); eje 1: vigas con y = c (corren en x)
        eje = if fo == 'plano'
                vg['d'] == 'v' ? 0 : 1
              else
                tc['ej'] != 'v' ? 0 : 1
              end
        ini = eje == 0 ? x0 : y0
        fin = eje == 0 ? x1 : y1
        c0 = ini + s / 2.0
        k = 0
        movidas = vg['mv'] || {}
        quitadas = vg['del'] || {}
        while c0 < fin
          c = c0 + movidas[k.to_s].to_f
          if !quitadas[k.to_s] && c > ini && c < fin
            tramos_recta(pts, eje, c).each do |t0, t1|
              viga_recta(g.entities, tc, eje, c, t0, t1, w, h, correa_h, nil, true)
            end
          end
          c0 += s
          k += 1
        end
        pintar(g, clave_v, mat_viga)
      end
    end

    def self.construir_correas(ents, tc, pts, fo, geom, etiqueta, mat_viga, clave)
      x0 = tc['x0'].to_f
      x1 = tc['x1'].to_f
      y0 = tc['y0'].to_f
      y1 = tc['y1'].to_f
      cr = tc['cr']
      if cr && fo != 'plano'
        clave_c = "#{clave}:correas"
        g = elemento(ents, clave_c, firma(['correas', geom, cr]), 'Correas', etiqueta)
        return unless g
        s = cr['s'].to_f
        s = 100.0 if s < 30.0
        eje = tc['ej'] != 'v' ? 1 : 0
        ini = eje == 0 ? x0 : y0
        fin = eje == 0 ? x1 : y1
        c0 = ini + s / 2.0
        k = 0
        movidas = cr['mv'] || {}
        quitadas = cr['del'] || {}
        while c0 < fin
          c = c0 + movidas[k.to_s].to_f
          if !quitadas[k.to_s] && c > ini && c < fin
            tramos_recta(pts, eje, c).each do |t0, t1|
              viga_recta(g.entities, tc, eje, c, t0, t1, 8.0, 12.0, 0.0, nil, false)
            end
          end
          c0 += s
          k += 1
        end
        pintar(g, clave_c, mat_viga)
      end
    end

    # Un plano con varias plantas trae plano['plantas'] (cada una con su z y sus muros, pilares…); se apilan en el mismo grupo
    def self.construir(ents, plano)
      plantas = plano['plantas']
      return construir_planta(ents, plano) if plantas.nil? || plantas.empty?
      plantas.each_with_index do |pl, i|
        @z_base = pl['z'].to_f
        @pref = i.zero? ? '' : "p#{pl['id'] || i}:"
        construir_planta(ents, pl)
        forjado(ents, pl) if i > 0 && pl['forjado'].to_f > 0
      end
    ensure
      @z_base = 0.0
      @pref = ''
    end

    # Losa entre una planta y la de abajo: bajo el suelo de cada sala de la planta, del grosor del forjado
    def self.forjado(ents, pl)
      grosor = pl['forjado'].to_f
      mat_f = material('Ranuse forjado', '#b9b4ab')
      et = etiqueta('Ranuse - Forjados')
      (pl['salas'] || []).each do |sa|
        pts = sa['pts']
        next if pts.nil? || pts.size < 3
        clave = "forjado:#{sa['idS'] || clave_poligono(pts)}"
        g = elemento(ents, clave, firma([pts, grosor]), "Forjado #{sa['nombre']}".strip, et)
        next unless g
        prisma(g.entities, pts, -grosor, -0.2)
        pintar(g, clave, mat_f)
      end
    end

    def self.construir_planta(ents, plano)
      @techos_por_defecto = !(plano['techos'] || []).empty?
      vista = ajuste('estado', 'final')
      altura = plano['altura'].to_f
      altura = 260.0 if altura <= 0

      mat_ex = material('Ranuse muro existente', '#e9e5df')
      mat_nuevo = material('Ranuse muro nuevo', '#ffffff')
      mat_dem = material('Ranuse muro a demoler', '#d98a7a')
      mat_vidrio = material('Ranuse vidrio', '#9ecbe8', 0.35)
      mat_madera = material('Ranuse puerta', '#a97c50')
      mat_marco = material('Ranuse marco', '#9aa0a6')
      mat_maq = material('Ranuse máquina', '#34343a')
      mat_pilar = material('Ranuse pilar', '#cfcac2')
      mat_viga = material('Ranuse viga', '#a97c50')
      techos_inc = techos_inclinados(plano)

      et_muros = etiqueta('Ranuse - Muros')
      et_suelos = etiqueta('Ranuse - Suelos')
      et_techos = etiqueta('Ranuse - Techos')
      et_maq = etiqueta('Ranuse - Máquinas')
      et_med = etiqueta('Ranuse - Obra a medida')
      mat_med = material('Ranuse obra a medida', '#c9b08a')
      mat_luz = material('Ranuse retroiluminado', '#fff2b3')

      # Obra a medida (muebles de obra, panelados, retroiluminados)
      (plano['a_medida'] || []).each_with_index do |am, i_am|
        pts = (am['pts'] || []).map { |q| [q[0].to_f, q[1].to_f] }
        next if pts.size < 3
        clave_mm = "mm:#{am['id'] || i_am}"
        g = elemento(ents, clave_mm, firma(am), am['nombre'] || 'Obra a medida', et_med)
        next unless g
        prisma(g.entities, pts, am['z0'].to_f, am['z1'].to_f)
        pintar(g, clave_mm, am['luz'] ? mat_luz : mat_med)
      end

      # Muros con sus huecos
      (plano['muros'] || []).each_with_index do |mu, i_mu|
        next unless visible?(mu['estado'], vista)
        ax, ay = mu['a']
        bx, by = mu['b']
        dx = bx - ax
        dy = by - ay
        largo = Math.hypot(dx, dy)
        next if largo < 1
        ux = dx / largo
        uy = dy / largo
        t = mu['t'].to_f
        t = 12.0 if t <= 0
        h_mu = mu['h'].to_f
        h_mu = altura if h_mu <= 0
        # a un muro solo le afecta la forma de las cubiertas que tiene encima (no sus vigas, correas ni tragaluces)
        techos_muro = techos_inc.select do |tc|
          [0.0, 0.25, 0.5, 0.75, 1.0].any? { |f| techo_cubre?(tc, ax + dx * f, ay + dy * f, 25.0 + t) }
        end.map { |tc| techo_geom(tc) }
        clave_mu = "muro:#{mu['id'] || i_mu}"
        g = elemento(ents, clave_mu, firma([mu, altura, vista, techos_muro]), 'Muro', et_muros, firma([mu, altura, vista, techos_inc]))
        next unless g
        mat = { 'ex' => mat_ex, 'new' => mat_nuevo, 'dem' => mat_dem }[mu['estado']] || mat_ex
        huecos = (mu['ab'] || []).select { |o| visible?(o['estado'], vista) }.sort_by { |o| o['p'].to_f }
        cur = -t / 2.0
        huecos.each do |o|
          p0 = [[o['p'].to_f, 0.0].max, largo].min
          p1 = [o['p'].to_f + o['w'].to_f, largo].min
          sill = o['tipo'] == 'door' ? 0.0 : o['sill'].to_f
          tope = sill + o['h'].to_f
          piezas = []
          piezas << [cur, p0, 0.0, h_mu]
          piezas << [p0, p1, 0.0, sill] if sill > 0.5
          piezas << [p0, p1, tope, h_mu] if tope < h_mu - 0.5
          piezas.each do |s0, s1, z0, z1|
            pieza_muro(g.entities, mat, ax, ay, ux, uy, t, s0, s1, z0, z1, h_mu, techos_muro)
          end
          carpinteria(g.entities, o, ax, ay, ux, uy, t, p0, p1, sill, tope, mat_vidrio, mat_madera, mat_marco)
          cur = [cur, p1].max
        end
        pieza_muro(g.entities, mat, ax, ay, ux, uy, t, cur, largo + t / 2.0, 0.0, h_mu, h_mu, techos_muro)
        pintar(g, clave_mu, mat)
      end

      # Suelos y techos por sala
      (plano['salas'] || []).each do |sa|
        pts = sa['pts']
        next if pts.nil? || pts.size < 3
        suelo = sa['suelo']
        ks = clave_poligono(pts)
        clave_su = "suelo:#{sa['idS'] || ks}"
        g = elemento(ents, clave_su, firma([sa['suelo'], pts, sa['nombre']]), "Suelo #{sa['nombre']}".strip, et_suelos)
        if g
          cara = prisma(g.entities, pts, 0.0, 0.0)
          cara ||= g.entities.add_face(pts.map { |p| pt(p[0], p[1], 0) })
          if cara
            cara.reverse! if cara.normal.z < 0
            cara.material = (@pintura_cara ||= {})[kp(clave_su)] || (suelo ? material("Ranuse suelo #{suelo['n']}", suelo['c']) : nil)
            cara.back_material = cara.material if cara.material
          end
        end
        next unless techos_activos?
        next if sala_con_cubierta?(pts, techos_inc) # esa sala lleva su cubierta con forma
        techo = sa['techo']
        clave_te = "techo:#{sa['idT'] || ks}"
        gt = elemento(ents, clave_te, firma([sa['techo'], pts, altura, sa['nombre']]), "Techo #{sa['nombre']}".strip, et_techos)
        next unless gt
        ct = gt.entities.add_face(pts.map { |p| pt(p[0], p[1], altura) })
        if ct
          ct.reverse! if ct.normal.z > 0
          ct.material = (@pintura_cara ||= {})[kp(clave_te)] || material("Ranuse techo #{techo ? techo['n'] : 'blanco'}", techo ? techo['c'] : '#f6f4f1')
        end
      end

      # Techos con forma y vigas (solo si los techos están visibles)
      if techos_activos?
        (plano['techos'] || []).each_with_index do |tc, i_tc|
          begin
            construir_techo(ents, tc, et_techos, mat_viga, "cub:#{tc['id'] || i_tc}", firma(tc))
          rescue StandardError => e
            # un techo con datos raros no debe romper el resto del modelo
            puts "Ranuse: no se pudo dibujar un techo (#{e.message})"
          end
        end
      end

      # Pilares
      (plano['pilares'] || []).each_with_index do |p, i_p|
        next unless visible?(p['estado'], vista)
        w = p['w'].to_f / 2.0
        d = p['d'].to_f / 2.0
        cx = p['cx'].to_f
        cy = p['cy'].to_f
        alto_p = altura_en(techos_inc, cx, cy, altura)
        clave_pi = "pilar:#{p['id'] || i_p}"
        g = elemento(ents, clave_pi, firma([p, alto_p, vista]), 'Pilar', et_muros)
        next unless g
        prisma(g.entities, [[cx - w, cy - d], [cx + w, cy - d], [cx + w, cy + d], [cx - w, cy + d]], 0.0, alto_p)
        pintar(g, clave_pi, mat_pilar)
      end

      # Máquinas
      (plano['equipos'] || []).each_with_index do |e, i_e|
        next unless e['estado'].nil? || visible?(e['estado'], vista) # lo que ya existe sale siempre; lo nuevo solo en «final»; lo que se retira, solo en «hoy»
        con_modelo = e['skp'] && e['skp']['url'] ? modelo_descargado?(e['skp']['url']) : false
        g = elemento(ents, "eq:#{e['id'] || i_e}", firma([e, con_modelo]), e['nombre'].to_s, et_maq)
        next unless g
        g.set_attribute(DICT, 'cid', e['cid'].to_s)
        alto = e['alto'].to_f
        alto = 110.0 if alto <= 0
        if colocar_modelo(g.entities, e)
          g.name = "#{e['nombre']} (modelo 3D)"
        else
          huella(g.entities, e, alto)
          g.material = mat_maq
        end
      end
    end

    def self.carpinteria(ents, o, ax, ay, ux, uy, t, p0, p1, sill, tope, mat_vidrio, mat_madera, mat_marco)
      ancho = p1 - p0
      return if ancho < 5
      if o['tipo'] == 'door'
        vidrio = (o['mat'].to_s =~ /vidrio|cristal/i)
        pg = ents.add_group
        pg.name = 'Puerta'
        if caja_muro(pg.entities, ax, ay, ux, uy, vidrio ? 1.2 : 4.0, p0 + 2, p1 - 2, 1.0, tope - 1)
          pg.material = vidrio ? mat_vidrio : mat_madera
        else
          pg.erase!
        end
      else
        marco = ents.add_group
        marco.name = 'Marco'
        f = 4.0
        caja_muro(marco.entities, ax, ay, ux, uy, 6.0, p0, p1, sill, sill + f)
        caja_muro(marco.entities, ax, ay, ux, uy, 6.0, p0, p1, tope - f, tope)
        caja_muro(marco.entities, ax, ay, ux, uy, 6.0, p0, p0 + f, sill + f, tope - f)
        caja_muro(marco.entities, ax, ay, ux, uy, 6.0, p1 - f, p1, sill + f, tope - f)
        marco.material = mat_marco
        vid = ents.add_group
        vid.name = 'Vidrio'
        if caja_muro(vid.entities, ax, ay, ux, uy, 1.0, p0 + f, p1 - f, sill + f, tope - f)
          vid.material = mat_vidrio
        else
          vid.erase!
        end
      end
    end

    # Huella de la máquina: el contorno real del bloque (si lo tiene) extruido hasta su altura;
    # si no, una caja del tamaño de la máquina. Se gira como en el plano (sentido horario).
    def self.huella(ents, e, alto)
      w = e['w'].to_f
      d = e['d'].to_f
      rot = e['rot'].to_f * Math::PI / 180.0
      c = Math.cos(rot)
      s = Math.sin(rot)
      cx = e['cx'].to_f
      cy = e['cy'].to_f
      largo = e['largo'].to_f
      fondo = e['fondo'].to_f
      largo = w if largo <= 0
      fondo = d if fondo <= 0
      transformar = lambda do |bx, by|
        x = bx * (w / largo) - w / 2.0
        y = by * (d / fondo) - d / 2.0
        [cx + x * c - y * s, cy + x * s + y * c]
      end
      hecho = false
      (e['huella'] || []).each do |poli|
        pts = poli.map { |p| transformar.call(p[0].to_f, p[1].to_f) }
        begin
          hecho = true if prisma(ents, pts, 0.0, alto)
        rescue => _
          # un contorno degenerado no debe impedir el resto
        end
      end
      return if hecho
      caja = [[0, 0], [largo, 0], [largo, fondo], [0, fondo]].map { |p| transformar.call(p[0], p[1]) }
      prisma(ents, caja, 0.0, alto)
    end
  end
end

# ── Menú y barra de herramientas «Ranuse» (con el logo) ───────────────────
unless file_loaded?(__FILE__)
  carpeta_iconos = File.join(File.dirname(__FILE__), 'ranuse_sketchup', 'icons')
  icono = lambda do |nombre, tam|
    ruta = File.join(carpeta_iconos, "#{nombre}_#{tam}.png")
    File.exist?(ruta) ? ruta : nil
  end
  crear = lambda do |texto, ayuda, nombre_icono, &accion|
    cmd = UI::Command.new(texto, &accion)
    cmd.tooltip = ayuda
    cmd.status_bar_text = ayuda
    cmd.small_icon = icono.call(nombre_icono, 16) if icono.call(nombre_icono, 16)
    cmd.large_icon = icono.call(nombre_icono, 24) if icono.call(nombre_icono, 24)
    cmd
  end

  cmd_conectar = crear.call('Conectar con un plano…', 'Ranuse: conectar con un plano del CRM', 'logo') { Ranuse::PlanoSU.conectar }
  cmd_actualizar = crear.call('Actualizar ahora', 'Ranuse: actualizar el modelo desde el plano', 'actualizar') { Ranuse::PlanoSU.sincronizar(false, true) }
  cmd_cero = crear.call('Rehacer todo desde cero', 'Ranuse: borra lo que hayas cambiado a mano y rehace todo el modelo desde el plano', 'actualizar') do
    if UI.messagebox("Esto rehace todo el modelo desde el plano y se pierde lo que hayas pintado, movido o borrado a mano en el grupo «RANUSE PLANO».\n\n¿Continuar?", MB_YESNO) == IDYES
      Ranuse::PlanoSU.sincronizar(false, true, true)
    end
  end
  cmd_auto = crear.call('Sincronización automática', 'Ranuse: actualizar solo cada pocos segundos', 'auto') { Ranuse::PlanoSU.alternar_auto }
  cmd_auto.set_validation_proc { Ranuse::PlanoSU.instance_variable_get(:@timer) ? MF_CHECKED : MF_UNCHECKED }
  cmd_techos = crear.call('Mostrar techos', 'Ranuse: mostrar u ocultar los techos', 'techos') { Ranuse::PlanoSU.alternar_techos }
  cmd_techos.set_validation_proc { Ranuse::PlanoSU.techos_activos? ? MF_CHECKED : MF_UNCHECKED }
  cmd_estado = crear.call('Estado: hoy / final', 'Ranuse: cambiar entre cómo está hoy y cómo quedará', 'estado') { Ranuse::PlanoSU.alternar_estado }

  menu_raiz = (UI.respond_to?(:menu) && (UI.menu('Extensions') || UI.menu('Plugins')))
  if menu_raiz
    menu = menu_raiz.add_submenu('Ranuse')
    [cmd_conectar, cmd_actualizar, cmd_auto, cmd_techos, cmd_estado, cmd_cero].each { |c| menu.add_item(c) }
  end

  barra = UI::Toolbar.new('Ranuse')
  [cmd_conectar, cmd_actualizar, cmd_auto, cmd_techos, cmd_estado].each { |c| barra.add_item(c) }
  barra.show if barra.restore == TB_NEW

  file_loaded(__FILE__)
end

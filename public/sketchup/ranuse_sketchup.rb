# encoding: UTF-8
# Ranuse Design · Planos → SketchUp
#
# Lee un plano de la herramienta de planos del CRM y construye el modelo 3D en SketchUp:
# muros con sus puertas y ventanas, suelos y techos con su material, pilares y máquinas
# (con su huella real y su altura). Cuando el plano cambia, se actualiza solo el grupo
# «RANUSE PLANO»: lo que modeles tú aparte no se toca.
#
# Instalación: copia este archivo en la carpeta Plugins de SketchUp y reinicia SketchUp
#   (Windows: C:\Users\TU_USUARIO\AppData\Roaming\SketchUp\SketchUp 20XX\SketchUp\Plugins)
# Uso: menú Extensiones → Ranuse → Conectar con un plano…

require 'sketchup.rb'
require 'json'

module Ranuse
  module PlanoSU
    DICT = 'ranuse_plano'.freeze
    NOMBRE_GRUPO = 'RANUSE PLANO'.freeze
    VERSION = '1.0.1'.freeze

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

    def self.alternar_techos
      guardar_ajuste('techos', !ajuste('techos', false))
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
    def self.sincronizar(silencioso = false, forzar = false)
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
            procesar(respuesta, silencioso, forzar)
          rescue => e
            UI.messagebox("No se pudo construir el modelo:\n#{e.message}") unless silencioso
          end
        end
      rescue => e
        @pidiendo = false
        UI.messagebox("No se pudo pedir el plano:\n#{e.message}") unless silencioso
      end
    end

    def self.procesar(respuesta, silencioso, forzar)
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
      reconstruir(datos)
      guardar_ajuste('actualizado', datos['updated'].to_s)
      Sketchup.status_text = "Ranuse: plano «#{datos['nombre']}» actualizado"
    end

    # ── Construcción del modelo ──────────────────────────────────────────────
    def self.reconstruir(datos)
      m = modelo
      plano = datos['modelo']
      m.start_operation('Actualizar plano Ranuse', true)
      begin
        antiguo = m.entities.grep(Sketchup::Group).find { |g| g.valid? && g.get_attribute(DICT, 'raiz') }
        antiguo.erase! if antiguo
        raiz = m.entities.add_group
        raiz.name = NOMBRE_GRUPO
        raiz.set_attribute(DICT, 'raiz', true)
        raiz.set_attribute(DICT, 'plano', datos['nombre'].to_s)
        construir(raiz.entities, plano)
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
      Geom::Point3d.new(x.to_f.cm, -y.to_f.cm, z.to_f.cm)
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

    def self.construir(ents, plano)
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

      et_muros = etiqueta('Ranuse - Muros')
      et_suelos = etiqueta('Ranuse - Suelos')
      et_techos = etiqueta('Ranuse - Techos')
      et_maq = etiqueta('Ranuse - Máquinas')
      et_med = etiqueta('Ranuse - Obra a medida')
      mat_med = material('Ranuse obra a medida', '#c9b08a')
      mat_luz = material('Ranuse retroiluminado', '#fff2b3')

      # Obra a medida (muebles de obra, panelados, retroiluminados)
      (plano['a_medida'] || []).each do |am|
        pts = (am['pts'] || []).map { |q| [q[0].to_f, q[1].to_f] }
        next if pts.size < 3
        g = ents.add_group
        g.name = am['nombre'] || 'Obra a medida'
        g.layer = et_med
        prisma(g.entities, pts, am['z0'].to_f, am['z1'].to_f)
        g.material = am['luz'] ? mat_luz : mat_med
      end

      # Muros con sus huecos
      (plano['muros'] || []).each do |mu|
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
        g = ents.add_group
        g.name = 'Muro'
        g.layer = et_muros
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
            pg = g.entities.add_group
            if caja_muro(pg.entities, ax, ay, ux, uy, t, s0, s1, z0, z1)
              pg.material = mat
            else
              pg.erase!
            end
          end
          carpinteria(g.entities, o, ax, ay, ux, uy, t, p0, p1, sill, tope, mat_vidrio, mat_madera, mat_marco)
          cur = [cur, p1].max
        end
        pg = g.entities.add_group
        if caja_muro(pg.entities, ax, ay, ux, uy, t, cur, largo + t / 2.0, 0.0, h_mu)
          pg.material = mat
        else
          pg.erase!
        end
      end

      # Suelos y techos por sala
      (plano['salas'] || []).each do |sa|
        pts = sa['pts']
        next if pts.nil? || pts.size < 3
        suelo = sa['suelo']
        g = ents.add_group
        g.name = "Suelo #{sa['nombre']}".strip
        g.layer = et_suelos
        cara = prisma(g.entities, pts, 0.0, 0.0)
        cara ||= g.entities.add_face(pts.map { |p| pt(p[0], p[1], 0) })
        if cara
          cara.reverse! if cara.normal.z < 0
          cara.material = material("Ranuse suelo #{suelo['n']}", suelo['c']) if suelo
          cara.back_material = cara.material if cara.material
        end
        next unless ajuste('techos', false)
        techo = sa['techo']
        gt = ents.add_group
        gt.name = "Techo #{sa['nombre']}".strip
        gt.layer = et_techos
        ct = gt.entities.add_face(pts.map { |p| pt(p[0], p[1], altura) })
        if ct
          ct.reverse! if ct.normal.z > 0
          ct.material = material("Ranuse techo #{techo ? techo['n'] : 'blanco'}", techo ? techo['c'] : '#f6f4f1')
        end
      end

      # Pilares
      (plano['pilares'] || []).each do |p|
        next unless visible?(p['estado'], vista)
        g = ents.add_group
        g.name = 'Pilar'
        g.layer = et_muros
        w = p['w'].to_f / 2.0
        d = p['d'].to_f / 2.0
        cx = p['cx'].to_f
        cy = p['cy'].to_f
        prisma(g.entities, [[cx - w, cy - d], [cx + w, cy - d], [cx + w, cy + d], [cx - w, cy + d]], 0.0, altura)
        g.material = mat_pilar
      end

      # Máquinas
      (plano['equipos'] || []).each do |e|
        g = ents.add_group
        g.name = e['nombre'].to_s
        g.layer = et_maq
        g.set_attribute(DICT, 'cid', e['cid'].to_s)
        alto = e['alto'].to_f
        alto = 110.0 if alto <= 0
        huella(g.entities, e, alto)
        g.material = mat_maq
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
  cmd_auto = crear.call('Sincronización automática', 'Ranuse: actualizar solo cada pocos segundos', 'auto') { Ranuse::PlanoSU.alternar_auto }
  cmd_auto.set_validation_proc { Ranuse::PlanoSU.instance_variable_get(:@timer) ? MF_CHECKED : MF_UNCHECKED }
  cmd_techos = crear.call('Mostrar techos', 'Ranuse: mostrar u ocultar los techos', 'techos') { Ranuse::PlanoSU.alternar_techos }
  cmd_techos.set_validation_proc { Ranuse::PlanoSU.ajuste('techos', false) ? MF_CHECKED : MF_UNCHECKED }
  cmd_estado = crear.call('Estado: hoy / final', 'Ranuse: cambiar entre cómo está hoy y cómo quedará', 'estado') { Ranuse::PlanoSU.alternar_estado }

  menu_raiz = (UI.respond_to?(:menu) && (UI.menu('Extensions') || UI.menu('Plugins')))
  if menu_raiz
    menu = menu_raiz.add_submenu('Ranuse')
    [cmd_conectar, cmd_actualizar, cmd_auto, cmd_techos, cmd_estado].each { |c| menu.add_item(c) }
  end

  barra = UI::Toolbar.new('Ranuse')
  [cmd_conectar, cmd_actualizar, cmd_auto, cmd_techos, cmd_estado].each { |c| barra.add_item(c) }
  barra.show if barra.restore == TB_NEW

  file_loaded(__FILE__)
end

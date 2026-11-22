/**
 * The Zinarix extension for SketchUp (Ruby), written to SketchUp's Plugins folder by
 * sketchup_install_extension / the SketchUp panel. It is shipped inside the app as text
 * (like the Blender runner in shared/blenderOps.ts) so the validator and the runner always
 * match the app version.
 *
 * How it talks to Zinarix: while SketchUp runs, a timer looks at ~/.zinarix-sketchup/jobs
 * (ZINARIX_SKETCHUP_HOME overrides it) for JSON jobs that Zinarix validated, applies their
 * ops with the FIXED dispatcher below (there is no eval: unknown ops are refused), writes
 * results/<id>.json and keeps alive.json fresh so Zinarix knows SketchUp is open.
 */

export const SKETCHUP_EXT_VERSION = '1.0.0';
export const SKETCHUP_LOADER_NAME = 'zinarix_sketchup.rb';
export const SKETCHUP_MAIN_DIR = 'zinarix_sketchup';

export const SKETCHUP_LOADER_RB = String.raw`# Zinarix Studio for SketchUp: lets the Zinarix AI model in SketchUp (validated ops only).
# ZINARIX_EXT_VERSION = '${SKETCHUP_EXT_VERSION}'
require 'sketchup.rb'
require 'extensions.rb'

module Zinarix
  module SketchupBridge
    unless file_loaded?(__FILE__)
      ex = SketchupExtension.new('Zinarix Studio', File.join(File.dirname(__FILE__), '${SKETCHUP_MAIN_DIR}', 'main'))
      ex.description = 'Lets Zinarix Studio (and its AI) build and export models through a fixed list of operations.'
      ex.version = '${SKETCHUP_EXT_VERSION}'
      ex.creator = 'Zinarix Studio'
      Sketchup.register_extension(ex, true)
      file_loaded(__FILE__)
    end
  end
end
`;

export const SKETCHUP_MAIN_RB = String.raw`# Zinarix Studio bridge (version ${SKETCHUP_EXT_VERSION}). Runs only the operations listed in
# Zinarix::SketchupBridge::OPS; jobs are JSON files Zinarix leaves in the jobs folder.
require 'sketchup.rb'
require 'json'
require 'fileutils'

module Zinarix
  module SketchupBridge
    VERSION = '${SKETCHUP_EXT_VERSION}'
    HOME = (ENV['ZINARIX_SKETCHUP_HOME'].to_s.empty? ? File.join(Dir.home, '.zinarix-sketchup') : ENV['ZINARIX_SKETCHUP_HOME'])
    JOBS = File.join(HOME, 'jobs')
    RESULTS = File.join(HOME, 'results')
    ALIVE = File.join(HOME, 'alive.json')
    UNITS = { 'mm' => 1.0 / 25.4, 'cm' => 1.0 / 2.54, 'm' => 1000.0 / 25.4, 'in' => 1.0, 'ft' => 12.0 }
    EXPORTS = %w[dae obj stl fbx dwg dxf 3ds kmz png jpg]
    OPS = %w[add_box add_rect add_face pushpull add_cylinder move rotate scale group delete material tag
             add_component add_text add_dimension view save export open]

    class OpError < StandardError; end

    @busy = false
    @last_alive = 0

    def self.start
      FileUtils.mkdir_p(JOBS)
      FileUtils.mkdir_p(RESULTS)
      UI.start_timer(0.5, true) { tick }
    rescue StandardError => e
      puts "Zinarix: #{e.message}"
    end

    def self.tick
      return if @busy
      @busy = true
      begin
        alive if Time.now.to_f - @last_alive > 2
        job_file = Dir.glob(File.join(JOBS, '*.json')).min
        run_file(job_file) if job_file
      rescue StandardError => e
        puts "Zinarix: #{e.message}"
      ensure
        @busy = false
      end
    end

    def self.alive
      @last_alive = Time.now.to_f
      m = Sketchup.active_model
      data = { time: (Time.now.to_f * 1000).to_i, version: Sketchup.version, extension: VERSION,
               model: m ? m.path.to_s : '', title: m ? m.title.to_s : '' }
      tmp = ALIVE + '.tmp'
      File.write(tmp, JSON.generate(data))
      File.rename(tmp, ALIVE)
    end

    def self.run_file(job_file)
      taken = job_file.sub(/\.json$/, '.taken')
      begin
        File.rename(job_file, taken)
      rescue StandardError
        return
      end
      job = nil
      begin
        job = JSON.parse(File.read(taken))
      rescue StandardError
        File.delete(taken) rescue nil
        return
      end
      File.delete(taken) rescue nil
      id = job['id'].to_s.gsub(/[^\w-]/, '')
      return if id.empty?
      if (Time.now.to_f * 1000) - job['created'].to_f > 10 * 60 * 1000
        write_result(id, { id: id, ok: false, error: 'The job waited too long and was dropped.' })
        return
      end
      write_result(id, run_job(id, job))
      alive
    end

    def self.write_result(id, data)
      path = File.join(RESULTS, id + '.json')
      File.write(path + '.tmp', JSON.generate(data))
      File.rename(path + '.tmp', path)
    end

    def self.same_path?(a, b)
      return false if a.to_s.empty? || b.to_s.empty?
      File.expand_path(a).tr('\\', '/').downcase == File.expand_path(b).tr('\\', '/').downcase
    end

    def self.run_job(id, job)
      path = job['path'].to_s
      units = UNITS.key?(job['units']) ? job['units'] : 'mm'
      exported = []
      saved = nil
      model = Sketchup.active_model
      unless path.empty?
        raise OpError, 'The model to work on must be a .skp file.' unless path =~ /\.skp\z/i
        if model && same_path?(model.path, path)
          # already open
        elsif File.exist?(path)
          raise OpError, "SketchUp could not open #{path}." unless Sketchup.open_file(path)
        else
          Sketchup.file_new
        end
        model = Sketchup.active_model
      end
      raise OpError, 'SketchUp has no model open.' unless model
      ops = job['ops'].is_a?(Array) ? job['ops'] : []
      model.start_operation('Zinarix', true)
      begin
        ops.each_with_index do |op, i|
          begin
            r = apply(model, op, op['units'] && UNITS.key?(op['units']) ? op['units'] : units)
            exported << r[:exported] if r.is_a?(Hash) && r[:exported]
            saved = r[:saved] if r.is_a?(Hash) && r[:saved]
            model = Sketchup.active_model if op['op'] == 'open'
          rescue StandardError => e
            raise OpError, "op ##{i + 1} (#{op['op']}): #{e.message}"
          end
        end
        model.commit_operation
      rescue StandardError
        model.abort_operation rescue nil
        raise
      end
      if job['save']
        if !path.empty?
          raise OpError, "SketchUp could not save #{path}." unless model.save(path)
          saved = path
        elsif !model.path.to_s.empty?
          raise OpError, 'SketchUp could not save the model.' unless model.save
          saved = model.path
        end
      end
      shot = nil
      if job['shot'].is_a?(Hash) && !job['shot']['path'].to_s.empty?
        s = job['shot']
        ok = model.active_view.write_image(filename: s['path'].to_s, width: s['width'].to_i.clamp(64, 4096),
                                           height: s['height'].to_i.clamp(64, 4096), antialias: true, transparent: false)
        shot = s['path'].to_s if ok
      end
      { id: id, ok: true, report: report(model, units, exported, saved, shot) }
    rescue StandardError => e
      { id: id, ok: false, error: e.message }
    end

    # ------------------------------------------------------------ helpers

    def self.len(v, u)
      Float(v) * UNITS[u]
    end

    def self.pt(a, u)
      raise OpError, 'a point must be [x, y, z]' unless a.is_a?(Array) && a.length == 3
      Geom::Point3d.new(len(a[0], u), len(a[1], u), len(a[2], u))
    end

    def self.vec(a, u)
      raise OpError, 'a vector must be [x, y, z]' unless a.is_a?(Array) && a.length == 3
      Geom::Vector3d.new(len(a[0], u), len(a[1], u), len(a[2], u))
    end

    def self.origin(op, u)
      Geom::Point3d.new(len(op['x'] || 0, u), len(op['y'] || 0, u), len(op['z'] || 0, u))
    end

    def self.text(v, max = 500)
      s = v.to_s.strip
      raise OpError, 'a name or text is missing' if s.empty?
      s[0, max]
    end

    def self.each_instance(ents, depth = 0, &blk)
      ents.each do |e|
        next unless e.is_a?(Sketchup::Group) || e.is_a?(Sketchup::ComponentInstance)
        blk.call(e)
        each_instance(e.definition.entities, depth + 1, &blk) if depth < 4
      end
    end

    def self.find(model, name)
      n = text(name, 80)
      found = nil
      each_instance(model.entities) do |e|
        next if found
        found = e if e.name == n
      end
      unless found
        each_instance(model.entities) do |e|
          next if found
          found = e if e.is_a?(Sketchup::ComponentInstance) && e.definition.name == n
        end
      end
      raise OpError, "no group or component is named \"#{n}\"" unless found
      found
    end

    def self.new_group(model, op)
      g = model.active_entities.add_group
      g.name = text(op['name'], 80) if op['name']
      g
    end

    def self.up_face(ents, pts)
      face = ents.add_face(pts)
      raise OpError, 'SketchUp could not make that face (points in a line or not flat?)' unless face
      # SketchUp turns faces drawn on the ground downwards: face them up so pushpull goes up.
      face.reverse! if face.normal.z < -1e-9
      face
    end

    def self.largest_face(g)
      faces = g.definition.entities.grep(Sketchup::Face)
      raise OpError, "\"#{g.name}\" has no faces" if faces.empty?
      faces.max_by(&:area)
    end

    def self.color(hex)
      raise OpError, 'colour must be #rrggbb' unless hex.to_s =~ /\A#([0-9a-f]{6})\z/i
      v = Regexp.last_match(1)
      Sketchup::Color.new(v[0, 2].to_i(16), v[2, 2].to_i(16), v[4, 2].to_i(16))
    end

    def self.camera(model, preset, perspective, zoom)
      view = model.active_view
      b = model.bounds
      c = b.empty? ? Geom::Point3d.new(0, 0, 0) : b.center
      d = [b.empty? ? 100.0 : b.diagonal, 10.0].max * 2
      dirs = { 'iso' => [-1, -1, 1], 'top' => [0, 0, 1], 'bottom' => [0, 0, -1], 'front' => [0, -1, 0],
               'back' => [0, 1, 0], 'left' => [-1, 0, 0], 'right' => [1, 0, 0] }
      v = dirs[preset] || dirs['iso']
      eye = Geom::Point3d.new(c.x + v[0] * d, c.y + v[1] * d, c.z + v[2] * d)
      up = %w[top bottom].include?(preset) ? Geom::Vector3d.new(0, 1, 0) : Geom::Vector3d.new(0, 0, 1)
      cam = Sketchup::Camera.new(eye, c, up)
      cam.perspective = perspective ? true : (preset == 'iso')
      view.camera = cam
      view.zoom_extents if zoom
    end

    def self.size_in(v, u)
      (v / UNITS[u]).round(3)
    end

    def self.report(model, u, exported, saved, shot)
      faces = 0
      edges = 0
      count = lambda do |ents, depth|
        ents.each do |e|
          faces += 1 if e.is_a?(Sketchup::Face)
          edges += 1 if e.is_a?(Sketchup::Edge)
          count.call(e.definition.entities, depth + 1) if depth < 4 && (e.is_a?(Sketchup::Group) || e.is_a?(Sketchup::ComponentInstance))
        end
      end
      count.call(model.entities, 0)
      list = []
      model.entities.each do |e|
        next unless e.is_a?(Sketchup::Group) || e.is_a?(Sketchup::ComponentInstance)
        break if list.length >= 200
        b = e.bounds
        item = { name: e.name.to_s.empty? ? (e.is_a?(Sketchup::Group) ? '(unnamed group)' : e.definition.name) : e.name,
                 type: e.is_a?(Sketchup::Group) ? 'group' : 'component',
                 size: [size_in(b.width, u), size_in(b.height, u), size_in(b.depth, u)],
                 min: [size_in(b.min.x, u), size_in(b.min.y, u), size_in(b.min.z, u)] }
        item[:definition] = e.definition.name if e.is_a?(Sketchup::ComponentInstance)
        item[:tag] = e.layer.name if e.layer && e.layer.name != 'Layer0' && e.layer.name != 'Untagged'
        item[:material] = e.material.display_name if e.material
        list << item
      end
      { sketchup: Sketchup.version, model: model.path.to_s, title: model.title.to_s, units: u, faces: faces, edges: edges,
        entities: list, materials: model.materials.map(&:display_name), tags: model.layers.map(&:name),
        exported: exported, saved: saved, shot: shot }
    end

    # ------------------------------------------------------------ the operations

    def self.apply(model, op, u)
      name = op['op'].to_s
      raise OpError, "unknown op #{name}" unless OPS.include?(name)
      ents = model.active_entities
      case name
      when 'add_box'
        g = new_group(model, op)
        o = origin(op, u)
        w = len(op['w'], u)
        d = len(op['d'], u)
        h = len(op['h'], u)
        f = up_face(g.entities, [o, o.offset([w, 0, 0]), o.offset([w, d, 0]), o.offset([0, d, 0])])
        f.pushpull(h)
      when 'add_rect'
        g = new_group(model, op)
        o = origin(op, u)
        w = len(op['w'], u)
        d = len(op['d'], u)
        up_face(g.entities, [o, o.offset([w, 0, 0]), o.offset([w, d, 0]), o.offset([0, d, 0])])
      when 'add_face'
        g = new_group(model, op)
        pts = op['points'].to_a.first(500).map { |p| pt(p, u) }
        up_face(g.entities, pts)
      when 'pushpull'
        largest_face(find(model, op['target'])).pushpull(len(op['distance'], u))
      when 'add_cylinder'
        g = new_group(model, op)
        segs = (op['segments'] || 24).to_i.clamp(3, 360)
        circle = g.entities.add_circle(origin(op, u), Geom::Vector3d.new(0, 0, 1), len(op['radius'], u), segs)
        f = up_face(g.entities, circle)
        f.pushpull(len(op['h'], u))
      when 'move'
        e = find(model, op['target'])
        v = op['by'] ? vec(op['by'], u) : (pt(op['to'], u) - e.bounds.min)
        e.transform!(Geom::Transformation.translation(v))
      when 'rotate'
        e = find(model, op['target'])
        axis = { 'x' => [1, 0, 0], 'y' => [0, 1, 0], 'z' => [0, 0, 1] }[op['axis'] || 'z']
        about = op['about'] ? pt(op['about'], u) : e.bounds.center
        e.transform!(Geom::Transformation.rotation(about, Geom::Vector3d.new(*axis), Float(op['angle']).degrees))
      when 'scale'
        e = find(model, op['target'])
        about = op['about'] ? pt(op['about'], u) : e.bounds.min
        f = op['factor']
        t = f.is_a?(Array) ? Geom::Transformation.scaling(about, Float(f[0]), Float(f[1]), Float(f[2])) : Geom::Transformation.scaling(about, Float(f))
        e.transform!(t)
      when 'group'
        items = op['targets'].to_a.first(200).map { |n| find(model, n) }
        parents = items.map(&:parent).uniq
        raise OpError, 'the targets must be at the same level' unless parents.length == 1
        container = parents.first.is_a?(Sketchup::Model) ? model.entities : parents.first.entities
        g = container.add_group(items)
        g.name = text(op['name'], 80)
      when 'delete'
        find(model, op['target']).erase!
      when 'material'
        e = find(model, op['target'])
        mname = op['name'] ? text(op['name'], 80) : "Zinarix #{op['color'] || File.basename(op['texture'].to_s)}"
        mat = model.materials[mname] || model.materials.add(mname)
        mat.color = color(op['color']) if op['color']
        if op['texture']
          tex = op['texture'].to_s
          raise OpError, "no texture file #{tex}" unless File.exist?(tex)
          mat.texture = tex
        end
        mat.alpha = Float(op['alpha']).clamp(0.0, 1.0) if op['alpha']
        e.material = mat
      when 'tag'
        e = find(model, op['target'])
        tname = text(op['tag'], 80)
        e.layer = model.layers[tname] || model.layers.add(tname)
      when 'add_component'
        file = op['path'].to_s
        raise OpError, "no component file #{file}" unless File.exist?(file) && file =~ /\.skp\z/i
        defn = model.definitions.load(file)
        inst = ents.add_instance(defn, Geom::Transformation.new(origin(op, u)))
        inst.name = text(op['name'], 80) if op['name']
      when 'add_text'
        ents.add_text(text(op['text']), origin(op, u))
      when 'add_dimension'
        ents.add_dimension_linear(pt(op['from'], u), pt(op['to'], u), vec(op['offset'] || [0, 0, 0], u))
      when 'view'
        camera(model, op['preset'].to_s, op['perspective'], op['zoom_extents'] != false)
      when 'save'
        file = op['path'].to_s
        if file.empty?
          raise OpError, 'the model has no file yet: give "path"' if model.path.to_s.empty?
          raise OpError, 'SketchUp could not save the model' unless model.save
          return { saved: model.path }
        end
        raise OpError, 'save "path" must end in .skp' unless file =~ /\.skp\z/i
        FileUtils.mkdir_p(File.dirname(file))
        raise OpError, "SketchUp could not save #{file}" unless model.save(file)
        return { saved: file }
      when 'export'
        file = op['path'].to_s
        ext = File.extname(file).delete('.').downcase
        raise OpError, "cannot export .#{ext}" unless EXPORTS.include?(ext)
        FileUtils.mkdir_p(File.dirname(file))
        ok = if %w[png jpg].include?(ext)
               model.active_view.write_image(filename: file, width: (op['width'] || 1600).to_i, height: (op['height'] || 1000).to_i,
                                             antialias: true, transparent: false)
             else
               model.export(file, { show_summary: false })
             end
        raise OpError, "SketchUp could not export .#{ext} (this SketchUp edition may not include that exporter)" unless ok && File.exist?(file)
        return { exported: file }
      when 'open'
        file = op['path'].to_s
        raise OpError, "no file #{file}" unless File.exist?(file) && file =~ /\.skp\z/i
        model.commit_operation
        raise OpError, "SketchUp could not open #{file}" unless Sketchup.open_file(file)
        Sketchup.active_model.start_operation('Zinarix', true)
      end
      nil
    end

    unless file_loaded?(__FILE__)
      start
      file_loaded(__FILE__)
    end
  end
end
`;

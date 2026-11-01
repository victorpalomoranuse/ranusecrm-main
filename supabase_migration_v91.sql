-- Los capítulos de un presupuesto son partidas especiales (solo un título de sección)
ALTER TABLE budget_items ADD COLUMN IF NOT EXISTS is_chapter_header boolean DEFAULT false;

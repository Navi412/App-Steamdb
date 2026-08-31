-- Tiempos de HowLongToBeat por juego. Es un dato 1:1 con el juego (no un
-- histórico como steam_snapshots), así que vive como columnas de `games`
-- en vez de una tabla propia. hltb_id permite volver a pedir el mismo
-- juego a HowLongToBeat sin repetir la búsqueda por título.

ALTER TABLE games ADD COLUMN hltb_id INTEGER;
ALTER TABLE games ADD COLUMN hltb_main_minutes INTEGER;
ALTER TABLE games ADD COLUMN hltb_completionist_minutes INTEGER;
ALTER TABLE games ADD COLUMN hltb_updated_at TEXT;

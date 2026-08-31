-- 003_hltb.sql asumía que se podía hablar directamente con la búsqueda de
-- howlongtobeat.com. Resultó que esa API no es viable: tiene una barrera
-- anti-bot (token + honeypot) delante. La alternativa es IGDB (api.igdb.com,
-- de Twitch), que expone el mismo dato ("Game Time To Beat") en una API
-- oficial, documentada y sin protección anti-scraping. Se renombran las
-- columnas para reflejar la fuente real de los datos.

ALTER TABLE games RENAME COLUMN hltb_id TO igdb_id;
ALTER TABLE games RENAME COLUMN hltb_main_minutes TO igdb_main_minutes;
ALTER TABLE games RENAME COLUMN hltb_completionist_minutes TO igdb_completionist_minutes;
ALTER TABLE games RENAME COLUMN hltb_updated_at TO igdb_updated_at;

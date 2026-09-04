-- Encuadre de la carátula por juego. El arte llega en proporciones distintas
-- (Steam 2:3, Xbox casi cuadrado, header apaisado, subidas variadas) y la caja
-- es 3:4, así que `object-fit: cover` siempre recorta por algún lado. Estos dos
-- porcentajes son el `object-position` (X, Y) que el usuario ajusta a mano para
-- decidir qué franja de la imagen se ve. 50/50 = centrado, el comportamiento
-- por defecto.

ALTER TABLE games ADD COLUMN cover_pos_x INTEGER NOT NULL DEFAULT 50;
ALTER TABLE games ADD COLUMN cover_pos_y INTEGER NOT NULL DEFAULT 50;

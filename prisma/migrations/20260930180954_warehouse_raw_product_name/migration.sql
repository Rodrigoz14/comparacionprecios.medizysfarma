-- Confirmado con el cliente (2026-09-29): las filas de bodega que no se
-- pueden homologar con certeza contra el catálogo ya no se descartan -- se
-- guardan igual, bajo su propio texto normalizado como clave, para no
-- perder existencia real solo porque el producto no está aún en el
-- catálogo de proveedores (p. ej. dispositivos médicos, odontología).
-- rawProductName guarda el nombre original para mostrarlo; null cuando sí
-- hay un producto real emparejado.
ALTER TABLE "warehouse_stock" ADD COLUMN     "raw_product_name" TEXT;

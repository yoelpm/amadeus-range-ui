# Amadeus Flight Range UI (Cloudflare Pages)

UI estática (HTML/CSS/JS) para consumir el Worker existente:

POST https://amadeus-flight-proxy.yoelpm.workers.dev/search-range

## Features
- Form con campos del JSON (defaults sensatos)
- Executive summary
- Tabla offers con ordenamiento (precio / score)
- Heatmap (grilla) desde heatmap[]
- Fechas recomendadas fuera del rango (recommendations.cheapest_date_candidates[])
- Panel de métricas técnicas (stats, dedup_stats si existe)
- Export JSON (descarga del response)
- Manejo de errores: timeout, 4xx/5xx, respuesta vacía

## Deploy en Cloudflare Pages (sin build)
### 1) Crear repo
1. Creá un repo nuevo en GitHub: `amadeus-range-ui`
2. Copiá estos archivos en el root:
   - index.html
   - styles.css
   - app.js
   - README.md
3. Commit & push

### 2) Conectar a Cloudflare Pages
1. Cloudflare Dashboard → **Pages** → **Create a project**
2. Conectá tu GitHub y elegí el repo
3. Build settings:
   - Framework preset: **None**
   - Build command: *(vacío)*
   - Build output directory: `/` (root)

4. Deploy

### 3) Variables de entorno
No se requieren variables para esta versión vanilla.
Si querés, podés hardcodear el endpoint en `app.js` o ajustar por branch manualmente.

## CORS (si hace falta)
Si al hacer fetch desde Pages ves error de CORS, asegurate que el Worker responda:

- OPTIONS preflight con:
  - Access-Control-Allow-Origin: https://TU-DOMINIO.pages.dev (o `*` si te da igual)
  - Access-Control-Allow-Methods: POST, OPTIONS
  - Access-Control-Allow-Headers: Content-Type
  - Access-Control-Max-Age: 86400

- En el POST (y errores también):
  - Access-Control-Allow-Origin: (mismo valor)
  - Vary: Origin

## Checklist de validación
1. **Happy path**: EZE → MAD con fechas default, rango 7.
   - Se ve summary, tabla, heatmap, métricas, export.
2. **Ordenamiento**: cambiar "Precio ↑/↓" y "Score ↑/↓", la tabla reordena.
3. **Reco**: activar recommendations y verificar bloque con candidates cuando existan.
4. **Errores**:
   - Timeout: poner 1000ms y ejecutar (debe mostrar "Timeout").
   - 4xx: poner origin inválido (ej: "EZ") → validación local, no request.
   - 5xx: simular desde el Worker (si podés) → UI muestra HTTP status + mensaje.
   - Respuesta vacía/no-json: simular con el Worker → UI muestra error.
5. **Responsive**: abrir en mobile width, el form colapsa bien y tabla scrollea horizontal.

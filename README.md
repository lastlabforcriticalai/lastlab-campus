# LAST Lab Campus — Fintech, Blockchain e IA

Campus experimental de LAST Lab para dos jornadas de formación crítica en tecnologías financieras. El frontend incluye diez unidades con lecturas, videos, actividades, simuladores y cuestionarios. El backend utiliza **Cloudflare Workers + D1** para usuarios y progreso.

## Estado
**Piloto técnico, no habilitado para alumnos reales.** El Worker ya existe como `lastlab-campus` y la D1 como `lastlab-campus-db` en la cuenta de Cloudflare del responsable. La web institucional `lastlab.lat` no se modifica.

## Estructura
- `public/`: aula virtual y materiales públicos del curso, con logo original.
- `src/worker.mjs`: API autenticada + servicio de archivos estáticos.
- `migrations/0001_init.sql`: tablas de usuarios, sesiones, progreso, cuestionarios y rate limiting. Ya fueron ejecutadas manualmente en D1.
- `wrangler.jsonc`: despliegue del Worker y binding DB.
- `tests/`: pruebas.

## Configuración y publicación
1. Vincular este repositorio al Worker existente `lastlab-campus` mediante **Workers & Pages → lastlab-campus → Settings → Builds → Connect**.
2. Revisar que la rama sea `main`, directorio raíz `/`, comando de despliegue `npx wrangler deploy` y que no haya un build frontend adicional.
3. En **Settings → Variables and Secrets**, crear un secreto `RATE_LIMIT_SALT` con una cadena aleatoria larga. Nunca escribirlo en GitHub ni compartirlo por chat.
4. Mantener `REGISTRATION_ENABLED=false` hasta superar las pruebas de autenticación, privacidad y rendimiento.
5. El binding de D1 en Wrangler debe llamarse `DB`. Ya existe en la configuración de Cloudflare.
6. Probar la web y el endpoint `/api/health`. Solo después habilitar registro bajo supervisión.

## Seguridad y límites
La aplicación utiliza cookies HttpOnly y sesiones en D1; la evaluación es una **autoevaluación** con respuestas visibles en el material público, no un examen inviolable. Sin correo electrónico ni recuperación automatizada de cuentas. Antes de apertura real, revisar protección de datos, retención, política de privacidad y comportamiento de PBKDF2 en Workers Free. No se deben guardar datos financieros reales en los ejercicios.

## Integración con la web institucional
Agregar en una etapa posterior un enlace discreto desde «Cursos / Courses» de `lastlab.lat` a este campus, sujeto a revisión institucional. No se altera `laslabcritical/lastlab`.

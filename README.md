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

## Despliegue inicial
La integración con Cloudflare Workers Builds se conectó al repositorio el 7 de noviembre de 2026. Este cambio documental inicia una comprobación de despliegue automático; el registro sigue desactivado durante las pruebas.

## Etapa 2 — Invitaciones individuales y recuperación docente
- **Seguridad:** funciona solo si `INVITES_ENABLED=true`, tras crear en D1 las tablas de `migrations/0002_student_access.sql`. Hasta entonces, el campus conserva todo su funcionamiento previo y no admite inscripciones nuevas.
- El administrador genera de 1 a 20 invitaciones por operación, válidas por 7 días, cada una de uso único. Se almacena solo SHA-256 del código; el texto del código aparece una sola vez.
- Los estudiantes usan el código para registrarse, sin necesidad de abrir `REGISTRATION_ENABLED`.
- El administrador puede revocar invitaciones, ver su estado y generar un código de recuperación para un estudiante, válido por 30 minutos. **Debe verificar su identidad por fuera del sistema** antes de entregárselo.
- El estudiante recupera su contraseña desde `Ingresar / Registrarse → Recuperar` y se invalidan sus sesiones anteriores.
- Sin envío de correos ni recuperación automática. No se debe anunciar como plataforma pública todavía.
- No ejecutar `wrangler d1 migrations apply --remote` sin revisar que la migración `0001_init.sql` se aplicó ya manualmente: para esta etapa usar exclusivamente la migración aditiva `0002_student_access.sql` mediante la consola D1.

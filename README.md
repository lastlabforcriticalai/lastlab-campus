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
- El administrador genera de 1 a 50 invitaciones por operación, válidas por 7 días, cada una de uso único. Se almacena solo SHA-256 del código; el texto del código aparece una sola vez.
- Los estudiantes usan el código para registrarse, sin necesidad de abrir `REGISTRATION_ENABLED`.
- El administrador puede revocar invitaciones, ver su estado y generar un código de recuperación para un estudiante, válido por 30 minutos. **Debe verificar su identidad por fuera del sistema** antes de entregárselo.
- El estudiante recupera su contraseña desde `Ingresar / Registrarse → Recuperar` y se invalidan sus sesiones anteriores.
- Sin envío de correos ni recuperación automática. No se debe anunciar como plataforma pública todavía.
- No ejecutar `wrangler d1 migrations apply --remote` sin revisar que la migración `0001_init.sql` se aplicó ya manualmente: para esta etapa usar exclusivamente la migración aditiva `0002_student_access.sql` mediante la consola D1.

La emisión de 50 códigos utiliza tres operaciones SQL de inserción (hasta 20 filas por instrucción), respetando el límite de parámetros y las consultas disponibles en Cloudflare Workers Free.

## Etapa 3 - Recuperación híbrida (sin activar hasta completar configuración)

Esta etapa agrega recuperación de contraseña por enlace enviado a un correo previamente verificado y ocho códigos personales de respaldo. La recuperación asistida por el docente sigue disponible.

### Activación segura paso a paso

1. En Cloudflare D1, ejecutar solamente migrations/0003_hybrid_recovery.sql en la base lastlab-campus-db. Verificar las tablas account_emails, email_action_tokens y account_backup_codes. Es una migración aditiva; no modifica users, progress ni quiz_attempts.
2. Para habilitar códigos personales sin correo, cambiar BACKUP_RECOVERY_ENABLED a true en wrangler.jsonc. Hasta ejecutar el paso 1, dejarlo false.
3. Abrir cuenta en https://resend.com, agregar y verificar un subdominio de envío propio, por ejemplo notificaciones.lastlab.lat. Cargar exclusivamente los registros DNS que indique Resend en el proveedor DNS autoritativo. No reemplazar registros existentes de la web ni del correo.
4. Crear una clave API de Resend con permiso de envío y agregarla en Cloudflare Workers -> lastlab-campus -> Settings -> Variables and Secrets como Secret llamado RESEND_API_KEY. Nunca compartir ni almacenar la clave en GitHub.
5. Definir EMAIL_FROM como variable de texto no secreto en la sección vars de wrangler.jsonc (se despliega desde GitHub), con un remitente bajo el dominio verificado, por ejemplo LAST Lab Campus <acceso@notificaciones.lastlab.lat>. El ejemplo solo será válido si ese subdominio fue realmente verificado.
6. Con el proveedor configurado, poner EMAIL_RECOVERY_ENABLED a true en wrangler.jsonc y desplegar. Probar con correo propio: asociar, recibir enlace, verificar, solicitar recuperación, cambiar contraseña y volver a entrar; revisar que se conserve el progreso.

El reset enviado por correo vence en 30 minutos. La verificación vence en 24 horas. Cada token es aleatorio y de un uso; la base solo almacena su SHA-256. Los enlaces contienen el token en el fragmento URL para que no se transmita automáticamente en solicitudes HTTP. El reset invalida las sesiones antiguas.
Los códigos personales son ocho, con 48 caracteres hexadecimales aleatorios cada uno; se muestran una sola vez. La regeneración exige la contraseña actual e invalida los anteriores. El restablecimiento con cada código también invalida sesiones anteriores.

En el plan gratuito de Resend se admiten 3.000 envíos mensuales y 100 diarios (confirmar precios y cuotas al activarlo). El sistema nunca envía mensajes ni admite restablecimiento por email mientras EMAIL_RECOVERY_ENABLED sea false.


## Acceso académico para una segunda profesora (sin permisos técnicos)

El campus permite asignar un permiso `teacher` a una cuenta registrada sin modificar el `CHECK` original de `users.role`, ni añadir permisos de Cloudflare, GitHub o configuración del Worker. El permiso docente se almacena por separado en `teacher_grants`, tabla aditiva creada automáticamente mediante una operación autenticada y autorizada del administrador al habilitar la primera docente.

**Alta en el panel (administrador):**
1. Entrar al campus con la cuenta administradora y abrir **Mi cuenta**.
2. Generar una **invitación individual** en «Invitar estudiantes», identificada para la profesora.
3. Entregar el código por un canal privado. La profesora se registra con su propio usuario, correo y contraseña; inicialmente aparece como estudiante.
4. En «Acceso de otros docentes», escribir **su nombre de usuario exacto** y pulsar «Habilitar docente».
5. Pedirle que vuelva a iniciar sesión o actualice la página para mostrar el **panel académico**. El acceso se verifica también en cada petición del servidor, incluso con sesiones ya abiertas.

**Qué puede hacer:** leer el curso, consultar lista y progreso de estudiantes, revisar la propuesta escrita y los cuestionarios por estudiante, escribir devoluciones que aparecen en «Mi cuenta» del alumno, generar/revocar invitaciones y emitir códigos de recuperación de cuentas estudiantiles previa comprobación de identidad.

**Qué no puede hacer:** crear o revocar otros docentes, recuperar cuentas docentes mediante la herramienta asistida, alterar permisos de administrador, gestionar secretos/API keys, modificar configuración de Cloudflare o desplegar software.

El administrador puede **revocar** un permiso docente desde el mismo panel; la revocación surte efecto sin cambiar la contraseña ni volver a crear la cuenta. El contenido de las notas personales privadas del alumno **no se muestra** en la revisión de tareas. Las tablas `teacher_grants` y `academic_reviews` se crean de forma aditiva únicamente al realizar las operaciones correspondientes; no se recrea ni borra la tabla `users`.

**Importante:** una cuenta docente no se crea enviando simplemente un correo. Debe haber un registro individual y una habilitación explícita por el administrador del campus.

# Portal DreamTeam

Una sola plataforma para los colaboradores de DreamTeam Contact Center, es decir, quienes ya ingresaron a la empresa (pasaron su OJT). Las postulaciones se gestionan en DreamTeam Campus, no aquí. La dirección principal (`/`) lleva al inicio de sesión.

- **Panel de colaboradores** (`/app`): quien no es Administrador entra a un inicio sin barra lateral, con un bloque con foto por cada módulo de su rol (la foto se elige en Administración → Módulos). Cada persona ve los módulos de su rol (CRM, Reportes, Campus, Correo, Directorio, Comunicados…), con favoritos, accesos rápidos y buscador `Ctrl K`.
- **Centro de Reportes** (módulo del panel): reportes del CRM que salen solos por correo (desde una cuenta de Google) y WhatsApp, con el contenido, los destinatarios y los horarios que se definen desde la pantalla.
- **Administración** (`/admin`): módulos, usuarios, roles y permisos, comunicados, auditoría y configuración, cada una protegida por su permiso.

Reemplaza la "Consola de Colaboradores" del repo DT-deployment, cuyo login vivía en el JavaScript del navegador. Aquí el acceso, los permisos y la restricción por IP se validan en el servidor.

## Arranque local

Requisitos: Node 20+.

```bash
npm run setup   # instala dependencias, crea la base SQLite local y carga datos de ejemplo
npm run dev     # API en :4100, worker de reportes y web en http://localhost:5174
```

| Rol | Correo | Contraseña |
|---|---|---|
| Administrador | admin@dreamteam.com.pe | Admin2026! |
| Supervisor | rosa.villanueva@dreamteam.com.pe | Supervisor2026 |
| Recursos Humanos | walter.rosario@dreamteam.com.pe | Rrhh2026 |
| Asesor comercial | diego.huaman@dreamteam.com.pe | Asesor2026 |
| Backoffice | lucia.ramos@dreamteam.com.pe | Backoffice2026 |

Volver a los datos de ejemplo: `npm run db:reset -w server` (borra todo).

## Módulos

Un módulo es una tarjeta del panel. El administrador elige cómo se abre:

| Tipo | Qué hace | Ejemplo |
|---|---|---|
| Incrustado | Muestra otra web dentro del portal, con el menú a la vista | Apps propias que permitan mostrarse incrustadas |
| Enlace externo | Abre otra web (en pestaña nueva o en la misma) | CRM, correo, Apps Script |
| Pantalla interna | Una pantalla propia del portal | Directorio, Comunicados |

Lo ven los roles marcados en el módulo, los usuarios agregados uno a uno y siempre el administrador. Cada apertura se registra para los "más usados" y el dashboard.

Para agregar una pantalla interna nueva: crea el componente en `web/src/pages/app/`, regístralo en `INTERNAL_SCREENS` de `web/src/pages/app/module-view.tsx` y en `INTERNAL_SCREENS` de `server/src/lib/modules.ts`.

## Centro de Reportes

Reemplaza al Report Center y a los Apps Script de reportes. Cada reporte es una **definición** que se arma desde el portal, sobre una plantilla visual fija:

- **Fuente**: campaña del CRM (`/api/export/sales`).
- **Filtros**: campo, condición (igual, alguno de, es hoy, de este mes, últimos N días…) y valor. “Leer campos del CRM” sugiere los campos y valores reales.
- **Agrupación** (por supervisor u otro campo), **columnas** con formato e **indicadores** por sección.
- **Salidas**: reporte en el cuerpo del correo, imagen para WhatsApp y Excel (una hoja por grupo o una sola).
- **Envío**: horarios y días (hora de Lima), destinatarios (correos, números o grupos de WhatsApp), asunto y texto con variables `{reporte} {subtitulo} {fecha} {total}`, reintentos y “no enviar si está vacío”.

Los 6 reportes del Apps Script (PDT de instalar, Seguimiento BO, Instaladas, Canceladas, En proceso, Ventas del mes BO) vienen como plantillas. También hay reportes de **captura de pantalla** con login (contraseñas cifradas).

La ejecución la hace `server/src/worker.ts`, un proceso aparte del API: revisa los horarios, procesa la cola (programados, “Enviar ahora”, pruebas y vistas previas), reintenta y guarda bitácora, imágenes y Excel de cada envío por 30 días.

Las conexiones (cuenta de Google, API key del CRM, Evolution API) se cargan en **Centro de Reportes → Conexiones** y se guardan cifradas. En local, `server/.env` trae `CRM_DEMO=1`, `SMTP_HOST=mock` y `EVOLUTION_API_URL=mock`: ventas ficticias y envíos simulados, sin tocar datos reales.

Permisos: quién ve el módulo lo decide la configuración del módulo; crear, editar, enviar y configurar conexiones es solo del Administrador.

## Roles

**Solo el rol Administrador administra**: crea, edita y borra módulos, usuarios, roles, reportes, comunicados y configuración, y ve la auditoría. Se aplica en el servidor (`server/src/lib/permissions.ts`): cualquier otro rol tiene cero permisos aunque la base diga otra cosa.

Los demás roles (Supervisor, RRHH, Backoffice, Asesor y los que se creen) **solo usan su panel**: ven y abren los módulos que el Administrador les asigne. Si uno de esos módulos es el Centro de Reportes, lo ven en modo lectura (historial y vistas previas, sin editar ni enviar).

Cada rol define además los módulos que ve y si puede entrar desde fuera de la oficina cuando la restricción por IP está activa. Los cinco roles base (Administrador, Supervisor, Asesor, RRHH y Backoffice) son de sistema y no se pueden borrar.

**Matriz fija de roles** (`server/src/lib/role-matrix.ts`): qué módulos ve cada rol base y qué puede hacer en cada uno. Se aplica en cada arranque del API, así que la base siempre queda alineada con el código. En **Administración → Roles** esos módulos salen con candado y el botón **Matriz de roles** muestra la tabla completa. Los roles que se creen a mano se siguen configurando desde su tarjeta.

## Inventario

Módulo interno (`web/src/pages/app/inventory/`, API en `server/src/routes/inventory*.ts`) para las 3 sedes (Izaguirre, Sede 2 y Sede 3; se renombran en **Inventario → Configurar → Sedes**):

- **Plano de sala**: islas y puestos con el kit de cada uno; se arrastran equipos del almacén a un puesto o un kit entero de un puesto a otro. **Editor de plano** en cuadrícula.
- **Almacén de insumos**: stock por sede, mínimo con alertas, kardex, traslados entre sedes y entregas que el colaborador confirma.
- **Equipos**: especificaciones, garantía, asignación a persona o puesto, bitácora y traslados entre sedes.
- **Incidencias**: tablero con arrastrar y soltar; "En atención" manda el equipo a reparación.
- **Excel**: plantillas, importación con vista previa y exportación. **Categorías** configurables.

Permisos (alcance por sede, `User.siteId`, que se asigna en Administración → Usuarios):

| Rol | Qué hace |
|---|---|
| Administrador | Todo, en todas las sedes |
| Supervisor | Su sede: recibe traslados, acomoda equipos en el plano, entrega insumos y reporta fallas |
| Asesor, RRHH, Backoffice | Solo "Mi equipo": su puesto y equipos, confirma entregas y reporta fallas |

## Seguridad

- Contraseñas con bcrypt, sesión JWT y bloqueo tras N intentos fallidos (configurable).
- La contraseña que asigna un administrador se guarda cifrada (AES-256-GCM) para poder mostrarla. Se borra en cuanto el usuario la cambia, y se le pide cambiarla al entrar.
- Restricción por IP (IP exacta o rango CIDR) validada en cada petición del API, no en el navegador.
- Auditoría de inicios de sesión, bloqueos y cambios de administración, con la IP de origen.
- No hay secretos en el repositorio: todo va en `server/.env` (ver `deploy/env.production.example`).

## Estructura

```
server/   API Express 5 + Prisma (PostgreSQL en producción, SQLite en local)
  prisma/schema.prisma   modelo de datos
  prisma/bootstrap.ts    roles, módulos y ajustes iniciales
  src/routes/            auth, portal (colaborador), modules, users, roles, announcements, admin, settings, reports
  src/reports/           motor de reportes: definición, CRM, HTML, Excel, Playwright, correo, WhatsApp
  src/worker.ts          worker del Centro de Reportes
  src/lib/               auth, permisos, IP, auditoría, ajustes, cifrado
web/      React 19 + Vite + Tailwind 4 + componentes estilo shadcn/ui (Radix)
  src/pages/app/         panel de colaboradores
  src/pages/admin/       administración
deploy/   Nginx, systemd, update.sh, backup.sh y la guía del VPS
```

El despliegue en el VPS está en [deploy/README.md](deploy/README.md).

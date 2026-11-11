# Despliegue en el VPS · portal.dreamteam.com.pe

Ubuntu 24.04 · Nginx · PostgreSQL · Node 22 · archivos por WinSCP. Es el mismo esquema del Campus.
El portal queda en `/var/www/portal`, corre como el usuario de sistema `portal` y el API escucha solo en `127.0.0.1:4100`.

| Archivo de esta carpeta | Va en el VPS |
| --- | --- |
| `nginx-portal.conf` | `/etc/nginx/sites-available/portal.dreamteam.com.pe` |
| `portal-api.service` | `/etc/systemd/system/portal-api.service` |
| `portal-worker.service` | `/etc/systemd/system/portal-worker.service` (Centro de Reportes) |
| `env.production.example` | `/var/www/portal/server/.env` (con tus valores) |
| `update.sh` | se ejecuta después de cada subida |
| `backup.sh` | respaldo diario por cron |

Los comandos se ejecutan por SSH como root (en WinSCP: **Comandos → Abrir en PuTTY**).

---

## 0. DNS y revisión previa

1. Crea un registro **A** `portal` → IP del VPS en el DNS de `dreamteam.com.pe`. Comprueba con `nslookup portal.dreamteam.com.pe`.
2. El VPS ya tiene el CRM, la web informativa y el Campus. Antes de instalar nada:

```bash
node -v; which node                   # el Campus ya instaló Node 22: se reutiliza
ss -ltnp | grep -E ':4100|:4000'      # 4100 debe estar libre (4000 es del Campus)
ls /etc/nginx/sites-enabled/
sudo -u postgres psql -c '\l'
free -h; df -h /
```

- **Puerto 4100 ocupado:** usa otro en `PORT` del `.env`, en `proxy_pass` de Nginx y en `update.sh`.
- **Node:** si el Campus usa `/opt/node22`, cambia `ExecStart` del servicio a `/opt/node22/bin/node` y agrega `export PATH=/opt/node22/bin:$PATH` en `update.sh`.

## 1. Usuario, carpeta y base de datos

```bash
useradd --system --create-home --shell /usr/sbin/nologin portal
mkdir -p /var/www/portal
openssl rand -hex 24          # copia el resultado: será la clave de PostgreSQL
sudo -u postgres psql
```

Dentro de `psql`:

```sql
CREATE USER portal WITH PASSWORD 'LA_CLAVE_GENERADA';
CREATE DATABASE portal OWNER portal ENCODING 'UTF8';
\q
```

## 2. Subir el proyecto con WinSCP

Sube la carpeta `portal-dreamteam` a `/var/www/portal` **sin** estas carpetas y archivos (WinSCP → Preferencias → Transferencia → Editar → Máscara de archivo):

```
| node_modules/; dist/; .env; *.db; *.db-journal; schema.dev.prisma
```

Debe quedar así: `/var/www/portal/package.json`, `/var/www/portal/server/`, `/var/www/portal/web/`, `/var/www/portal/deploy/`.

## 3. Variables de entorno

```bash
cp /var/www/portal/deploy/env.production.example /var/www/portal/server/.env
nano /var/www/portal/server/.env
```

- `DATABASE_URL`: la clave del paso 1.
- `JWT_SECRET` y `PASSWORD_VAULT_KEY`: ejecuta `openssl rand -hex 32` una vez por cada una. **El API no arranca en producción sin `JWT_SECRET`.**
- `PASSWORD_VAULT_KEY` no se cambia nunca más: si cambia, las contraseñas asignadas dejan de verse con el ojito.

## 4. Servicios e instalación

El portal corre como dos servicios: `portal-api` (la web y el API) y `portal-worker` (programa y envía los reportes con Chromium).

```bash
sed -i 's/\r$//' /var/www/portal/deploy/*.sh
# Librerías del sistema que necesita Chromium (una sola vez)
cd /var/www/portal && npx --yes playwright@1.64.1 install-deps chromium
cp /var/www/portal/deploy/portal-api.service /var/www/portal/deploy/portal-worker.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable portal-api portal-worker
bash /var/www/portal/deploy/update.sh     # instala, crea las tablas, descarga Chromium, compila y arranca
```

El worker usa unos 300 MB de RAM mientras genera una imagen. Si el VPS tiene poca memoria, revisa `free -h` antes.

Debe terminar con **“Portal actualizado y en línea.”** Si falla: `journalctl -u portal-api -n 50`.

## 5. Crear el administrador

Crea los roles y módulos iniciales (CRM, Reportes, Campus, Correo, etc.) y tu cuenta:

```bash
read -rsp "Contraseña del administrador: " ADMIN_PASSWORD; echo; export ADMIN_PASSWORD
sudo -u portal -H --preserve-env=ADMIN_PASSWORD bash -c \
  'cd /var/www/portal/server && ADMIN_EMAIL=licencias@dreamteam.com.pe ADMIN_NAME="Administrador Portal" npm run db:init'
unset ADMIN_PASSWORD
```

La contraseña necesita al menos 10 caracteres y un número. No se cargan usuarios de ejemplo.

## 6. Nginx y HTTPS

Es un bloque `server` aparte: no se toca la configuración del CRM, la web ni el Campus.

```bash
mkdir -p /etc/nginx/snippets
cp /var/www/portal/deploy/nginx-portal-headers.conf /etc/nginx/snippets/portal-headers.conf
cp /var/www/portal/deploy/nginx-portal.conf /etc/nginx/sites-available/portal.dreamteam.com.pe
ln -s /etc/nginx/sites-available/portal.dreamteam.com.pe /etc/nginx/sites-enabled/
nginx -t            # si da error, NO recargues: borra el enlace y avísame
systemctl reload nginx
certbot --nginx -d portal.dreamteam.com.pe
```

## 7. Firewall y respaldos

```bash
ufw status        # 4100 y 5432 NO deben aparecer abiertos al público
crontab -e
# agrega:
30 3 * * * bash /var/www/portal/deploy/backup.sh >> /var/log/portal-backup.log 2>&1
```

Prueba el respaldo una vez a mano: `bash /var/www/portal/deploy/backup.sh`.

## 8. Comprobar

1. Abre `https://portal.dreamteam.com.pe`: debe abrirse el inicio de sesión.
2. Ingresa con el administrador.
3. **Administración → Módulos**: revisa las URLs de cada módulo (el CRM está con la IP del VPS; cámbiala si tiene dominio).
4. **Administración → Usuarios**: crea un asesor de prueba e ingresa con él en otra ventana.
5. **Centro de Reportes → Conexiones**: carga la cuenta de Google (correo + contraseña de aplicación), la API key del CRM y, si usarás WhatsApp, la Evolution API. Usa “Probar” en cada una.
6. **Centro de Reportes → Reportes**: los 6 reportes del Apps Script ya están creados y pausados. Asígnales destinatarios, revisa la vista previa y actívalos. En el Resumen, “Worker de reportes” debe estar en verde.
7. **Configuración → Red**: si vas a limitar el acceso a la oficina, agrega primero la IP pública de la oficina y luego activa la restricción.

El portal es solo para colaboradores: no tiene web pública ni recibe postulaciones (eso vive en DreamTeam Campus).

---

## Actualizar más adelante

1. Sube por WinSCP los archivos cambiados (misma máscara del paso 2).
2. Ejecuta `bash /var/www/portal/deploy/update.sh`.

Si `update.sh` se detiene diciendo que un cambio de base “borraría datos”, no lo fuerces.

## Problemas comunes

| Síntoma | Qué revisar |
| --- | --- |
| `502 Bad Gateway` | El API está caído: `systemctl status portal-api` y `journalctl -u portal-api -n 50` |
| Recargar `/admin/...` da 404 | Falta el bloque `location /` con `try_files` en Nginx |
| Un módulo incrustado sale en blanco | Ese sitio no permite mostrarse dentro de otra página: cámbialo a **Enlace externo** |
| Todos ven “Acceso restringido” | La restricción por IP está activa sin la IP de la oficina: entra como administrador y agrégala |
| “Worker de reportes” en rojo | `systemctl status portal-worker` y `journalctl -u portal-worker -n 50` |
| Un reporte falla con “No se pudo abrir Chromium” | `npx playwright install-deps chromium` como root y vuelve a ejecutar `update.sh` |
| Google rechaza el correo | Debe ser una contraseña de aplicación y la cuenta debe tener la verificación en dos pasos |
| `$'\r': command not found` | `sed -i 's/\r$//' /var/www/portal/deploy/*.sh` |
